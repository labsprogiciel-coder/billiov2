import { supabase } from '@/lib/supabase';
import { INITIAL_PAYMENTS } from '@/data';
import { recordInvoicePaymentEntry } from '@/lib/api/accounting';
import type { Payment, Invoice, PayMethod } from '@/lib/schemas';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export function dbToPayment(row: Record<string, unknown>): Payment {
  return {
    id:     String(row.id),
    date:   String(row.date),
    client: String(row.client_code),
    inv:    String(row.inv_id),
    method: row.method as Payment['method'],
    ref:    String(row.ref ?? ''),
    amount: Number(row.amount),
    status: (row.status ?? 'completed') as Payment['status'],
    source: (row.source ?? 'manual') as Payment['source'],
    createdByName: row.created_by_name ? String(row.created_by_name) : undefined,
  };
}

export async function nextPaymentId(orgId: string): Promise<string> {
  if (MOCK) return 'PAI-' + String(Math.floor(Math.random() * 9000) + 1000);
  // Atomic per-org sequence — see next_payment_number()
  const { data, error } = await supabase.rpc('next_payment_number', { p_org_id: orgId });
  if (error) throw error;
  return 'PAI-' + String(data as number).padStart(4, '0');
}

export async function fetchPayments(orgId: string): Promise<Payment[]> {
  if (MOCK) return [...INITIAL_PAYMENTS];
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('org_id', orgId)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(dbToPayment);
}

export async function createPayment(
  orgId: string,
  payload: Omit<Payment, 'source'> & { source?: Payment['source'] },
): Promise<Payment> {
  const source = payload.source ?? 'manual';
  if (MOCK) return { ...payload, source };
  const { data, error } = await supabase
    .from('payments')
    .insert({
      id:          payload.id,
      org_id:      orgId,
      date:        payload.date,
      client_code: payload.client,
      inv_id:      payload.inv,
      method:      payload.method,
      ref:         payload.ref,
      amount:      payload.amount,
      status:      payload.status,
      source,
    })
    .select()
    .single();
  if (error) throw error;
  return dbToPayment(data as Record<string, unknown>);
}

export async function removePayment(orgId: string, id: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('payments').delete().eq('org_id', orgId).eq('id', id);
  if (error) throw error;
}

const SETTLEMENT_ERRORS: Record<string, string> = {
  exceeds_balance:  'Le montant dépasse le reste à payer de la facture.',
  invalid_amount:   'Saisissez un montant supérieur à zéro.',
  invoice_not_open: 'Cette facture n\'est plus en attente de paiement.',
};

export interface InvoiceSettlement {
  payment:       Payment;
  invoiceStatus: Invoice['status'];
  balance:       number;
  /** False when the payment was saved but its journal entry failed. */
  accountingOk:  boolean;
}

/**
 * Records a payment against an invoice — the only way the app records one.
 * The payment insert and the invoice status update happen in one database
 * transaction (record_invoice_payment); the invoice only becomes 'paid' once
 * its balance reaches zero. The journal entry is written afterwards.
 *
 * `amount` is the amount settled, including anything withheld at source.
 */
export async function settleInvoicePayment(
  orgId: string,
  opts: {
    invoiceId:           string;
    date:                string;
    method:              PayMethod;
    ref:                 string;
    amount:              number;
    clientName:          string;
    tvaRetenue?:         number;
    serviceWithholding?: number;
    /** Name of the signed-in user, shown as « Saisi par » until the list reloads (the database stores its own). */
    recordedBy?:         string;
  },
): Promise<InvoiceSettlement> {
  let result: { payment_id: string; client_code: string; invoice_status: Invoice['status']; balance: number };
  if (MOCK) {
    result = { payment_id: await nextPaymentId(orgId), client_code: '', invoice_status: 'pending', balance: 0 };
  } else {
    const { data, error } = await supabase.rpc('record_invoice_payment', {
      p_org_id:     orgId,
      p_invoice_id: opts.invoiceId,
      p_date:       opts.date,
      p_method:     opts.method,
      p_ref:        opts.ref,
      p_amount:     opts.amount,
    });
    if (error) throw new Error(SETTLEMENT_ERRORS[error.hint ?? ''] ?? error.message);
    result = data as typeof result;
  }

  const payment: Payment = {
    id:     result.payment_id,
    date:   opts.date,
    client: result.client_code,
    inv:    opts.invoiceId,
    method: opts.method,
    ref:    opts.ref,
    amount: opts.amount,
    status: 'completed',
    source: 'manual',
    createdByName: opts.recordedBy,
  };

  let accountingOk = true;
  try {
    await recordInvoicePaymentEntry(orgId, {
      invoiceId:          opts.invoiceId,
      total:              opts.amount,
      date:               opts.date,
      clientName:         opts.clientName,
      tvaRetenue:         opts.tvaRetenue         && opts.tvaRetenue > 0         ? opts.tvaRetenue         : undefined,
      serviceWithholding: opts.serviceWithholding && opts.serviceWithholding > 0 ? opts.serviceWithholding : undefined,
    });
  } catch (err) {
    console.error('[recordInvoicePaymentEntry] failed:', err);
    accountingOk = false;
  }

  return { payment, invoiceStatus: result.invoice_status, balance: Number(result.balance), accountingOk };
}
