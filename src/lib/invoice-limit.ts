// The free Solo plan's monthly invoice limit, as the database counts it
// (supabase/migrations/20261111_solo_limit_and_plan_protection.sql): an
// invoice counts in the UTC month it was first issued; drafts don't count.

import { SOLO_INVOICE_LIMIT, type PlanId } from '@/lib/plans';
import type { Invoice } from '@/lib/schemas';

/** Invoices first issued in the current UTC month. */
export function issuedThisMonth(invoices: Pick<Invoice, 'status' | 'issued' | 'firstIssuedAt'>[], now = new Date()): number {
  const month = now.toISOString().slice(0, 7);
  return invoices.filter(inv =>
    inv.status !== 'draft'
    // Invoices issued in this session have no database timestamp yet: use their date
    && (inv.firstIssuedAt ? new Date(inv.firstIssuedAt).toISOString() : inv.issued).startsWith(month),
  ).length;
}

/** Whether issuing one more invoice would go over the plan's limit. */
export function invoiceLimitReached(plan: PlanId, invoices: Parameters<typeof issuedThisMonth>[0], now = new Date()): boolean {
  return plan === 'solo' && issuedThisMonth(invoices, now) >= SOLO_INVOICE_LIMIT;
}

/** The database refused an invoice because the Solo limit is reached. */
export function isInvoiceLimitError(err: unknown): boolean {
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  return msg.includes('solo_invoice_limit');
}
