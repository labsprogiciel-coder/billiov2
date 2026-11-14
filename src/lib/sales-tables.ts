// What the Factures, Devis and Paiements tables of the ERP look (PRO-165)
// show: each row's status and the figures above each table. Kept free of
// React so it can be tested.

import type { CreditNote, Invoice, Payment, PayMethod, Quote } from '@/lib/schemas';
import { invoiceBalance, todayISO } from '@/lib/invoice-status';

/** Colour of a status pill (see .dt-status in index.css). */
export type StatusTone = 'late' | 'paid' | 'wait' | 'partial' | 'draft' | 'muted';

export interface RowStatus { label: string; tone: StatusTone }

/** An invoice with what is left to collect on it. */
export interface InvoiceRow extends Invoice {
  paid: number;
  /** Amount still due (0 for drafts: nothing is owed until it is issued). */
  balance: number;
}

export function invoiceRows(
  invoices: Invoice[],
  payments: Payment[],
  creditNotes: Pick<CreditNote, 'invoiceId' | 'amount'>[],
): InvoiceRow[] {
  return invoices.map(inv => {
    if (inv.status === 'draft') return { ...inv, paid: 0, balance: 0 };
    const b = invoiceBalance(inv, payments, creditNotes);
    // Received counts at most the invoice's amount (an overpayment isn't income
    // on this invoice), and a paid invoice owes nothing even if its payments
    // were recorded elsewhere
    return { ...inv, paid: Math.min(b.paid, inv.amount), balance: inv.status === 'paid' ? 0 : b.balance };
  });
}

/**
 * The status shown for an invoice. Expects the display status already applied
 * (an issued invoice past its due date is 'overdue', see invoice-status.ts).
 * Two more show than are stored: partly paid, and due today.
 */
export function invoiceRowStatus(row: Pick<InvoiceRow, 'status' | 'due' | 'paid' | 'balance'>, today: string = todayISO()): RowStatus {
  switch (row.status) {
    case 'draft':   return { label: 'Brouillon', tone: 'draft' };
    case 'paid':    return { label: 'Payée', tone: 'paid' };
    case 'overdue': return row.paid > 0 && row.balance > 0
      ? { label: 'Partiellement payée · en retard', tone: 'late' }
      : { label: 'En retard', tone: 'late' };
    case 'pending':
      if (row.paid > 0 && row.balance > 0) return { label: 'Partiellement payée', tone: 'partial' };
      if (row.due === today) return { label: 'Échéance aujourd’hui', tone: 'partial' };
      return { label: 'En attente', tone: 'wait' };
  }
}

export interface Figure { amount: number; count: number }

export interface InvoiceFigures {
  /** Issued invoices (drafts left out). */
  invoiced: Figure;
  /** Still due on invoices that aren't late yet. */
  waiting: Figure;
  /** Still due on late invoices. */
  late: Figure;
  /** Received on issued invoices. */
  collected: Figure;
}

export function invoiceFigures(rows: InvoiceRow[]): InvoiceFigures {
  const issued = rows.filter(r => r.status !== 'draft');
  const sum = (list: InvoiceRow[], f: (r: InvoiceRow) => number): Figure =>
    ({ amount: list.reduce((s, r) => s + f(r), 0), count: list.length });
  const open = issued.filter(r => r.balance > 0);
  return {
    invoiced:  sum(issued, r => r.amount),
    waiting:   sum(open.filter(r => r.status === 'pending'), r => r.balance),
    late:      sum(open.filter(r => r.status === 'overdue'), r => r.balance),
    // A paid invoice counts in full, whether or not its payments are in Billio
    collected: sum(issued.filter(r => r.status === 'paid' || r.paid > 0), r => r.status === 'paid' ? r.amount : r.paid),
  };
}

export const QUOTE_STATUS: Record<Quote['status'], RowStatus> = {
  draft:    { label: 'Brouillon', tone: 'draft' },
  sent:     { label: 'Envoyé',    tone: 'wait' },
  accepted: { label: 'Accepté',   tone: 'paid' },
  declined: { label: 'Refusé',    tone: 'late' },
  expired:  { label: 'Expiré',    tone: 'muted' },
  invoiced: { label: 'Facturé',   tone: 'paid' },
};

export interface QuoteFigures {
  /** Sent, no answer yet. */
  waiting: Figure;
  /** Accepted and not invoiced yet: ready to invoice. */
  accepted: Figure;
  /** Won (accepted or invoiced) out of every quote that got an answer or expired. */
  rate: { won: number; decided: number; percent: number };
  /** Sent in the last 90 days (drafts left out). */
  quoted90: Figure;
}

export function quoteFigures(quotes: Quote[], today: string = todayISO()): QuoteFigures {
  const sum = (list: Quote[]): Figure => ({ amount: list.reduce((s, q) => s + q.amount, 0), count: list.length });
  const won = quotes.filter(q => q.status === 'accepted' || q.status === 'invoiced').length;
  const decided = quotes.filter(q => q.status === 'accepted' || q.status === 'invoiced' || q.status === 'declined' || q.status === 'expired').length;
  const since = Date.parse(today + 'T00:00:00Z') - 90 * 86_400_000;
  return {
    waiting:  sum(quotes.filter(q => q.status === 'sent')),
    accepted: sum(quotes.filter(q => q.status === 'accepted')),
    rate:     { won, decided, percent: decided ? Math.round((won / decided) * 100) : 0 },
    quoted90: sum(quotes.filter(q => q.status !== 'draft' && Date.parse(q.issued + 'T00:00:00Z') >= since)),
  };
}

export interface PaymentFigures {
  collected: Figure;
  momo: Figure;
  wire: Figure;
  /** Cash and cheques together. */
  cashCheque: Figure;
  /** Share of the amount collected, in whole percent. */
  share: { momo: number; wire: number; cashCheque: number };
}

/** Completed payments only: a pending or failed one hasn't been collected. */
export function paymentFigures(payments: Payment[]): PaymentFigures {
  const done = payments.filter(p => p.status === 'completed');
  const sum = (methods: PayMethod[]): Figure => {
    const list = done.filter(p => methods.includes(p.method));
    return { amount: list.reduce((s, p) => s + p.amount, 0), count: list.length };
  };
  const collected = sum(['momo', 'wire', 'cash', 'cheque']);
  const momo = sum(['momo']);
  const wire = sum(['wire']);
  const cashCheque = sum(['cash', 'cheque']);
  const pct = (f: Figure) => collected.amount ? Math.round((f.amount / collected.amount) * 100) : 0;
  return { collected, momo, wire, cashCheque, share: { momo: pct(momo), wire: pct(wire), cashCheque: pct(cashCheque) } };
}

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  momo: 'Mobile Money', wire: 'Virement', cash: 'Espèces', cheque: 'Chèque',
};

export const PAYMENT_STATUS: Record<Payment['status'], RowStatus> = {
  completed: { label: 'Effectué',   tone: 'paid' },
  pending:   { label: 'En attente', tone: 'wait' },
  failed:    { label: 'Échoué',     tone: 'late' },
};

/**
 * The page an old Facturation link (/invoices?tab=…) now lives at, in the
 * ERP look, or null when it is the invoices page itself.
 */
export function salesTabRedirect(tab: string | null): '/quotes' | '/payments' | null {
  return tab === 'quotes' ? '/quotes' : tab === 'payments' ? '/payments' : null;
}

// ── « Responsable » (PRO-172) ────────────────────────────────────────────────

interface Owned { ownerId?: string; ownerName?: string }

/** Who a record belongs to, for filtering: the member, or the name a departed member left. */
export function ownerKey(r: Owned): string {
  return r.ownerId ? `id:${r.ownerId}` : r.ownerName ? `name:${r.ownerName}` : 'none';
}

/** The owners present in `rows`, by name, with « Sans responsable » last if any. */
export function ownerOptions(rows: Owned[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const k = ownerKey(r);
    if (!seen.has(k)) seen.set(k, r.ownerName ?? 'Sans responsable');
  }
  return [...seen].map(([key, label]) => ({ key, label }))
    .sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label, 'fr')));
}
