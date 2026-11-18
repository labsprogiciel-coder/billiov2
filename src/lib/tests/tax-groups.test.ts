import { describe, expect, it } from 'vitest';
import { lineGroup, productTaxGroup, splitByGroups, taxSummary, TAX_GROUPS } from '@/lib/tax-groups';
import { splitTtc, vatOn } from '@/lib/vat';

const line = (qty: number, price: number, taxGroup?: 'A' | 'B' | 'C' | 'D') => ({ qty, price, taxGroup });

describe('DGI tax groups (PRO-138)', () => {
  it('has the official rates: only B, C, F, G, L and M carry VAT', () => {
    const taxed = Object.values(TAX_GROUPS).filter(g => g.rate > 0).map(g => g.code);
    expect(taxed).toEqual(['B', 'C', 'F', 'G', 'L', 'M']);
    expect(TAX_GROUPS.B.rate).toBe(0.18);
    expect(TAX_GROUPS.C.rate).toBe(0.10);
  });

  it('taxes an all-B document exactly as the single 18 % rate did', () => {
    for (const [lines, pct] of [[[line(3, 12_345), line(1, 999)], 7.5], [[line(1, 100_001)], 0], [[line(2, 33_333), line(5, 1)], 12]] as const) {
      const s = taxSummary([...lines], pct, true);
      const sub = lines.reduce((a, l) => a + l.qty * l.price, 0);
      const disc = Math.round(sub * (pct / 100));
      expect(s.discount).toBe(disc);
      expect(s.tax).toBe(vatOn(sub - disc, true));
      expect(s.groups.map(g => g.code)).toEqual(['B']);
      expect(splitByGroups(s.total, s)).toEqual(splitTtc(s.total, true));
      expect(splitByGroups(12_345, s)).toEqual(splitTtc(12_345, true));
    }
  });

  it('taxes a taxable line and an exempt line separately', () => {
    const s = taxSummary([line(1, 100_000, 'B'), line(1, 50_000, 'A')], 0, true);
    expect(s.groups).toEqual([
      { code: 'A', label: 'Exonéré', rate: 0, base: 50_000, tax: 0 },
      { code: 'B', label: 'TVA taxable 1', rate: 0.18, base: 100_000, tax: 18_000 },
    ]);
    expect(s.total).toBe(168_000);
    expect(splitByGroups(168_000, s)).toEqual({ ht: 150_000, tva: 18_000 });
  });

  it('shares the discount between groups without losing a franc', () => {
    const s = taxSummary([line(1, 10_001, 'B'), line(1, 10_001, 'C'), line(1, 10_001, 'A')], 10, true);
    expect(s.discount).toBe(3_000);
    expect(s.groups.reduce((a, g) => a + g.base, 0)).toBe(s.net);
    expect(s.net).toBe(27_003);
    expect(s.tax).toBe(s.groups.reduce((a, g) => a + g.tax, 0));
    expect(s.total).toBe(s.net + s.tax);
  });

  it('puts every line in H, without VAT, for an organisation that does not charge VAT', () => {
    const s = taxSummary([line(1, 1_000, 'B'), line(1, 500, 'C')], 0, false);
    expect(s.groups).toEqual([{ code: 'H', label: 'Régime synthétique', rate: 0, base: 1_500, tax: 0 }]);
    expect(lineGroup({ taxGroup: 'B' }, false)).toBe('H');
    expect(lineGroup({}, true)).toBe('B');
  });

  it('maps a catalogue rate to its group', () => {
    expect(productTaxGroup(18, true)).toBe('B');
    expect(productTaxGroup(10, true)).toBe('C');
    expect(productTaxGroup(0, true)).toBe('A');
    expect(productTaxGroup(18, false)).toBe('H');
  });
});

describe('tax groups on credit notes and conversions (PRO-138)', () => {
  it('credits each line in its own group, and keeps the invoice VAT when every line is credited', async () => {
    const { creditLines, creditTotals, invoiceChargedVat } = await import('@/lib/credit-note');
    const { splitDocument } = await import('@/lib/tax-groups');
    const inv = [{ id: 'a', desc: 'Conseil', unit: 'jour', qty: 2, price: 50_000, taxGroup: 'B' as const }, { id: 'b', desc: 'Livre', unit: 'unité', qty: 1, price: 20_000, taxGroup: 'A' as const }];
    const lines = creditLines(inv, { a: 2, b: 1 });
    expect(lines.map(l => l.taxGroup)).toEqual(['B', 'A']);
    const t = creditTotals(lines, { discountPct: 0 }, true);
    expect(t.tax).toBe(18_000);
    expect(t.total).toBe(138_000);
    // 18 % of the whole would read 138 000 as « without VAT » (it is not 120 000 + 21 600)
    expect(invoiceChargedVat({ amount: 138_000, discountPct: 0 }, inv, false)).toBe(true);
    expect(splitDocument(138_000, inv, 0, true)).toEqual({ ht: 120_000, tva: 18_000 });
  });

  it('splits a document without lines at 18 %, as before', async () => {
    const { splitDocument } = await import('@/lib/tax-groups');
    expect(splitDocument(118_000, [], 0, true)).toEqual(splitTtc(118_000, true));
    expect(splitDocument(118_000, [], 0, false)).toEqual({ ht: 118_000, tva: 0 });
  });
});
