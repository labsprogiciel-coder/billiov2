import { supabase } from '@/lib/supabase';
import { INITIAL_CLIENTS, mockOwner } from '@/data';
import type { ClientRecord } from '@/lib/schemas';
import { clientTypeOf } from '@/lib/client-type';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export function dbToClient(row: Record<string, unknown>): ClientRecord {
  return {
    code:     String(row.code),
    av:       String(row.av ?? 'av-a'),
    name:     String(row.name),
    contact:  String(row.contact ?? '—'),
    email:    String(row.email ?? '—'),
    phone:    String(row.phone ?? '—'),
    city:     String(row.city ?? '—'),
    country:        String(row.country ?? 'Burkina Faso'),
    ifu:            String(row.ifu ?? ''),
    rccm:           String(row.rccm ?? ''),
    taxRegime:           String(row.tax_regime ?? ''),
    fiscalDivision:      String(row.fiscal_division ?? ''),
    withholdingScenario: (row.withholding_scenario ?? undefined) as ClientRecord['withholdingScenario'],
    clientType: clientTypeOf({ clientType: row.client_type as string | null, ifu: String(row.ifu ?? '') }),
    invoices: Number(row.invoices_count ?? 0),
    billed:   Number(row.billed ?? 0),
    balance:  Number(row.balance ?? 0),
    status:   (row.status ?? 'active') as ClientRecord['status'],
    ownerId:     row.owner_id ? String(row.owner_id) : undefined,
    ownerName:   row.owner_name ? String(row.owner_name) : undefined,
  };
}

export async function fetchClients(orgId: string): Promise<ClientRecord[]> {
  if (MOCK) return [...INITIAL_CLIENTS];
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('org_id', orgId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(dbToClient);
}

export async function nextClientCode(orgId: string): Promise<string> {
  if (MOCK) return 'CLI-' + String(Math.floor(Math.random() * 9000) + 1000);
  // Atomic per-org sequence — see next_client_number(). Codes must be unique:
  // invoices, quotes and payments reference clients by code.
  const { data, error } = await supabase.rpc('next_client_number', { p_org_id: orgId });
  if (error) throw error;
  return 'CLI-' + String(data as number).padStart(4, '0');
}

export async function createClient(
  orgId: string,
  payload: Omit<ClientRecord, 'code' | 'invoices' | 'billed' | 'balance'>,
): Promise<ClientRecord> {
  const code = await nextClientCode(orgId);
  if (MOCK) return { ...payload, code, invoices: 0, billed: 0, balance: 0, ...mockOwner() };
  const { data, error } = await supabase
    .from('clients')
    .insert({
      org_id:         orgId,
      code,
      av:             payload.av,
      name:           payload.name,
      contact:        payload.contact,
      email:          payload.email,
      phone:          payload.phone,
      city:           payload.city,
      country:        payload.country ?? 'Burkina Faso',
      ifu:             payload.ifu ?? '',
      rccm:            payload.rccm ?? '',
      tax_regime:            payload.taxRegime ?? '',
      fiscal_division:       payload.fiscalDivision ?? '',
      withholding_scenario:  payload.withholdingScenario ?? null,
      client_type:           clientTypeOf(payload),
      status:         payload.status,
      invoices_count: 0,
      billed:         0,
      balance:        0,
    })
    .select()
    .single();
  if (error) throw error;
  return dbToClient(data as Record<string, unknown>);
}

export async function updateClient(orgId: string, code: string, patch: Partial<ClientRecord>): Promise<void> {
  if (MOCK) return;
  const dbPatch: Record<string, unknown> = {};
  if (patch.name      !== undefined) dbPatch.name           = patch.name;
  if (patch.av        !== undefined) dbPatch.av             = patch.av;
  if (patch.contact   !== undefined) dbPatch.contact        = patch.contact;
  if (patch.email     !== undefined) dbPatch.email          = patch.email;
  if (patch.phone     !== undefined) dbPatch.phone          = patch.phone;
  if (patch.city      !== undefined) dbPatch.city           = patch.city;
  if (patch.country   !== undefined) dbPatch.country        = patch.country;
  if (patch.ifu       !== undefined) dbPatch.ifu            = patch.ifu;
  if (patch.rccm      !== undefined) dbPatch.rccm           = patch.rccm;
  if (patch.taxRegime            !== undefined) dbPatch.tax_regime            = patch.taxRegime;
  if (patch.fiscalDivision       !== undefined) dbPatch.fiscal_division       = patch.fiscalDivision;
  if (patch.withholdingScenario  !== undefined) dbPatch.withholding_scenario  = patch.withholdingScenario ?? null;
  if (patch.clientType           !== undefined) dbPatch.client_type           = patch.clientType;
  if (patch.status    !== undefined) dbPatch.status         = patch.status;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from('clients').update(dbPatch).eq('org_id', orgId).eq('code', code);
  if (error) throw error;
}

export async function removeClient(orgId: string, code: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('clients').delete().eq('org_id', orgId).eq('code', code);
  if (error) throw error;
}
