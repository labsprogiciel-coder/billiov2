import { useState, useEffect, useRef } from 'react';
import posthog from 'posthog-js';
import { useParams, useNavigate } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { updateQuote } from '@/lib/api/quotes';
import { fetchLineItems, saveLineItems, deleteLineItems } from '@/lib/api/line-items';
import { convertQuoteToInvoice } from '@/lib/api/quote-conversion';
import { InvoicePDFDocument } from '@/components/InvoicePDF';
import { downloadBlob } from '@/lib/download';
import { fmt, fmtDateLong, newLineItem } from '@/data';
import type { LineItem } from '@/lib/schemas';

const STATUS_LABEL: Record<string, string> = {
  draft:    'Brouillon',
  sent:     'Envoyé',
  accepted: 'Accepté',
  declined: 'Refusé',
  expired:  'Expiré',
  invoiced: 'Facturé',
};

const BillioLogoSvg = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5.5 3.2h10.2c.6 0 1.1.2 1.5.6l3 3c.4.4.6.9.6 1.5v12c0 .7-.6 1.1-1.2.8l-1.6-.8-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.6.8c-.6.3-1.3-.1-1.3-.8V4.7c0-.8.7-1.5 1.5-1.5z" fill="#fff" fillOpacity="0.96"/>
    <path d="M8 8.2h6M8 11.4h7M8 14.6h4" stroke="#185FA5" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
);

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { quotes, setQuotes, setInvoices, showToast, clientsMap, products, orgSettings, orgId, loading } = useApp();
  const [lines, setLines] = useState<LineItem[]>([]);
  const [converting, setConverting] = useState(false);
  const convertingRef = useRef(false);

  // Edit panel state
  const [editOpen,    setEditOpen]    = useState(false);
  const [eClient,     setEClient]     = useState('');
  const [eSubject,    setESubject]    = useState('');
  const [eDate,       setEDate]       = useState('');
  const [eValid,      setEValid]      = useState('');
  const [eLines,      setELines]      = useState<LineItem[]>([]);
  const [saving,      setSaving]      = useState(false);
  const [showPicker,  setShowPicker]  = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showPicker]);

  useEffect(() => {
    if (id && orgId) fetchLineItems(orgId, { quoteId: id }).then(setLines).catch(err => { console.error('[QuotePage] fetchLineItems error:', err); setLines([]); });
  }, [id, orgId]);

  if (loading) return <PageSkeleton title="Devis" variant="table-only" metrics={0} rows={4} />;

  const quote = quotes.find(q => q.id === id);
  if (!quote) {
    return (
      <div className="main">
        <div className="topbar">
          <div className="crumbs">
            <button className="crumb-back" onClick={() => navigate('/invoices?tab=quotes')} aria-label="Retour">
              <Icon name="arrow-left" ariaHidden />
            </button>
            <div className="crumb-text">Devis introuvable</div>
          </div>
        </div>
        <div className="content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>
          Le devis #{id} n'existe pas.
        </div>
      </div>
    );
  }

  const client       = clientsMap[quote.client] ?? { name: quote.client, city: '—', av: 'av-a' };
  const subtotal     = lines.reduce((s, li) => s + li.qty * li.price, 0);
  const canInvoiceTVA = orgSettings.taxRegime === 'RNI';
  const tax          = canInvoiceTVA ? Math.round(subtotal * 0.18) : 0;
  const total        = subtotal + tax;

  const quoteUrl    = window.location.href;
  const isTerminal  = ['invoiced', 'declined', 'expired'].includes(quote.status);
  const canConvert  = !isTerminal;
  const canEdit     = !isTerminal;

  const eSubtotal = eLines.reduce((s, l) => s + l.qty * l.price, 0);
  const eTax      = canInvoiceTVA ? Math.round(eSubtotal * 0.18) : 0;
  const eTotal    = eSubtotal + eTax;

  const filteredProducts = products.filter(p => !pickerQuery || p.name.toLowerCase().includes(pickerQuery.toLowerCase()));

  const openEdit = () => {
    setEClient(quote.client);
    setESubject(quote.subject);
    setEDate(quote.issued);
    setEValid(quote.valid);
    setELines(lines.length ? lines.map(l => ({ ...l })) : [newLineItem()]);
    setEditOpen(true);
  };

  const updateELine = (lid: string, field: string, val: string) => {
    const asNum = Number(val);
    setELines(prev => prev.map(l => l.id === lid
      ? { ...l, [field]: field === 'qty' || field === 'price' ? (isNaN(asNum) ? 0 : asNum) : val }
      : l));
  };

  const handleSaveEdit = async () => {
    if (!eClient) { showToast('Veuillez sélectionner un client.', true); return; }
    if (!eDate)   { showToast('La date du devis est requise.', true); return; }
    if (!eValid)  { showToast('La date de validité est requise.', true); return; }
    if (eValid < eDate) { showToast('La date de validité doit être après la date du devis.', true); return; }
    if (eSubtotal <= 0) { showToast('Ajoutez au moins une ligne.', true); return; }
    setSaving(true);
    const prevLines = lines;
    try {
      await updateQuote(orgId, quote.id, { subject: eSubject.trim() || 'Devis sans titre', client: eClient, issued: eDate, valid: eValid, amount: eTotal });
      await deleteLineItems(orgId, { quoteId: quote.id });
      try {
        await saveLineItems(orgId, eLines, { quoteId: quote.id });
      } catch (lineErr) {
        // Restore original lines so the quote is not left empty in the DB
        if (prevLines.length > 0) {
          await saveLineItems(orgId, prevLines, { quoteId: quote.id }).catch(() => {});
        }
        throw lineErr;
      }
      setQuotes(prev => prev.map(q => q.id === quote.id
        ? { ...q, subject: eSubject.trim() || 'Devis sans titre', client: eClient, issued: eDate, valid: eValid, amount: eTotal }
        : q));
      setLines(eLines);
      setEditOpen(false);
      showToast('Devis mis à jour');
    } catch (err) {
      console.error('Edit quote failed:', err);
      showToast('Erreur lors de la mise à jour', true);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(quoteUrl);
    showToast('Lien copié dans le presse-papiers');
  };

  const handleShareEmail = () => {
    const subject = encodeURIComponent(`Devis #${quote.id} — ${orgSettings.name || 'Billio'}`);
    const body = encodeURIComponent(
      `Bonjour,\n\nVeuillez trouver ci-joint notre devis #${quote.id} d'un montant de ${fmt(total)} F CFA.\n\nObjet : ${quote.subject}\nValide jusqu'au : ${fmtDateLong(quote.valid)}\n\nConsultez le devis en ligne :\n${quoteUrl}\n\nCordialement,\n${orgSettings.name || ''}`.trim()
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(
      `Bonjour,\n\nVoici notre devis *#${quote.id}* d'un montant de *${fmt(total)} F CFA*.\n\n📋 *${quote.subject}*\n📅 Valide jusqu'au ${fmtDateLong(quote.valid)}\n\nConsultez-le ici : ${quoteUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
    posthog.capture('quote_shared_whatsapp', { quote_id: quote.id });
  };

  const handleDownloadPDF = async () => {
    const pdfLines   = editOpen ? eLines : lines;
    const pdfSubject = editOpen ? (eSubject.trim() || 'Devis sans titre') : quote.subject;
    const pdfIssued  = editOpen ? eDate : quote.issued;
    const pdfValid   = editOpen ? eValid : quote.valid;
    const pdfAmount  = editOpen ? eTotal : total;
    try {
      const blob = await pdf(
        <InvoicePDFDocument
          invoice={{ id: quote.id, subject: pdfSubject, client: quote.client, issued: pdfIssued, due: pdfValid, amount: pdfAmount, status: 'pending', discountPct: 0 }}
          lines={pdfLines}
          client={client}
          biz={orgSettings}
          title="Facture Proforma"
          clientLabel="Adressé à"
          paymentTerms={orgSettings.paymentTerms || 'Net 14 jours'}
          deliveryTerms={orgSettings.deliveryTerms || 'À convenir'}
        />
      ).toBlob();
      downloadBlob(blob, `devis-${quote.id.toLowerCase()}.pdf`);
      posthog.capture('quote_pdf_downloaded', { quote_id: quote.id });
    } catch (err) {
      console.error('[handleDownloadPDF] failed:', err);
      showToast('Impossible de générer le PDF. Veuillez réessayer.', true);
    }
  };

  const handleConvertToInvoice = async () => {
    if (convertingRef.current) return;
    convertingRef.current = true;
    setConverting(true);
    try {
      const { invoice, accountingOk } = await convertQuoteToInvoice(orgId, quote, { canInvoiceTVA, clientName: client.name });
      setInvoices(prev => prev.some(i => i.id === invoice.id) ? prev : [invoice, ...prev]);
      setQuotes(prev => prev.map(q => q.id === quote.id ? { ...q, status: 'invoiced' } : q));
      posthog.capture('quote_converted_to_invoice', { quote_id: quote.id, invoice_id: invoice.id });
      showToast(`Devis ${quote.id} → Facture #${invoice.id} créée`);
      if (!accountingOk) showToast('Facture créée, mais l\'écriture comptable a échoué. Vérifiez la comptabilité.', true);
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      console.error('[convertToInvoice] failed:', err);
      showToast('Erreur lors de la conversion. Aucune facture n\'a été créée — veuillez réessayer.', true);
    } finally {
      convertingRef.current = false;
      setConverting(false);
    }
  };

  return (
    <>
    <div className="main">
      <div className="topbar">
        <div className="crumbs">
          <button className="crumb-back" onClick={() => navigate('/invoices?tab=quotes')} aria-label="Retour aux devis">
            <Icon name="arrow-left" ariaHidden />
          </button>
          <div className="crumb-text">
            <button className="crumb-link" onClick={() => navigate('/invoices?tab=quotes')}>Devis</button>
            {' / '}<b>#{quote.id}</b>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={handleDownloadPDF}>
            <Icon name="printer" ariaHidden /> Télécharger PDF
          </button>
          {canEdit && (
            <button className="btn" onClick={openEdit} disabled={converting}>
              <Icon name="edit" ariaHidden /> Modifier
            </button>
          )}
          {canConvert && (
            <button className="btn btn-primary" onClick={handleConvertToInvoice} disabled={converting}>
              <Icon name="arrow-right" ariaHidden />
              {converting ? 'Conversion…' : 'Créer une facture'}
            </button>
          )}
        </div>
      </div>

      <div className="content">
        <div className="detail-grid">

          {/* Quote paper */}
          <div className="paper">
            <div className="pp-top">
              <div className="pp-biz">
                <div className="pp-logo" aria-hidden="true"><BillioLogoSvg /></div>
                <div>
                  <div className="pp-biz-name">{orgSettings.name || 'Mon entreprise'}</div>
                  <div className="pp-biz-meta">
                    {[orgSettings.address, orgSettings.city, orgSettings.country].filter(Boolean).join(', ')}
                    {(orgSettings.ifu || orgSettings.rccm) && (
                      <><br />{[orgSettings.ifu && `IFU ${orgSettings.ifu}`, orgSettings.rccm && `RCCM ${orgSettings.rccm}`].filter(Boolean).join(' · ')}</>
                    )}
                    {(orgSettings.email || orgSettings.phone) && (
                      <><br />{[orgSettings.email, orgSettings.phone].filter(Boolean).join(' · ')}</>
                    )}
                  </div>
                </div>
              </div>
              <div className="pp-doc">
                <div className="pp-doc-title">Devis</div>
                <div className="pp-doc-num">#{quote.id}</div>
                <div className={`pp-status sq-${quote.status}`}>{STATUS_LABEL[quote.status]}</div>
              </div>
            </div>

            <div className="pp-parties">
              <div>
                <div className="pp-block-label">Adressé à</div>
                <div className="pp-client-name">{client.name}</div>
                <div className="pp-client-meta">{client.city}</div>
                {(client.contact || client.email || client.phone) && (
                  <div className="pp-client-meta" style={{ marginTop: 2 }}>
                    {client.contact && <div>Contact : {client.contact}</div>}
                    {client.phone   && <div>Tél : {client.phone}</div>}
                    {client.email   && <div>Email : {client.email}</div>}
                  </div>
                )}
                {(client.ifu || client.rccm || client.taxRegime) && (
                  <div className="pp-compliance-ids">
                    {client.ifu       && <span>IFU {client.ifu}</span>}
                    {client.rccm      && <span>RCCM {client.rccm}</span>}
                    {client.taxRegime && <span>{client.taxRegime}</span>}
                  </div>
                )}
              </div>
              <div>
                <div className="pp-block-label">Détails</div>
                <div className="pp-meta-grid">
                  <div className="k">Émis le</div>
                  <div className="v">{fmtDateLong(quote.issued)}</div>
                  <div className="k">Valide jusqu'au</div>
                  <div className={`v${quote.status === 'expired' ? ' due' : ''}`}>{fmtDateLong(quote.valid)}</div>
                  <div className="k">Paiement</div>
                  <div className="v">{orgSettings.paymentTerms || 'Net 14 jours'}</div>
                  <div className="k">Livraison</div>
                  <div className="v">{orgSettings.deliveryTerms || 'À convenir'}</div>
                </div>
              </div>
            </div>

            <div className="pp-subject"><span className="pp-subject-label">Objet :</span>{quote.subject}</div>

            <table className="li-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Unité</th>
                  <th className="r">Qté</th>
                  <th className="r">Prix unitaire</th>
                  <th className="r">Montant</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: '16px 0' }}>Aucune ligne</td></tr>
                ) : lines.map(li => (
                  <tr key={li.id}>
                    <td><div className="li-desc">{li.desc}</div></td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{li.unit ?? 'unité'}</td>
                    <td className="r">{li.qty}</td>
                    <td className="r">{fmt(li.price)}</td>
                    <td className="r">{fmt(li.qty * li.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pp-totals">
              <div className="pp-totals-inner">
                <div className="tot-row"><span>Sous-total</span><span className="tv">{fmt(subtotal)} F CFA</span></div>
                {canInvoiceTVA && (
                  <div className="tot-row"><span>TVA (18 %)</span><span className="tv">{fmt(tax)} F CFA</span></div>
                )}
                <div className="tot-row grand"><span>Total estimé</span><span className="tv">{fmt(total)} F CFA</span></div>
              </div>
            </div>

            <div className="pp-foot">{orgSettings.name || 'Mon entreprise'} · Devis généré via Billio · Ce document n'est pas une facture</div>
          </div>

          {/* Rail */}
          <aside className="rail">
            <div className="rail-card">
              <div className="rail-due-label">Montant estimé</div>
              <div className="rail-due-amt tnum">
                {fmt(total)}<span className="cur">F CFA</span>
              </div>
              {quote.status === 'expired' && (
                <div className="rail-due-sub">
                  <Icon name="alert-triangle" ariaHidden />
                  Devis expiré le {fmtDateLong(quote.valid)}
                </div>
              )}
              {quote.expSoon && quote.status === 'sent' && (
                <div className="rail-due-sub" style={{ color: '#B45309' }}>
                  <Icon name="clock-pause" ariaHidden />
                  Expire bientôt
                </div>
              )}

              <div className="rail-actions">
                {canConvert && (
                  <button className="btn btn-primary btn-block" onClick={handleConvertToInvoice} disabled={converting}>
                    <Icon name="arrow-right" ariaHidden />
                    {converting ? 'Conversion…' : 'Créer une facture'}
                  </button>
                )}

                <div className="rail-divider" />

                <button className="btn btn-block" onClick={handleCopyLink}>
                  <Icon name="link" ariaHidden /> Copier le lien
                </button>
                <button className="btn btn-block" onClick={handleShareEmail}>
                  <Icon name="mail" ariaHidden /> Envoyer par e-mail
                </button>
                <button className="btn btn-block" onClick={handleShareWhatsApp}>
                  <Icon name="brand-whatsapp" ariaHidden /> Partager sur WhatsApp
                </button>

                <div className="rail-divider" />

                <button className="btn btn-block" onClick={handleDownloadPDF}>
                  <Icon name="printer" ariaHidden /> Télécharger PDF
                </button>
              </div>
            </div>

            <div className="rail-card">
              <div className="rail-title">Statut</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span className={`status-pill sq-${quote.status}`}>{STATUS_LABEL[quote.status]}</span>
              </div>
              <div className="rail-title">Informations</div>
              <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>Émis le</span>
                  <span style={{ fontWeight: 600 }}>{fmtDateLong(quote.issued)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>Valide jusqu'au</span>
                  <span style={{ fontWeight: 600, color: quote.status === 'expired' ? '#A32D2D' : undefined }}>{fmtDateLong(quote.valid)}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>

    {/* Edit panel */}
    <div className={`scrim${editOpen ? ' open' : ''}`} onClick={() => { if (!saving) setEditOpen(false); }} />
    <div className={`new-inv-panel${editOpen ? ' open' : ''}`} role="dialog" aria-label="Modifier le devis" aria-modal="true">
      <div className="panel-slide-head">
        <div>
          <div className="panel-slide-title">Modifier le devis</div>
          <div className="panel-slide-sub">#{quote.id}</div>
        </div>
        <button className="icon-btn" onClick={() => setEditOpen(false)} aria-label="Fermer" disabled={saving}>
          <Icon name="x" size={15} ariaHidden />
        </button>
      </div>

      <div className="panel-body">
        <div className="form-group">
          <label className="form-label">Client</label>
          <select className="form-input" value={eClient} onChange={e => setEClient(e.target.value)}>
            <option value="">Sélectionner un client…</option>
            {Object.entries(clientsMap).map(([code, c]) => (
              <option key={code} value={code}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Date du devis</label>
            <input type="date" className="form-input" value={eDate} onChange={e => setEDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Valide jusqu'au</label>
            <input type="date" className="form-input" value={eValid} onChange={e => setEValid(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Objet</label>
          <input type="text" className="form-input" placeholder="ex. Refonte site web — périmètre complet"
            maxLength={255} value={eSubject} onChange={e => setESubject(e.target.value)} />
        </div>

        <div className="subhead">Lignes</div>
        <div className="line-items-head">
          <div className="li-col">Description</div>
          <div className="li-col">Unité</div>
          <div className="li-col right">Qté</div>
          <div className="li-col right">Prix</div>
          <div />
        </div>

        {eLines.map(li => (
          <div key={li.id} className="line-item">
            <div className="line-item-row">
              <input className="li-input" placeholder="Description du service" value={li.desc}
                onChange={e => updateELine(li.id, 'desc', e.target.value)} />
              <select className="li-input" value={li.unit ?? 'unité'}
                onChange={e => updateELine(li.id, 'unit', e.target.value)}>
                {['unité','heure','jour','mois','an','projet','article','licence'].map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <input className="li-input num" type="number" min="0" value={li.qty}
                onChange={e => updateELine(li.id, 'qty', e.target.value)} />
              <input className="li-input num" type="number" min="0" value={li.price || ''}
                placeholder="0" onChange={e => updateELine(li.id, 'price', e.target.value)} />
              <button className="li-del" onClick={() => setELines(prev => prev.length > 1 ? prev.filter(l => l.id !== li.id) : prev)} aria-label="Supprimer la ligne">
                <Icon name="trash" size={15} ariaHidden />
              </button>
            </div>
          </div>
        ))}

        <div className="line-actions">
          <button className="add-line" onClick={() => setELines(prev => [...prev, newLineItem()])}>
            <Icon name="plus" size={14} ariaHidden /> Ajouter une ligne
          </button>
          {products.length > 0 && (
            <div className="product-picker-wrap" ref={pickerRef}>
              <button className="catalog-btn" onClick={() => setShowPicker(v => !v)}>
                <Icon name="package" size={14} ariaHidden /> Depuis le catalogue
              </button>
              {showPicker && (
                <div className="product-picker-dropdown">
                  <input autoFocus placeholder="Rechercher…" value={pickerQuery}
                    onChange={e => setPickerQuery(e.target.value)} />
                  {filteredProducts.length === 0
                    ? <div className="picker-empty">Aucun produit trouvé</div>
                    : filteredProducts.map(p => (
                        <div key={p.id} className="picker-item" onClick={() => {
                          setELines(prev => [...prev, newLineItem(p.name, 1, p.price, p.unit, p.id)]);
                          setShowPicker(false); setPickerQuery('');
                        }}>
                          <div>
                            <div className="picker-item-name">{p.name}</div>
                            <div className="picker-item-meta">{p.unit}</div>
                          </div>
                          <div className="picker-item-price">{fmt(p.price)} F</div>
                        </div>
                      ))
                  }
                </div>
              )}
            </div>
          )}
        </div>

        <div className="total-block">
          <div className="total-row"><span>Sous-total HT</span><span>{fmt(eSubtotal)} F CFA</span></div>
          {canInvoiceTVA && <div className="total-row"><span>TVA (18 %)</span><span>{fmt(eTax)} F CFA</span></div>}
          <div className="total-row final"><span>Total estimé</span><span>{fmt(eTotal)} F CFA</span></div>
        </div>
      </div>

      <div className="panel-footer">
        <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditOpen(false)} disabled={saving}>
          Annuler
        </button>
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving} onClick={handleSaveEdit}>
          <Icon name="check" ariaHidden /> {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
    </>
  );
}
