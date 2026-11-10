import { useState, useEffect, useRef } from 'react';
import { canWrite, canDelete } from '@/lib/permissions';
import posthog from 'posthog-js';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Icon from '@/components/Icon';
import ConfirmModal from '@/components/ConfirmModal';
import SendDocumentDialog, { type SendChannel } from '@/components/SendDocumentDialog';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { removeInvoice, updateInvoice, createInvoice, nextInvoiceId } from '@/lib/api/invoices';
import { createActivity } from '@/lib/api/activities';
import { deleteInvoiceEntries, updateInvoiceIssuanceEntry, recordCreditNoteEntry, recordInvoiceIssuanceEntry } from '@/lib/api/accounting';
import { settleInvoicePayment } from '@/lib/api/payments';
import { invoiceBalance, daysOverdue, todayISO } from '@/lib/invoice-status';
import { paymentMethodsNotReadyMessage, usePaymentMethods } from '@/lib/use-payment-methods';
import { filledLines, lineItemsError } from '@/lib/line-validation';
import { invoiceMessage } from '@/lib/document-messages';
import { contactValue } from '@/lib/share-links';
import { fetchLineItems, saveLineItems, deleteLineItems } from '@/lib/api/line-items';
import { fetchCreditNotes, createCreditNote, nextCreditNoteId } from '@/lib/api/credit-notes';
import { useComplianceGuard } from '@/lib/use-compliance-guard';
import { fmt, fmtDate, fmtDateLong, STATUS_LABEL, newLineItem } from '@/data';
import { renderInvoicePdf } from '@/lib/render-pdf';
import { downloadBlob } from '@/lib/download';
import { getFiscalIdLabel } from '@/lib/ohada';
import type { Status } from '@/data';
import { calculateServiceWithholding, SERVICE_WITHHOLDING_THRESHOLD } from '@/lib/tax-bf';
import type { Activity, CreditNote, LineItem, PayMethod, ServiceWithholdingScenario } from '@/lib/schemas';
import { VAT_LABEL, chargesVat, splitTtc, vatOn } from '@/lib/vat';

type DotKind = 'paid' | 'sent' | 'overdue' | 'avoir' | '';
interface TlEntry { dot: DotKind; text: string; time: string; }

function buildTimeline(
  invoice: { issued: string; due: string; status: Status },
  clientName: string,
  payment?: { date: string },
): TlEntry[] {
  const issuedStr = fmtDateLong(invoice.issued);
  const created: TlEntry = { dot: '', text: 'Facture créée', time: issuedStr };
  if (invoice.status === 'draft') return [created];

  const sent: TlEntry = { dot: 'sent', text: 'Envoyée', time: issuedStr };

  if (invoice.status === 'paid') {
    const paidEntry: TlEntry = payment
      ? { dot: 'paid', text: `Paiement reçu de ${clientName}`, time: fmtDateLong(payment.date) }
      : { dot: 'paid', text: `Paiement reçu de ${clientName}`, time: '—' };
    return [paidEntry, sent, created];
  }

  if (invoice.status === 'overdue') {
    return [
      { dot: 'overdue', text: 'Passée en retard', time: fmtDateLong(invoice.due) },
      sent,
      created,
    ];
  }

  return [sent, created];
}

const BillioLogoSvg = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5.5 3.2h10.2c.6 0 1.1.2 1.5.6l3 3c.4.4.6.9.6 1.5v12c0 .7-.6 1.1-1.2.8l-1.6-.8-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.6.8c-.6.3-1.3-.1-1.3-.8V4.7c0-.8.7-1.5 1.5-1.5z" fill="#fff" fillOpacity="0.96"/>
    <path d="M8 8.2h6M8 11.4h7M8 14.6h4" stroke="#185FA5" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
);

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { invoices, setInvoices, payments, setPayments, setActivity, showToast, clientsMap, products, orgSettings, invoiceTemplate, orgId, loading, userRole } = useApp();
  const writable = canWrite(userRole);
  const compliance = useComplianceGuard();
  const { lines: paymentMethods, status: paymentMethodsStatus } = usePaymentMethods();
  const paymentMethodsReady = paymentMethodsStatus === 'ready';
  const [sendKind, setSendKind] = useState<'send' | 'reminder' | null>(null);
  // The list and the create panel link here with { openSend: true } to open the send dialog
  const location = useLocation();
  const openSendRequested = (location.state as { openSend?: boolean } | null)?.openSend === true;
  const [busyAction, setBusyAction] = useState<'duplicate' | 'issue' | null>(null);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [payDialog, setPayDialog] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [payRef, setPayRef] = useState('');
  const [tvaRetenue, setTvaRetenue] = useState(0);
  const [serviceWithholding, setServiceWithholding] = useState(0);
  const [payAmount, setPayAmount] = useState(0);
  const [paySaving, setPaySaving] = useState(false);
  const [linesError, setLinesError] = useState(false);
  const [linesLoading, setLinesLoading] = useState(true);

  // Edit panel state
  const [editOpen,   setEditOpen]   = useState(false);
  const [eClient,    setEClient]    = useState('');
  const [eSubject,   setESubject]   = useState('');
  const [eDate,      setEDate]      = useState('');
  const [eDue,       setEDue]       = useState('');
  const [eLines,     setELines]     = useState<LineItem[]>([]);
  const [eDiscount,  setEDiscount]  = useState(0);
  const [saving,     setSaving]     = useState(false);
  const [showPicker,   setShowPicker]   = useState(false);
  const [pickerQuery,  setPickerQuery]  = useState('');
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [avoirDialog,  setAvoirDialog]  = useState(false);
  const [avoirReason,  setAvoirReason]  = useState('');
  const [avoirAmount,  setAvoirAmount]  = useState(0);
  const [avoirSaving,  setAvoirSaving]  = useState(false);
  const [creditNotes,  setCreditNotes]  = useState<CreditNote[]>([]);
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
    if (!id || !orgId) return;
    let cancelled = false;
    setLinesError(false);
    setLinesLoading(true);
    fetchLineItems(orgId, { invoiceId: id })
      .then(l => { if (!cancelled) setLines(l); })
      .catch(err => { console.error('[fetchLineItems]', err); if (!cancelled) { setLines([]); setLinesError(true); } })
      .finally(() => { if (!cancelled) setLinesLoading(false); });
    return () => { cancelled = true; };
  }, [id, orgId]);

  useEffect(() => {
    if (id && orgId) fetchCreditNotes(orgId, id).then(setCreditNotes).catch(() => setCreditNotes([]));
  }, [id, orgId]);

  const requestedInvoiceStatus = invoices.find(i => i.id === id)?.status;
  useEffect(() => {
    // Wait for the payment methods: the prepared message lists them
    if (!openSendRequested || !requestedInvoiceStatus || paymentMethodsStatus === 'loading') return;
    if (paymentMethodsStatus === 'ready' && (requestedInvoiceStatus === 'pending' || requestedInvoiceStatus === 'overdue')) {
      setSendKind(requestedInvoiceStatus === 'overdue' ? 'reminder' : 'send');
    }
    // Clear the request so a refresh or back navigation doesn't reopen the dialog
    navigate(location.pathname, { replace: true, state: null });
  }, [openSendRequested, requestedInvoiceStatus, paymentMethodsStatus, navigate, location.pathname]);

  if (loading) return <PageSkeleton title="Facture" variant="table-only" metrics={0} rows={4} />;

  const invoice = invoices.find(i => i.id === id);
  if (!invoice) {
    return (
      <div className="main">
        <div className="topbar">
          <div className="crumbs">
            <button className="crumb-back" onClick={() => navigate('/invoices')} aria-label="Retour">
              <Icon name="arrow-left" ariaHidden />
            </button>
            <div className="crumb-text">Facture introuvable</div>
          </div>
        </div>
        <div className="content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>
          La facture #{id} n'existe pas.
        </div>
      </div>
    );
  }

  const client        = clientsMap[invoice.client] ?? { name: invoice.client, city: '—', av: 'av-a' };
  const clientWithholdingScenario = (client as { withholdingScenario?: ServiceWithholdingScenario }).withholdingScenario;
  const canInvoiceTVA = chargesVat(orgSettings.taxRegime);
  const subtotal      = lines.reduce((s, li) => s + li.qty * li.price, 0);
  const discountPct   = invoice.discountPct ?? 0;
  const discountAmt   = Math.round(subtotal * (discountPct / 100));
  const discountedSub = subtotal - discountAmt;
  const tax           = vatOn(discountedSub, canInvoiceTVA);
  const total         = discountedSub + tax;
  const isOverdue       = invoice.status === 'overdue';
  const { paid, credited, balance } = invoiceBalance(invoice, payments, creditNotes);
  // Invoices marked paid before payments were tracked per invoice have no payment rows
  const amountDue       = invoice.status === 'paid' ? 0 : balance;
  const creditable      = Math.max(0, invoice.amount - credited);
  const invoicePayment  = payments.find(p => p.inv === invoice.id);
  const timeline        = buildTimeline(invoice, client.name, invoicePayment);

  // Sending happens from the user's own email/WhatsApp; log it once they pick a channel
  const handleSent = (channel: SendChannel) => {
    if (channel === 'copy' || !sendKind) return;
    // Opening the email app or WhatsApp doesn't mean the message went out
    const via = channel === 'email' ? 'par email' : 'par WhatsApp';
    const parts = sendKind === 'reminder'
      ? [{ text: `Relance préparée ${via} pour ` }, { text: `#${invoice.id}`, bold: true as const }]
      : [{ text: 'Facture ' }, { text: `#${invoice.id}`, bold: true as const }, { text: ` préparée ${via} pour ` }, { text: client.name, bold: true as const }];
    const entry: Activity = { kind: 'sent', parts, time: "À l'instant" };
    setActivity(prev => [entry, ...prev]);
    createActivity(orgId, { kind: 'sent', parts }).catch(err => {
      console.error('[createActivity] failed:', err);
      setActivity(prev => prev.filter(a => a !== entry));
      showToast('L\'envoi n\'a pas pu être enregistré dans l\'historique.', true);
    });
    setSendKind(null);
  };

  // A new draft with the same client, subject and lines, dated today
  const handleDuplicate = async () => {
    if (busyAction) return;
    if (linesLoading) return;
    if (linesError) { showToast('Les lignes de la facture n\'ont pas pu être chargées — rechargez la page avant de dupliquer.', true); return; }
    setBusyAction('duplicate');
    try {
      // Same payment term as the source (0 = due on issue); 14 days if its dates are unreadable
      const sourceTerm = Math.round((Date.parse(invoice.due) - Date.parse(invoice.issued)) / 86_400_000);
      const termDays = Number.isFinite(sourceTerm) ? Math.max(0, sourceTerm) : 14;
      const issued = todayISO();
      const due = new Date(Date.parse(issued + 'T00:00:00Z') + termDays * 86_400_000).toISOString().slice(0, 10);
      const id = await nextInvoiceId(orgId);
      const copy = { id, subject: invoice.subject, client: invoice.client, issued, due, amount: total, status: 'draft' as const, discountPct };
      await createInvoice(orgId, copy);
      try {
        await saveLineItems(orgId, lines, { invoiceId: id });
      } catch (err) {
        await removeInvoice(orgId, id).catch(e => console.error('[rollback] removeInvoice failed:', e));
        throw err;
      }
      setInvoices(prev => prev.some(i => i.id === id) ? prev : [copy, ...prev]);
      showToast(`Brouillon #${id} créé à partir de #${invoice.id}`);
      navigate(`/invoices/${id}`);
    } catch (err) {
      console.error('[handleDuplicate] failed:', err);
      showToast('Impossible de dupliquer la facture. Veuillez réessayer.', true);
    } finally {
      setBusyAction(null);
    }
  };

  // Issuing a draft: check the mandatory mentions first; handleIssue reports
  // its own problems (lines not loaded or invalid) without the check
  const requestIssue = () => {
    if (busyAction || linesLoading) return;
    if (linesError || lineItemsError(lines)) { void handleIssue(); return; }
    void compliance.guard(invoice.client, () => void handleIssue(), { returnTo: `/invoices/${invoice.id}` });
  };

  // Draft → pending: the invoice becomes payable and gets its sales journal entry
  const handleIssue = async () => {
    if (busyAction) return;
    if (linesLoading) return;
    if (linesError) { showToast('Les lignes de la facture n\'ont pas pu être chargées — rechargez la page avant d\'émettre la facture.', true); return; }
    const linesProblem = lineItemsError(lines);
    if (linesProblem) { showToast(`${linesProblem} Modifiez la facture avant de l'émettre.`, true); return; }
    setBusyAction('issue');
    try {
      await updateInvoice(orgId, invoice.id, { status: 'pending', amount: total });
      setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, status: 'pending' as const, amount: total } : i));
      try {
        await recordInvoiceIssuanceEntry(orgId, { invoiceId: invoice.id, htAmount: discountedSub, tvaAmount: tax, date: invoice.issued, clientName: client.name });
        showToast(`Facture #${invoice.id} émise`);
      } catch (err) {
        console.error('[recordInvoiceIssuanceEntry] failed:', err);
        showToast(`Facture #${invoice.id} émise, mais l'écriture comptable de vente n'a pas pu être enregistrée. Signalez-le à votre comptable.`, true);
      }
      setSendKind('send');
    } catch (err) {
      console.error('[handleIssue] failed:', err);
      showToast('Impossible d\'émettre la facture. Veuillez réessayer.', true);
    } finally {
      setBusyAction(null);
    }
  };
  const handleDownloadPDF = async () => {
    if (linesLoading) return;
    if (linesError) { showToast('Les lignes de la facture n\'ont pas pu être chargées — rechargez la page avant de télécharger le PDF.', true); return; }
    if (!paymentMethodsReady) { showToast(paymentMethodsNotReadyMessage(paymentMethodsStatus), true); return; }
    try {
      const blob = await renderInvoicePdf({
        template: invoiceTemplate,
        invoice,
        lines,
        client,
        biz: orgSettings,
        paymentTerms: orgSettings.paymentTerms || 'Net 14 jours',
        deliveryTerms: orgSettings.deliveryTerms || 'À convenir',
        paymentMethods,
      });
      downloadBlob(blob, `facture-${invoice.id.toLowerCase()}.pdf`);
      posthog.capture('invoice_pdf_downloaded', { invoice_id: invoice.id });
    } catch (err) {
      console.error('[handleDownloadPDF] failed:', err);
      showToast('Impossible de générer le PDF. Veuillez réessayer.', true);
    }
  };
  const handleDelete = () => setDeleteDialog(true);
  const handleConfirmDelete = async () => {
    try {
      await removeInvoice(orgId, invoice.id);
    } catch (err) {
      console.error('[removeInvoice] failed:', err);
      setDeleteDialog(false);
      showToast('Erreur lors de la suppression de la facture. Veuillez réessayer.', true);
      return;
    }
    deleteInvoiceEntries(orgId, invoice.id).catch(err => console.error('[deleteInvoiceEntries] failed:', err));
    setInvoices(prev => prev.filter(i => i.id !== invoice.id));
    showToast('Facture supprimée');
    navigate('/invoices');
  };

  const openAvoir = () => {
    setAvoirReason('');
    setAvoirAmount(creditable);
    setAvoirDialog(true);
  };

  const handleConfirmAvoir = async () => {
    if (!avoirReason.trim()) { showToast('Saisissez le motif de l\'avoir.', true); return; }
    if (avoirAmount <= 0 || avoirAmount > creditable) { showToast(`Montant invalide (maximum ${fmt(creditable)} F CFA).`, true); return; }
    setAvoirSaving(true);
    try {
      const avId = await nextCreditNoteId(orgId);
      const today = new Date().toISOString().slice(0, 10);
      const cn = await createCreditNote(orgId, {
        id:        avId,
        invoiceId: invoice.id,
        subject:   `Avoir sur ${invoice.id}`,
        client:    invoice.client,
        issued:    today,
        amount:    avoirAmount,
        reason:    avoirReason.trim(),
      });
      setCreditNotes(prev => [cn, ...prev]);
      // The database marks the invoice paid once nothing is left to collect
      if ((invoice.status === 'pending' || invoice.status === 'overdue') && balance - avoirAmount <= 0) {
        setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, status: 'paid' as const } : i));
      }
      // Accounting: back-calculate HT/TVA from TTC amount
      const { ht: htAmount, tva: tvaAmount } = splitTtc(avoirAmount, canInvoiceTVA);
      recordCreditNoteEntry(orgId, {
        creditNoteId: avId,
        invoiceId:    invoice.id,
        htAmount,
        tvaAmount,
        date:         today,
        clientName:   client.name,
      }).catch(err => console.error('Credit note accounting failed:', err));
      setAvoirDialog(false);
      showToast(`Avoir ${avId} émis`);
    } catch (err) {
      console.error('Create credit note failed:', err);
      showToast('Erreur lors de l\'émission de l\'avoir', true);
    } finally {
      setAvoirSaving(false);
    }
  };
  const REF_PLACEHOLDER: Record<PayMethod, string> = {
    cash: 'Reçu #0212',
    wire: '#WV0000',
    momo: 'Réf MTN / Orange',
    cheque: 'ch_3PXyZ...',
  };
  const METHOD_LABEL: Record<PayMethod, string> = {
    cash:   'Cash',
    wire:   'Virement',
    momo:   'Mobile Money',
    cheque: 'Chèque',
  };

  const canEdit = writable && (invoice.status === 'draft' || invoice.status === 'pending' || invoice.status === 'overdue');

  const openEdit = () => {
    setEClient(invoice.client);
    setESubject(invoice.subject);
    setEDate(invoice.issued);
    setEDue(invoice.due);
    setEDiscount(invoice.discountPct ?? 0);
    setELines(lines.length ? lines.map(l => ({ ...l })) : [newLineItem()]);
    setEditOpen(true);
  };

  const updateELine = (lid: string, field: string, val: string) =>
    setELines(prev => prev.map(l => l.id === lid ? { ...l, [field]: field === 'qty' || field === 'price' ? Number(val) : val } : l));

  const filteredProducts = products.filter(p => !pickerQuery || p.name.toLowerCase().includes(pickerQuery.toLowerCase()));

  const eSubtotal      = eLines.reduce((s, l) => s + l.qty * l.price, 0);
  const eDiscountAmt   = Math.round(eSubtotal * (eDiscount / 100));
  const eDiscountedSub = eSubtotal - eDiscountAmt;
  const eTax           = vatOn(eDiscountedSub, canInvoiceTVA);
  const eTotal         = eDiscountedSub + eTax;

  const handleSaveEdit = async () => {
    if (!eClient) { showToast('Veuillez sélectionner un client.', true); return; }
    const editLinesProblem = lineItemsError(eLines);
    if (editLinesProblem) { showToast(editLinesProblem, true); return; }
    setSaving(true);
    try {
      await updateInvoice(orgId, invoice.id, { subject: eSubject.trim() || 'Facture sans titre', client: eClient, issued: eDate, due: eDue, amount: eTotal, discountPct: eDiscount });
      await deleteLineItems(orgId, { invoiceId: invoice.id });
      await saveLineItems(orgId, filledLines(eLines), { invoiceId: invoice.id });
      const editedClientName = (clientsMap[eClient] ?? { name: eClient }).name;
      // A draft has no sales entry yet: it is booked when the invoice is issued
      if (invoice.status !== 'draft') {
        updateInvoiceIssuanceEntry(orgId, {
          invoiceId:  invoice.id,
          htAmount:   eDiscountedSub,
          tvaAmount:  eTax,
          date:       eDate,
          clientName: editedClientName,
        }).catch(err => {
          console.error('Accounting update failed:', err);
          showToast('Facture mise à jour, mais l\'écriture comptable n\'a pas pu être rectifiée. Signalez-le à votre comptable.', true);
        });
      }
      setInvoices(prev => prev.map(i => i.id === invoice.id
        ? { ...i, subject: eSubject.trim() || 'Facture sans titre', client: eClient, issued: eDate, due: eDue, amount: eTotal, discountPct: eDiscount }
        : i));
      setLines(filledLines(eLines));
      setEditOpen(false);
      showToast('Facture mise à jour');
    } catch (err) {
      console.error('Edit invoice failed:', err);
      showToast('Erreur lors de la mise à jour', true);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmPayment = async () => {
    if (paySaving) return;
    if (payAmount <= 0 || payAmount > balance) {
      showToast(`Saisissez un montant entre 1 et ${fmt(balance)} F CFA.`, true);
      return;
    }
    if (tvaRetenue + serviceWithholding > payAmount) {
      showToast('Les retenues dépassent le montant réglé.', true);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    setPaySaving(true);
    try {
      const res = await settleInvoicePayment(orgId, {
        invoiceId:          invoice.id,
        date:               today,
        method:             payMethod,
        ref:                payRef.trim() || METHOD_LABEL[payMethod],
        amount:             payAmount,
        clientName:         client.name,
        tvaRetenue,
        serviceWithholding,
      });
      setPayments(prev => prev.some(p => p.id === res.payment.id) ? prev : [{ ...res.payment, client: res.payment.client || invoice.client }, ...prev]);
      setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, status: res.invoiceStatus } : i));
      setPayDialog(false);
      showToast(res.balance > 0
        ? `Paiement de ${fmt(payAmount)} F CFA enregistré — reste ${fmt(res.balance)} F CFA`
        : `Paiement ${METHOD_LABEL[payMethod]} de ${fmt(payAmount)} F CFA enregistré — facture soldée`);
      if (!res.accountingOk) showToast('Paiement enregistré, mais l\'écriture comptable a échoué. Vérifiez la comptabilité.', true);
    } catch (err) {
      console.error('Payment recording failed:', err);
      showToast(err instanceof Error ? err.message : 'Erreur lors de l\'enregistrement du paiement', true);
    } finally {
      setPaySaving(false);
    }
  };

  return (
    <>
    <div className="main">
      {/* Topbar — breadcrumb variant */}
      <div className="topbar">
        <div className="crumbs">
          <button className="crumb-back" onClick={() => navigate('/invoices')} aria-label="Retour aux factures">
            <Icon name="arrow-left" ariaHidden />
          </button>
          <div className="crumb-text">
            <button className="crumb-link" onClick={() => navigate('/invoices')}>Factures</button>
            {' / '}<b>#{invoice.id}</b>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={handleDownloadPDF} disabled={linesLoading || !paymentMethodsReady}>
            <Icon name="printer" ariaHidden /> Télécharger PDF
          </button>
          {canEdit && (
            <button className="btn" onClick={openEdit}>
              <Icon name="edit" ariaHidden /> Modifier
            </button>
          )}
          {writable && invoice.status === 'draft' && (
            <button className="btn btn-primary" onClick={requestIssue} disabled={busyAction !== null || linesLoading || compliance.checking}>
              <Icon name="send" ariaHidden /> {busyAction === 'issue' ? 'Émission…' : 'Émettre la facture'}
            </button>
          )}
          {writable && (isOverdue || invoice.status === 'pending') && (
            <button className="btn btn-primary" onClick={() => setSendKind(isOverdue ? 'reminder' : 'send')} disabled={!paymentMethodsReady}>
              <Icon name="send" ariaHidden /> {isOverdue ? 'Envoyer une relance' : 'Envoyer au client'}
            </button>
          )}
        </div>
      </div>

      <div className="content">
        <div className="detail-grid">

          {/* Invoice paper */}
          <div className="paper">
            <div className="pp-top">
              <div className="pp-biz">
                <div className="pp-logo" aria-hidden="true"><BillioLogoSvg /></div>
                <div>
                  <div className="pp-biz-name">{orgSettings.name || 'Mon entreprise'}</div>
                  <div className="pp-biz-meta">
                    {[orgSettings.address, orgSettings.city, orgSettings.country].filter(Boolean).join(', ')}
                    {(orgSettings.ifu || orgSettings.rccm) && (
                      <><br />{[orgSettings.ifu && `${getFiscalIdLabel(orgSettings.country)} ${orgSettings.ifu}`, orgSettings.rccm && `RCCM ${orgSettings.rccm}`].filter(Boolean).join(' · ')}</>
                    )}
                    {(orgSettings.taxRegime || orgSettings.divisionFiscale) && (
                      <><br />{[orgSettings.taxRegime && `${orgSettings.taxRegime}`, orgSettings.divisionFiscale && `${orgSettings.divisionFiscale}`].filter(Boolean).join(' · ')}</>
                    )}
                    {(orgSettings.email || orgSettings.phone) && (
                      <><br />{[orgSettings.email, orgSettings.phone].filter(Boolean).join(' · ')}</>
                    )}
                  </div>
                </div>
              </div>
              <div className="pp-doc">
                <div className="pp-doc-title">Facture</div>
                <div className="pp-doc-num">#{invoice.id}</div>
                <div className={`pp-status st-${invoice.status}`}>{STATUS_LABEL[invoice.status]}</div>
              </div>
            </div>

            <div className="pp-parties">
              <div>
                <div className="pp-block-label">Facturé à</div>
                <div className="pp-client-name">{client.name}</div>
                <div className="pp-client-meta">{[client.city, client.country].filter(Boolean).join(', ')}</div>
                {(client.contact || client.email || client.phone) && (
                  <div className="pp-client-meta" style={{ marginTop: 2 }}>
                    {client.contact && <div>Contact : {client.contact}</div>}
                    {client.phone   && <div>Tél : {client.phone}</div>}
                    {client.email   && <div>Email : {client.email}</div>}
                  </div>
                )}
                {(client.ifu || client.rccm || client.taxRegime || client.fiscalDivision) && (
                  <div className="pp-compliance-ids">
                    {client.ifu            && <span>{getFiscalIdLabel(client.country)} {client.ifu}</span>}
                    {client.rccm           && <span>RCCM {client.rccm}</span>}
                    {client.taxRegime      && <span>{client.taxRegime}</span>}
                    {client.fiscalDivision && <span>{client.fiscalDivision}</span>}
                  </div>
                )}
              </div>
              <div>
                <div className="pp-block-label">Détails</div>
                <div className="pp-meta-grid">
                  <div className="k">Émis le</div>
                  <div className="v">{fmtDateLong(invoice.issued)}</div>
                  <div className="k">Échéance</div>
                  <div className={`v${isOverdue ? ' due' : ''}`}>{fmtDateLong(invoice.due)}</div>
                  <div className="k">Paiement</div>
                  <div className="v">{orgSettings.paymentTerms || 'Net 14 jours'}</div>
                  <div className="k">Livraison</div>
                  <div className="v">{orgSettings.deliveryTerms || 'À convenir'}</div>
                </div>
              </div>
            </div>

            <div className="pp-subject"><span className="pp-subject-label">Objet :</span>{invoice.subject}</div>

            {linesError && (
              <div role="alert" style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', fontSize: 13 }}>
                Impossible de charger les lignes de cette facture. Le détail et les totaux ci-dessous sont incomplets — rechargez la page.
              </div>
            )}
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
                <div className="tot-row"><span>Sous-total HT</span><span className="tv">{fmt(subtotal)} F CFA</span></div>
                {discountPct > 0 && (
                  <div className="tot-row"><span>Remise ({discountPct}%)</span><span className="tv" style={{ color: 'var(--color-text-secondary)' }}>−{fmt(discountAmt)} F CFA</span></div>
                )}
                {canInvoiceTVA && <div className="tot-row"><span>{VAT_LABEL}</span><span className="tv">{fmt(tax)} F CFA</span></div>}
                {paid > 0 && (
                  <div className="tot-row"><span>Montant payé</span><span className="tv paid-amt">−{fmt(paid)} F CFA</span></div>
                )}
                {credited > 0 && (
                  <div className="tot-row"><span>Avoirs</span><span className="tv paid-amt">−{fmt(credited)} F CFA</span></div>
                )}
                <div className="tot-row grand"><span>Total dû</span><span className="tv">{invoice.status === 'draft' ? fmt(total) : fmt(amountDue)} F CFA</span></div>
              </div>
            </div>

            <div className="pp-pay">
              <div>
                <div className="pp-block-label">Modes de paiement</div>
                <div className="pp-pay-methods">
                  {paymentMethodsStatus === 'loading' ? (
                    <div className="pp-pm" style={{ color: 'var(--color-text-tertiary)' }}><span>Chargement…</span></div>
                  ) : paymentMethodsStatus === 'error' ? (
                    <div className="pp-pm" style={{ color: 'var(--color-text-tertiary)' }}><span>Modes de paiement indisponibles — rechargez la page.</span></div>
                  ) : paymentMethods.length > 0 ? paymentMethods.map(m => (
                    <div className="pp-pm" key={m.label}>
                      <Icon name={m.label === 'Virement bancaire' ? 'building-bank' : m.label === 'Espèces' ? 'cash' : 'device-mobile'} ariaHidden />
                      <span>{m.label} — <b>{m.value}</b></span>
                    </div>
                  )) : (
                    <div className="pp-pm" style={{ color: 'var(--color-text-tertiary)' }}>
                      <span>Aucun mode de paiement configuré — <button type="button" className="crumb-link" style={{ color: 'var(--brand)', textDecoration: 'underline' }} onClick={() => navigate('/settings')}>ajoutez-en dans Paramètres</button></span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="pp-block-label">Notes</div>
                <div className="pp-note">
                  Merci pour votre confiance. Conditions de paiement : {orgSettings.paymentTerms || 'Net 14 jours'}.
                </div>
              </div>
            </div>

            <div className="pp-foot">{orgSettings.name || 'Mon entreprise'} · Facture générée via Billio</div>
          </div>

          {/* Rail */}
          <aside className="rail">
            <div className="rail-card">
              <div className="rail-due-label">Montant dû</div>
              <div className="rail-due-amt tnum">
                {fmt(invoice.status === 'draft' ? total : amountDue)}<span className="cur">F CFA</span>
              </div>
              {isOverdue && (
                <div className="rail-due-sub">
                  <Icon name="alert-triangle" ariaHidden />
                  {daysOverdue(invoice.due)} jour{daysOverdue(invoice.due) > 1 ? 's' : ''} de retard · éch. {fmtDate(invoice.due)}
                </div>
              )}
              <div className="rail-actions">
                {writable && (isOverdue || invoice.status === 'pending') && (<>
                  <button className="btn btn-primary btn-block" onClick={() => { setPayRef(''); setPayMethod('cash'); setTvaRetenue(0); setServiceWithholding(0); setPayAmount(balance); setPayDialog(true); }}>
                    <Icon name="cash" ariaHidden /> Enregistrer un paiement
                  </button>
                  <button className="btn btn-block" onClick={() => setSendKind(isOverdue ? 'reminder' : 'send')} disabled={!paymentMethodsReady}>
                    <Icon name="send" ariaHidden /> {isOverdue ? 'Envoyer une relance' : 'Envoyer au client'}
                  </button>
                </>)}
                {writable && invoice.status === 'draft' && (
                  <button className="btn btn-primary btn-block" onClick={requestIssue} disabled={busyAction !== null || linesLoading || compliance.checking}>
                    <Icon name="send" ariaHidden /> {busyAction === 'issue' ? 'Émission…' : 'Émettre la facture'}
                  </button>
                )}
                <button className="btn btn-block" onClick={handleDownloadPDF} disabled={linesLoading || !paymentMethodsReady}>
                  <Icon name="printer" ariaHidden /> Télécharger PDF
                </button>
                {writable && (<>
                <div className="rail-divider" />
                <button className="btn btn-block" onClick={handleDuplicate} disabled={busyAction !== null || linesLoading}>
                  <Icon name="copy" ariaHidden /> {busyAction === 'duplicate' ? 'Duplication…' : 'Dupliquer'}
                </button>
                {invoice.status === 'draft' ? (canDelete(userRole) &&
                  <button className="btn btn-block btn-ghost btn-danger" onClick={handleDelete}>
                    <Icon name="trash" ariaHidden /> Supprimer la facture
                  </button>
                ) : (
                  <button className="btn btn-block btn-ghost btn-danger" onClick={openAvoir}>
                    <Icon name="file-minus" ariaHidden /> Émettre un avoir
                  </button>
                )}
                </>)}
              </div>
            </div>

            <div className="rail-card">
              <div className="rail-title">Activité</div>
              {creditNotes.map(cn => (
                <div key={cn.id} className="tl-item">
                  <div className="tl-dot avoir" />
                  <div>
                    <div className="tl-text">Avoir {cn.id} — {fmt(cn.amount)} F CFA</div>
                    <div className="tl-time">{fmtDateLong(cn.issued)} · {cn.reason}</div>
                  </div>
                </div>
              ))}
              {timeline.map((entry, i) => (
                <div key={i} className="tl-item">
                  <div className={`tl-dot${entry.dot ? ` ${entry.dot}` : ''}`} />
                  <div>
                    <div className="tl-text">{entry.text}</div>
                    <div className="tl-time">{entry.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>

    {sendKind && paymentMethodsReady && (() => {
      const msg = invoiceMessage(sendKind, {
        invoiceId: invoice.id, clientName: client.name, orgName: orgSettings.name,
        amountDue, due: invoice.due, methods: paymentMethods,
        overdueDays: daysOverdue(invoice.due),
      });
      return (
        <SendDocumentDialog
          title={sendKind === 'reminder' ? `Relancer ${client.name}` : `Envoyer la facture #${invoice.id}`}
          recipientName={client.name}
          email={contactValue(client.email)}
          phone={contactValue(client.phone)}
          subject={msg.subject}
          message={msg.message}
          onSent={handleSent}
          onClose={() => setSendKind(null)}
          onDownloadPdf={handleDownloadPDF}
        />
      );
    })()}
    {payDialog && (
      <div className="inv-overlay" onClick={() => setPayDialog(false)}>
        <div className="inv-modal" onClick={e => e.stopPropagation()}>
          <div className="inv-modal-head">
            <div className="inv-modal-title">
              <Icon name="cash" size={16} ariaHidden />
              Enregistrer un paiement
            </div>
            <button className="btn btn-icon" onClick={() => setPayDialog(false)} aria-label="Fermer">
              <Icon name="x" size={16} ariaHidden />
            </button>
          </div>
          <div className="inv-modal-body">
            <div>
              <div className="form-label">Méthode de paiement</div>
              <div className="method-pick" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                {(['cash', 'wire', 'momo', 'cheque'] as PayMethod[]).map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`mp-opt${payMethod === m ? ' active' : ''}`}
                    onClick={() => setPayMethod(m)}
                  >
                    <Icon name={m === 'cash' ? 'cash' : m === 'wire' ? 'building-bank' : m === 'momo' ? 'device-mobile' : 'writing'} size={18} ariaHidden />
                    <span>{METHOD_LABEL[m]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Montant réglé (reste à payer : {fmt(balance)} F CFA)</label>
              <input
                className="form-input"
                type="number"
                min={1}
                max={balance}
                value={payAmount || ''}
                placeholder="0"
                onChange={e => setPayAmount(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Référence (optionnel)</label>
              <input
                className="form-input"
                type="text"
                value={payRef}
                onChange={e => setPayRef(e.target.value)}
                placeholder={REF_PLACEHOLDER[payMethod]}
              />
            </div>
            {canInvoiceTVA && (
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Retenue TVA (30 % = {fmt(Math.round(tax * 0.30))} F)</span>
                  <button
                    type="button"
                    style={{ fontSize: 11, color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => setTvaRetenue(Math.round(tax * 0.30))}
                  >
                    Appliquer 30 %
                  </button>
                </label>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  max={tax}
                  value={tvaRetenue || ''}
                  placeholder="0"
                  onChange={e => setTvaRetenue(Math.max(0, Math.min(tax, Number(e.target.value) || 0)))}
                />
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 0 }}>
              {(() => {
                const suggested = clientWithholdingScenario
                  ? calculateServiceWithholding(discountedSub, clientWithholdingScenario)
                  : null;
                const belowThreshold = discountedSub < SERVICE_WITHHOLDING_THRESHOLD;
                const RATE_LABEL: Record<string, string> = {
                  'resident-with-ifu':    '5 %',
                  'resident-without-ifu': '25 %',
                  'construction':         '1 %',
                  'non-resident':         '20 %',
                };
                return (<>
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Retenue à la source services (Art.207/212)</span>
                    {suggested !== null && !belowThreshold && (
                      <button
                        type="button"
                        style={{ fontSize: 11, color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        onClick={() => setServiceWithholding(suggested)}
                      >
                        Appliquer {RATE_LABEL[clientWithholdingScenario!]} ({fmt(suggested)} F)
                      </button>
                    )}
                  </label>
                  {belowThreshold ? (
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '6px 0' }}>
                      Montant HT sous le seuil de {fmt(SERVICE_WITHHOLDING_THRESHOLD)} F — pas de retenue requise (Art.208.3)
                    </div>
                  ) : (
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={serviceWithholding || ''}
                      placeholder={suggested !== null ? `Suggéré : ${fmt(suggested)} F` : '0'}
                      onChange={e => setServiceWithholding(Math.max(0, Number(e.target.value) || 0))}
                    />
                  )}
                </>);
              })()}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div>Montant réglé : <b>{fmt(payAmount)} F CFA</b>{payAmount < balance && <> · reste ensuite {fmt(balance - payAmount)} F CFA</>}</div>
              {(tvaRetenue > 0 || serviceWithholding > 0) && (<>
                {tvaRetenue > 0       && <div style={{ color: '#276C2B' }}>TVA retenue (4449) : −{fmt(tvaRetenue)} F</div>}
                {serviceWithholding > 0 && <div style={{ color: '#8A5207' }}>Ret. services (4091) : −{fmt(serviceWithholding)} F</div>}
                <div style={{ fontWeight: 700 }}>Vous recevrez : {fmt(payAmount - tvaRetenue - serviceWithholding)} F CFA</div>
              </>)}
            </div>
          </div>
          <div className="inv-modal-foot">
            <button className="btn" onClick={() => setPayDialog(false)}>Annuler</button>
            <button className="btn btn-primary" onClick={handleConfirmPayment} disabled={paySaving}>
              <Icon name="check" size={14} ariaHidden /> {paySaving ? 'Enregistrement…' : 'Confirmer'}
            </button>
          </div>
        </div>
      </div>
    )}
      {/* Edit panel */}
      <div className={`scrim${editOpen ? ' open' : ''}`} onClick={() => setEditOpen(false)} />
      <div className={`new-inv-panel${editOpen ? ' open' : ''}`} role="dialog" aria-label="Modifier la facture" aria-modal="true">
        <div className="panel-slide-head">
          <div>
            <div className="panel-slide-title">Modifier la facture</div>
            <div className="panel-slide-sub">#{invoice.id}</div>
          </div>
          <button className="icon-btn" onClick={() => setEditOpen(false)} aria-label="Fermer">
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
              <label className="form-label">Date de facturation</label>
              <input type="date" className="form-input" value={eDate} onChange={e => setEDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Date d'échéance</label>
              <input type="date" className="form-input" value={eDue} onChange={e => setEDue(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Objet</label>
            <input type="text" className="form-input" placeholder="ex. Développement web — sprint 5"
              maxLength={255} value={eSubject} onChange={e => setESubject(e.target.value)} />
          </div>

          <div className="subhead"><span>Lignes de facturation</span></div>
          <div className="line-items-head">
            <div className="li-col">Description</div>
            <div className="li-col">Unité</div>
            <div className="li-col right">Qté</div>
            <div className="li-col right">Prix</div>
            <div />
          </div>

          {eLines.map((li, idx) => (
            <div key={li.id} className="line-item">
              <div className="line-item-row">
                <input className="li-input" placeholder="Description du service" value={li.desc}
                  aria-label={`Description, ligne ${idx + 1}`}
                  onChange={e => updateELine(li.id, 'desc', e.target.value)} />
                <select className="li-input" value={li.unit ?? 'unité'}
                  aria-label={`Unité, ligne ${idx + 1}`}
                  onChange={e => updateELine(li.id, 'unit', e.target.value)}>
                  {['unité','heure','jour','mois','an','projet','article','licence'].map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <input className="li-input num" type="number" min="0" value={li.qty}
                  aria-label={`Quantité, ligne ${idx + 1}`}
                  onChange={e => updateELine(li.id, 'qty', e.target.value)} />
                <input className="li-input num" type="number" min="0" value={li.price || ''}
                  placeholder="0" aria-label={`Prix unitaire, ligne ${idx + 1}`}
                  onChange={e => updateELine(li.id, 'price', e.target.value)} />
                <button className="li-del" onClick={() => setELines(prev => prev.length > 1 ? prev.filter(l => l.id !== li.id) : prev)} aria-label={`Supprimer la ligne ${idx + 1}`}>
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
            <div className="total-row" style={{ alignItems: 'center' }}>
              <span>Remise (%)</span>
              <input
                type="number" min="0" max="100" step="0.5"
                className="form-input"
                style={{ width: 80, textAlign: 'right', padding: '3px 8px', fontSize: 13 }}
                value={eDiscount || ''}
                placeholder="0"
                onChange={e => setEDiscount(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
              />
            </div>
            {eDiscount > 0 && <div className="total-row" style={{ color: 'var(--color-text-secondary)' }}><span>Montant remise</span><span>−{fmt(eDiscountAmt)} F CFA</span></div>}
            {canInvoiceTVA && <div className="total-row"><span>{VAT_LABEL}</span><span>{fmt(eTax)} F CFA</span></div>}
            <div className="total-row final"><span>Total à payer</span><span>{fmt(eTotal)} F CFA</span></div>
          </div>
        </div>

        <div className="panel-footer">
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditOpen(false)}>
            Annuler
          </button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving} onClick={handleSaveEdit}>
            <Icon name="check" ariaHidden /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {deleteDialog && (
        <ConfirmModal
          title="Supprimer la facture"
          body={`Supprimer la facture #${invoice.id} ? Cette action est irréversible et effacera également les écritures comptables associées.`}
          confirmLabel="Supprimer la facture"
          onConfirm={handleConfirmDelete}
          onClose={() => setDeleteDialog(false)}
        />
      )}

      {avoirDialog && (
        <div className="inv-overlay" onClick={() => !avoirSaving && setAvoirDialog(false)}>
          <div className="inv-modal" onClick={e => e.stopPropagation()}>
            <div className="inv-modal-head">
              <div className="inv-modal-title">
                <Icon name="file-minus" size={16} ariaHidden />
                Émettre un avoir
              </div>
              <button className="btn btn-icon" onClick={() => setAvoirDialog(false)} aria-label="Fermer" disabled={avoirSaving}>
                <Icon name="x" size={16} ariaHidden />
              </button>
            </div>
            <div className="inv-modal-body">
              <div className="form-label">Motif de l'avoir <span style={{ color: 'var(--color-danger)' }}>*</span></div>
              <input
                className="form-input"
                placeholder="Ex : erreur de tarif, annulation partielle…"
                value={avoirReason}
                onChange={e => setAvoirReason(e.target.value)}
              />
              <div className="form-label" style={{ marginTop: 12 }}>Montant TTC à annuler (max {fmt(creditable)} F CFA)</div>
              <input
                className="form-input"
                type="number"
                min={1}
                max={creditable}
                step={1}
                value={avoirAmount}
                onChange={e => setAvoirAmount(Number(e.target.value))}
              />
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                Conforme SYSCOHADA — un avoir génère une écriture comptable de contre-passation (AV-) dans le journal des ventes. La facture originale reste dans l'historique.
              </p>
            </div>
            <div className="inv-modal-foot">
              <button className="btn" onClick={() => setAvoirDialog(false)} disabled={avoirSaving}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={handleConfirmAvoir} disabled={avoirSaving}>
                {avoirSaving ? 'Émission…' : 'Émettre l\'avoir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
