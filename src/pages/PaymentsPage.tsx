import { invoiceRef } from '@/lib/invoice-number';
import { useState, useMemo, useEffect, useRef } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { settleInvoicePayment } from '@/lib/api/payments';
import { fetchCreditNotes } from '@/lib/api/credit-notes';
import { invoiceBalance, todayISO } from '@/lib/invoice-status';
import { csvBlob } from '@/lib/csv';
import { confirmDiscard } from '@/lib/confirm-discard';
import { downloadBlob } from '@/lib/download';
import { fmt } from '@/data';
import type { Payment, PayMethod, PayStatus, CreditNote } from '@/lib/schemas';
import Page from '@/components/Page';
import PaymentList from '@/components/sales/PaymentList';
import IncomingPayments from '@/components/sales/IncomingPayments';
import { paymentAuthor, reconcileStatus } from '@/lib/sales-tables';
import { useCommandIntent } from '@/lib/command-intent';

const METHOD_META: Record<PayMethod, { label: string; icon: string; cls: string; sub: string }> = {
  cash:   { label: 'Cash',         icon: 'cash',          cls: 'm-cash',   sub: 'En personne'     },
  wire:   { label: 'Virement',     icon: 'building-bank', cls: 'm-wire',   sub: 'Virement bancaire' },
  momo:   { label: 'Mobile Money', icon: 'device-mobile', cls: 'm-momo',   sub: 'MTN / Orange'    },
  cheque: { label: 'Chèque',       icon: 'writing',       cls: 'm-cheque', sub: 'Chèque bancaire'  },
  pispi:  { label: 'PI-SPI',       icon: 'qrcode',        cls: 'm-wire',   sub: 'Paiement instantané BCEAO' },
};


const STATUS_LABEL: Record<PayStatus, string> = {
  completed: 'Effectué',
  pending:   'En attente',
  failed:    'Échoué',
};

const REF_META: Record<PayMethod, { label: string; placeholder: string }> = {
  cash:   { label: 'Numéro de reçu',      placeholder: 'Reçu #0212'       },
  wire:   { label: 'Référence virement',   placeholder: '#WV0000'          },
  momo:   { label: 'ID de transaction',    placeholder: 'Réf MTN / Orange' },
  cheque: { label: 'Numéro de chèque',     placeholder: 'CHQ-0001'         },
  pispi:  { label: 'ID de transaction PI-SPI', placeholder: 'End-to-end ID du relevé' },
};


/** Paiements (PRO-165): payments received online, the list, and recording a payment. */
export default function PaymentsPage() {
  const { writable } = usePermissions();
  const { invoices, setInvoices, payments, setPayments, showToast, clientsMap, orgId, loading, userLabel } = useApp();

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

  // Payments point to the invoice's internal id; show its legal number
  const invRef = useMemo(() => {
    const byId = new Map(invoices.map(i => [i.id, invoiceRef(i)]));
    return (id: string) => byId.get(id) ?? id;
  }, [invoices]);

  // Relevé: the payments currently listed, as a CSV for Excel
  // The table filters itself and tells us what it lists
  const tableShown = useRef<Payment[]>([]);
  function exportStatement() {
    const listed = tableShown.current;
    if (listed.length === 0) { showToast('Aucun paiement à exporter.', true); return; }
    const rows = listed.map(p => [
      p.date, invRef(p.inv), clientsMap[p.client]?.name ?? p.client, METHOD_META[p.method].label, p.ref, p.amount, STATUS_LABEL[p.status], paymentAuthor(p),
      reconcileStatus(p) === 'matched' ? 'Rapproché' : reconcileStatus(p) === 'to_match' ? 'À rapprocher' : '',
    ]);
    downloadBlob(
      csvBlob(['Date', 'Facture', 'Client', 'Méthode', 'Référence', 'Montant (F CFA)', 'Statut', 'Saisi par', 'Rapprochement'], rows),
      `releve-paiements-${todayISO()}.csv`,
    );
  }

  function openPanel() {
    setMethod('cash'); setInvId(''); setAmount(''); setRef('');
    setDate(new Date().toISOString().split('T')[0]);
    setPanelOpen(true);
  }

  function closePanel() { setPanelOpen(false); }

  // From the command box (PRO-162)
  useCommandIntent(intent => {
    if (intent.command !== 'new-payment' || !writable) return false;
    openPanel();
  }, !loading);
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
        recordedBy: userLabel,
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

  if (loading) return <PageSkeleton title="Paiements" subtitle="Argent reçu sur vos factures" metrics={4} rows={6} />;

  return (
    <>
      <Page
        title="Paiements"
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
            <IncomingPayments />
            <PaymentList onShownChange={rows => { tableShown.current = rows; }} />
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
              {(['cash', 'wire', 'momo', 'cheque', 'pispi'] as PayMethod[]).map(m => (
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
            <label className="form-label" htmlFor="pay-invoice">Facture</label>
            <select
              id="pay-invoice"
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
            <label className="form-label" htmlFor="pay-date">Date de réception</label>
            <input
              id="pay-date"
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
