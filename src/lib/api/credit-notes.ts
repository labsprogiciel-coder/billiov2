import { supabase } from '@/lib/supabase';
import type { CreditNote } from '@/lib/schemas';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';
// Demo mode has no database: number credit notes in memory
let mockSeq = 0;

function dbToCreditNote(row: Record<string, unknown>): CreditNote {
  return {
    id:        String(row.id),
    invoiceId: String(row.invoice_id),
    subject:   String(row.subject ?? ''),
    client:    String(row.client_code),
    issued:    String(row.issued_at),
    amount:    Number(row.amount),
    reason:    String(row.reason ?? ''),
    number:    row.number ? String(row.number) : undefined,
  };
}

export async function nextCreditNoteId(orgId: string): Promise<string> {
  if (MOCK) return 'AV-' + String(Math.floor(Math.random() * 9000) + 1000);
  const { data, error } = await supabase.rpc('next_credit_note_number', { p_org_id: orgId });
  if (error) throw error;
  return 'AV-' + String(data as number).padStart(4, '0');
}

export async function fetchCreditNotes(orgId: string, invoiceId?: string): Promise<CreditNote[]> {
  if (MOCK) return [];
  let q = supabase.from('credit_notes').select('*').eq('org_id', orgId);
  if (invoiceId) q = q.eq('invoice_id', invoiceId);
  const { data, error } = await q.order('issued_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(dbToCreditNote);
}

export async function createCreditNote(
  orgId: string,
  payload: Omit<CreditNote, 'id'> & { id: string },
): Promise<CreditNote> {
  if (MOCK) return { ...payload, number: `AV-${new Date().getUTCFullYear()}-${String(++mockSeq).padStart(4, '0')}` };
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('credit_notes')
    .insert({
      id:          payload.id,
      org_id:      orgId,
      invoice_id:  payload.invoiceId,
      subject:     payload.subject,
      client_code: payload.client,
      issued_at:   payload.issued,
      amount:      payload.amount,
      reason:      payload.reason,
      created_by:  user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return dbToCreditNote(data as Record<string, unknown>);
}
