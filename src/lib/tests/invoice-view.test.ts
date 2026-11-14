import { describe, expect, it } from 'vitest';
import type { CreditNote, Invoice, Payment } from '@/lib/schemas';
import { clientBalance, expectedSalesEntry, invoiceActivity, invoiceBadge } from '@/lib/invoice-view';

const today = '2026-11-14';
const inv = (over: Partial<Invoice> = {}): Invoice =>
  ({ id: 'I1', subject: 's', client: 'KB', issued: '2026-10-01', due: '2026-10-09', amount: 118_000, status: 'overdue', discountPct: 0, ...over });
const pay = (amount: number, date: string, over: Partial<Payment> = {}): Payment =>
  ({ id: `P${date}`, date, client: 'KB', inv: 'I1', method: 'momo', ref: '', amount, status: 'completed', source: 'manual', ...over });

describe('invoiceBadge', () => {
  it('says how late it is', () => {
    expect(invoiceBadge(inv(), 118_000, 0, today)).toEqual({ label: 'En retard · 36 jours', tone: 'late' });
    expect(invoiceBadge(inv({ due: '2026-11-13' }), 10, 5, today).label).toBe('En retard · 1 jour · partiellement payée');
    expect(invoiceBadge(inv({ status: 'pending', due: today }), 10, 0, today).label).toBe('Échéance aujourd’hui');
    expect(invoiceBadge(inv({ status: 'paid' }), 0, 0, today).tone).toBe('paid');
  });
});

describe('invoiceActivity', () => {
  it('lists what happened, newest first', () => {
    const credit: CreditNote = { id: 'C1', invoiceId: 'I1', subject: '', client: 'KB', issued: '2026-10-20', amount: 8_000, reason: 'Remise', number: 'AV-2026-0001' };
    const a = invoiceActivity(inv({ firstIssuedAt: '2026-10-01T09:00:00Z', issuedByName: 'Awa', number: 'FACT-2026-0007' }),
      [pay(50_000, '2026-10-15', { createdByName: 'Issa' }), pay(10_000, '2026-11-02', { status: 'pending' })], [credit], n => String(n), today);
    expect(a.map(e => e.text)).toEqual([
      'Paiement de 10000 F CFA (en attente)',
      'Avoir AV-2026-0001 de 8000 F CFA · Remise',
      'Paiement de 50000 F CFA · saisi par Issa',
      'Échéance dépassée',
      'Émise par Awa sous le n° FACT-2026-0007',
      'Facture créée',
    ]);
  });
  it('shows only the creation of a draft', () => {
    expect(invoiceActivity(inv({ status: 'draft' }), [], [], String, today).map(e => e.text)).toEqual(['Brouillon créé']);
  });
});

describe('clientBalance', () => {
  it('sums what the client still owes on its open invoices', () => {
    const invoices = [inv(), inv({ id: 'I2', status: 'paid' }), inv({ id: 'I3', client: 'X' }), inv({ id: 'I4', status: 'pending', amount: 1_000 })];
    expect(clientBalance('KB', invoices, [pay(18_000, '2026-10-02')], [])).toBe(101_000);
  });
});

describe('expectedSalesEntry', () => {
  it('books 411 at TTC against 706 and 443', () => {
    expect(expectedSalesEntry(118_000, true).map(l => [l.account, l.debit, l.credit])).toEqual([['411', 118_000, 0], ['706', 0, 100_000], ['443', 0, 18_000]]);
    expect(expectedSalesEntry(50_000, false).map(l => l.account)).toEqual(['411', '706']);
  });
});
