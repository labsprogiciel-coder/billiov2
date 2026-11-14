import { describe, expect, it } from 'vitest';
import type { ClientRecord, Quote } from '@/lib/schemas';
import type { InvoiceRow } from '@/lib/sales-tables';
import { clientDocuments, clientRows } from '@/lib/client-table';

const client = (code: string): ClientRecord => ({
  code, av: 'av-a', name: code, contact: '', email: '', phone: '', city: '', invoices: 0, billed: 0, balance: 0, status: 'active',
});
const row = (id: string, cl: string, status: InvoiceRow['status'], amount: number, paid: number, balance: number, issued = '2026-03-01'): InvoiceRow =>
  ({ id, client: cl, status, amount, paid, balance, issued, due: '2026-04-01', subject: '', discountPct: 0 });

describe('clientRows', () => {
  it('sums each client’s issued invoices with real balances', () => {
    const [kb, sh] = clientRows([client('KB'), client('SH')], [
      row('a', 'KB', 'pending', 100, 40, 60),
      row('b', 'KB', 'overdue', 50, 0, 50),
      row('c', 'KB', 'paid', 30, 0, 0, '2025-12-20'),
      row('d', 'KB', 'draft', 999, 0, 0),
    ], 2026);
    expect(kb).toMatchObject({ invoices: 3, invoicedYear: 150, invoicedAll: 180, paid: 70, balance: 110, late: true });
    expect(sh).toMatchObject({ invoices: 0, invoicedYear: 0, balance: 0, late: false });
  });
  it('is not late when the overdue invoice is settled', () => {
    const [kb] = clientRows([client('KB')], [row('a', 'KB', 'overdue', 50, 50, 0)], 2026);
    expect(kb.late).toBe(false);
  });
});

describe('clientDocuments', () => {
  it('keeps the client’s newest documents', () => {
    const inv = [row('a', 'KB', 'paid', 1, 0, 0, '2026-01-01'), row('b', 'KB', 'paid', 1, 0, 0, '2026-05-01'), row('c', 'SH', 'paid', 1, 0, 0)];
    const quotes = [{ client: 'KB', issued: '2026-02-01' }] as Quote[];
    const d = clientDocuments('KB', inv, quotes, 1);
    expect(d.invoices.map(i => i.id)).toEqual(['b']);
    expect([d.invoiceCount, d.quoteCount]).toEqual([2, 1]);
  });
});
