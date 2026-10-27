import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import posthog from 'posthog-js';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import { EmptyState } from '@/components/EmptyState';
import { tabPanelId, tabId } from '@/lib/tab-ids';
import { InvoicesEmptyIllustration } from '@/components/PageEmptyIllustrations';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { createInvoice, nextInvoiceId, removeInvoice } from '@/lib/api/invoices';
import { recordInvoiceIssuanceEntry } from '@/lib/api/accounting';
import { saveLineItems } from '@/lib/api/line-items';
import { createActivity } from '@/lib/api/activities';
import {
  STATUS_LABEL, fmt, fmtCompact, fmtDate, fmtDue, nextId, newLineItem, clientInitials,
} from '@/data';
import type { FilterKey, Status, LineItem } from '@/data';
import type { Activity } from '@/lib/schemas';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',     label: 'Toutes' },
  { key: 'paid',    label: 'Payées' },
  { key: 'pending', label: 'En attente' },
  { key: 'overdue', label: 'En retard' },
  { key: 'draft',   label: 'Brouillons' },
];

/** Rendered by SalesPage, which passes the Factures | Devis tab switcher. */
export default function InvoicesPage({ tabs }: { tabs?: ReactNode }) {
  const { invoices, setInvoices, setActivity, showToast, clientsMap, products, orgSettings, orgId, loading } = useApp();

  const navigate = useNavigate();

  const [filter, setFilter]     = useState<FilterKey>('all');
  const [panelOpen, setPanelOpen] = useState(false);

  // New invoice form state
  const [fClient,  setFClient]  = useState('');
  const [fDate,    setFDate]    = useState(() => new Date().toISOString().slice(0, 10));
  const [fDue,     setFDue]     = useState(() => new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  const [fSubject, setFSubject] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [fPay,      setFPay]      = useState('Mobile Money (MTN / Orange / Wave)');
  const [fNotes,    setFNotes]    = useState('');
  const [fDiscount, setFDiscount] = useState(0);
  const [showPicker, setShowPicker]   = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const submittingRef = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showPicker]);

  const filteredProducts = useMemo(() => {
    const q = pickerQuery.toLowerCase();
    return products.filter(p => !q || p.name.toLowerCase().includes(q));
  }, [products, pickerQuery]);

  function addFromProduct(productId: string) {
    const p = products.find(pr => pr.id === productId);
    if (!p) return;
    setLineItems(prev => [...prev, newLineItem(p.name, 1, p.price, p.unit, p.id)]);
    setShowPicker(false);
    setPickerQuery('');
  }

  const filteredInvoices = useMemo(
    () => filter === 'all' ? invoices : invoices.filter(i => i.status === filter),
    [invoices, filter],
  );

  const filterCounts = useMemo(() => {
    const counts: Partial<Record<FilterKey, number>> = { all: invoices.length };
    invoices.forEach(i => { counts[i.status] = (counts[i.status] ?? 0) + 1; });
    return counts;
  }, [invoices]);

  const canInvoiceTVA   = orgSettings.taxRegime === 'RNI';
  const subtotal        = useMemo(() => lineItems.reduce((s, li) => s + li.qty * li.price, 0), [lineItems]);
  const discountAmt     = Math.round(subtotal * (fDiscount / 100));
  const discountedSub   = subtotal - discountAmt;
  const tax             = canInvoiceTVA ? Math.round(discountedSub * 0.18) : 0;
  const total           = discountedSub + tax;

  const openPanel = () => {
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    setFClient(''); setFDate(today); setFDue(due); setFSubject(''); setFNotes(''); setFDiscount(0);
    setLineItems([newLineItem('', 1, 250_000), newLineItem('', 3, 75_000)]);
    setShowPicker(false); setPickerQuery('');
    setPanelOpen(true);
  };
  const closePanel = () => { setPanelOpen(false); setShowPicker(false); };

  const addLine    = () => setLineItems(prev => [...prev, newLineItem()]);
  const removeLine = (id: string) =>
    setLineItems(prev => prev.length > 1 ? prev.filter(li => li.id !== id) : [newLineItem()]);
  const updateLine = (id: string, field: 'desc' | 'unit' | 'qty' | 'price', val: string) =>
    setLineItems(prev => prev.map(li => li.id !== id ? li : {
      ...li, [field]: field === 'desc' || field === 'unit' ? val : (parseFloat(val) || 0),
    }));

  const sendReminder = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const actEntry: Activity = { kind: 'sent', parts: [{ text: 'Relance envoyée pour ' }, { text: `#${id}`, bold: true }], time: "À l'instant" };
    setActivity((prev: Activity[]) => [actEntry, ...prev]);
    try {
      await createActivity(orgId, { kind: actEntry.kind, parts: actEntry.parts });
      showToast(`Relance envoyée pour #${id}`);
    } catch (err) {
      console.error('[sendReminder] error:', err);
      setActivity((prev: Activity[]) => prev.filter(a => a !== actEntry));
      showToast('Erreur lors de l\'envoi de la relance. Veuillez réessayer.', true);
    }
  };

  const submitInvoice = async (status: 'draft' | 'pending') => {
    if (submittingRef.current) return;
    if (!fClient)      { showToast('Veuillez sélectionner un client.', true); return; }
    if (subtotal <= 0) { showToast('Ajoutez au moins une ligne de facturation.', true); return; }
    submittingRef.current = true;
    setSubmitting(true);

    const isFirstInvoice = invoices.length === 0;
    const cName = clientsMap[fClient]?.name ?? fClient;
    let invoiceCreated = false;
    let id = '';

    try {
      id = await nextInvoiceId(orgId);
      const newInv = { id, subject: fSubject.trim() || 'Facture sans titre', client: fClient, issued: fDate, due: fDue, amount: total, status, discountPct: fDiscount };
      await createInvoice(orgId, newInv);
      invoiceCreated = true;
      // Don't leave an invoice without lines behind if saving them fails
      try {
        await saveLineItems(orgId, lineItems, { invoiceId: id });
      } catch (lineErr) {
        await removeInvoice(orgId, id).catch(e => console.error('[rollback] removeInvoice failed:', e));
        invoiceCreated = false;
        throw lineErr;
      }

      posthog.capture('invoice_created', { invoice_type: status, item_count: lineItems.length, total_amount: total, currency: 'XOF' });
      if (status === 'pending') posthog.capture('invoice_sent', { invoice_id: id, delivery_method: fPay });
      if (isFirstInvoice) posthog.capture('first_invoice_created');

      setInvoices(prev => [newInv, ...prev]);

      const actPayload = status === 'pending'
        ? { kind: 'sent'   as const, parts: [{ text: 'Facture ' }, { text: `#${id}`, bold: true as const }, { text: ' envoyée à ' }, { text: cName, bold: true as const }] }
        : { kind: 'viewed' as const, parts: [{ text: 'Brouillon ' }, { text: `#${id}`, bold: true as const }, { text: ' enregistré pour ' }, { text: cName, bold: true as const }] };
      const actEntry: Activity = { ...actPayload, time: "À l'instant" };
      setActivity((prev: Activity[]) => [actEntry, ...prev]);
      // The invoice is saved at this point; a failed activity log must not make it look unsaved
      createActivity(orgId, actPayload).catch(err => console.error('[createActivity] failed:', err));

      closePanel();
      showToast(status === 'pending' ? `Facture #${id} envoyée à ${cName}` : `Brouillon #${id} enregistré`);

      if (status === 'pending') {
        recordInvoiceIssuanceEntry(orgId, {
          invoiceId:  id,
          htAmount:   discountedSub,
          tvaAmount:  tax,
          date:       fDate,
          clientName: cName,
        }).catch(err => console.error('[recordInvoiceIssuanceEntry] failed:', err));
      }
    } catch (err) {
      console.error('[submitInvoice] error:', err);
      showToast(invoiceCreated
        ? `La facture #${id} a été créée, mais une erreur est survenue ensuite. Vérifiez-la avant de réessayer.`
        : 'Une erreur est survenue. La facture n\'a pas été enregistrée — veuillez réessayer.', true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <PageSkeleton title="Facturation" subtitle="Gérez et suivez vos factures" metrics={4} rows={6} />;

  return (
    <>
      <div className="main">
        <div className="topbar">
          <div>
            <div className="page-title">Facturation</div>
            <div className="page-sub">Gérez et suivez vos factures</div>
          </div>
          <div className="topbar-actions">
            <button className="btn"><Icon name="search" ariaHidden /> Rechercher</button>
            <button className="btn btn-primary" onClick={openPanel}>
              <Icon name="plus" ariaHidden /> Nouvelle facture
            </button>
          </div>
        </div>

        <div className="content">
          {/* Metrics */}
          <div className="metrics">
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico blue"><Icon name="file-invoice" size={15} ariaHidden /></div>
                <div className="metric-label">Total facturé</div>
              </div>
              <div className="metric-value tnum">
                {fmtCompact(invoices.filter(i => i.status !== 'draft').reduce((s, i) => s + i.amount, 0))}
                <span className="metric-unit">F CFA</span>
              </div>
              <div className="metric-change neutral">{invoices.filter(i => i.status !== 'draft').length} factures émises</div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico green"><Icon name="circle-check-filled" size={15} ariaHidden /></div>
                <div className="metric-label">Encaissé</div>
              </div>
              <div className="metric-value tnum">
                {fmtCompact(invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0))}
                <span className="metric-unit">F CFA</span>
              </div>
              <div className="metric-change neutral">{invoices.filter(i => i.status === 'paid').length} factures payées</div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico amber"><Icon name="clock-pause" size={15} ariaHidden /></div>
                <div className="metric-label">En attente</div>
              </div>
              <div className="metric-value tnum">
                {fmtCompact(invoices.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0))}
                <span className="metric-unit">F CFA</span>
              </div>
              <div className="metric-change neutral">{invoices.filter(i => i.status === 'pending').length} en attente de paiement</div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico" style={{ background: '#FCEBEB', color: '#A32D2D' }}><Icon name="alert-triangle" size={15} ariaHidden /></div>
                <div className="metric-label">En retard</div>
              </div>
              <div className="metric-value tnum" style={{ color: invoices.some(i => i.status === 'overdue') ? '#A32D2D' : undefined }}>
                {fmtCompact(invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0))}
                <span className="metric-unit">F CFA</span>
              </div>
              <div className="metric-change neutral">{invoices.filter(i => i.status === 'overdue').length} factures en retard</div>
            </div>
          </div>

          <div className="section-header">
            {tabs ?? <div className="section-title">Toutes les factures</div>}
            <div className="filters">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  className={`filter-chip${filter === f.key ? ' active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}<span className="cnt">{filterCounts[f.key] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="invoice-table" {...(tabs ? { role: 'tabpanel', id: tabPanelId('sales'), 'aria-labelledby': tabId('sales', 'invoices') } : {})}>
            <div className="table-head grid-cols">
              <div className="th">Facture</div>
              <div className="th">Client</div>
              <div className="th">Émission / Échéance</div>
              <div className="th right">Montant</div>
              <div className="th">Statut</div>
              <div className="th" />
            </div>

            {filteredInvoices.length === 0 ? (
              <EmptyState
                illustration={<InvoicesEmptyIllustration />}
                title={filter !== 'all' ? `Aucune facture « ${STATUS_LABEL[filter as Status]} »` : 'Aucune facture'}
                description="Créez votre première facture pour commencer à facturer vos clients."
              />
            ) : filteredInvoices.map(inv => {
              const c = clientsMap[inv.client] ?? (() => {
                if (import.meta.env.DEV) console.warn(`[InvoicesPage] client not in clientsMap: "${inv.client}" (invoice #${inv.id})`);
                return { name: inv.client, city: '—', av: 'av-a' };
              })();
              return (
                <div
                  key={inv.id}
                  className="inv-row grid-cols"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && navigate(`/invoices/${inv.id}`)}
                >
                  <div>
                    <div className="inv-id">#{inv.id}</div>
                    <div className="inv-subject">{inv.subject}</div>
                  </div>
                  <div className="client-cell">
                    <div className={`client-av ${c.av}`}>{clientInitials(c.name)}</div>
                    <div>
                      <div className="cell-text">{c.name}</div>
                      <div className="cell-sub">{c.city}</div>
                    </div>
                  </div>
                  <div>
                    <div className="cell-text">{fmtDate(inv.issued)}</div>
                    <div className="cell-sub">{fmtDue(inv.due)}</div>
                  </div>
                  <div className="amount tnum" style={{ textAlign: 'right' }}>
                    {fmt(inv.amount)}<span className="cur">F CFA</span>
                  </div>
                  <div>
                    <span className={`status-pill s-${inv.status}`}>{STATUS_LABEL[inv.status]}</span>
                  </div>
                  <div className="row-actions">
                    {inv.status === 'draft' && (
                      <button className="icon-btn" aria-label="Modifier" onClick={e => { e.stopPropagation(); navigate(`/invoices/${inv.id}`); }}>
                        <Icon name="edit" size={15} ariaHidden />
                      </button>
                    )}
                    {inv.status === 'paid' && (
                      <button className="icon-btn" aria-label="Télécharger" onClick={e => e.stopPropagation()}>
                        <Icon name="download" size={15} ariaHidden />
                      </button>
                    )}
                    {(inv.status === 'overdue' || inv.status === 'pending') && (
                      <button className="icon-btn" aria-label="Envoyer une relance" onClick={e => sendReminder(e, inv.id)}>
                        <Icon name="send" size={15} ariaHidden />
                      </button>
                    )}
                    <button className="icon-btn" aria-label="Plus d'options" onClick={e => e.stopPropagation()}>
                      <Icon name="dots" size={15} ariaHidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Slide-over panel — sibling of .main, both inside .main-rel */}
      <div className={`scrim${panelOpen ? ' open' : ''}`} onClick={closePanel} />
      <div className={`new-inv-panel${panelOpen ? ' open' : ''}`} role="dialog" aria-label="Nouvelle facture" aria-modal="true">
        <div className="panel-slide-head">
          <div>
            <div className="panel-slide-title">Nouvelle facture</div>
            <div className="panel-slide-sub">#{nextId(invoices)}</div>
          </div>
          <button className="icon-btn" onClick={closePanel} aria-label="Fermer">
            <Icon name="x" size={15} ariaHidden />
          </button>
        </div>

        <div className="panel-body">
          <div className="form-group">
            <label className="form-label">Client</label>
            <select className="form-input" value={fClient} onChange={e => setFClient(e.target.value)}>
              <option value="">Sélectionner un client…</option>
              {Object.entries(clientsMap).map(([code, c]) => (
                <option key={code} value={code}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Date de facturation</label>
              <input type="date" className="form-input" value={fDate} onChange={e => setFDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Date d'échéance</label>
              <input type="date" className="form-input" value={fDue} onChange={e => setFDue(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Objet</label>
            <input type="text" className="form-input" placeholder="ex. Développement web — sprint 5"
              maxLength={255} value={fSubject} onChange={e => setFSubject(e.target.value)} />
          </div>

          <div className="subhead"><span>Lignes de facturation</span></div>
          <div className="line-items-head">
            <div className="li-col">Description</div>
            <div className="li-col">Unité</div>
            <div className="li-col right">Qté</div>
            <div className="li-col right">Prix</div>
            <div />
          </div>

          {lineItems.map((li, idx) => (
            <div key={li.id} className="line-item">
              <div className="line-item-row">
                <input className="li-input" placeholder="Description du service" value={li.desc}
                  aria-label={`Description, ligne ${idx + 1}`}
                  onChange={e => updateLine(li.id, 'desc', e.target.value)} />
                <select className="li-input" value={li.unit ?? 'unité'}
                  aria-label={`Unité, ligne ${idx + 1}`}
                  onChange={e => updateLine(li.id, 'unit', e.target.value)}>
                  {['unité','heure','jour','mois','an','projet','article','licence'].map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <input className="li-input num" type="number" min="0" value={li.qty}
                  aria-label={`Quantité, ligne ${idx + 1}`}
                  onChange={e => updateLine(li.id, 'qty', e.target.value)} />
                <input className="li-input num" type="number" min="0" value={li.price || ''}
                  placeholder="0" aria-label={`Prix unitaire, ligne ${idx + 1}`}
                  onChange={e => updateLine(li.id, 'price', e.target.value)} />
                <button className="li-del" onClick={() => removeLine(li.id)} aria-label={`Supprimer la ligne ${idx + 1}`}>
                  <Icon name="trash" size={15} ariaHidden />
                </button>
              </div>
            </div>
          ))}

          <div className="line-actions">
            <button className="add-line" onClick={addLine}>
              <Icon name="plus" size={14} ariaHidden /> Ajouter une ligne
            </button>
            {products.length > 0 && (
              <div className="product-picker-wrap" ref={pickerRef}>
                <button className="catalog-btn" onClick={() => setShowPicker(v => !v)}>
                  <Icon name="package" size={14} ariaHidden />
                  Depuis le catalogue
                </button>
                {showPicker && (
                  <div className="product-picker-dropdown">
                    <input
                      autoFocus
                      placeholder="Rechercher…"
                      value={pickerQuery}
                      onChange={e => setPickerQuery(e.target.value)}
                    />
                    {filteredProducts.length === 0 ? (
                      <div className="picker-empty">Aucun produit trouvé</div>
                    ) : filteredProducts.map(p => (
                      <div key={p.id} className="picker-item" onClick={() => addFromProduct(p.id)}>
                        <div>
                          <div className="picker-item-name">{p.name}</div>
                          <div className="picker-item-meta">{p.unit}</div>
                        </div>
                        <div className="picker-item-price">{fmt(p.price)} F</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="total-block">
            <div className="total-row"><span>Sous-total HT</span><span>{fmt(subtotal)} F CFA</span></div>
            <div className="total-row" style={{ alignItems: 'center' }}>
              <span>Remise (%)</span>
              <input
                type="number" min="0" max="100" step="0.5"
                className="form-input"
                style={{ width: 80, textAlign: 'right', padding: '3px 8px', fontSize: 13 }}
                value={fDiscount || ''}
                placeholder="0"
                onChange={e => setFDiscount(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
              />
            </div>
            {fDiscount > 0 && <div className="total-row" style={{ color: 'var(--color-text-secondary)' }}><span>Montant remise</span><span>−{fmt(discountAmt)} F CFA</span></div>}
            {canInvoiceTVA && <div className="total-row"><span>TVA (18 %)</span><span>{fmt(tax)} F CFA</span></div>}
            <div className="total-row final"><span>Total à payer</span><span>{fmt(total)} F CFA</span></div>
          </div>

          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Mode de paiement</label>
            <select className="form-input" value={fPay} onChange={e => setFPay(e.target.value)}>
              <option>Mobile Money (MTN / Orange / Wave)</option>
              <option>Virement bancaire</option>
              <option>Paiement à la livraison</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={2} placeholder="Merci pour votre confiance…"
              style={{ resize: 'none', lineHeight: 1.5 }} maxLength={1000} value={fNotes}
              onChange={e => setFNotes(e.target.value)} />
          </div>
        </div>

        <div className="panel-footer">
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} disabled={submitting} onClick={() => submitInvoice('draft')}>
            {submitting ? 'Enregistrement…' : 'Enregistrer brouillon'}
          </button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={submitting} onClick={() => submitInvoice('pending')}>
            <Icon name="send" ariaHidden /> {submitting ? 'Envoi en cours…' : 'Envoyer la facture'}
          </button>
        </div>
      </div>
    </>
  );
}
