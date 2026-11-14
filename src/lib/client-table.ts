// Figures for the client list and record of the ERP look (PRO-169), from the
// invoices with their balances (src/lib/sales-tables.ts invoiceRows), so a
// partly paid invoice or a credit note counts for what it is.

import type { ClientRecord, Quote } from '@/lib/schemas';
import type { InvoiceRow } from '@/lib/sales-tables';

export interface ClientFigures {
  /** Issued this calendar year (drafts left out). */
  invoicedYear: number;
  /** Issued since the start (drafts left out). */
  invoicedAll: number;
  /** Received on its issued invoices. */
  paid: number;
  balance: number;
  /** Some of the balance is past due. */
  late: boolean;
  invoices: number;
}

export type ClientRow = ClientRecord & ClientFigures;

const EMPTY: ClientFigures = { invoicedYear: 0, invoicedAll: 0, paid: 0, balance: 0, late: false, invoices: 0 };

export function clientRows(clients: ClientRecord[], invoices: InvoiceRow[], year: number): ClientRow[] {
  const by = new Map<string, ClientFigures>();
  for (const inv of invoices) {
    if (inv.status === 'draft') continue;
    const f = { ...(by.get(inv.client) ?? EMPTY) };
    f.invoices += 1;
    f.invoicedAll += inv.amount;
    if (inv.issued.startsWith(String(year))) f.invoicedYear += inv.amount;
    f.paid += inv.status === 'paid' ? inv.amount : inv.paid;
    f.balance += inv.balance;
    if (inv.status === 'overdue' && inv.balance > 0) f.late = true;
    by.set(inv.client, f);
  }
  return clients.map(c => ({ ...c, ...(by.get(c.code) ?? EMPTY) }));
}

/** A client's documents, newest first, for its record. */
export function clientDocuments<I extends { client: string; issued: string }, Q extends Pick<Quote, 'client' | 'issued'>>(
  code: string, invoices: I[], quotes: Q[], limit = 5,
): { invoices: I[]; quotes: Q[]; invoiceCount: number; quoteCount: number } {
  const newest = <T extends { issued: string }>(a: T, b: T) => b.issued.localeCompare(a.issued);
  const inv = invoices.filter(i => i.client === code).sort(newest);
  const quo = quotes.filter(q => q.client === code).sort(newest);
  return { invoices: inv.slice(0, limit), quotes: quo.slice(0, limit), invoiceCount: inv.length, quoteCount: quo.length };
}
