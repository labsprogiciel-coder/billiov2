// Reassigning the « Responsable » from a table or a record (PRO-172): saves,
// updates the lists held in AppContext, and says what happened.

import { useCallback, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { OwnerChangeRefusedError, reassignOwner, type OwnedTable } from '@/lib/api/owners';

export function useReassign() {
  const { orgId, setInvoices, setQuotes, setClients, showToast } = useApp();
  const [busy, setBusy] = useState(false);

  const reassign = useCallback(async (table: OwnedTable, ids: string[], ownerId: string, ownerLabel: string): Promise<boolean> => {
    setBusy(true);
    const apply = (stored: Map<string, { ownerId?: string; ownerName?: string }>) => {
      const patch = <T,>(rows: T[], key: (r: T) => string) =>
        rows.map(r => { const o = stored.get(key(r)); return o ? { ...r, ...o } : r; });
      if (table === 'invoices') setInvoices(prev => patch(prev, r => r.id));
      if (table === 'quotes') setQuotes(prev => patch(prev, r => r.id));
      if (table === 'clients') setClients(prev => patch(prev, r => r.code));
    };
    try {
      const stored = await reassignOwner(orgId, table, ids, ownerId);
      apply(stored);
      showToast(ids.length === 1 ? `Responsable : ${ownerLabel}` : `${ids.length} éléments attribués à ${ownerLabel}`);
      return true;
    } catch (err) {
      if (err instanceof OwnerChangeRefusedError) {
        apply(err.stored);
        showToast(err.message, true);
      } else {
        console.error('[reassignOwner]', err);
        showToast('Le responsable n’a pas pu être changé. Veuillez réessayer.', true);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [orgId, setInvoices, setQuotes, setClients, showToast]);

  return { reassign, busy };
}
