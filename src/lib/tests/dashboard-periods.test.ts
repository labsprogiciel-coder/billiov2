import { describe, expect, it } from 'vitest';
import type { Invoice, Payment } from '@/lib/schemas';
import { cashSeries, invoicesToChase, periodFigures, periodRanges } from '@/lib/dashboard-periods';
import { dashboardMetrics } from '@/lib/dashboard-metrics';

const inv = (id: string, issued: string, amount: number, status: Invoice['status'] = 'pending', due = '2026-12-31'): Invoice =>
  ({ id, subject: '', client: 'c', issued, due, amount, status, discountPct: 0 });
const pay = (invId: string, date: string, amount: number, status: Payment['status'] = 'completed'): Payment =>
  ({ id: `${invId}-${date}`, date, client: 'c', inv: invId, method: 'momo', ref: '', amount, status, source: 'manual' });
const today = '2026-11-14';

describe('periodRanges', () => {
  it('runs from the start of the period to today, against the same span before', () => {
    expect(periodRanges('month', today)).toEqual({ current: { start: '2026-11-01', end: today }, previous: { start: '2026-10-01', end: '2026-10-14' } });
    expect(periodRanges('quarter', today).current.start).toBe('2026-10-01');
    expect(periodRanges('quarter', today).previous).toEqual({ start: '2026-07-01', end: '2026-08-14' });
    expect(periodRanges('year', today).previous).toEqual({ start: '2025-01-01', end: '2025-11-14' });
    // a short previous month is cut at its end
    expect(periodRanges('month', '2026-03-31').previous).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});

describe('periodFigures', () => {
  const invoices = [
    inv('a', '2026-11-03', 100_000, 'paid'), inv('b', '2026-10-05', 50_000, 'paid'),
    inv('c', '2026-11-10', 60_000, 'overdue', '2026-11-12'), inv('d', '2026-11-12', 999, 'draft'),
  ];
  const payments = [pay('a', '2026-11-08', 100_000), pay('b', '2026-11-02', 50_000), pay('c', '2026-11-13', 10_000), pay('c', '2026-11-13', 5_000, 'pending')];

  it('sums the month to date against the same days last month', () => {
    const f = periodFigures(invoices, payments, [], 'month', today);
    expect(f).toMatchObject({ invoiced: 160_000, changePct: 220, outstanding: 50_000, overdueCount: 1, collected: 160_000, collectedPct: 100, avgDaysToPay: 16.5, settledCount: 2 });
  });
  it('caps the collected share and counts only late invoices still due', () => {
    const f = periodFigures([inv('a', '2026-11-03', 10, 'paid'), inv('o', '2026-01-01', 50, 'overdue', '2026-02-01')],
      [pay('a', '2026-11-04', 10), pay('o', '2026-03-01', 50), pay('x', '2026-11-05', 500)], [], 'month', today);
    expect([f.collectedPct, f.overdueCount]).toEqual([100, 0]);
  });
  it('matches the all-time dashboard over the whole history', () => {
    const all = dashboardMetrics(invoices, payments, [], today);
    const y = periodFigures(invoices, payments, [], 'year', today);
    expect([y.invoiced, y.outstanding, y.collected, y.avgDaysToPay]).toEqual([all.totalInvoiced, all.outstanding, all.collected, all.avgDaysToPay]);
  });
});

describe('cashSeries', () => {
  const payments = [pay('a', '2026-11-08', 100), pay('b', '2026-08-02', 50), pay('c', '2025-12-30', 7), pay('d', '2026-11-01', 9, 'failed')];
  it('gives 6 months ending with the current one', () => {
    const s = cashSeries(payments, 'month', today);
    expect(s.map(b => b.label)).toEqual(['juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.']);
    expect(s.map(b => b.amount)).toEqual([0, 0, 50, 0, 0, 100]);
    expect(s.filter(b => b.current).map(b => b.key)).toEqual(['2026-11']);
  });
  it('gives 4 quarters and 12 months', () => {
    expect(cashSeries(payments, 'quarter', today).map(b => `${b.label}:${b.amount}`)).toEqual(['T1 26:0', 'T2 26:0', 'T3 26:50', 'T4 26:100']);
    const y = cashSeries(payments, 'year', today);
    expect([y.length, y[0].key, y[0].amount]).toEqual([12, '2025-12', 7]);
  });
});

describe('invoicesToChase', () => {
  it('lists late invoices still due, oldest first, with days late', () => {
    const list = invoicesToChase([
      inv('x', '2026-09-01', 100, 'overdue', '2026-10-01'), inv('y', '2026-08-01', 100, 'overdue', '2026-09-01'),
      inv('z', '2026-08-01', 100, 'overdue', '2026-09-15'), inv('w', '2026-11-01', 100, 'pending'),
    ], [pay('z', '2026-10-01', 100)], [], today);
    expect(list.map(c => [c.invoice.id, c.daysLate])).toEqual([['y', 74], ['x', 44]]);
  });
});
