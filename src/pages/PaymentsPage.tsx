import { invoiceRef } from '@/lib/invoice-number';
import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import { EmptyState } from '@/components/EmptyState';
import { PaymentsEmptyIllustration } from '@/components/PageEmptyIllustrations';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { tabPanelId, tabId } from '@/lib/tab-ids';
import { useApp } from '@/context/AppContext';
import { settleInvoicePayment } from '@/lib/api/payments';
import { fetchCreditNotes } from '@/lib/api/credit-notes';
import { invoiceBalance, todayISO } from '@/lib/invoice-status';
import { csvBlob } from '@/lib/csv';
import { confirmDiscard } from '@/lib/confirm-discard';
import { downloadBlob } from '@/lib/download';
import { fmt, fmtCompact, fmtDate, clientInitials } from '@/data';
import type { PayMethod, PayStatus, CreditNote } from '@/lib/schemas';
import Page from '@/components/Page';

type FilterKey = 'all' | 'cash' | 'wire' | 'momo' | 'cheque' | 'online' | 'pending';

const METHOD_META: Record<PayMethod, { label: string; icon: string; cls: string; sub: string }> = {
  cash:   { label: 'Cash',         icon: 'cash',          cls: 'm-cash',   sub: 'En personne'     },
  wire:   { label: 'Virement',     icon: 'building-bank', cls: 'm-wire',   sub: 'Virement bancaire' },
  momo:   { label: 'Mobile Money', icon: 'device-mobile', cls: 'm-momo',   sub: 'MTN / Orange'    },
  cheque: { label: 'Chèque',       icon: 'writing',       cls: 'm-cheque', sub: 'Chèque bancaire'  },
};


const STATUS_LABEL: Record<PayStatus, string> = {
  completed: 'Effectué',
  pending:   'En attente',
  failed:    'Échoué',
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',     label: 'Tous'          },
  { key: 'online',  label: 'En ligne'      },
  { key: 'momo',    label: 'Mobile Money'  },
  { key: 'wire',    label: 'Virement'      },
  { key: 'cheque',  label: 'Chèque'        },
  { key: 'cash',    label: 'Cash'          },
  { key: 'pending', label: 'En attente'    },
];

const REF_META: Record<PayMethod, { label: string; placeholder: string }> = {
  cash:   { label: 'Numéro de reçu',      placeholder: 'Reçu #0212'       },
  wire:   { label: 'Référence virement',   placeholder: '#WV0000'          },
  momo:   { label: 'ID de transaction',    placeholder: 'Réf MTN / Orange' },
  cheque: { label: 'Numéro de chèque',     placeholder: 'CHQ-0001'         },
};


/** Rendered by SalesPage, which passes the Factures | Devis | Paiements tab switcher. */
export default function PaymentsPage({ tabs }: { tabs?: ReactNode }) {
  const { writable } = usePermissions();
  const { invoices, setInvoices, payments, setPayments, showToast, clientsMap, orgId, loading } = useApp();

  const [filter, setFilter]     = useState<FilterKey>('all');
  const [panelOpen, setPanelOpen] = useState(false);

  // Form state
  const [method, setMethod] = useState<PayMethod>('cash');
  const [invId, setInvId]   = useState('');
  const [amount, setAmount] = useState('');
  const [ref, setRef]       = useState('');
  const [date, setDate]     = useState(new Date().toISOString().split('T')[0]);
  const [submitting, setSubmitting]   = useState(false);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);

  useEffect(() => {
    if (orgId) fetchCreditNotes(orgId).then(setCreditNotes).catch(err => console.error('[fetchCreditNotes]', err));
  }, [orgId]);

  const openInvoices = invoices.filter(i => i.status === 'pending' || i.status === 'overdue');
  const balanceOf    = (id: string) => {
    const inv = invoices.find(i => i.id === id);
    return inv ? invoiceBalance(inv, payments, creditNotes).balance : 0;
  };

  // Metrics
  const completed = payments.filter(p => p.status === 'completed');
  const total     = completed.reduce((s, p) => s + p.amount, 0);
  const byMethod  = { cash: 0, wire: 0, momo: 0, cheque: 0 } as Record<PayMethod, number>;
  completed.forEach(p => { byMethod[p.method] += p.amount; });
  const share = (m: PayMethod) => total ? Math.round((byMethod[m] / total) * 100) : 0;

  const counts: Record<FilterKey, number> = {
    all:     payments.length,
    online:  payments.filter(p => p.source === 'online').length,
    cash:   payments.filter(p => p.method === 'cash').length,
    wire:   payments.filter(p => p.method === 'wire').length,
    momo:   payments.filter(p => p.method === 'momo').length,
    cheque: payments.filter(p => p.method === 'cheque').length,
    pending: payments.filter(p => p.status === 'pending').length,
  };

  // Payments point to the invoice's internal id; show its legal number
  const invRef = useMemo(() => {
    const byId = new Map(invoices.map(i => [i.id, invoiceRef(i)]));
    return (id: string) => byId.get(id) ?? id;
  }, [invoices]);

  const filtered = useMemo(() => {
    if (filter === 'pending') return payments.filter(p => p.status === 'pending');
    if (filter === 'online')  return payments.filter(p => p.source === 'online');
    if (filter !== 'all')     return payments.filter(p => p.method === filter);
    return payments;
  }, [payments, filter]);

  const onlineCount = payments.filter(p => p.source === 'online').length;

  // Relevé: the payments currently listed, as a CSV for Excel
  function exportStatement() {
    if (filtered.length === 0) { showToast('Aucun paiement à exporter.', true); return; }
    const rows = filtered.map(p => [
      p.date, invRef(p.inv), clientsMap[p.client]?.name ?? p.client, METHOD_META[p.method].label, p.ref, p.amount, STATUS_LABEL[p.status],
    ]);
    downloadBlob(
      csvBlob(['Date', 'Facture', 'Client', 'Méthode', 'Référence', 'Montant (F CFA)', 'Statut'], rows),
      `releve-paiements-${todayISO()}.csv`,
    );
  }

  function openPanel() {
    setMethod('cash'); setInvId(''); setAmount(''); setRef('');
    setDate(new Date().toISOString().split('T')[0]);
    setPanelOpen(true);
  }

  function closePanel() { setPanelOpen(false); }
  function requestClosePanel() {
    if (confirmDiscard(invId !== '' || amount.trim() !== '' || ref.trim() !== '')) closePanel();
  }

  function handlePickInvoice(id: string) {
    setInvId(id);
    setAmount(id ? String(balanceOf(id)) : '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!invId) { showToast('Sélectionnez une facture', true); return; }
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) { showToast('Saisissez un montant', true); return; }
    const balance = balanceOf(invId);
    if (amt > balance) { showToast(`Le montant dépasse le reste à payer (${fmt(balance)} F CFA).`, true); return; }

    const inv = invoices.find(i => i.id === invId);
    const m   = METHOD_META[method];
    setSubmitting(true);
    try {
      const res = await settleInvoicePayment(orgId, {
        invoiceId:  invId,
        date,
        method,
        ref:        ref.trim() || m.sub,
        amount:     amt,
        clientName: clientsMap[inv?.client ?? '']?.name ?? (inv?.client ?? '?'),
      });
      setPayments(prev => prev.some(p => p.id === res.payment.id) ? prev : [{ ...res.payment, client: res.payment.client || (inv?.client ?? '') }, ...prev]);
      setInvoices(prev => prev.map(i => i.id === invId ? { ...i, status: res.invoiceStatus } : i));
      posthog.capture('payment_recorded', { amount: amt, method, invoice_id: invId });
      closePanel();
      showToast(res.balance > 0
        ? `Paiement de ${fmt(amt)} F CFA enregistré — reste ${fmt(res.balance)} F CFA`
        : `Paiement ${m.label} de ${fmt(amt)} F CFA enregistré — facture soldée`);
      if (!res.accountingOk) showToast('Paiement enregistré, mais l\'écriture comptable a échoué. Vérifiez la comptabilité.', true);
    } catch (err) {
      console.error('Payment failed:', err);
      showToast(err instanceof Error ? err.message : 'Erreur lors de l\'enregistrement du paiement', true);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageSkeleton title="Facturation" subtitle="Argent reçu sur vos factures" metrics={4} rows={6} />;

  return (
    <>
      <Page
        title="Facturation"
        subtitle="Argent reçu sur vos factures"
        actions={<>
          <button className="btn" onClick={exportStatement} title="Exporter les paiements affichés (CSV)">
            <Icon name="download" size={16} />
            Relevé
          </button>
          {writable && (
            <button className="btn btn-primary" onClick={openPanel}>
              <Icon name="plus" size={16} />
              Enregistrer un paiement
            </button>
          )}
        </>}
      >
          {/* Metrics */}
          <div className="metrics">
            {/* Feature card — total received */}
            <div className="metric-card pay-feature">
              <div className="metric-top">
                <div className="metric-ico pay-ico-white"><Icon name="arrow-down-left" size={15} /></div>
                <div className="metric-label pay-label-white">Total encaissé</div>
              </div>
              <div className="metric-value pay-val-white tnum">
                {fmt(total)}<span className="metric-unit pay-unit-white">F CFA</span>
              </div>
              <div className="metric-change pay-change-white">
                {completed.length} paiement{completed.length > 1 ? 's' : ''} reçu{completed.length > 1 ? 's' : ''}
              </div>
            </div>

            {/* Mobile Money */}
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico momo"><Icon name="device-mobile" size={15} /></div>
                <div className="metric-label">Mobile Money</div>
              </div>
              <div className="metric-value tnum">
                {fmtCompact(byMethod.momo)}<span className="metric-unit">F CFA</span>
              </div>
              <div className="share-bar">
                <div className="share-fill" style={{ width: `${share('momo')}%`, background: 'var(--pm-momo)' }} />
              </div>
              <div className="metric-change neutral">{share('momo')}% du volume</div>
            </div>

            {/* Wire */}
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico wire"><Icon name="building-bank" size={15} /></div>
                <div className="metric-label">Virement</div>
              </div>
              <div className="metric-value tnum">
                {fmtCompact(byMethod.wire)}<span className="metric-unit">F CFA</span>
              </div>
              <div className="share-bar">
                <div className="share-fill" style={{ width: `${share('wire')}%`, background: 'var(--pm-wire)' }} />
              </div>
              <div className="metric-change neutral">{share('wire')}% du volume</div>
            </div>

            {/* Cheque */}
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico cheque"><Icon name="writing" size={15} /></div>
                <div className="metric-label">Chèque</div>
              </div>
              <div className="metric-value tnum">
                {fmtCompact(byMethod.cheque)}<span className="metric-unit">F CFA</span>
              </div>
              <div className="share-bar">
                <div className="share-fill" style={{ width: `${share('cheque')}%`, background: 'var(--pm-cheque)' }} />
              </div>
              <div className="metric-change neutral">{share('cheque')}% du volume</div>
            </div>
          </div>

          {/* Section header + filters */}
          <div className="section-header">
            {tabs ?? <div className="section-title">Transactions</div>}
            <div className="filters">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  className={'filter-chip' + (filter === f.key ? ' active' : '')}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}<span className="cnt">{counts[f.key]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Reconciliation banner — shown when online payments exist */}
          {onlineCount > 0 && (
            <div className="recon-banner">
              <div className="rb-ico"><Icon name="bolt" size={18} /></div>
              <div className="rb-text">
                <b>Les paiements en ligne se rapprochent automatiquement</b>
                Connecté via Paystack — chaque paiement en ligne est associé à la facture correspondante en temps réel.
              </div>
            </div>
          )}

          {/* Payments table */}
          <div className="pay-table" {...(tabs ? { role: 'tabpanel', id: tabPanelId('sales'), 'aria-labelledby': tabId('sales', 'payments') } : {})}>
            <div className="table-head pay-grid-cols">
              <div className="th">Paiement</div>
              <div className="th">Client &amp; facture</div>
              <div className="th">Méthode</div>
              <div className="th right">Montant</div>
              <div className="th">Statut</div>
              <div className="th" />
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                illustration={<PaymentsEmptyIllustration />}
                title="Aucun paiement"
                description="Aucun paiement ici pour le moment. Les paiements reçus apparaîtront ici."
              />
            ) : (
              filtered.map(p => {
                const cl = clientsMap[p.client];
                const m  = METHOD_META[p.method];
                const isOnline = p.source === 'online';
                return (
                  <div key={p.id} className="pay-row pay-grid-cols">
                    {/* Payment ID */}
                    <div>
                      <div className="pay-id">{p.id}</div>
                      <div className="pay-date">{fmtDate(p.date)}</div>
                    </div>

                    {/* Client & invoice */}
                    <div className="client-cell">
                      {cl && <div className={`client-av ${cl.av}`}>{clientInitials(cl.name)}</div>}
                      <div>
                        <div className="cell-text">{cl?.name ?? p.client}</div>
                        <div className="cell-sub">
                          pour <span className="lnk">#{invRef(p.inv)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Method */}
                    <div className="method-cell">
                      <div className={`method-ico ${m.cls}`}>
                        <Icon name={m.icon} size={16} />
                      </div>
                      <div>
                        <div className="method-name">{m.label}</div>
                        <div className="method-sub">
                          {isOnline ? 'via Paystack' : p.ref}
                        </div>
                      </div>
                    </div>

                    {/* Amount */}
                    <div
                      className="pay-amount tnum"
                      style={{
                        textAlign: 'right',
                        color: p.status === 'pending' ? 'var(--color-text-tertiary)' : undefined,
                      }}
                    >
                      +{fmt(p.amount)}<span className="cur">F CFA</span>
                    </div>

                    {/* Status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`status-pill s-${p.status}`}>{STATUS_LABEL[p.status]}</span>
                      {isOnline && p.status === 'completed' && (
                        <span className="auto-chip"><Icon name="bolt" size={11} /> Auto</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="row-actions" onClick={e => e.stopPropagation()}>
                      <button className="icon-btn" title="Reçu">
                        <Icon name="file-text" size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
      </Page>

      {/* Scrim */}
      <div className={'scrim' + (panelOpen ? ' open' : '')} onClick={requestClosePanel} />

      {/* Record payment panel */}
      <div className={'new-inv-panel' + (panelOpen ? ' open' : '')}>
        <div className="panel-slide-head">
          <div>
            <div className="panel-slide-title">Enregistrer un paiement</div>
            <div className="panel-slide-sub">Saisir un encaissement hors ligne</div>
          </div>
          <button className="icon-btn" onClick={requestClosePanel} aria-label="Fermer">
            <Icon name="x" size={18} />
          </button>
        </div>

        <form id="pay-form" className="panel-body" onSubmit={handleSubmit}>
          {/* Method picker */}
          <div className="form-group">
            <label className="form-label">Méthode de paiement</label>
            <div className="method-pick">
              {(['cash', 'wire', 'momo', 'cheque'] as PayMethod[]).map(m => (
                <div
                  key={m}
                  className={'mp-opt' + (method === m ? ' active' : '')}
                  onClick={() => { setMethod(m); setRef(''); }}
                >
                  <Icon name={METHOD_META[m].icon} size={20} />
                  <span>{METHOD_META[m].label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Invoice */}
          <div className="form-group">
            <label className="form-label">Facture</label>
            <select
              className="form-input"
              value={invId}
              onChange={e => handlePickInvoice(e.target.value)}
              required
            >
              <option value="">Sélectionner une facture ouverte…</option>
              {openInvoices.map(inv => (
                <option key={inv.id} value={inv.id}>
                  #{invoiceRef(inv)} — {clientsMap[inv.client]?.name ?? inv.client} (reste {fmt(balanceOf(inv.id))} F CFA)
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div className="form-group">
            <label className="form-label">Montant reçu{invId ? ` (reste à payer : ${fmt(balanceOf(invId))} F CFA)` : ''}</label>
            <div className="input-affix">
              <input
                type="number"
                min="0"
                max={invId ? balanceOf(invId) : undefined}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                required
              />
              <span className="suffix">F CFA</span>
            </div>
          </div>

          {/* Reference */}
          <div className="form-group">
            <label className="form-label">{REF_META[method].label}</label>
            <input
              className="form-input"
              type="text"
              placeholder={REF_META[method].placeholder}
              value={ref}
              onChange={e => setRef(e.target.value)}
            />
          </div>

          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: -6, marginBottom: 12 }}>
            Le client a appliqué une retenue à la source ? Enregistrez le paiement depuis la facture pour la comptabiliser.
          </div>

          {/* Date */}
          <div className="form-group">
            <label className="form-label">Date de réception</label>
            <input
              className="form-input"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
        </form>

        <div className="panel-footer">
          <button type="button" className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={requestClosePanel}>
            Annuler
          </button>
          <button type="submit" form="pay-form" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={submitting}>
            <Icon name="check" size={15} />
            {submitting ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </>
  );
}
