// Reassigning the « Responsable » of invoices, quotes or clients (PRO-172).
// Only the organisation's owner and admins may; the database enforces it
// (supabase/migrations/20261115_record_owner.sql) by keeping the old owner,
// so the rows it returns tell whether the change took.

import { supabase } from '@/lib/supabase';
import { MOCK_TEAM } from '@/data';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export type OwnedTable = 'invoices' | 'quotes' | 'clients';

const KEY: Record<OwnedTable, string> = { invoices: 'id', quotes: 'id', clients: 'code' };

export class OwnerChangeRefusedError extends Error {
  readonly refused: string[];
  /** What the database stored, including the records it did change. */
  readonly stored: Map<string, { ownerId?: string; ownerName?: string }>;
  constructor(refused: string[], stored: Map<string, { ownerId?: string; ownerName?: string }>) {
    super('Seuls les administrateurs peuvent changer le responsable.');
    this.refused = refused;
    this.stored = stored;
  }
}

/**
 * Gives `ids` to `ownerId`. Resolves with each record's owner as stored;
 * throws OwnerChangeRefusedError (after the others are saved) for any the
 * database kept as they were.
 */
export async function reassignOwner(
  orgId: string, table: OwnedTable, ids: string[], ownerId: string,
): Promise<Map<string, { ownerId?: string; ownerName?: string }>> {
  const out = new Map<string, { ownerId?: string; ownerName?: string }>();
  if (ids.length === 0) return out;
  if (MOCK) {
    const m = MOCK_TEAM.find(t => t.id === ownerId);
    ids.forEach(id => out.set(id, { ownerId, ownerName: m?.name }));
    return out;
  }
  const key = KEY[table];
  const { data, error } = await supabase
    .from(table)
    .update({ owner_id: ownerId })
    .eq('org_id', orgId)
    .in(key, ids)
    .select(`${key}, owner_id, owner_name`);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    out.set(String(row[key]), {
      ownerId: row.owner_id ? String(row.owner_id) : undefined,
      ownerName: row.owner_name ? String(row.owner_name) : undefined,
    });
  }
  const refused = ids.filter(id => out.get(id)?.ownerId !== ownerId);
  if (refused.length) throw new OwnerChangeRefusedError(refused, out);
  return out;
}
