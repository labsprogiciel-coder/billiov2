import { supabase } from '@/lib/supabase';
import { INITIAL_INVOICES } from '@/data';
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
  };
}

export async function nextInvoiceId(orgId: string): Promise<string> {
  if (MOCK) return 'INV-' + String(Math.floor(Math.random() * 9000) + 1000);
  // Atomic per-org sequence — safe against concurrent requests and cross-org
  // collisions. The DB function holds a row-level lock so two callers for the
  // same org always get different numbers.
  const { data, error } = await supabase.rpc('next_invoice_number', { p_org_id: orgId });
  if (error) throw error;
  return 'INV-' + String(data as number).padStart(4, '0');
}

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
  payload: Pick<Invoice, 'id' | 'subject' | 'client' | 'issued' | 'due' | 'amount' | 'status' | 'discountPct'>,
): Promise<Invoice> {
  if (MOCK) return { ...payload };
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
    })
    .select()
    .single();
  if (error) throw error;
  return dbToInvoice(data as Record<string, unknown>);
}

/** Returns the invoice's first issue time as the database stamped it (for the Solo limit). */
export async function updateInvoice(orgId: string, id: string, patch: Partial<Pick<Invoice, 'status' | 'subject' | 'client' | 'issued' | 'due' | 'amount' | 'discountPct'>>): Promise<{ firstIssuedAt?: string }> {
  if (MOCK) return {};
  const dbPatch: Record<string, unknown> = {};
  if (patch.status      !== undefined) dbPatch.status       = patch.status;
  if (patch.subject     !== undefined) dbPatch.subject      = patch.subject;
  if (patch.client      !== undefined) dbPatch.client_code  = patch.client;
  if (patch.issued      !== undefined) dbPatch.issued_at    = patch.issued;
  if (patch.due         !== undefined) dbPatch.due_at       = patch.due;
  if (patch.amount      !== undefined) dbPatch.amount       = patch.amount;
  if (patch.discountPct !== undefined) dbPatch.discount_pct = patch.discountPct;
  const { data, error } = await supabase.from('invoices').update(dbPatch).eq('org_id', orgId).eq('id', id)
    .select('first_issued_at').maybeSingle();
  if (error) throw error;
  const stamped = (data as { first_issued_at?: string | null } | null)?.first_issued_at;
  return { firstIssuedAt: stamped ? String(stamped) : undefined };
}

export async function removeInvoice(orgId: string, id: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('invoices').delete().eq('org_id', orgId).eq('id', id);
  if (error) throw error;
}
