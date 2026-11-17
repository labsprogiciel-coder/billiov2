// Invoice editor (PRO-167), in the ERP look: the A4 invoice is the editor.
// /invoices/new           a new invoice (?client=CODE to start with a client,
//                         ?quote=ID to start from a quote, or a copy passed by « Dupliquer »)
// /invoices/:id/edit      a draft
// /quotes/new, /quotes/:id/edit   the same editor for a quote (PRO-185): « Devis »,
//                         a validity date instead of the due date, no DGI checks;
//                         its notes and discount are carried into the invoice
// Dates, subject, lines and discount are typed on the page. Seller and client
// blocks come from Paramètres and the client's record (CGI art. 562), never
// typed here. « Notes et conditions » is rich text (Tiptap), formatted from the
// toolbar. A floating bar holds the PDF, duplicate, checks and other actions.
// Issued invoices are changed from their own page, as before.
// A saved draft saves itself a few seconds after each change, and when the
// page is left; a new invoice asks before its input is dropped (PRO-184).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import posthog from 'posthog-js';
import Page from '@/components/Page';
import StatusPill from '@/components/sales/StatusPill';
import { OwnerLine } from '@/components/owner/OwnerControls';
import { PageSkeleton } from '@/components/SkeletonLoader';
import EditorToolbar, { type InsertKind } from '@/components/invoice/EditorToolbar';
import ClientPicker from '@/components/invoice/ClientPicker';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { canDelete } from '@/lib/permissions';
import { usePaymentMethods } from '@/lib/use-payment-methods';
import { useComplianceGuard } from '@/lib/use-compliance-guard';
import { useDismiss } from '@/lib/use-dismiss';
import { isInvoiceLimitError } from '@/lib/invoice-limit';
import { filledLines } from '@/lib/line-validation';
import { fetchLineItems } from '@/lib/api/line-items';
import { removeInvoice } from '@/lib/api/invoices';
import { QuoteLockedError, removeQuote, updateQuote } from '@/lib/api/quotes';
import { saveQuoteDraft } from '@/lib/api/quote-drafts';
import { createProduct } from '@/lib/api/products';
import { recordInvoiceIssuanceEntry } from '@/lib/api/accounting';
import { createActivity } from '@/lib/api/activities';
import { fetchClientDocuments } from '@/lib/api/client-documents';
import { fetchPaymentSettings, type PaymentSettings } from '@/lib/api/payment-settings';
import { DraftIssuedError, issueSavedDraft, saveInvoiceDraft } from '@/lib/api/invoice-drafts';
import { draftProblem, editorTotals, issueProblem, lineProblems } from '@/lib/invoice-editor';
import { clientIssues, sellerIssues } from '@/lib/invoice-compliance';
import { cleanRichText, type RichDoc } from '@/lib/rich-text';
import { notesExtensions, NOTES_MAX_CHARS, NOTES_MAX_BYTES, notesStoredSize } from '@/lib/notes-editor';
import { kybItems, kybSummary, kybSummaryLabel, type ClientDocument } from '@/lib/kyb';
import { clientTypeDef, clientTypeOf } from '@/lib/client-type';
import { getFiscalIdLabel } from '@/lib/ohada';
import { formatCadastralRef } from '@/lib/cadastral';
import { invoiceTotalMention } from '@/lib/amount-in-words';
import { contactValue } from '@/lib/share-links';
import { invoiceRef } from '@/lib/invoice-number';
import { renderInvoicePdf } from '@/lib/render-pdf';
import { paperBands } from '@/lib/invoice-template';
import { chargesVat } from '@/lib/vat';
import { TAX_GROUPS, defaultTaxGroup, lineGroup, productTaxGroup, vatRows, type TaxGroupCode } from '@/lib/tax-groups';
import TaxGroupSelect from '@/components/TaxGroupSelect';
import { SERVICE_WITHHOLDING_RATE_LABEL } from '@/lib/tax-bf';
import { fmt, newLineItem } from '@/data';
import type { Activity, Invoice, LineItem, Product, Quote } from '@/lib/schemas';

const UNITS = ['unité', 'heure', 'jour', 'mois', 'an', 'projet', 'article', 'licence'];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** What a line is, without its id: to tell unsaved changes */
const lineKey = (ls: LineItem[]) => filledLines(ls).map(l => [l.desc, l.unit, l.qty, l.price, l.productId ?? '', l.taxGroup ?? '']);
const timeOf = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** A saved draft saves itself this long after the last change */
const AUTOSAVE_MS = 3000;

/** An invoice copied by « Dupliquer », opened as a new invoice. */
interface CopyState { copy?: { client: string; subject: string; discountPct: number; notes?: RichDoc; lines: LineItem[] } }

export default function InvoiceEditorPage({ doc = 'invoice' }: { doc?: 'invoice' | 'quote' }) {
  const isQuote = doc === 'quote';
  const { id: routeId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    orgId, loading, invoices, setInvoices, quotes, setQuotes, clientsMap, products, setProducts, orgSettings, invoiceTemplate,
    setActivity, showToast, userLabel, userRole,
  } = useApp();
  const { writable } = usePermissions();
  const { lines: paymentMethods, status: paymentMethodsStatus } = usePaymentMethods();
  const compliance = useComplianceGuard();
  const vatOn = chargesVat(orgSettings.taxRegime);

  // The quote a new invoice starts from (not when writing a quote)
  const quoteId = routeId || isQuote ? undefined : params.get('quote') ?? undefined;
  const quote = quoteId ? quotes.find(q => q.id === quoteId) : undefined;
  const copy = (location.state as CopyState | null)?.copy;

  // The draft (or quote) once saved, or null while new
  const [saved, setSaved] = useState<Invoice | Quote | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [ready, setReady] = useState(false);
  const [client, setClient] = useState('');
  const [issued, setIssued] = useState(() => isoDay(new Date()));
  const [due, setDue] = useState(() => isoDay(new Date(Date.now() + 14 * 864e5)));
  const [subject, setSubject] = useState('');
  const [lines, setLines] = useState<LineItem[]>([newLineItem()]);
  const [discountPct, setDiscountPct] = useState(0);
  const [notes, setNotes] = useState<RichDoc | null>(null);
  const [busy, setBusy] = useState<'save' | 'issue' | 'pdf' | 'delete' | null>(null);
  const busyRef = useRef(false);
  // What was last saved (or loaded), to tell unsaved changes
  const [baseline, setBaselineState] = useState('');
  // The same, readable at once (the leave guard runs between renders)
  const baselineRef = useRef('');
  const setBaseline = (v: string) => { baselineRef.current = v; setBaselineState(v); };
  const snapshotOf = (v: { client: string; issued: string; due: string; subject: string; discountPct: number; lines: LineItem[]; notes: RichDoc | null }) =>
    JSON.stringify({ ...v, lines: lineKey(v.lines) });
  const snapshot = snapshotOf({ client, issued, due, subject, discountPct, lines, notes });
  const dirty = ready && snapshot !== baseline;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // Leaving on purpose (issued, deleted): nothing to keep
  const leaveOk = useRef(false);

  // ── Notes: Tiptap ──────────────────────────────────────────────────────────
  const [notesActive, setNotesActive] = useState(false);
  // The editor is built from the loaded notes, and again on each load
  const [notesSeed, setNotesSeed] = useState<{ key: number; doc: RichDoc | null }>({ key: 0, doc: null });
  const editor = useEditor({
    extensions: notesExtensions,
    content: notesSeed.doc ?? '',
    editorProps: { attributes: { class: 'ie-notes-input', 'aria-label': 'Notes et conditions', 'aria-multiline': 'true', role: 'textbox' } },
    onUpdate: ({ editor: e }) => setNotes(cleanRichText(e.getJSON())),
    onFocus: () => setNotesActive(true),
  }, [notesSeed.key]);
  const notesLength = editor?.getText().length ?? 0;
  // Saving, issuing or checking: the notes can't change under the save
  const lockedNow = busy !== null || compliance.checking;
  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(!lockedNow); }, [editor, lockedNow]);

  // ── Load: a draft, a quote, a copy, or a blank invoice ─────────────────────
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !orgId) return;
    const key = `${doc}:` + (routeId ?? `new:${quoteId ?? ''}:${params.get('client') ?? ''}:${copy ? location.key : ''}`);
    if (loadedFor.current === key) return;
    let live = true;
    // Another draft or a new invoice: don't show (or save into) the previous one meanwhile
    setReady(false);
    const start = (v: { client: string; issued: string; due: string; subject: string; discountPct: number; lines: LineItem[]; notes: RichDoc | null }, isBaseline: boolean) => {
      if (!live) return;
      setClient(v.client); setIssued(v.issued); setDue(v.due); setSubject(v.subject); setDiscountPct(v.discountPct);
      setLines(v.lines.length ? v.lines : [newLineItem()]); setNotes(v.notes);
      // A new invoice or a copy has no saved identity: its first save creates it
      if (!routeId) { setSaved(null); setSavedAt(null); }
      setNotesSeed(seed => ({ key: seed.key + 1, doc: v.notes }));
      loadedFor.current = key;
      leaveOk.current = false;
      setBaseline(isBaseline ? snapshotOf(v) : '');
      setReady(true);
    };

    if (routeId && isQuote) {
      const q = quotes.find(x => x.id === routeId);
      if (!q) { showToast('Devis introuvable.', true); navigate('/quotes', { replace: true }); return; }
      // Invoiced, declined or expired: read-only, on its own page
      if (['invoiced', 'declined', 'expired'].includes(q.status)) { navigate(`/quotes/${q.id}`, { replace: true }); return; }
      fetchLineItems(orgId, { quoteId: q.id }).then(ls => {
        if (!live) return;
        setSaved(q);
        start({ client: q.client, issued: q.issued, due: q.valid, subject: q.subject, discountPct: q.discountPct ?? 0, lines: ls, notes: q.notes ?? null }, true);
      }).catch(err => {
        if (!live) return;
        console.error('[fetchLineItems]', err);
        showToast('Les lignes du devis n’ont pas pu être chargées. Réessayez.', true);
        navigate(`/quotes/${q.id}`, { replace: true });
      });
    } else if (routeId) {
      const inv = invoices.find(i => i.id === routeId);
      if (!inv) { showToast('Facture introuvable.', true); navigate('/invoices', { replace: true }); return; }
      // Issued invoices keep their own page (and its corrections)
      if (inv.status !== 'draft') { navigate(`/invoices/${inv.id}`, { replace: true }); return; }
      fetchLineItems(orgId, { invoiceId: inv.id }).then(ls => {
        if (!live) return;
        setSaved(inv);
        start({ client: inv.client, issued: inv.issued, due: inv.due, subject: inv.subject, discountPct: inv.discountPct ?? 0, lines: ls, notes: inv.notes ?? null }, true);
      }).catch(err => {
        if (!live) return;
        console.error('[fetchLineItems]', err);
        showToast('Les lignes de la facture n’ont pas pu être chargées. Réessayez.', true);
        navigate(`/invoices/${inv.id}`, { replace: true });
      });
    } else if (quoteId) {
      if (!quote) { showToast('Devis introuvable.', true); navigate('/quotes', { replace: true }); return; }
      // Already converted: open that invoice rather than making a second one
      const linked = quote.invoiceId ? invoices.find(i => i.id === quote.invoiceId) : undefined;
      if (linked) { navigate(linked.status === 'draft' ? `/invoices/${linked.id}/edit` : `/invoices/${linked.id}`, { replace: true }); return; }
      fetchLineItems(orgId, { quoteId: quote.id }).then(ls => {
        // Fresh ids: these lines become the invoice's own
        // The quote's discount and notes go with it (PRO-185)
        start({ client: quote.client, issued, due, subject: quote.subject, discountPct: quote.discountPct ?? 0, lines: ls.map(l => ({ ...l, id: crypto.randomUUID() })), notes: quote.notes ?? null }, false);
      }).catch(err => {
        if (!live) return;
        console.error('[fetchLineItems]', err);
        showToast('Les lignes du devis n’ont pas pu être chargées. Réessayez.', true);
        navigate(`/quotes/${quote.id}`, { replace: true });
      });
    } else if (copy) {
      start({ ...copy, issued, due, lines: copy.lines.map(l => ({ ...l, id: crypto.randomUUID() })), notes: copy.notes ?? null }, false);
    } else {
      const c = params.get('client');
      start({ client: c && clientsMap[c] ? c : '', issued, due, subject: '', discountPct: 0, lines: [], notes: null }, true);
    }
    return () => { live = false; };
    // Loads once per draft / quote / copy / start; later edits are the user's
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, orgId, doc, routeId, quoteId, quote, invoices, quotes, copy, location.key]);

  // ── Client details: type, IFU and KYB file ─────────────────────────────────
  const clientRec = client ? clientsMap[client] : undefined;
  const [documents, setDocuments] = useState<ClientDocument[] | null>(null);
  const [paySettings, setPaySettings] = useState<PaymentSettings | null>(null);
  useEffect(() => {
    if (!orgId) return;
    let live = true;
    // Unreadable: say nothing about the file rather than « all missing »
    fetchClientDocuments(orgId).then(d => { if (live) setDocuments(d); }).catch(err => console.error('[fetchClientDocuments]', err));
    fetchPaymentSettings(orgId).then(p => { if (live) setPaySettings(p); }).catch(() => {});
    return () => { live = false; };
  }, [orgId]);
  const kybOf = useCallback((code: string) => {
    const c = clientsMap[code];
    if (!c || !documents) return null;
    return kybSummary(kybItems(clientTypeOf(c), documents.filter(d => d.clientCode === code), isoDay(new Date())));
  }, [clientsMap, documents]);
  const kyb = client ? kybOf(client) : null;

  // ── Lines, and « / » for the catalogue ─────────────────────────────────────
  const sheetRef = useRef<HTMLDivElement>(null);
  const focusLine = (lid: string) => requestAnimationFrame(() => sheetRef.current?.querySelector<HTMLInputElement>(`[data-line="${lid}"]`)?.focus());
  const updateLine = (lid: string, field: 'desc' | 'unit' | 'qty' | 'price', val: string) =>
    setLines(prev => prev.map(l => l.id !== lid ? l : { ...l, [field]: field === 'desc' || field === 'unit' ? val : (parseFloat(val) || 0) }));
  const setLineGroup = (lid: string, taxGroup: TaxGroupCode) => setLines(prev => prev.map(l => l.id !== lid ? l : { ...l, taxGroup }));
  const removeLine = (lid: string) => setLines(prev => prev.length > 1 ? prev.filter(l => l.id !== lid) : [newLineItem()]);
  const addLine = (desc = '') => {
    const l = { ...newLineItem(), desc, taxGroup: defaultTaxGroup(vatOn) };
    setLines(prev => [...prev.filter(x => filledLines([x]).length > 0 || x.desc.startsWith('/')), l]);
    focusLine(l.id);
  };
  const [catHi, setCatHi] = useState(0);
  const catalogueFor = (l: LineItem) => {
    if (!l.desc.startsWith('/')) return null;
    const q = l.desc.slice(1).trim().toLowerCase();
    return products.filter(p => !q || `${p.name} ${p.sku}`.toLowerCase().includes(q)).slice(0, 6);
  };
  const pickProduct = (lid: string, pid: string) => {
    const p = products.find(x => x.id === pid);
    if (!p) return;
    setLines(prev => prev.map(l => l.id !== lid ? l : { ...l, desc: p.name, price: p.price, unit: p.unit, productId: p.id, taxGroup: productTaxGroup(p.tax, vatOn) }));
    setCatHi(0);
  };
  const onDescKey = (l: LineItem, e: KeyboardEvent<HTMLInputElement>) => {
    const found = catalogueFor(l);
    if (!found) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCatHi(h => Math.min(h + 1, found.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCatHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && found[catHi]) { e.preventDefault(); pickProduct(l.id, found[catHi].id); }
    // Échap keeps what was typed, as a free description
    else if (e.key === 'Escape') { e.preventDefault(); updateLine(l.id, 'desc', l.desc.slice(1)); setCatHi(0); }
  };
  const codeOf = (l: LineItem) => (l.productId ? products.find(p => p.id === l.productId)?.sku : undefined) || '—';

  // « Ajouter au catalogue »: a typed line becomes a catalogue item, and the line links to it
  const [cataloguing, setCataloguing] = useState<string | null>(null);
  const canCatalogue = (l: LineItem) => !l.productId && l.desc.trim() !== '' && !l.desc.startsWith('/') && l.price > 0;
  async function addToCatalogue(l: LineItem) {
    if (cataloguing || !canCatalogue(l)) return;
    const name = l.desc.trim();
    const link = (pid: string) => setLines(prev => prev.map(x => x.id === l.id ? { ...x, productId: pid } : x));
    // Already there under this name: link it rather than make a second one
    const same = products.find(p => p.name.trim().toLowerCase() === name.toLowerCase() && p.price === l.price && p.unit === (l.unit ?? 'unité'));
    if (same) { link(same.id); showToast(`Ligne liée à « ${same.name} » du catalogue`); return; }
    const service = ['heure', 'jour', 'mois', 'an', 'projet'].includes(l.unit ?? '');
    const item: Product = {
      id: crypto.randomUUID(), name, sku: '—', type: service ? 'service' : 'product', unit: l.unit ?? 'unité', price: l.price,
      tax: vatOn ? Math.round(TAX_GROUPS[lineGroup(l, vatOn)].rate * 100) : 0, used: 0, ico: service ? 'briefcase' : 'tag', color: service ? 'ico-blue' : 'ico-green',
    };
    setCataloguing(l.id);
    try {
      const stored = await createProduct(orgId, item);
      setProducts(prev => [{ ...item, updatedAt: stored.updatedAt, updatedByName: stored.updatedByName, createdById: stored.createdById }, ...prev]);
      link(item.id);
      posthog.capture('product_created', { type: item.type, unit: item.unit, from: 'invoice_editor' });
      showToast(`« ${name} » ajouté au catalogue`);
    } catch (err) {
      console.error('[createProduct]', err);
      showToast('L’article n’a pas pu être ajouté au catalogue. Réessayez.', true);
    } finally {
      setCataloguing(null);
    }
  }

  const discountRef = useRef<HTMLInputElement>(null);
  const onInsert = (k: InsertKind) => {
    if (k === 'line') addLine();
    else if (k === 'catalogue') addLine('/');
    else if (k === 'discount') { discountRef.current?.focus(); discountRef.current?.select(); }
    else editor?.commands.focus('end');
  };

  const totals = editorTotals(lines, discountPct, vatOn, clientRec?.withholdingScenario);
  const problems = lineProblems(lines);

  // ── Checks before issuing (the same ones « Émettre » runs) ─────────────────
  const checks = useMemo(() => {
    const out: { ok: boolean; warn?: boolean; text: string; lineId?: string }[] = [];
    // A quote is not a tax document: only its own content is checked
    if (isQuote) {
      out.push(clientRec ? { ok: true, text: `Client : ${clientRec.name}` } : { ok: false, text: 'Choisissez un client' });
      lines.forEach((l, i) => { if (problems[l.id]) out.push({ ok: false, text: `Ligne ${i + 1} : ${problems[l.id]}`, lineId: l.id }); });
      if (filledLines(lines).length === 0) out.push({ ok: false, text: 'Ajoutez au moins une ligne' });
      if (due < issued) out.push({ ok: false, text: 'La date de validité doit suivre la date du devis' });
      return out;
    }
    const seller = sellerIssues(orgSettings, paySettings);
    out.push(seller.length ? { ok: false, text: `Mentions du vendeur à compléter : ${seller.map(i => i.label).join(', ')}` } : { ok: true, text: 'Mentions du vendeur complètes' });
    if (!clientRec) out.push({ ok: false, text: 'Choisissez un client' });
    else {
      const ci = clientIssues(clientRec);
      out.push(ci.length ? { ok: false, text: `Fiche client à compléter : ${ci.map(i => i.label).join(', ')}` } : { ok: true, text: 'Mentions du client complètes' });
    }
    lines.forEach((l, i) => { if (problems[l.id]) out.push({ ok: false, text: `Ligne ${i + 1} : ${problems[l.id]}`, lineId: l.id }); });
    if (filledLines(lines).length === 0) out.push({ ok: false, text: 'Ajoutez au moins une ligne' });
    if (due < issued) out.push({ ok: false, text: 'L’échéance doit suivre la date de facturation' });
    if (kyb?.needsAttention) out.push({ ok: false, warn: true, text: `Dossier KYB : ${kybSummaryLabel(kyb)} (n’empêche pas l’émission)` });
    return out;
  }, [isQuote, orgSettings, paySettings, clientRec, lines, problems, due, issued, kyb]);
  const blocking = checks.filter(c => !c.ok && !c.warn).length;

  // ── Save, issue, preview, duplicate, delete ────────────────────────────────
  const fields = { client, subject, issued, due, discountPct, amount: totals.total, notes };
  const clientName = clientRec?.name ?? client;

  /** Why the draft can't be saved as it is, or null */
  const saveProblem = (): string | null =>
    draftProblem(client, issued, due, lines, isQuote)
    ?? (notesLength > NOTES_MAX_CHARS ? `Les notes sont trop longues (${NOTES_MAX_CHARS} caractères au plus).` : null)
    ?? (notes && notesStoredSize(notes) > NOTES_MAX_BYTES ? 'Les notes ont trop de mises en forme pour être enregistrées. Simplifiez-les (moins de passages en gras, italique ou liens).' : null);

  /** Saves the quote (PRO-185); its status is kept. */
  async function saveQuote(): Promise<Quote> {
    const isNew = !saved;
    const prev = saved as Quote | null;
    const stored = await saveQuoteDraft(orgId, {
      id: prev?.id, status: prev?.status,
      fields: { client, subject, issued, valid: due, discountPct, amount: totals.total, notes }, lines,
    });
    const merged: Quote = { ...prev, ...stored, ownerId: stored.ownerId ?? prev?.ownerId, ownerName: stored.ownerName ?? prev?.ownerName, invoiceId: prev?.invoiceId };
    setQuotes(list => list.some(q => q.id === merged.id) ? list.map(q => q.id === merged.id ? { ...q, ...merged } : q) : [merged, ...list]);
    if (isNew) {
      posthog.capture('quote_created', { item_count: filledLines(lines).length, total_amount: totals.total, status: 'draft', from: copy ? 'copy' : 'editor' });
      window.history.replaceState(window.history.state, '', `/quotes/${merged.id}/edit`);
    }
    return merged;
  }

  /** Saves the draft; returns it, or null when it wasn't saved (the reason is shown unless `quiet`). */
  async function save(opts?: { quiet?: boolean }): Promise<Invoice | Quote | null> {
    const problem = saveProblem();
    if (problem) { if (!opts?.quiet) showToast(problem, true); return null; }
    if (isQuote) {
      const q = await saveQuote();
      setSaved(q);
      setSavedAt(new Date());
      setBaseline(snapshot);
      return q;
    }
    const isNew = !saved;
    const draft = await saveInvoiceDraft(orgId, { id: saved?.id, fields, lines, ownerId: isNew ? quote?.ownerId : undefined });
    const prevInv = saved as Invoice | null;
    const merged: Invoice = { ...prevInv, ...draft, ownerId: draft.ownerId ?? prevInv?.ownerId, ownerName: draft.ownerName ?? prevInv?.ownerName };
    setInvoices(prev => prev.some(i => i.id === merged.id) ? prev.map(i => i.id === merged.id ? { ...i, ...merged } : i) : [merged, ...prev]);
    if (isNew && quote) {
      // The quote links to its invoice from now on (it is marked invoiced at issue)
      await updateQuote(orgId, quote.id, { invoiceId: merged.id })
        .then(() => setQuotes(prev => prev.map(q => q.id === quote.id ? { ...q, invoiceId: merged.id } : q)))
        .catch(err => console.error('[updateQuote] link failed:', err));
    }
    if (isNew) {
      posthog.capture('invoice_created', { invoice_type: 'draft', item_count: filledLines(lines).length, total_amount: totals.total, currency: 'XOF', from: quote ? 'quote' : copy ? 'copy' : 'editor' });
      // The address now names the draft, so a reload comes back to it. Not a
      // route change: that would remount the page and reload what the form holds
      window.history.replaceState(window.history.state, '', `/invoices/${merged.id}/edit`);
    }
    setSaved(merged);
    setSavedAt(new Date());
    setBaseline(snapshot);
    return merged;
  }

  // Every save goes through one queue, so an autosave and a click never write at once.
  // Each runs the latest save(), with what the form holds when its turn comes.
  const saveRef = useRef(save);
  saveRef.current = save;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function queuedSave(opts?: { quiet?: boolean }): Promise<Invoice | Quote | null> {
    const run = queue.current.catch(() => {}).then(() => saveRef.current(opts));
    queue.current = run;
    return run;
  }

  /** The draft was issued (or the quote invoiced, declined, expired) elsewhere: nothing was written; open it. */
  function onIssuedElsewhere(err: unknown): boolean {
    if (err instanceof QuoteLockedError) {
      showToast('Ce devis a été facturé, refusé ou a expiré entre-temps : vos modifications n’ont pas été enregistrées.', true);
      leaveOk.current = true;
      navigate(`/quotes/${err.quoteId}`, { replace: true });
      return true;
    }
    if (!(err instanceof DraftIssuedError)) return false;
    showToast('Cette facture a été émise entre-temps : vos modifications n’ont pas été enregistrées.', true);
    leaveOk.current = true;
    navigate(`/invoices/${err.invoiceId}`, { replace: true });
    return true;
  }

  // ── Autosave (saved drafts only: a new invoice is created by « Enregistrer ») ──
  const [autoState, setAutoState] = useState<'saving' | 'failed' | null>(null);
  async function autosave(): Promise<boolean> {
    setAutoState('saving');
    try {
      const d = await queuedSave({ quiet: true });
      setAutoState(d ? null : 'failed');
      return !!d;
    } catch (err) {
      setAutoState(null);
      if (onIssuedElsewhere(err)) return false;
      console.error('[autosave]', err);
      setAutoState('failed');
      return false;
    }
  }
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;
  const savable = saveProblem() === null;
  useEffect(() => {
    if (!saved || !dirty || !savable || busy !== null || compliance.checking) return;
    const t = setTimeout(() => void autosaveRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [saved, dirty, savable, snapshot, busy, compliance.checking]);

  // ── Leaving: closing the tab asks; in the app, a saved draft is saved first ──
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  const blocker = useBlocker(() => readyRef.current && !leaveOk.current && snapshotRef.current !== baselineRef.current);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let live = true;
    void (async () => {
      const kept = saved && saveProblem() === null && !busyRef.current ? await autosaveRef.current() : false;
      if (!live) return;
      if (kept || window.confirm(saved
        ? 'Les modifications n’ont pas pu être enregistrées. Quitter quand même ? Elles seront perdues.'
        : `Quitter sans enregistrer ? ${isQuote ? 'Le devis n’a' : 'La facture n’a'} pas encore été enregistré${isQuote ? '' : 'e'} : ce qui est saisi sera perdu.`)) blocker.proceed();
      else blocker.reset();
    })();
    return () => { live = false; };
    // Once per blocked navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  async function onSave() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('save');
    try {
      if (await queuedSave()) { setAutoState(null); showToast(isQuote ? 'Devis enregistré' : 'Brouillon enregistré'); }
    } catch (err) {
      if (onIssuedElsewhere(err)) return;
      console.error('[saveInvoiceDraft]', err);
      showToast('Le brouillon n’a pas pu être enregistré. Réessayez.', true);
    } finally {
      busyRef.current = false; setBusy(null);
    }
  }

  async function issue() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('issue');
    let draft: Invoice | null = null;
    try {
      // Invoices only: save() returns the invoice draft here
      draft = await queuedSave() as Invoice | null;
      if (!draft) return;
      const res = await issueSavedDraft(orgId, draft.id, totals.total);
      const issuedInv: Invoice = { ...draft, status: 'pending', number: res.number, firstIssuedAt: res.firstIssuedAt ?? new Date().toISOString(), issuedByName: res.issuedByName ?? userLabel };
      setInvoices(prev => prev.map(i => i.id === issuedInv.id ? issuedInv : i));
      const ref = invoiceRef(issuedInv);
      // The quote it came from, also when the draft was reopened later
      const sourceQuote = quote ?? quotes.find(q => q.invoiceId === issuedInv.id);
      if (sourceQuote) {
        updateQuote(orgId, sourceQuote.id, { status: 'invoiced', invoiceId: issuedInv.id })
          .then(() => setQuotes(prev => prev.map(q => q.id === sourceQuote.id ? { ...q, status: 'invoiced', invoiceId: issuedInv.id } : q)))
          .catch(err => console.error('[updateQuote] invoiced failed:', err));
        posthog.capture('quote_converted_to_invoice', { quote_id: sourceQuote.id, invoice_id: issuedInv.id });
      }
      recordInvoiceIssuanceEntry(orgId, { invoiceId: issuedInv.id, htAmount: totals.net, tvaAmount: totals.tax, date: issued, clientName })
        .catch(err => {
          console.error('[recordInvoiceIssuanceEntry] failed:', err);
          showToast(`Facture #${ref} émise, mais l'écriture comptable de vente n'a pas pu être enregistrée. Signalez-le à votre comptable.`, true);
        });
      const act = { kind: 'sent' as const, parts: [{ text: 'Facture ' }, { text: `#${ref}`, bold: true as const }, { text: ' émise pour ' }, { text: clientName, bold: true as const }] };
      setActivity((prev: Activity[]) => [{ ...act, time: "À l'instant" }, ...prev]);
      createActivity(orgId, act).catch(err => console.error('[createActivity] failed:', err));
      posthog.capture('invoice_sent', { invoice_id: issuedInv.id });
      showToast(`Facture #${ref} émise`);
      navigate(`/invoices/${issuedInv.id}`, { replace: true, state: { openSend: true } });
    } catch (err) {
      if (onIssuedElsewhere(err)) return;
      if (isInvoiceLimitError(err)) { compliance.showLimit(); showToast('Facture enregistrée comme brouillon.'); return; }
      console.error('[issueInvoice]', err);
      showToast(draft
        ? 'La facture est enregistrée comme brouillon, mais n’a pas pu être émise. Réessayez.'
        : 'Une erreur est survenue. La facture n’a pas été enregistrée — réessayez.', true);
    } finally {
      busyRef.current = false; setBusy(null);
    }
  }

  // A quote: « Enregistrer et fermer » saves it and opens its page (send, PDF, invoice)
  async function onFinishQuote() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('issue');
    try {
      const q = await queuedSave();
      if (!q) { setChecksOpen(true); return; }
      showToast(`Devis ${q.id} enregistré`);
      leaveOk.current = true;
      navigate(`/quotes/${q.id}`, { replace: true });
    } catch (err) {
      if (onIssuedElsewhere(err)) return;
      console.error('[saveQuote]', err);
      showToast('Le devis n’a pas pu être enregistré. Réessayez.', true);
    } finally {
      busyRef.current = false; setBusy(null);
    }
  }

  // « Émettre »: the editor's checks, then the plan limit and the DGI mentions (PRO-133)
  function onIssue() {
    if (isQuote) { void onFinishQuote(); return; }
    const problem = issueProblem(client, issued, due, lines);
    if (problem) { showToast(problem, true); setChecksOpen(true); return; }
    void compliance.guard(client, () => void issue(), {
      returnTo: saved ? `/invoices/${saved.id}/edit` : '/invoices/new',
      beforeLeave: async () => {
        try { const d = await queuedSave(); return d ? `/invoices/${d.id}/edit` : null; } catch { return null; }
      },
    });
  }

  async function onPreviewPdf() {
    if (busyRef.current) return;
    if (paymentMethodsStatus !== 'ready') { showToast('Les moyens de paiement ne sont pas encore chargés. Réessayez dans un instant.', true); return; }
    if (!clientRec) { showToast('Choisissez un client pour voir le PDF.', true); return; }
    // Opened now, while the click still counts, then filled once the PDF is ready
    const tab = window.open('', '_blank');
    busyRef.current = true; setBusy('pdf');
    try {
      const inv: Invoice = { id: saved?.id ?? 'brouillon', subject: subject.trim() || (isQuote ? 'Devis sans titre' : 'Facture sans titre'), client, issued, due, amount: totals.total, status: isQuote ? 'pending' : 'draft', discountPct, notes: notes ?? undefined };
      const blob = await renderInvoicePdf({
        template: invoiceTemplate, invoice: inv, lines: filledLines(lines), client: clientRec, biz: orgSettings,
        paymentTerms: orgSettings.paymentTerms || 'Net 14 jours', deliveryTerms: orgSettings.deliveryTerms || 'À convenir', paymentMethods,
        // As the quote's own page prints it
        ...(isQuote ? { title: 'Facture Proforma', documentKind: 'devis' as const, clientLabel: 'Adressé à' } : {}),
      });
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      console.error('[previewPdf]', err);
      showToast('Le PDF n’a pas pu être généré. Réessayez.', true);
    } finally {
      busyRef.current = false; setBusy(null);
    }
  }

  function onDuplicate() {
    // Leaving this draft: the guard saves it (or asks, for a new invoice)
    const state: CopyState = { copy: { client, subject, discountPct, notes: notes ?? undefined, lines: filledLines(lines) } };
    navigate(isQuote ? '/quotes/new' : '/invoices/new', { state });
    showToast('Copie ouverte : enregistrez-la pour la garder.');
  }

  async function onDeleteDraft() {
    if (!saved || busyRef.current) return;
    if (isQuote) {
      if (!window.confirm(`Supprimer le devis ${saved.id} ?`)) return;
      busyRef.current = true; setBusy('delete');
      try {
        // Its lines go with it (on delete cascade)
        await removeQuote(orgId, saved.id);
        setQuotes(prev => prev.filter(q => q.id !== saved.id));
        showToast('Devis supprimé');
        leaveOk.current = true;
        navigate('/quotes', { replace: true });
      } catch (err) {
        console.error('[removeQuote]', err);
        showToast('Le devis n’a pas pu être supprimé. Réessayez.', true);
      } finally {
        busyRef.current = false; setBusy(null);
      }
      return;
    }
    if (!window.confirm('Supprimer ce brouillon ? Il n’a pas de numéro : rien n’est perdu dans la numérotation.')) return;
    busyRef.current = true; setBusy('delete');
    try {
      await removeInvoice(orgId, saved.id);
      // A draft started from a quote: the quote can be invoiced again
      for (const q of quotes.filter(q => q.invoiceId === saved.id && q.status !== 'invoiced')) {
        updateQuote(orgId, q.id, { invoiceId: null }, { onlyIfInvoiceId: saved.id })
          .then(() => setQuotes(prev => prev.map(x => x.id === q.id && x.invoiceId === saved.id ? { ...x, invoiceId: undefined } : x)))
          .catch(err => console.error('[updateQuote] unlink failed:', err));
      }
      setInvoices(prev => prev.filter(i => i.id !== saved.id));
      showToast('Brouillon supprimé');
      leaveOk.current = true;
      navigate('/invoices', { replace: true });
    } catch (err) {
      console.error('[removeInvoice]', err);
      showToast('Le brouillon n’a pas pu être supprimé. Réessayez.', true);
    } finally {
      busyRef.current = false; setBusy(null);
    }
  }

  function onCancel() {
    if (busy || compliance.checking) return;
    // The leave guard saves a draft's changes, or asks for a new invoice
    if (isQuote) { navigate(saved ? `/quotes/${saved.id}` : '/quotes'); return; }
    navigate(saved ? `/invoices/${saved.id}` : quote ? `/quotes/${quote.id}` : '/invoices');
  }

  // Floating bar popovers
  const [checksOpen, setChecksOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const checksRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const closeChecks = useCallback(() => setChecksOpen(false), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useDismiss(checksRef, checksOpen, closeChecks);
  useDismiss(moreRef, moreOpen, closeMore);

  if (loading || !ready) return <PageSkeleton title={isQuote ? 'Devis' : 'Facture'} variant="document" rows={4} />;
  if (!writable) {
    return isQuote
      ? <Page title="Devis" back={{ label: 'Retour aux devis', onClick: () => navigate('/quotes') }}><p className="dt-muted">Votre rôle ne permet pas de créer ou modifier des devis.</p></Page>
      : <Page title="Facture" back={{ label: 'Retour aux factures', onClick: () => navigate('/invoices') }}><p className="dt-muted">Votre rôle ne permet pas de créer ou modifier des factures.</p></Page>;
  }

  const locked = busy !== null || compliance.checking;
  const pageBand = paperBands(invoiceTemplate);
  const live = saved ? (isQuote ? quotes.find(q => q.id === saved.id) : invoices.find(i => i.id === saved.id)) ?? saved : null;
  const savedQuote = isQuote ? saved as Quote | null : null;
  const heading = isQuote
    ? (savedQuote ? `Devis ${savedQuote.id}` : 'Nouveau devis')
    : (saved ? 'Brouillon de facture' : 'Nouvelle facture');
  const quoteStatusLabel: Record<Quote['status'], string> = { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', declined: 'Refusé', expired: 'Expiré', invoiced: 'Facturé' };
  const ownerName = live?.ownerName ?? (quote?.ownerName ? quote.ownerName : 'vous');
  const sellerIds = [
    orgSettings.ifu && `${getFiscalIdLabel(orgSettings.country)} ${orgSettings.ifu}`,
    orgSettings.rccm && `RCCM ${orgSettings.rccm}`,
    orgSettings.taxRegime, orgSettings.divisionFiscale,
  ].filter(Boolean).join(' · ');
  const clientIds = clientRec ? [
    clientRec.ifu && `${getFiscalIdLabel(clientRec.country ?? 'Burkina Faso')} ${clientRec.ifu}`,
    clientRec.rccm && `RCCM ${clientRec.rccm}`, clientRec.taxRegime, clientRec.fiscalDivision,
  ].filter(Boolean) as string[] : [];
  const kybText = (code: string) => {
    const k = kybOf(code);
    return k && k.required > 0 ? { text: k.complete ? 'KYB complet' : `KYB ${k.verified}/${k.required}`, tone: k.complete ? 'ok' as const : 'warn' as const } : null;
  };

  return (
    <>
      <Page
        back={{ label: saved ? 'Fermer' : 'Annuler', onClick: onCancel }}
        title={<span className="iv-title"><span>{heading}</span><StatusPill tone={savedQuote && savedQuote.status !== 'draft' ? 'wait' : 'draft'} label={savedQuote ? quoteStatusLabel[savedQuote.status] : 'Brouillon'} /></span>}
        subtitle={
          <span className="iv-sub">
            {isQuote ? (!saved && <span>N° attribué à l’enregistrement</span>) : <span>N° attribué à l’émission</span>}
            {quote && <span>Depuis le devis {quote.id}</span>}
            {saved
              ? <span><OwnerLine table={isQuote ? 'quotes' : 'invoices'} id={saved.id} ownerId={live?.ownerId} ownerName={live?.ownerName} className="ie-owner" /></span>
              : <span>Responsable : {ownerName}</span>}
            <span aria-live="polite">
              {autoState === 'saving' ? 'Enregistrement…'
                : autoState === 'failed' ? <span className="ie-save-failed">Enregistrement automatique impossible{savable ? '' : isQuote ? ' : corrigez le devis' : ' : corrigez la facture'} · <button type="button" className="ie-link" onClick={() => void onSave()}>Enregistrer</button></span>
                : savedAt ? `Enregistré à ${timeOf(savedAt)}` : saved ? 'Enregistré' : 'Pas encore enregistré'}
              {dirty && saved && autoState === null ? ' · modifications en cours' : ''}
            </span>
          </span>
        }
        documentTitle={heading}
        actions={<>
          <button className="btn" onClick={onCancel} disabled={locked}>{saved ? 'Fermer' : 'Annuler'}</button>
          <button className="btn" onClick={() => void onSave()} disabled={locked}>
            {busy === 'save' ? 'Enregistrement…' : isQuote ? 'Enregistrer' : 'Enregistrer le brouillon'}
          </button>
          <button className="btn btn-primary" onClick={onIssue} disabled={locked}>
            {isQuote
              ? (busy === 'issue' ? 'Enregistrement…' : 'Enregistrer et fermer')
              : busy === 'issue' ? 'Émission…' : compliance.checking ? 'Vérification…' : 'Émettre la facture'}
          </button>
        </>}
      >
        <div className="ie-stage">
          <EditorToolbar editor={editor} notesActive={notesActive} locked={locked} onInsert={onInsert}
            onBadLink={() => showToast('Lien refusé : utilisez une adresse https://… ou mailto:…', true)} />

          <div
            className={`paper ie-sheet${pageBand ? ' has-bands' : ''}`} ref={sheetRef}
            style={pageBand ? { ['--band' as string]: pageBand } : undefined}
            // The toolbar's formatting follows where the cursor was last
            onFocusCapture={e => { if (!(e.target as HTMLElement).closest('.ie-notes')) setNotesActive(false); }}
          >
            {!isQuote && <div className="ie-watermark" aria-hidden="true">BROUILLON</div>}

            <div className="pp-top">
              <div className="pp-biz ie-locked" title="Depuis Paramètres">
                <div>
                  <div className="pp-biz-name">{orgSettings.name || 'Mon entreprise'}</div>
                  <div className="pp-biz-meta">
                    {[orgSettings.address, orgSettings.city, orgSettings.country].filter(Boolean).join(', ')}
                    {sellerIds && <><br />{sellerIds}</>}
                    {orgSettings.cadastralRef && <><br />Réf. cadastrale {formatCadastralRef(orgSettings.cadastralRef)}</>}
                    {(orgSettings.email || orgSettings.phone) && <><br />{[orgSettings.email, orgSettings.phone].filter(Boolean).join(' · ')}</>}
                  </div>
                  <button type="button" className="ie-source" onClick={() => navigate('/settings?tab=business')}>Depuis Paramètres · modifier</button>
                </div>
              </div>
              <div className="pp-doc">
                <div className="pp-doc-title">{isQuote ? 'Devis' : 'Facture'}</div>
                {isQuote && savedQuote
                  ? <div className="pp-doc-num">#{savedQuote.id}</div>
                  : <div className="pp-doc-num ie-later">{isQuote ? 'N° attribué à l’enregistrement' : 'N° attribué à l’émission'}</div>}
              </div>
            </div>

            <div className="pp-parties">
              <div>
                <div className="pp-block-label">{isQuote ? 'Adressé à' : 'Facturé à'}</div>
                <ClientPicker value={client} onChange={setClient} disabled={locked} kybLabel={kybText} />
                {clientRec && (
                  <>
                    <div className="pp-client-meta">{clientTypeDef(clientTypeOf(clientRec)).mention}</div>
                    <div className="pp-client-meta">{[contactValue(clientRec.city), contactValue(clientRec.country)].filter(Boolean).join(', ')}</div>
                    {clientIds.length > 0 && <div className="pp-compliance-ids">{clientIds.map(x => <span key={x}>{x}</span>)}</div>}
                    {kyb && kyb.required > 0 && <div className={`ie-kyb ${kyb.complete ? 'ok' : kyb.needsAttention ? 'warn' : ''}`}>Dossier KYB : {kybSummaryLabel(kyb)}</div>}
                  </>
                )}
              </div>
              <div>
                <div className="pp-block-label">Détails</div>
                <div className="pp-meta-grid">
                  <label className="k" htmlFor="ie-issued">{isQuote ? 'Date du devis' : 'Date de facturation'}</label>
                  <div className="v"><input id="ie-issued" type="date" className="ie-field" value={issued} disabled={locked} onChange={e => setIssued(e.target.value)} /></div>
                  <label className="k" htmlFor="ie-due">{isQuote ? 'Valable jusqu’au' : 'Échéance'}</label>
                  <div className="v"><input id="ie-due" type="date" className={`ie-field${due < issued ? ' bad' : ''}`} value={due} disabled={locked} onChange={e => setDue(e.target.value)} /></div>
                  {!isQuote && <>
                    <div className="k">Émise le</div>
                    <div className="v ie-later">date, heure et opérateur à l’émission</div>
                  </>}
                  <div className="k">Paiement</div>
                  <div className="v">{orgSettings.paymentTerms || 'Net 14 jours'}</div>
                </div>
              </div>
            </div>

            <div className="pp-subject">
              <label className="pp-subject-label" htmlFor="ie-subject">Objet :</label>
              <input id="ie-subject" className="ie-field ie-grow" maxLength={255} placeholder="ex. Développement web — sprint 5" value={subject} disabled={locked} onChange={e => setSubject(e.target.value)} />
            </div>

            <table className="li-table ie-lines">
              <thead>
                <tr>
                  <th className="ie-code">Code</th>
                  <th>Description</th>
                  <th className="r">Qté</th>
                  <th>Unité</th>
                  <th className="r">P.U. HT</th>
                  <th className="r">TVA</th>
                  <th className="r">Montant HT</th>
                  <th><span className="sr-only">Supprimer</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const problem = problems[l.id];
                  const found = catalogueFor(l);
                  return (
                    <tr key={l.id} className={problem ? 'has-err' : undefined}>
                      <td className="ie-code">
                        {canCatalogue(l)
                          ? <button type="button" className="ie-link ie-catalogue-add" onClick={() => void addToCatalogue(l)} disabled={locked || cataloguing !== null}
                              title="Ajouter cette ligne au catalogue" aria-label={`Ajouter la ligne ${i + 1} au catalogue`}>{cataloguing === l.id ? '…' : '+ Catalogue'}</button>
                          : codeOf(l)}
                      </td>
                      <td className="ie-desc-cell">
                        <input className="ie-field ie-grow" data-line={l.id} placeholder="Description, ou « / » pour le catalogue" value={l.desc} disabled={locked}
                          aria-label={`Description, ligne ${i + 1}`} aria-invalid={problem ? true : undefined}
                          aria-expanded={found ? true : undefined} aria-controls={found ? `cat-${l.id}` : undefined}
                          onChange={e => { updateLine(l.id, 'desc', e.target.value); setCatHi(0); }}
                          onKeyDown={e => onDescKey(l, e)} />
                        {problem && <div className="ie-err" role="alert">{problem}</div>}
                        {found && (
                          <div className="ie-pop ie-cat" id={`cat-${l.id}`} role="listbox" aria-label="Catalogue">
                            {found.length === 0 && <div className="ie-pop-empty">Aucun produit. Échap garde « {l.desc.slice(1)} » comme description.</div>}
                            {found.map((p, j) => (
                              <button type="button" role="option" aria-selected={j === catHi} key={p.id} className={`ie-client-opt${j === catHi ? ' hi' : ''}`}
                                onMouseDown={e => e.preventDefault()} onMouseEnter={() => setCatHi(j)} onClick={() => pickProduct(l.id, p.id)}>
                                <span><b>{p.name}</b><small>{[p.sku, p.unit && `par ${p.unit}`].filter(Boolean).join(' · ')}</small></span>
                                <span className="ie-cat-price">{fmt(p.price)} F</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="r"><input className="ie-field num ie-qty" type="number" min="0" step="any" value={l.qty} disabled={locked}
                        aria-label={`Quantité, ligne ${i + 1}`} onChange={e => updateLine(l.id, 'qty', e.target.value)} /></td>
                      <td>
                        <select className="ie-field" value={l.unit ?? 'unité'} disabled={locked} aria-label={`Unité, ligne ${i + 1}`} onChange={e => updateLine(l.id, 'unit', e.target.value)}>
                          {[...new Set([...UNITS, l.unit ?? 'unité'])].map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                      <td className="r"><input className="ie-field num ie-price" type="number" min="0" step="any" value={l.price || ''} placeholder="0" disabled={locked}
                        aria-label={`Prix unitaire HT, ligne ${i + 1}`} onChange={e => updateLine(l.id, 'price', e.target.value)} /></td>
                      <td className="r ie-muted">{vatOn
                        ? <TaxGroupSelect value={lineGroup(l, vatOn)} onChange={g => setLineGroup(l.id, g)} disabled={locked} label={`Groupe de taxe, ligne ${i + 1}`} />
                        : '—'}</td>
                      <td className="r ie-amt">{fmt(l.qty * l.price)}</td>
                      <td>
                        <button type="button" className="li-del" onClick={() => removeLine(l.id)} disabled={locked} aria-label={`Supprimer la ligne ${i + 1}`}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="ie-line-actions">
              <button type="button" className="ie-link" onClick={() => addLine()} disabled={locked}>+ Ajouter une ligne</button>
              {products.length > 0 && <button type="button" className="ie-link" onClick={() => addLine('/')} disabled={locked}>Depuis le catalogue</button>}
            </div>

            <div className="pp-totals">
              <div className="pp-totals-inner">
                <div className="tot-row"><span>Sous-total HT</span><span className="tv">{fmt(totals.subtotal)} F CFA</span></div>
                <div className="tot-row">
                  <label htmlFor="ie-disc">Remise (%)</label>
                  <span className="tv ie-disc">
                    <input id="ie-disc" ref={discountRef} type="number" min="0" max="100" step="0.5" className="ie-field num" value={discountPct || ''} placeholder="0" disabled={locked}
                      onChange={e => setDiscountPct(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))} />
                    {totals.discount > 0 && <>− {fmt(totals.discount)} F CFA</>}
                  </span>
                </div>
                {vatOn && vatRows(totals.groups).map(r => <div key={r.key} className="tot-row"><span>{r.label}</span><span className="tv">{fmt(r.amount)} F CFA</span></div>)}
                {totals.withholding !== null && clientRec?.withholdingScenario && (<>
                  <div className="tot-row"><span>{vatOn ? 'Total TTC' : 'Total'}</span><span className="tv">{fmt(totals.total)} F CFA</span></div>
                  <div className="tot-row ie-withholding">
                    <span>Retenue à la source ({SERVICE_WITHHOLDING_RATE_LABEL[clientRec.withholdingScenario]}) — Art.207/212</span>
                    <span className="tv">− {fmt(totals.withholding)} F CFA</span>
                  </div>
                </>)}
                <div className="tot-row grand"><span>{totals.withholding !== null ? 'Net à payer' : isQuote ? 'Total estimé' : 'Total dû'}</span><span className="tv">{fmt(totals.toPay)} F CFA</span></div>
              </div>
            </div>
            {totals.total > 0 && <p className="pp-words">{invoiceTotalMention(totals.total, isQuote ? 'devis' : 'facture')}</p>}

            <div className="pp-pay">
              <div>
                <div className="pp-block-label">Modes de paiement</div>
                <div className="pp-pay-methods">
                  {paymentMethods.length > 0
                    ? paymentMethods.map(m => <div key={m.label} className="pp-pm"><span>{m.label} — {m.value}</span></div>)
                    : <div className="pp-pm"><span>Aucun moyen de paiement dans Paramètres.</span></div>}
                </div>
                <button type="button" className="ie-source" onClick={() => navigate('/settings?tab=payments')}>Depuis Paramètres → Paiements · modifier</button>
              </div>
              <div className="ie-notes">
                <div className="pp-block-label">Notes et conditions</div>
                <EditorContent editor={editor} className={`ie-notes-box${notesLength > NOTES_MAX_CHARS ? ' bad' : ''}`} />
                {notesLength > NOTES_MAX_CHARS * 0.8 && <div className={notesLength > NOTES_MAX_CHARS ? 'ie-err' : 'ie-muted'}>{notesLength} / {NOTES_MAX_CHARS} caractères</div>}
              </div>
            </div>

            {!isQuote && <div className="pp-mentions" aria-label="Mentions obligatoires">
              <div className="pp-block-label">Mentions obligatoires (DGI)</div>
              <ul>
                <li>Émise le [date et heure à l’émission] par [opérateur]</li>
                <li>{orgSettings.cadastralRef ? `Lieu de vente : réf. cadastrale ${formatCadastralRef(orgSettings.cadastralRef)}` : 'Référence cadastrale du lieu de vente : à renseigner dans Paramètres'}</li>
                <li>Timbre fiscal (paiement en espèces) : barème à confirmer</li>
                <li>Zone SECeF : QR code et code de la facture, ajoutés à la certification</li>
              </ul>
            </div>}

            {/* The footer as the PDF prints it on every page, from Modèles */}
            <div className="pp-foot ie-locked">
              <span>{orgSettings.name || 'Mon entreprise'}</span>
              <span>{invoiceTemplate.footer.trim() || 'Facture générée via Billio'}</span>
              <button type="button" className="ie-source" onClick={() => navigate('/templates')}>Depuis Modèles · modifier</button>
            </div>
          </div>
        </div>

        <div className="ie-bar" role="toolbar" aria-label={isQuote ? 'Actions du devis' : 'Actions de la facture'}>
          <button type="button" className="ie-bar-btn" onClick={() => void onPreviewPdf()} disabled={locked} title="Aperçu PDF" aria-label="Aperçu PDF">
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            {busy === 'pdf' && <span>Préparation…</span>}
          </button>
          <button type="button" className="ie-bar-btn" onClick={onDuplicate} disabled={locked} title="Dupliquer" aria-label="Dupliquer">
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
          </button>
          <div className="ie-bar-pop" ref={checksRef}>
            <button type="button" className={`ie-bar-btn${checksOpen ? ' on' : ''}`} aria-expanded={checksOpen} aria-haspopup="dialog" onClick={() => setChecksOpen(o => !o)}
              aria-label={blocking ? `Contrôles : ${blocking} à corriger` : (isQuote ? 'Contrôles : prêt' : 'Contrôles : prêt à émettre')}>
              <span className={`ie-badge${blocking ? '' : ' ok'}`}>{blocking || '✓'}</span>Contrôles
            </button>
            {checksOpen && (
              <div className="ie-pop ie-checks" role="dialog" aria-label={isQuote ? 'Contrôles du devis' : 'Avant d’émettre'}>
                <div className="ie-checks-title">{isQuote ? 'Contrôles du devis' : 'Avant d’émettre'}</div>
                <ul>
                  {checks.map((c, i) => (
                    <li key={i} className={c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}>
                      <span aria-hidden="true">{c.ok ? '✓' : '!'}</span>
                      <span>{c.text}{c.lineId && <> · <button type="button" className="ie-link" onClick={() => { setChecksOpen(false); focusLine(c.lineId!); }}>voir</button></>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="ie-bar-pop" ref={moreRef}>
            <button type="button" className={`ie-bar-btn${moreOpen ? ' on' : ''}`} aria-label="Plus d’actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>•••</button>
            {moreOpen && (
              <div className="dt-menu ie-pop ie-more" role="menu" aria-label="Plus d’actions">
                <button type="button" role="menuitem" className="dt-mi" onClick={() => { setMoreOpen(false); navigate('/templates'); }}>Modèle de facture…</button>
                {saved && saved.status === 'draft' && canDelete(userRole) && (
                  <button type="button" role="menuitem" className="dt-mi danger" onClick={() => { setMoreOpen(false); void onDeleteDraft(); }}>{isQuote ? 'Supprimer le devis' : 'Supprimer le brouillon'}</button>
                )}
              </div>
            )}
          </div>
        </div>
      </Page>
      {compliance.dialog}
    </>
  );
}
