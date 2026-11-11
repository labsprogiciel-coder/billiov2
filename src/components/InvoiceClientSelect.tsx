import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { createClient } from '@/lib/api/clients';
import { clientTypeOf } from '@/lib/client-type';

const CASH = '__cash__';
export const CASH_CLIENT_NAME = 'Client comptant';

/**
 * Client picker for an invoice. Besides the organisation's clients it offers
 * "Client comptant" (DGI client type CC) for a counter sale to an unnamed
 * buyer: the first time it's picked, a CC client is created and reused after.
 */
export default function InvoiceClientSelect({ value, onChange, open = true, disabled = false }: {
  value: string;
  onChange: (code: string) => void;
  /** Whether the form is open (its panel stays mounted when closed) */
  open?: boolean;
  /** Locks the choice, e.g. while the invoice is being checked or saved */
  disabled?: boolean;
}) {
  const { orgId, clients, setClients, showToast } = useApp();
  const [creating, setCreating] = useState(false);
  const cash = clients.find(c => clientTypeOf(c) === 'CC');
  // The form's current value, read when the creation finishes
  const valueRef = useRef(value);
  valueRef.current = value;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Bumped when the form closes, so a creation started before is not applied after
  const session = useRef(0);
  useEffect(() => { if (!open) session.current++; }, [open]);

  async function pick(v: string) {
    if (v !== CASH) { onChange(v); return; }
    if (!orgId) { showToast('Impossible de sauvegarder : organisation introuvable.', true); return; }
    // Clear the previous client at once, so the form can't be saved with it meanwhile
    onChange('');
    const started = session.current;
    setCreating(true);
    try {
      const created = await createClient(orgId, {
        av: 'av-a', name: CASH_CLIENT_NAME, contact: '—', email: '—', phone: '—', city: '—',
        country: 'Burkina Faso', ifu: '', rccm: '', taxRegime: '', fiscalDivision: '', status: 'active', clientType: 'CC',
      });
      setClients(prev => prev.some(c => c.code === created.code) ? prev : [created, ...prev]);
      // Don't select it if the form was closed, reset or given another client meanwhile
      if (mounted.current && session.current === started && valueRef.current === '') onChange(created.code);
    } catch (err) {
      console.error('[cashClient]', err);
      showToast("Le client comptant n'a pas pu être créé. Réessayez.", true);
    } finally {
      if (mounted.current) setCreating(false);
    }
  }

  return (
    <select className="form-input" value={value} disabled={creating || disabled} onChange={e => void pick(e.target.value)}>
      <option value="">Sélectionner un client…</option>
      {clients.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
      {!cash && <option value={CASH}>{CASH_CLIENT_NAME} (vente sans client identifié)</option>}
    </select>
  );
}
