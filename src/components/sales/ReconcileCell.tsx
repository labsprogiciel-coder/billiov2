// « À rapprocher » / « Rapproché » on a payment (PRO-175). An admin or an accountant ticks it once they found the
// payment on the bank or Mobile Money statement; the database stamps who and when.
import { useState } from 'react';
import StatusPill from '@/components/sales/StatusPill';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { setPaymentReconciled } from '@/lib/api/payments';
import { RECONCILE_STATUS, reconcileStatus } from '@/lib/sales-tables';
import { fmtDate } from '@/data';
import type { Payment } from '@/lib/schemas';

export default function ReconcileCell({ payment }: { payment: Payment }) {
  const { orgId, setPayments, showToast } = useApp();
  const { postable } = usePermissions();
  const [busy, setBusy] = useState(false);
  const state = reconcileStatus(payment);
  if (state === 'none') return <span className="dt-muted">—</span>;

  const by = payment.reconciledAt ? `Rapproché le ${fmtDate(payment.reconciledAt.slice(0, 10))}${payment.reconciledByName ? ` par ${payment.reconciledByName}` : ''}` : undefined;
  async function toggle() {
    setBusy(true);
    try {
      const next = await setPaymentReconciled(orgId, payment, state === 'to_match');
      setPayments(prev => prev.map(p => p.id === next.id ? next : p));
    } catch (err) {
      console.error('[setPaymentReconciled]', err);
      showToast('Le rapprochement n’a pas pu être enregistré. Réessayez.', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="reco-cell" title={by}>
      <StatusPill {...RECONCILE_STATUS[state]} />
      {postable && (
        <button type="button" className="reco-btn" onClick={e => { e.stopPropagation(); toggle(); }} disabled={busy}
          aria-label={state === 'to_match' ? `Marquer le paiement ${payment.id} comme rapproché` : `Annuler le rapprochement du paiement ${payment.id}`}>
          {state === 'to_match' ? 'Rapprocher' : 'Annuler'}
        </button>
      )}
    </span>
  );
}
