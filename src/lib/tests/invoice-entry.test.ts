import { describe, expect, it } from 'vitest';
import { invoiceSalesLines, salesAdjustmentLines, type EntryLine } from '@/lib/invoice-entry';

const sum = (ls: EntryLine[], k: 'debit' | 'credit') => ls.reduce((s, l) => s + l[k], 0);

describe('invoiceSalesLines', () => {
  it('debits the client and credits sales and VAT', () => {
    expect(invoiceSalesLines(100000, 18000)).toEqual([
      { accountNum: '411', debit: 118000, credit: 0 },
      { accountNum: '706', debit: 0, credit: 100000 },
      { accountNum: '443', debit: 0, credit: 18000 },
    ]);
  });
  it('has no VAT line without VAT', () => {
    expect(invoiceSalesLines(50000, 0).map(l => l.accountNum)).toEqual(['411', '706']);
  });
});

describe('salesAdjustmentLines', () => {
  it('is empty when the books already match', () => {
    const lines = invoiceSalesLines(100000, 18000);
    expect(salesAdjustmentLines(lines, lines)).toEqual([]);
  });

  it('books only the difference when the amount goes up', () => {
    const adj = salesAdjustmentLines(invoiceSalesLines(100000, 0), invoiceSalesLines(120000, 0));
    expect(adj).toEqual([
      { accountNum: '411', debit: 20000, credit: 0 },
      { accountNum: '706', debit: 0, credit: 20000 },
    ]);
  });

  it('reverses the difference when the amount goes down', () => {
    const adj = salesAdjustmentLines(invoiceSalesLines(585000, 0), invoiceSalesLines(555750, 0));
    expect(adj).toEqual([
      { accountNum: '411', debit: 0, credit: 29250 },
      { accountNum: '706', debit: 29250, credit: 0 },
    ]);
  });

  it('records the whole entry when nothing was booked yet', () => {
    expect(salesAdjustmentLines([], invoiceSalesLines(50000, 9000))).toEqual(invoiceSalesLines(50000, 9000));
  });

  it('corrects earlier duplicates (INV-0010: four entries, one invoice)', () => {
    const books = [585000, 526500, 555750, 555750].flatMap(a => invoiceSalesLines(a, 0));
    const adj = salesAdjustmentLines(books, invoiceSalesLines(555750, 0));
    expect(adj).toEqual([
      { accountNum: '411', debit: 0, credit: 1667250 },
      { accountNum: '706', debit: 1667250, credit: 0 },
    ]);
    // Original entries plus the adjustment net to exactly one invoice
    const after = [...books, ...adj];
    expect(sum(after, 'debit') - sum(after, 'credit')).toBe(0);
    expect(salesAdjustmentLines(after, invoiceSalesLines(555750, 0))).toEqual([]);
  });

  it('removes VAT that is no longer charged', () => {
    const adj = salesAdjustmentLines(invoiceSalesLines(100000, 18000), invoiceSalesLines(100000, 0));
    expect(adj).toEqual([
      { accountNum: '411', debit: 0, credit: 18000 },
      { accountNum: '443', debit: 18000, credit: 0 },
    ]);
  });

  it('always balances', () => {
    const adj = salesAdjustmentLines(invoiceSalesLines(333333.33, 60000), invoiceSalesLines(250000.5, 45000.09));
    expect(sum(adj, 'debit')).toBeCloseTo(sum(adj, 'credit'), 2);
  });
});
