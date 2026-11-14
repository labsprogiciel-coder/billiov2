import { supabase } from '@/lib/supabase';
import { INITIAL_INVOICES, mockOwner } from '@/data';
import type { Invoice } from '@/lib/schemas';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export function dbToInvoice(row: Record<string, unknown>): Invoice {
  return {
    id:          String(row.id),
    subject:     String(row.subject ?? ''),
    client:      String(row.client_code),
    issued:      String(row.issued_at),
    due:         String(row.due_at),
    amount:      Number(row.amount),
    status:      row.status as Invoice['status'],
    discountPct: Number(row.discount_pct ?? 0),
    firstIssuedAt: row.first_issued_at ? String(row.first_issued_at) : undefined,
    number:      row.number ? String(row.number) : undefined,
    issuedByName: row.issued_by_name ? String(row.issued_by_name) : undefined,
    ownerId:     row.owner_id ? String(row.owner_id) : undefined,
    ownerName:   row.owner_name ? String(row.owner_name) : undefined,
  };
}

export { newDraftId } from '@/lib/invoice-number';

// Demo mode has no database: number issued invoices the same way, in memory
let mockSeq = 0;
const mockNumber = () => `FACT-${new Date().getUTCFullYear()}-${String(++mockSeq).padStart(4, '0')}`;

export async function fetchInvoices(orgId: string): Promise<Invoice[]> {
  if (MOCK) return [...INITIAL_INVOICES];
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('org_id', orgId)
    .order('issued_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(dbToInvoice);
}

export async function createInvoice(
  orgId: string,
  payload: Pick<Invoice, 'id' | 'subject' | 'client' | 'issued' | 'due' | 'amount' | 'status' | 'discountPct'> & Pick<Invoice, 'ownerId'>,
): Promise<Invoice> {
  if (MOCK) return { ...payload, number: payload.status === 'draft' ? undefined : mockNumber(), ...mockOwner(payload.ownerId) };
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      id:           payload.id,
      org_id:       orgId,
      subject:      payload.subject,
      client_code:  payload.client,
      issued_at:    payload.issued,
      due_at:       payload.due,
      amount:       payload.amount,
      status:       payload.status,
      discount_pct: payload.discountPct ?? 0,
      created_by:   user?.id ?? null,
      // The database makes the creator the owner unless this names another
      // member (an invoice made from a quote keeps the quote's owner)
      ...(payload.ownerId ? { owner_id: payload.ownerId } : {}),
    })
    .select()
    .single();
  if (error) throw error;
  return dbToInvoice(data as Record<string, unknown>);
}

/** Returns the invoice's first issue time and legal number, as the database set them. */
export async function updateInvoice(orgId: string, id: string, patch: Partial<Pick<Invoice, 'status' | 'subject' | 'client' | 'issued' | 'due' | 'amount' | 'discountPct'>>): Promise<{ firstIssuedAt?: string; number?: string; issuedByName?: string }> {
  if (MOCK) return patch.status && patch.status !== 'draft' ? { number: mockNumber() } : {};
  const dbPatch: Record<string, unknown> = {};
  if (patch.status      !== undefined) dbPatch.status       = patch.status;
  if (patch.subject     !== undefined) dbPatch.subject      = patch.subject;
  if (patch.client      !== undefined) dbPatch.client_code  = patch.client;
  if (patch.issued      !== undefined) dbPatch.issued_at    = patch.issued;
  if (patch.due         !== undefined) dbPatch.due_at       = patch.due;
  if (patch.amount      !== undefined) dbPatch.amount       = patch.amount;
  if (patch.discountPct !== undefined) dbPatch.discount_pct = patch.discountPct;
  const { data, error } = await supabase.from('invoices').update(dbPatch).eq('org_id', orgId).eq('id', id)
    .select('first_issued_at, number, issued_by_name').maybeSingle();
  if (error) throw error;
  // No row: the invoice was deleted meanwhile, or this user can't change it
  if (!data) throw new Error(`invoice ${id} not found or not writable`);
  const row = data as { first_issued_at?: string | null; number?: string | null; issued_by_name?: string | null };
  return { firstIssuedAt: row.first_issued_at ? String(row.first_issued_at) : undefined, number: row.number ?? undefined, issuedByName: row.issued_by_name ?? undefined };
}

/** The invoice's stored status and legal number, or null if it doesn't exist. */
export async function fetchInvoiceIssue(orgId: string, id: string): Promise<{ status: string; number?: string; firstIssuedAt?: string; issuedByName?: string } | null> {
  if (MOCK) return null;
  const { data, error } = await supabase.from('invoices').select('status, number, first_issued_at, issued_by_name').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { status: string; number?: string | null; first_issued_at?: string | null; issued_by_name?: string | null };
  return { status: row.status, number: row.number ?? undefined, firstIssuedAt: row.first_issued_at ?? undefined, issuedByName: row.issued_by_name ?? undefined };
}

export async function removeInvoice(orgId: string, id: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('invoices').delete().eq('org_id', orgId).eq('id', id);
  if (error) throw error;
}
