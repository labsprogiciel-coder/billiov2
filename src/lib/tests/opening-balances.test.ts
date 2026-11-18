import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const { adoptOpeningBalances, openingGap } = await import('@/lib/api/accounting');

describe('opening balances must balance (PRO-121)', () => {
  it('the gap is debit minus credit', () => {
    expect(openingGap([{ d: 2425000, c: 0 }, { d: 0, c: 1100000 }, { d: 0, c: 500000 }])).toBe(825000);
    expect(openingGap([{ d: 1000, c: 0 }, { d: 0, c: 1000 }])).toBe(0);
  });

  it('an unbalanced entry is refused, never topped up on another account', async () => {
    await expect(adoptOpeningBalances('org', { year: 2026, date: '2026-01-01', piece: 'AN-2026-001', label: 'x', lines: [
      { acct: '521', d: 2425000, c: 0 }, { acct: '101', d: 0, c: 1600000 },
    ] })).rejects.toThrow(/unbalanced by 825000/);
  });
});
