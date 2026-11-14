import { describe, expect, it } from 'vitest';
import type { Invoice, Payment, Quote } from '@/lib/schemas';
import {
  invoiceFigures, invoiceRowStatus, invoiceRows, paymentFigures, quoteFigures, salesTabRedirect,
} from '@/lib/sales-tables';

const inv = (id: string, status: Invoice['status'], amount: number, due = '2026-11-30'): Invoice =>
  ({ id, subject: 'Travaux', client: 'c1', issued: '2026-11-01', due, amount, status, discountPct: 0 });
const pay = (inv: string, amount: number, method: Payment['method'] = 'momo', status: Payment['status'] = 'completed'): Payment =>
  ({ id: `P-${inv}-${amount}`, date: '2026-11-10', client: 'c1', inv, method, ref: '', amount, status, source: 'manual' });
const quote = (id: string, status: Quote['status'], amount: number, issued = '2026-11-01'): Quote =>
  ({ id, subject: 'Devis', client: 'c1', issued, valid: '2026-12-01', expSoon: false, amount, status });

describe('invoiceRows', () => {
  it('works out what is left to collect', () => {
    const rows = invoiceRows(
      [inv('a', 'pending', 100_000), inv('b', 'paid', 50_000), inv('d', 'draft', 30_000)],
      [pay('a', 40_000), pay('a', 10_000, 'cash', 'pending')],
      [{ invoiceId: 'a', amount: 5_000 }],
    );
    expect(rows.map(r => [r.id, r.paid, r.balance])).toEqual([['a', 40_000, 55_000], ['b', 0, 0], ['d', 0, 0]]);
  });
  it('counts an overpayment only up to the amount', () => {
    const [row] = invoiceRows([inv('a', 'overdue', 100_000)], [pay('a', 150_000)], []);
    expect([row.paid, row.balance]).toEqual([100_000, 0]);
  });
});

describe('invoiceRowStatus', () => {
  const today = '2026-11-14';
  it('shows partly paid and due today', () => {
    expect(invoiceRowStatus({ status: 'pending', due: '2026-11-30', paid: 10, balance: 90 }, today).label).toBe('Partiellement payée');
    expect(invoiceRowStatus({ status: 'pending', due: today, paid: 0, balance: 100 }, today).label).toBe('Échéance aujourd’hui');
    expect(invoiceRowStatus({ status: 'pending', due: '2026-11-30', paid: 0, balance: 100 }, today)).toEqual({ label: 'En attente', tone: 'wait' });
  });
  it('keeps late invoices red, even when partly paid', () => {
    expect(invoiceRowStatus({ status: 'overdue', due: '2026-11-01', paid: 10, balance: 90 }, today).tone).toBe('late');
    expect(invoiceRowStatus({ status: 'overdue', due: '2026-11-01', paid: 0, balance: 100 }, today).label).toBe('En retard');
  });
  it('labels drafts and paid invoices', () => {
    expect(invoiceRowStatus({ status: 'draft', due: today, paid: 0, balance: 0 }, today).label).toBe('Brouillon');
    expect(invoiceRowStatus({ status: 'paid', due: today, paid: 0, balance: 0 }, today).label).toBe('Payée');
  });
});

describe('invoiceFigures', () => {
  it('splits issued invoices into waiting, late and collected', () => {
    const rows = invoiceRows(
      [inv('a', 'pending', 100_000), inv('b', 'overdue', 80_000), inv('c', 'paid', 50_000), inv('d', 'draft', 999)],
      [pay('a', 30_000), pay('b', 20_000)],
      [],
    );
    const f = invoiceFigures(rows);
    expect(f.invoiced).toEqual({ amount: 230_000, count: 3 });
    expect(f.waiting).toEqual({ amount: 70_000, count: 1 });
    expect(f.late).toEqual({ amount: 60_000, count: 1 });
    expect(f.collected).toEqual({ amount: 100_000, count: 3 });
  });
});

describe('quoteFigures', () => {
  it('counts answers and the last 90 days', () => {
    const f = quoteFigures([
      quote('q1', 'sent', 100), quote('q2', 'accepted', 200), quote('q3', 'invoiced', 300),
      quote('q4', 'declined', 400), quote('q5', 'draft', 500), quote('q6', 'sent', 600, '2026-01-10'),
    ], '2026-11-14');
    expect(f.waiting).toEqual({ amount: 700, count: 2 });
    expect(f.accepted).toEqual({ amount: 200, count: 1 });
    expect(f.rate).toEqual({ won: 2, decided: 3, percent: 67 });
    expect(f.quoted90).toEqual({ amount: 1_000, count: 4 });
  });
  it('has no rate before any answer', () => {
    expect(quoteFigures([quote('q1', 'sent', 1)]).rate.percent).toBe(0);
  });
});

describe('paymentFigures', () => {
  it('splits completed payments by method', () => {
    const f = paymentFigures([
      pay('a', 50, 'momo'), pay('a', 30, 'wire'), pay('a', 15, 'cash'), pay('a', 5, 'cheque'), pay('a', 999, 'momo', 'pending'),
    ]);
    expect(f.collected).toEqual({ amount: 100, count: 4 });
    expect(f.cashCheque).toEqual({ amount: 20, count: 2 });
    expect(f.share).toEqual({ momo: 50, wire: 30, cashCheque: 20 });
  });
});

describe('salesTabRedirect', () => {
  it('sends old ?tab= links to their own page', () => {
    expect(salesTabRedirect('quotes')).toBe('/quotes');
    expect(salesTabRedirect('payments')).toBe('/payments');
    expect(salesTabRedirect(null)).toBeNull();
    expect(salesTabRedirect('invoices')).toBeNull();
  });
});

describe('owner filter', () => {
  it('lists each owner once, departed members by name, unowned last', async () => {
    const { ownerKey, ownerOptions } = await import('@/lib/sales-tables');
    const rows = [
      { ownerId: 'u2', ownerName: 'Paul' }, { ownerId: 'u1', ownerName: 'Awa' }, { ownerId: 'u2', ownerName: 'Paul' },
      {}, { ownerName: 'Issa' },
    ];
    expect(ownerOptions(rows)).toEqual([
      { key: 'id:u1', label: 'Awa' }, { key: 'name:Issa', label: 'Issa' }, { key: 'id:u2', label: 'Paul' },
      { key: 'none', label: 'Sans responsable' },
    ]);
    expect(ownerKey({ ownerName: 'Issa' })).toBe('name:Issa');
  });
});
