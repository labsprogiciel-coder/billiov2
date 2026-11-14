// The ERP dashboard (PRO-164): figures over a chosen period (month, quarter or
// year, to date), cash collected per month or quarter, and the invoices to
// chase. Computed like src/lib/dashboard-metrics.ts, over a date range.

import type { CreditNote, Invoice, Payment } from '@/lib/schemas';
import { daysOverdue, invoiceBalance, todayISO } from '@/lib/invoice-status';

export type Period = 'month' | 'quarter' | 'year';

export interface Range { start: string; end: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));

/** The period containing `today`, to date, and the same span of the period before. */
export function periodRanges(period: Period, today: string): { current: Range; previous: Range } {
  const [y, m] = today.split('-').map(Number);
  const startMonth = period === 'month' ? m - 1 : period === 'quarter' ? Math.floor((m - 1) / 3) * 3 : 0;
  const months = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;
  const start = utc(y, startMonth);
  const prevStart = utc(y, startMonth - months);
  // Same elapsed days into the previous period (clamped to its end)
  const elapsed = Math.round((Date.parse(today + 'T00:00:00Z') - start.getTime()) / 86_400_000);
  const prevEndCap = new Date(start.getTime() - 86_400_000);
  const prevEnd = new Date(Math.min(prevStart.getTime() + elapsed * 86_400_000, prevEndCap.getTime()));
  return { current: { start: iso(start), end: today }, previous: { start: iso(prevStart), end: iso(prevEnd) } };
}

const within = (day: string, r: Range) => day >= r.start && day <= r.end;

export interface PeriodFigures {
  invoiced: number;
  /** Change on the same span of the previous period, in %; null when it had none. */
  changePct: number | null;
  /** Still due on open invoices today (not tied to the period). */
  outstanding: number;
  /** Late invoices with something still due. */
  overdueCount: number;
  /** Completed payments received in the period. */
  collected: number;
  /** Collected as a share of invoiced in the period (at most 100); null when nothing was invoiced. */
  collectedPct: number | null;
  /** Average days from issue to settlement, for invoices settled in the period. */
  avgDaysToPay: number | null;
  settledCount: number;
}

export function periodFigures(
  invoices: Invoice[], payments: Payment[], creditNotes: Pick<CreditNote, 'invoiceId' | 'amount'>[],
  period: Period, today: string = todayISO(),
): PeriodFigures {
  const { current, previous } = periodRanges(period, today);
  const issued = invoices.filter(i => i.status !== 'draft');
  const sumIn = (r: Range) => issued.filter(i => within(i.issued, r)).reduce((s, i) => s + i.amount, 0);
  const invoiced = sumIn(current);
  const before = sumIn(previous);
  const open = invoices.filter(i => i.status === 'pending' || i.status === 'overdue');
  const done = payments.filter(p => p.status === 'completed');
  const collected = done.filter(p => within(p.date, current)).reduce((s, p) => s + p.amount, 0);

  const delays: number[] = [];
  for (const inv of invoices.filter(i => i.status === 'paid')) {
    const dates = done.filter(p => p.inv === inv.id).map(p => p.date).sort();
    const settled = dates[dates.length - 1];
    if (!settled || !within(settled, current)) continue;
    const days = Math.round((Date.parse(settled + 'T00:00:00Z') - Date.parse(inv.issued + 'T00:00:00Z')) / 86_400_000);
    if (Number.isFinite(days) && days >= 0) delays.push(days);
  }
  return {
    invoiced,
    changePct: before > 0 ? Math.round(((invoiced - before) / before) * 100) : null,
    outstanding: open.reduce((s, i) => s + invoiceBalance(i, payments, creditNotes).balance, 0),
    overdueCount: open.filter(i => i.status === 'overdue' && invoiceBalance(i, payments, creditNotes).balance > 0).length,
    collected,
    // Capped like the original dashboard: payments on older invoices can exceed what the period invoiced
    collectedPct: invoiced > 0 ? Math.min(100, Math.round((collected / invoiced) * 100)) : null,
    avgDaysToPay: delays.length ? Math.round((delays.reduce((s, x) => s + x, 0) / delays.length) * 10) / 10 : null,
    settledCount: delays.length,
  };
}

export interface CashBar { key: string; label: string; amount: number; current: boolean }

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Cash collected per month (6 months for « Mois », 12 for « Année ») or per
 * quarter (4 for « Trimestre »), ending with the current one.
 */
export function cashSeries(payments: Payment[], period: Period, today: string = todayISO()): CashBar[] {
  const [y, m] = today.split('-').map(Number);
  const done = payments.filter(p => p.status === 'completed');
  const bars: CashBar[] = [];
  if (period === 'quarter') {
    const q = Math.floor((m - 1) / 3);
    for (let k = 3; k >= 0; k--) {
      const start = utc(y, (q - k) * 3), end = utc(y, (q - k) * 3 + 3, 0);
      const r = { start: iso(start), end: iso(end) };
      const qy = start.getUTCFullYear(), qn = Math.floor(start.getUTCMonth() / 3) + 1;
      bars.push({ key: `${qy}-T${qn}`, label: `T${qn} ${String(qy).slice(2)}`, amount: done.filter(p => within(p.date, r)).reduce((s, p) => s + p.amount, 0), current: k === 0 });
    }
    return bars;
  }
  const n = period === 'year' ? 12 : 6;
  for (let k = n - 1; k >= 0; k--) {
    const start = utc(y, m - 1 - k), key = iso(start).slice(0, 7);
    bars.push({ key, label: MONTHS[start.getUTCMonth()], amount: done.filter(p => p.date.startsWith(key)).reduce((s, p) => s + p.amount, 0), current: k === 0 });
  }
  return bars;
}

export interface ChaseItem { invoice: Invoice; balance: number; daysLate: number }

/** Late invoices with something still due, oldest due date first. */
export function invoicesToChase(
  invoices: Invoice[], payments: Payment[], creditNotes: Pick<CreditNote, 'invoiceId' | 'amount'>[], today: string = todayISO(),
): ChaseItem[] {
  return invoices
    .filter(i => i.status === 'overdue')
    .map(i => ({ invoice: i, balance: invoiceBalance(i, payments, creditNotes).balance, daysLate: daysOverdue(i.due, today) }))
    .filter(c => c.balance > 0)
    .sort((a, b) => a.invoice.due.localeCompare(b.invoice.due));
}
