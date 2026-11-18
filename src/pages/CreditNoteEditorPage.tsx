// A credit note in the invoice editor (PRO-168): a credit note is a kind of
// invoice, so it is written on the same A4 sheet.
// /invoices/:id/credit-note   a new credit note on issued invoice :id
// /credit-notes/:cnId/edit    a draft credit note
// The sheet is titled « FACTURE D'AVOIR ». Its nature (COR, RAN, RAM, RRR) and
// its reason are required; the lines are the invoice's, and only the quantity
// credited is typed, up to what earlier credit notes left. The client, the
// discount and the VAT are the invoice's. Issuing gives the number
// (AV-YYYY-NNNN) and posts the accounting entry.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import posthog from 'posthog-js';
import Page from '@/components/Page';
import StatusPill from '@/components/sales/StatusPill';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { canDelete } from '@/lib/permissions';
import { useDismiss } from '@/lib/use-dismiss';
import { fetchLineItems } from '@/lib/api/line-items';
import {
  createCreditNote, creditNoteIssueError, fetchCreditNote, fetchCreditNotes, nextCreditNoteId,
  removeCreditNoteDraft, updateCreditNoteDraft, type CreditNoteFields,
} from '@/lib/api/credit-notes';
import { fetchInvoiceEntries, recordCreditNoteEntry } from '@/lib/api/accounting';
import { createActivity } from '@/lib/api/activities';
import {
  CREDIT_NATURES, amountTotals, creditIssueProblem, creditLines, creditTotals, creditableAmount, creditableQty, invoiceChargedVat, natureLabel,
  amountOnlyLines, amountOnlyVat, reconcileFinalCredit, vatChoiceFromDraft, vatFromSalesEntry,
  type CreditNature,
} from '@/lib/credit-note';
import { renderCreditNotePdf, showPdf } from '@/lib/credit-note-pdf';
import { invoiceBalance } from '@/lib/invoice-status';
import { filledLines } from '@/lib/line-validation';
import { invoiceRef, creditNoteRef } from '@/lib/invoice-number';
import { clientTypeDef, clientTypeOf } from '@/lib/client-type';
import { getFiscalIdLabel } from '@/lib/ohada';
import { formatCadastralRef } from '@/lib/cadastral';
import { invoiceTotalMention } from '@/lib/amount-in-words';
import { contactValue } from '@/lib/share-links';
import { paperBands } from '@/lib/invoice-template';
import { VAT_LABEL, VAT_RATE, chargesVat } from '@/lib/vat';
import { fmt, fmtDateLong } from '@/data';
import type { Activity, CreditNote, Invoice, LineItem } from '@/lib/schemas';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const timeOf = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function CreditNoteEditorPage() {
  const { id: invoiceParam, cnId } = useParams();
  const navigate = useNavigate();
  const { orgId, loading, invoices, setInvoices, payments, clientsMap, orgSettings, invoiceTemplate, setActivity, showToast, userRole } = useApp();
  const { postable, credits } = usePermissions();

  // ── Load: the draft (if any), its invoice, the invoice's lines and issued credit notes ──
  const [draft, setDraft] = useState<CreditNote | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invLines, setInvLines] = useState<LineItem[]>([]);
  const [issuedNotes, setIssuedNotes] = useState<CreditNote[]>([]);
  const [ready, setReady] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  // An invoice without stored lines is credited by amount (TTC), as the old dialog did
  const [amt, setAmt] = useState(0);
  // Its VAT, from its sales entry (null: not found, or not readable for this role)
  const [entryVat, setEntryVat] = useState<boolean | null>(null);
  // ...and when that entry can't be read, the user says (null: not said yet)
  const [vatChoice, setVatChoice] = useState<boolean | null>(null);
  const [nature, setNature] = useState<CreditNature | ''>('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(() => isoDay(new Date()));
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [baseline, setBaselineState] = useState('');
  const baselineRef = useRef('');
  const setBaseline = (v: string) => { baselineRef.current = v; setBaselineState(v); };
  const snapOf = (v: { qty: Record<string, number>; amt: number; vat: boolean | null; nature: string; reason: string; date: string }) =>
    JSON.stringify({ qty: Object.entries(v.qty).filter(([, q]) => q > 0).sort(), amt: v.amt, vat: v.vat, nature: v.nature, reason: v.reason.trim(), date: v.date });
  const snapshot = snapOf({ qty, amt, vat: vatChoice, nature, reason, date });
  const dirty = ready && snapshot !== baseline;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const leaveOk = useRef(false);

  const loadKey = cnId ? `cn:${cnId}` : `inv:${invoiceParam}`;
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !orgId || loadedFor.current === loadKey) return;
    let live = true;
    setReady(false);
    const fail = (msg: string, to: string) => { if (!live) return; showToast(msg, true); leaveOk.current = true; navigate(to, { replace: true }); };
    (async () => {
      let cn: CreditNote | null = null;
      if (cnId) {
        cn = await fetchCreditNote(orgId, cnId);
        if (!live) return;
        if (!cn) return fail('Avoir introuvable.', '/invoices');
        if (cn.status === 'issued') { leaveOk.current = true; navigate(`/invoices/${cn.invoiceId}`, { replace: true }); return; }
      }
      const invId = cn?.invoiceId ?? invoiceParam ?? '';
      const inv = invoices.find(i => i.id === invId);
      if (!inv) return fail('Facture introuvable.', '/invoices');
      if (inv.status === 'draft') return fail('Un avoir se crée sur une facture émise.', `/invoices/${inv.id}/edit`);
      const [ls, notes] = await Promise.all([fetchLineItems(orgId, { invoiceId: inv.id }), fetchCreditNotes(orgId, inv.id)]);
      if (!live) return;
      // No lines: the VAT comes from the invoice's sales entry, not today's regime
      const ev = filledLines(ls).length === 0
        ? await fetchInvoiceEntries(orgId, inv.id).then(e => vatFromSalesEntry(e, inv.id)).catch(() => null)
        : null;
      if (!live) return;
      setEntryVat(ev);
      // A draft keeps its quantities, but never more than what is left on each
      // line now (a credit note may have been issued since it was saved)
      const remaining = creditableQty(filledLines(ls), notes.filter(n => n.id !== cn?.id));
      const q: Record<string, number> = {};
      let reduced = false;
      for (const l of cn?.lines ?? []) {
        if (!l.sourceId) continue;
        const want = (q[l.sourceId] ?? 0) + l.qty;
        const cap = remaining[l.sourceId] ?? 0;
        if (want > cap) reduced = true;
        q[l.sourceId] = Math.min(want, cap);
      }
      if (reduced) showToast('Certaines quantités dépassaient ce qui reste à créditer et ont été réduites.', true);
      // Invoice without lines: the draft's amount, and the VAT it was written with
      // (its one line holds the amount before tax)
      const noLines = filledLines(ls).length === 0;
      const a = cn && noLines ? cn.amount : 0;
      const vc = cn && noLines ? vatChoiceFromDraft(cn) : null;
      setDraft(cn);
      setAmt(a);
      setVatChoice(vc);
      setInvoiceId(inv.id);
      setInvLines(filledLines(ls));
      setIssuedNotes(notes.filter(n => n.id !== cn?.id));
      setQty(q);
      setNature(cn?.nature ?? '');
      setReason(cn?.reason ?? '');
      const d = cn?.issued ?? isoDay(new Date());
      setDate(d);
      setSavedAt(null);
      // What the draft holds as saved; a reduced quantity counts as a change to save
      const savedQty: Record<string, number> = {};
      for (const l of cn?.lines ?? []) if (l.sourceId) savedQty[l.sourceId] = (savedQty[l.sourceId] ?? 0) + l.qty;
      setBaseline(snapOf({ qty: savedQty, amt: a, vat: vc, nature: cn?.nature ?? '', reason: cn?.reason ?? '', date: d }));
      loadedFor.current = loadKey;
      leaveOk.current = false;
      setReady(true);
    })().catch(err => {
      console.error('[creditNoteEditor] load', err);
      fail('L’avoir n’a pas pu être chargé. Réessayez.', invoiceParam ? `/invoices/${invoiceParam}` : '/invoices');
    });
    return () => { live = false; };
    // Loads once per credit note or invoice; later edits are the user's
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, orgId, loadKey]);

  const invoice: Invoice | undefined = invoiceId ? invoices.find(i => i.id === invoiceId) : undefined;
  const clientRec = invoice ? clientsMap[invoice.client] : undefined;

  // ── What can be credited, and the totals ───────────────────────────────────
  const left = useMemo(() => creditableQty(invLines, issuedNotes), [invLines, issuedNotes]);
  const lines = useMemo(() => creditLines(invLines, qty), [invLines, qty]);
  const amountOnly = invLines.length === 0;
  // Without lines, the invoice's VAT can't be read from its lines and total:
  // its sales entry says, or the user does (never today's regime alone)
  const amountVat = amountOnlyVat(entryVat, vatChoice);
  const vatUnknown = amountOnly && amountVat === null;
  const vatCharged = invoice
    ? (amountOnly ? amountVat === true : invoiceChargedVat(invoice, invLines, chargesVat(orgSettings.taxRegime)))
    : false;
  const max = invoice ? creditableAmount(invoice, issuedNotes) : 0;
  // The credit that empties every line takes exactly what is left (rounding)
  const emptiesInvoice = !amountOnly && lines.length > 0 && invLines.every(l => (qty[l.id] ?? 0) >= (left[l.id] ?? 0));
  const totals = amountOnly
    ? amountTotals(amt, vatCharged)
    : reconcileFinalCredit(creditTotals(lines, { discountPct: invoice?.discountPct ?? 0 }, vatCharged),
      { emptiesInvoice, left: max, chargedVat: vatCharged, tolerance: 2 * (issuedNotes.length + 1) });
  const bal = invoice ? invoiceBalance(invoice, payments, issuedNotes) : { paid: 0, credited: 0, balance: 0 };
  const dueAfter = Math.max(0, bal.balance - totals.total);
  const problem = vatUnknown
    ? 'Précisez si la facture d’origine portait la TVA.'
    : creditIssueProblem({ nature, reason, total: totals.total, max, paid: bal.paid });
  const setLineQty = (lid: string, raw: string) => {
    const v = Math.max(0, Math.min(left[lid] ?? 0, parseFloat(raw) || 0));
    setQty(prev => ({ ...prev, [lid]: v }));
  };
  const creditAll = () => { if (amountOnly) setAmt(max); else setQty({ ...left }); };
  const clearAll = () => { setQty({}); setAmt(0); };

  const checks = [
    nature ? { ok: true, text: `Nature : ${natureLabel(nature)}` } : { ok: false, text: 'Choisissez la nature de l’avoir' },
    ...(nature === 'RAN' && bal.paid > 0 ? [{ ok: false, text: 'RAN impossible : la facture a reçu un paiement (choisissez RAM)' }] : []),
    reason.trim() ? { ok: true, text: 'Motif indiqué' } : { ok: false, text: 'Indiquez le motif' },
    totals.total > 0
      ? { ok: true, text: amountOnly ? `Montant : ${fmt(totals.total)} F CFA` : `${lines.length} ligne${lines.length > 1 ? 's' : ''} créditée${lines.length > 1 ? 's' : ''}` }
      : { ok: false, text: amountOnly ? 'Indiquez le montant à créditer' : 'Indiquez au moins une quantité à créditer' },
    totals.total > max ? { ok: false, text: `Dépasse ce qui reste à créditer (${fmt(max)} F CFA)` } : { ok: true, text: `Reste à créditer sur la facture : ${fmt(max)} F CFA` },
    ...(vatUnknown ? [{ ok: false, text: 'Précisez si la facture d’origine portait la TVA' }] : []),
  ];
  const blocking = checks.filter(c => !c.ok).length;

  // ── Save, issue, preview, delete ───────────────────────────────────────────
  const [busy, setBusy] = useState<'save' | 'issue' | 'pdf' | 'delete' | null>(null);
  const busyRef = useRef(false);
  const fields = (): CreditNoteFields | null => invoice ? {
    invoiceId: invoice.id, subject: `Avoir sur ${invoiceRef(invoice)}`, client: invoice.client, issued: date,
    amount: totals.total, reason: reason.trim(), nature: nature || undefined, discountPct: amountOnly ? 0 : invoice.discountPct ?? 0,
    // An amount-only note keeps its amount before tax as one line (no source line): its PDF and VAT stay as issued
    lines: amountOnly
      ? amountOnlyLines({ total: totals.total, net: totals.net, vatKnown: amountVat !== null, desc: `Montant crédité sur ${invoiceRef(invoice)}` })
      : lines,
  } : null;

  async function run(kind: 'save' | 'issue' | 'pdf' | 'delete', fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(kind);
    try { await fn(); } finally { busyRef.current = false; setBusy(null); }
  }

  const onSave = () => run('save', async () => {
    const f = fields();
    if (!f) return;
    try {
      let cn: CreditNote;
      if (draft) cn = await updateCreditNoteDraft(orgId, draft.id, f);
      else {
        cn = await createCreditNote(orgId, await nextCreditNoteId(orgId), f, 'draft');
        // The address names the draft, so a reload comes back to it (no remount)
        window.history.replaceState(window.history.state, '', `/credit-notes/${cn.id}/edit`);
      }
      setDraft(cn);
      setSavedAt(new Date());
      setBaseline(snapshot);
      showToast('Brouillon d’avoir enregistré');
    } catch (err) {
      console.error('[saveCreditNote]', err);
      showToast('Le brouillon n’a pas pu être enregistré. Réessayez.', true);
    }
  });

  const onIssue = () => {
    if (problem) { showToast(problem, true); setChecksOpen(true); return; }
    void run('issue', async () => {
      const f = fields();
      if (!f || !invoice) return;
      try {
        const cn = draft
          ? await updateCreditNoteDraft(orgId, draft.id, f, true)
          : await createCreditNote(orgId, await nextCreditNoteId(orgId), f, 'issued');
        const ref = creditNoteRef(cn);
        setBaseline(snapshot);
        // The database marks the invoice paid once nothing is left to collect
        if ((invoice.status === 'pending' || invoice.status === 'overdue') && dueAfter <= 0) {
          setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, status: 'paid' as const } : i));
        }
        const clientName = clientRec?.name ?? invoice.client;
        // Posted before leaving, so the invoice page reads the entry with the others
        try {
          await recordCreditNoteEntry(orgId, { creditNoteId: cn.id, invoiceId: invoice.id, htAmount: totals.net, tvaAmount: totals.tax, date: cn.issued, clientName });
          showToast(`Avoir ${ref} émis`);
        } catch (err) {
          console.error('[recordCreditNoteEntry]', err);
          // Only this message: a success toast after it would replace it
          showToast(`Avoir ${ref} émis, mais l’écriture comptable n’a pas pu être enregistrée. Signalez-le à votre comptable.`, true);
        }
        const act = { kind: 'avoir' as const, parts: [{ text: 'Avoir ' }, { text: ref, bold: true as const }, { text: ` (${cn.nature}) sur ` }, { text: `#${invoiceRef(invoice)}`, bold: true as const }, { text: ` · ${clientName}` }] };
        setActivity((prev: Activity[]) => [{ ...act, time: "À l'instant" }, ...prev]);
        createActivity(orgId, act).catch(err => console.error('[createActivity] failed:', err));
        posthog.capture('credit_note_issued', { nature: cn.nature, line_count: cn.lines.length, amount: cn.amount, currency: 'XOF' });
        leaveOk.current = true;
        navigate(`/invoices/${invoice.id}`, { replace: true });
      } catch (err) {
        console.error('[issueCreditNote]', err);
        showToast(creditNoteIssueError(err) ?? 'L’avoir n’a pas pu être émis. Réessayez.', true);
      }
    });
  };

  const onPreviewPdf = () => {
    if (!invoice || !clientRec) return;
    const tab = window.open('', '_blank');
    void run('pdf', async () => {
      try {
        const f = fields()!;
        const preview: CreditNote = { ...f, id: draft?.id ?? 'avoir', status: 'draft' };
        showPdf(await renderCreditNotePdf({ creditNote: preview, invoice, chargedVat: vatCharged, client: clientRec, biz: orgSettings, template: invoiceTemplate }), tab);
      } catch (err) {
        tab?.close();
        console.error('[creditNotePdf]', err);
        showToast('Le PDF n’a pas pu être généré. Réessayez.', true);
      }
    });
  };

  const onDelete = () => {
    if (!draft || !window.confirm('Supprimer ce brouillon d’avoir ? Il n’a pas de numéro : rien n’est perdu dans la numérotation.')) return;
    void run('delete', async () => {
      try {
        await removeCreditNoteDraft(orgId, draft.id);
        showToast('Brouillon d’avoir supprimé');
        leaveOk.current = true;
        navigate(`/invoices/${draft.invoiceId}`, { replace: true });
      } catch (err) {
        console.error('[removeCreditNoteDraft]', err);
        showToast('Le brouillon n’a pas pu être supprimé. Réessayez.', true);
      }
    });
  };

  // ── Leaving with unsaved changes asks first ────────────────────────────────
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  const blocker = useBlocker(() => readyRef.current && !leaveOk.current && snapshotRef.current !== baselineRef.current);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Quitter sans enregistrer ? Les modifications de l’avoir seront perdues.')) blocker.proceed();
    else blocker.reset();
    // Once per blocked navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  // Floating bar popovers
  const [checksOpen, setChecksOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const checksRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const closeChecks = useCallback(() => setChecksOpen(false), []);
  const closeEntry = useCallback(() => setEntryOpen(false), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useDismiss(checksRef, checksOpen, closeChecks);
  useDismiss(entryRef, entryOpen, closeEntry);
  useDismiss(moreRef, moreOpen, closeMore);

  if (loading || !ready || !invoice) return <PageSkeleton title="Avoir" variant="document" rows={4} />;
  if (!credits) {
    return <Page title="Avoir" back={{ label: 'Retour à la facture', onClick: () => navigate(`/invoices/${invoice.id}`) }}><p className="dt-muted">Seuls les administrateurs et les comptables émettent des avoirs.</p></Page>;
  }

  const locked = busy !== null;
  const pageBand = paperBands(invoiceTemplate);
  const ref = invoiceRef(invoice);
  const sellerIds = [
    orgSettings.ifu && `${getFiscalIdLabel(orgSettings.country)} ${orgSettings.ifu}`,
    orgSettings.rccm && `RCCM ${orgSettings.rccm}`,
    orgSettings.taxRegime, orgSettings.divisionFiscale,
  ].filter(Boolean).join(' · ');
  const clientIds = clientRec ? [
    clientRec.ifu && `${getFiscalIdLabel(clientRec.country ?? 'Burkina Faso')} ${clientRec.ifu}`,
    clientRec.rccm && `RCCM ${clientRec.rccm}`, clientRec.taxRegime, clientRec.fiscalDivision,
  ].filter(Boolean) as string[] : [];
  const ranBlocked = bal.paid > 0;

  return (
    <Page
      back={{ label: 'Retour à la facture', onClick: () => navigate(`/invoices/${invoice.id}`) }}
      title={<span className="iv-title"><span>{draft ? 'Brouillon d’avoir' : 'Nouvel avoir'}</span><StatusPill tone="draft" label="Avoir · brouillon" /></span>}
      subtitle={
        <span className="iv-sub">
          <span>Sur la facture <button type="button" className="dt-linkcell" onClick={() => navigate(`/invoices/${invoice.id}`)}>{ref}</button></span>
          <span>N° AV attribué à l’émission</span>
          <span>{savedAt ? `Enregistré à ${timeOf(savedAt)}` : draft ? 'Enregistré' : 'Pas encore enregistré'}{dirty && draft ? ' · modifications non enregistrées' : ''}</span>
        </span>
      }
      documentTitle={draft ? 'Brouillon d’avoir' : 'Nouvel avoir'}
      actions={<>
        <button className="btn" onClick={() => navigate(`/invoices/${invoice.id}`)} disabled={locked}>Annuler</button>
        <button className="btn" onClick={() => void onSave()} disabled={locked}>{busy === 'save' ? 'Enregistrement…' : 'Enregistrer le brouillon'}</button>
        <button className="btn btn-primary" onClick={onIssue} disabled={locked}>{busy === 'issue' ? 'Émission…' : 'Émettre l’avoir'}</button>
      </>}
    >
      <div className="ie-stage">
        <div className="ie-toolbar" role="toolbar" aria-label="Lignes de l’avoir">
          <button type="button" className="ie-tool ie-tool-txt" onClick={creditAll} disabled={locked}>Tout créditer</button>
          <button type="button" className="ie-tool ie-tool-txt" onClick={clearAll} disabled={locked}>Remettre à zéro</button>
          <span className="ie-tool-where">Les lignes viennent de la facture : indiquez la quantité créditée</span>
        </div>

        <div className={`paper ie-sheet${pageBand ? ' has-bands' : ''}`} style={pageBand ? { ['--band' as string]: pageBand } : undefined}>
          <div className="ie-watermark" aria-hidden="true">BROUILLON</div>

          <div className="pp-top">
            <div className="pp-biz ie-locked">
              <div>
                <div className="pp-biz-name">{orgSettings.name || 'Mon entreprise'}</div>
                <div className="pp-biz-meta">
                  {[orgSettings.address, orgSettings.city, orgSettings.country].filter(Boolean).join(', ')}
                  {sellerIds && <><br />{sellerIds}</>}
                  {orgSettings.cadastralRef && <><br />Réf. cadastrale {formatCadastralRef(orgSettings.cadastralRef)}</>}
                </div>
              </div>
            </div>
            <div className="pp-doc">
              <div className="pp-doc-title">Facture d’avoir</div>
              <div className="pp-doc-num ie-later">N° attribué à l’émission</div>
              <label className="cn-nature">
                <span>Nature</span>
                <select className={`ie-field${nature ? '' : ' empty'}`} value={nature} disabled={locked} onChange={e => setNature(e.target.value as CreditNature)}>
                  <option value="">Choisir…</option>
                  {CREDIT_NATURES.map(n => (
                    <option key={n.code} value={n.code} disabled={n.code === 'RAN' && ranBlocked}>
                      {n.code} · {n.label}{n.code === 'RAN' && ranBlocked ? ' (facture déjà payée en partie)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {nature && <div className="cn-nature-hint">{CREDIT_NATURES.find(n => n.code === nature)?.hint}</div>}
            </div>
          </div>

          <div className="pp-parties">
            <div>
              <div className="pp-block-label">Avoir au profit de</div>
              <div className="pp-client-name">{clientRec?.name ?? invoice.client}</div>
              {clientRec && (
                <>
                  <div className="pp-client-meta">{clientTypeDef(clientTypeOf(clientRec)).mention}</div>
                  <div className="pp-client-meta">{[contactValue(clientRec.city), contactValue(clientRec.country)].filter(Boolean).join(', ')}</div>
                  {clientIds.length > 0 && <div className="pp-compliance-ids">{clientIds.map(x => <span key={x}>{x}</span>)}</div>}
                </>
              )}
            </div>
            <div>
              <div className="pp-block-label">Détails</div>
              <div className="pp-meta-grid">
                <div className="k">Facture d’origine</div>
                <div className="v"><button type="button" className="dt-linkcell" onClick={() => navigate(`/invoices/${invoice.id}`)}>{ref}</button> du {fmtDateLong(invoice.issued)}</div>
                <label className="k" htmlFor="cn-date">Date de l’avoir</label>
                <div className="v"><input id="cn-date" type="date" className="ie-field" value={date} min={invoice.issued} disabled={locked} onChange={e => setDate(e.target.value)} /></div>
                <div className="k">Émis le</div>
                <div className="v ie-later">date, heure et opérateur à l’émission</div>
              </div>
            </div>
          </div>

          <div className="pp-subject">
            <label className="pp-subject-label" htmlFor="cn-reason">Motif :</label>
            <input id="cn-reason" className={`ie-field ie-grow${reason.trim() ? '' : ' empty'}`} maxLength={500} placeholder="ex. Formation reportée, 2 heures de support non consommées"
              value={reason} disabled={locked} onChange={e => setReason(e.target.value)} />
          </div>

          <table className="li-table ie-lines">
            <thead>
              <tr>
                <th>Description</th>
                <th className="r">Qté créditée</th>
                <th>Unité</th>
                <th className="r">P.U. HT</th>
                <th className="r">TVA</th>
                <th className="r">Montant HT</th>
              </tr>
            </thead>
            <tbody>
              {invLines.map((l, i) => {
                const q = qty[l.id] ?? 0;
                const room = left[l.id] ?? 0;
                return (
                  <tr key={l.id} className={q > 0 ? undefined : 'cn-off'}>
                    <td>
                      <div className="cn-desc">{l.desc}</div>
                      <div className="cn-sub">facturé : {fmt(l.qty)} {l.unit ?? 'unité'}{room < l.qty ? ` · déjà crédité : ${fmt(l.qty - room)}` : ''}</div>
                    </td>
                    <td className="r">
                      <input className="ie-field num ie-qty" type="number" min="0" max={room} step="any" value={q || ''} placeholder="0" disabled={locked || room === 0}
                        aria-label={`Quantité créditée, ligne ${i + 1} (au plus ${fmt(room)})`} onChange={e => setLineQty(l.id, e.target.value)} />
                      <span className="cn-max">/ {fmt(room)}</span>
                    </td>
                    <td>{l.unit ?? 'unité'}</td>
                    <td className="r">{fmt(l.price)}</td>
                    <td className="r ie-muted">{vatCharged ? `${Math.round(VAT_RATE * 100)} %` : '—'}</td>
                    <td className="r ie-amt">{fmt(q * l.price)}</td>
                  </tr>
                );
              })}
              {amountOnly && (
                <tr>
                  <td colSpan={5}>
                    <label htmlFor="cn-amount" className="cn-desc">Montant TTC à créditer</label>
                    <div className="cn-sub">Cette facture n’a pas de lignes enregistrées : l’avoir porte sur un montant (au plus {fmt(max)} F CFA).</div>
                    {entryVat === null && (
                      <label className="cn-vat">
                        <span>La facture d’origine portait-elle la TVA ?</span>
                        <select className={`ie-field${vatChoice === null ? ' empty' : ''}`} value={vatChoice === null ? '' : vatChoice ? 'yes' : 'no'} disabled={locked}
                          onChange={e => setVatChoice(e.target.value === '' ? null : e.target.value === 'yes')}>
                          <option value="">À préciser</option>
                          <option value="yes">Oui ({Math.round(VAT_RATE * 100)} %)</option>
                          <option value="no">Non</option>
                        </select>
                      </label>
                    )}
                  </td>
                  <td className="r">
                    <input id="cn-amount" className="ie-field num ie-price" type="number" min="0" max={max} step="1" value={amt || ''} placeholder="0" disabled={locked}
                      onChange={e => setAmt(Math.max(0, Math.min(max, Math.round(parseFloat(e.target.value) || 0))))} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="pp-totals">
            <div className="pp-totals-inner">
              <div className="tot-row"><span>Sous-total HT</span><span className="tv">{fmt(totals.subtotal)} F CFA</span></div>
              {totals.discount > 0 && <div className="tot-row"><span>Remise de la facture ({invoice.discountPct} %)</span><span className="tv">− {fmt(totals.discount)} F CFA</span></div>}
              {vatCharged && <div className="tot-row"><span>{VAT_LABEL}</span><span className="tv">{fmt(totals.tax)} F CFA</span></div>}
              <div className={`tot-row grand${totals.total > max ? ' cn-over' : ''}`}><span>Total de l’avoir</span><span className="tv">{fmt(totals.total)} F CFA</span></div>
            </div>
          </div>
          {totals.total > 0 && <p className="pp-words">{invoiceTotalMention(totals.total, 'avoir')}</p>}

          <div className="pp-pay">
            <div>
              <div className="pp-block-label">Situation de la facture</div>
              <dl className="cn-situation">
                <div><dt>Total facturé TTC</dt><dd>{fmt(invoice.amount)}</dd></div>
                {bal.credited > 0 && <div><dt>Avoirs déjà émis</dt><dd>− {fmt(bal.credited)}</dd></div>}
                <div><dt>Cet avoir</dt><dd>− {fmt(totals.total)}</dd></div>
                <div><dt>Déjà payé</dt><dd>{bal.paid ? `− ${fmt(bal.paid)}` : '0'}</dd></div>
                <div className="due"><dt>Reste dû</dt><dd>{fmt(bal.balance)} → {fmt(dueAfter)} F CFA</dd></div>
              </dl>
            </div>
            <div>
              <div className="pp-block-label">Règlement</div>
              <p className="cn-note">Le montant de cet avoir est déduit du reste dû sur la facture {ref}.</p>
            </div>
          </div>

          <div className="pp-mentions" aria-label="Mentions obligatoires">
            <div className="pp-block-label">Mentions obligatoires (DGI)</div>
            <ul>
              <li>Nature {nature || '[à choisir]'} · référence de la facture d’origine {ref}</li>
              <li>Émis le [date et heure à l’émission] par [opérateur]</li>
              <li>Zone SECeF : QR code et code de l’avoir, ajoutés à la certification</li>
            </ul>
          </div>

          <div className="pp-foot ie-locked">
            <span>{orgSettings.name || 'Mon entreprise'}</span>
            <span>Avoir sur la facture {ref}</span>
          </div>
        </div>
      </div>

      <div className="ie-bar" role="toolbar" aria-label="Actions de l’avoir">
        <button type="button" className="ie-bar-btn" onClick={onPreviewPdf} disabled={locked || !clientRec} title="Aperçu PDF" aria-label="Aperçu PDF">
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
          {busy === 'pdf' && <span>Préparation…</span>}
        </button>
        <div className="ie-bar-pop" ref={checksRef}>
          <button type="button" className={`ie-bar-btn${checksOpen ? ' on' : ''}`} aria-expanded={checksOpen} aria-haspopup="dialog" onClick={() => setChecksOpen(o => !o)}
            aria-label={blocking ? `Contrôles : ${blocking} à corriger` : 'Contrôles : prêt à émettre'}>
            <span className={`ie-badge${blocking ? '' : ' ok'}`}>{blocking || '✓'}</span>Contrôles
          </button>
          {checksOpen && (
            <div className="ie-pop ie-checks" role="dialog" aria-label="Avant d’émettre">
              <div className="ie-checks-title">Avant d’émettre</div>
              <ul>{checks.map((c, i) => <li key={i} className={c.ok ? 'ok' : 'bad'}><span aria-hidden="true">{c.ok ? '✓' : '!'}</span><span>{c.text}</span></li>)}</ul>
            </div>
          )}
        </div>
        {postable && (
          <div className="ie-bar-pop" ref={entryRef}>
            <button type="button" className={`ie-bar-btn${entryOpen ? ' on' : ''}`} aria-expanded={entryOpen} aria-haspopup="dialog" onClick={() => setEntryOpen(o => !o)}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4zM4 10h16M10 10v10" /></svg>Écriture
            </button>
            {entryOpen && (
              <div className="ie-pop ie-checks cn-entry" role="dialog" aria-label="Écriture comptable">
                <div className="ie-checks-title">Écriture à l’émission · journal VE</div>
                <table className="iv-lines">
                  <thead><tr><th scope="col">Compte</th><th scope="col" className="num">Débit</th><th scope="col" className="num">Crédit</th></tr></thead>
                  <tbody>
                    <tr><td>706 Prestations de services</td><td className="num">{fmt(totals.net)}</td><td className="num" /></tr>
                    {totals.tax > 0 && <tr><td>443 TVA facturée</td><td className="num">{fmt(totals.tax)}</td><td className="num" /></tr>}
                    <tr><td>411 {clientRec?.name ?? invoice.client}</td><td className="num" /><td className="num">{fmt(totals.total)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {draft && canDelete(userRole) && (
          <div className="ie-bar-pop" ref={moreRef}>
            <button type="button" className={`ie-bar-btn${moreOpen ? ' on' : ''}`} aria-label="Plus d’actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>•••</button>
            {moreOpen && (
              <div className="dt-menu ie-pop ie-more" role="menu" aria-label="Plus d’actions">
                <button type="button" role="menuitem" className="dt-mi danger" onClick={() => { setMoreOpen(false); onDelete(); }}>Supprimer le brouillon</button>
              </div>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
