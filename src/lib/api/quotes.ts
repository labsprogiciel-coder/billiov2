import { supabase } from '@/lib/supabase';
import { INITIAL_QUOTES, mockOwner } from '@/data';
import type { Quote } from '@/lib/schemas';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export function dbToQuote(row: Record<string, unknown>): Quote {
  const validUntil = String(row.valid_until);
  const daysLeft   = (new Date(validUntil).getTime() - Date.now()) / 86_400_000;
  return {
    id:      String(row.id),
    subject: String(row.subject ?? ''),
    client:  String(row.client_code),
    issued:  String(row.issued_at),
    valid:   validUntil,
    expSoon: daysLeft > 0 && daysLeft <= 14,
    amount:  Number(row.amount),
    status:  (row.status ?? 'draft') as Quote['status'],
    ownerId:     row.owner_id ? String(row.owner_id) : undefined,
    ownerName:   row.owner_name ? String(row.owner_name) : undefined,
  };
}

export async function nextQuoteId(orgId: string): Promise<string> {
  if (MOCK) return 'QUO-' + String(Math.floor(Math.random() * 9000) + 1000);
  const { data, error } = await supabase.rpc('next_quote_number', { p_org_id: orgId });
  if (error) throw error;
  return 'QUO-' + String(data as number).padStart(4, '0');
}

export async function fetchQuotes(orgId: string): Promise<Quote[]> {
  if (MOCK) return [...INITIAL_QUOTES];
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('org_id', orgId)
    .order('issued_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(dbToQuote);
}

export async function createQuote(
  orgId: string,
  payload: Pick<Quote, 'id' | 'subject' | 'client' | 'issued' | 'valid' | 'amount' | 'status'>,
): Promise<Quote> {
  const daysLeft = (new Date(payload.valid).getTime() - Date.now()) / 86_400_000;
  const expSoon  = daysLeft > 0 && daysLeft <= 14;
  if (MOCK) return { ...payload, expSoon, ...mockOwner() };
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('quotes')
    .insert({
      id:          payload.id,
      org_id:      orgId,
      subject:     payload.subject,
      client_code: payload.client,
      issued_at:   payload.issued,
      valid_until: payload.valid,
      amount:      payload.amount,
      status:      payload.status,
      created_by:  user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return dbToQuote(data as Record<string, unknown>);
}

export async function updateQuote(
  orgId: string,
  id: string,
  patch: Partial<Pick<Quote, 'status' | 'subject' | 'client' | 'issued' | 'valid' | 'amount'>>,
): Promise<void> {
  if (MOCK) return;
  const dbPatch: Record<string, unknown> = {};
  if (patch.status  !== undefined) dbPatch.status       = patch.status;
  if (patch.subject !== undefined) dbPatch.subject      = patch.subject;
  if (patch.client  !== undefined) dbPatch.client_code  = patch.client;
  if (patch.issued  !== undefined) dbPatch.issued_at    = patch.issued;
  if (patch.valid   !== undefined) dbPatch.valid_until  = patch.valid;
  if (patch.amount  !== undefined) dbPatch.amount       = patch.amount;
  const { error } = await supabase.from('quotes').update(dbPatch).eq('org_id', orgId).eq('id', id);
  if (error) throw error;
}

export async function removeQuote(orgId: string, id: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('quotes').delete().eq('org_id', orgId).eq('id', id);
  if (error) throw error;
}
