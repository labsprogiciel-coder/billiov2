import { supabase } from '@/lib/supabase';
import { isTaxGroup } from '@/lib/tax-groups';
import type { CreditNote } from '@/lib/schemas';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';
// Demo mode has no database: keep credit notes and their numbers in memory
let mockSeq = 0;
const mockNotes = new Map<string, CreditNote>();

type CreditLine = CreditNote['lines'][number];

function dbToCreditNote(row: Record<string, unknown>): CreditNote {
  const lines = Array.isArray(row.lines) ? row.lines as CreditLine[] : [];
  return {
    id:        String(row.id),
    invoiceId: String(row.invoice_id),
    subject:   String(row.subject ?? ''),
    client:    String(row.client_code),
    issued:    String(row.issued_at),
    amount:    Number(row.amount),
    reason:    String(row.reason ?? ''),
    number:    row.number ? String(row.number) : undefined,
    status:    row.status === 'draft' ? 'draft' : 'issued',
    nature:    (row.nature ?? undefined) as CreditNote['nature'],
    lines:     lines.map(l => ({ id: String(l.id ?? crypto.randomUUID()), desc: String(l.desc ?? ''), unit: String(l.unit ?? 'unité'), qty: Number(l.qty) || 0, price: Number(l.price) || 0, productId: l.productId ?? undefined, sourceId: l.sourceId ?? undefined, ...(isTaxGroup(l.taxGroup) ? { taxGroup: l.taxGroup } : {}) })),
    discountPct: Number(row.discount_pct ?? 0),
    issuedTs:     row.issued_ts ? String(row.issued_ts) : undefined,
    issuedByName: row.issued_by_name ? String(row.issued_by_name) : undefined,
  };
}

export async function nextCreditNoteId(orgId: string): Promise<string> {
  if (MOCK) return 'AV-' + String(Math.floor(Math.random() * 900000) + 100000);
  const { data, error } = await supabase.rpc('next_credit_note_number', { p_org_id: orgId });
  if (error) throw error;
  return 'AV-' + String(data as number).padStart(4, '0');
}

/**
 * Issued credit notes (of one invoice, or all). Drafts are left out: they
 * don't count in any balance. See fetchCreditNoteDrafts.
 */
export async function fetchCreditNotes(orgId: string, invoiceId?: string): Promise<CreditNote[]> {
  if (MOCK) return [...mockNotes.values()].filter(c => c.status === 'issued' && (!invoiceId || c.invoiceId === invoiceId));
  let q = supabase.from('credit_notes').select('*').eq('org_id', orgId).eq('status', 'issued');
  if (invoiceId) q = q.eq('invoice_id', invoiceId);
  const { data, error } = await q.order('issued_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(dbToCreditNote);
}

/** Draft credit notes, for the invoice list and the invoice they belong to. */
export async function fetchCreditNoteDrafts(orgId: string, invoiceId?: string): Promise<CreditNote[]> {
  if (MOCK) return [...mockNotes.values()].filter(c => c.status === 'draft' && (!invoiceId || c.invoiceId === invoiceId));
  let q = supabase.from('credit_notes').select('*').eq('org_id', orgId).eq('status', 'draft');
  if (invoiceId) q = q.eq('invoice_id', invoiceId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(dbToCreditNote);
}

/** One credit note, draft or issued; null when there is none. */
export async function fetchCreditNote(orgId: string, id: string): Promise<CreditNote | null> {
  if (MOCK) return mockNotes.get(id) ?? null;
  const { data, error } = await supabase.from('credit_notes').select('*').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? dbToCreditNote(data as Record<string, unknown>) : null;
}

/** Every issued credit note of one client, for the client's balance. */
export async function fetchClientCreditNotes(orgId: string, clientCode: string): Promise<CreditNote[]> {
  if (MOCK) return [...mockNotes.values()].filter(c => c.status === 'issued' && c.client === clientCode);
  const { data, error } = await supabase.from('credit_notes').select('*').eq('org_id', orgId).eq('client_code', clientCode).eq('status', 'issued');
  if (error) throw error;
  return (data ?? []).map(dbToCreditNote);
}

/** What the editor writes; the number and the issuer come from the database. */
export type CreditNoteFields = Pick<CreditNote, 'invoiceId' | 'subject' | 'client' | 'issued' | 'amount' | 'reason' | 'nature' | 'lines' | 'discountPct'>;

function toRow(f: CreditNoteFields) {
  return {
    invoice_id:   f.invoiceId,
    subject:      f.subject,
    client_code:  f.client,
    issued_at:    f.issued,
    amount:       f.amount,
    reason:       f.reason,
    nature:       f.nature ?? null,
    lines:        f.lines.map(l => ({ id: l.id, desc: l.desc, unit: l.unit, qty: l.qty, price: l.price, productId: l.productId, sourceId: l.sourceId, taxGroup: l.taxGroup })),
    discount_pct: f.discountPct,
  };
}

/** Creates a credit note, as a draft or issued at once. */
export async function createCreditNote(orgId: string, id: string, fields: CreditNoteFields, status: CreditNote['status']): Promise<CreditNote> {
  if (MOCK) {
    const cn: CreditNote = { ...fields, id, status, ...(status === 'issued' ? mockIssue() : {}) };
    mockNotes.set(id, cn);
    return cn;
  }
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('credit_notes')
    .insert({ id, org_id: orgId, ...toRow(fields), status, created_by: user?.id ?? null })
    .select()
    .single();
  if (error) throw error;
  return dbToCreditNote(data as Record<string, unknown>);
}

/**
 * Saves a draft's fields, and issues it when `issue` is set. Only while it is
 * still a draft: issued meanwhile, nothing is written and this throws.
 */
export async function updateCreditNoteDraft(orgId: string, id: string, fields: CreditNoteFields, issue = false): Promise<CreditNote> {
  if (MOCK) {
    const prev = mockNotes.get(id);
    if (!prev || prev.status !== 'draft') throw new Error('credit note is no longer a draft');
    const cn: CreditNote = { ...prev, ...fields, ...(issue ? { status: 'issued' as const, ...mockIssue() } : {}) };
    mockNotes.set(id, cn);
    return cn;
  }
  const { data, error } = await supabase
    .from('credit_notes')
    .update({ ...toRow(fields), ...(issue ? { status: 'issued' } : {}) })
    .eq('org_id', orgId).eq('id', id).eq('status', 'draft')
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('credit note is no longer a draft');
  return dbToCreditNote(data as Record<string, unknown>);
}

/** Deletes a draft credit note (the database refuses an issued one). */
export async function removeCreditNoteDraft(orgId: string, id: string): Promise<void> {
  if (MOCK) { mockNotes.delete(id); return; }
  const { error } = await supabase.from('credit_notes').delete().eq('org_id', orgId).eq('id', id).eq('status', 'draft');
  if (error) throw error;
}

function mockIssue() {
  return { number: `AV-${new Date().getUTCFullYear()}-${String(++mockSeq).padStart(4, '0')}`, issuedTs: new Date().toISOString(), issuedByName: 'Vous (démo)' };
}

/** Why the database refused to issue, in the user's words; null when it is another error. */
export function creditNoteIssueError(err: unknown): string | null {
  const hint = (err as { hint?: string } | null)?.hint;
  if (hint === 'exceeds_invoice_total') return 'Cet avoir dépasse ce qui reste à créditer sur la facture.';
  if (hint === 'stale_line') return 'Les lignes de la facture ont été corrigées depuis : rouvrez l’avoir pour créditer les lignes actuelles.';
  if (hint === 'exceeds_line_quantity') return 'Une ligne a été créditée entre-temps par un autre avoir : rouvrez l’avoir pour voir ce qui reste.';
  if (hint === 'ran_after_payment') return 'RAN (annulation) n’est possible que si la facture n’a reçu aucun paiement : choisissez RAM.';
  if (hint === 'nature_required') return 'Choisissez la nature de l’avoir.';
  if (hint === 'reason_required') return 'Indiquez le motif de l’avoir.';
  return null;
}
