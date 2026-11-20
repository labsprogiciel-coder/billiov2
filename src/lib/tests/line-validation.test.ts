import { describe, it, expect } from 'vitest';
import { filledLines, lineItemsError } from '@/lib/line-validation';
import type { LineItem } from '@/lib/schemas';

const line = (desc: string, qty: number, price: number): LineItem => ({ id: desc + qty + price, desc, unit: 'unité', qty, price });

describe('filledLines', () => {
  it('drops untouched blank rows', () => {
    expect(filledLines([line('', 1, 0), line('Conseil', 1, 1000)]).map(l => l.desc)).toEqual(['Conseil']);
  });

  it('keeps blank rows whose quantity was changed, so validation reports them', () => {
    expect(filledLines([line('', 3, 0)])).toHaveLength(1);
    expect(lineItemsError([line('Conseil', 1, 1000), line('', 3, 0)])).toBe('Chaque ligne doit avoir une description.');
  });
});

describe('lineItemsError', () => {
  it('accepts complete lines, ignoring blank rows', () => {
    expect(lineItemsError([line('Conseil', 2, 50000), line('', 1, 0)])).toBeNull();
  });

  it('requires at least one line', () => {
    expect(lineItemsError([line('', 1, 0)])).toBe('Ajoutez au moins une ligne.');
  });

  it('requires a description on priced lines', () => {
    expect(lineItemsError([line('', 1, 250000)])).toBe('Chaque ligne doit avoir une description.');
  });

  it('rejects zero quantities, negative prices and a zero total', () => {
    expect(lineItemsError([line('A', 0, 1000)])).toMatch(/quantités/);
    expect(lineItemsError([line('A', 1, -5)])).toMatch(/négatifs/);
    expect(lineItemsError([line('A', 1, 0)])).toBe('La ligne « A » a un montant nul : indiquez un prix.');
  });

  it('refuses a line worth zero even when the total is positive, naming it (PRO-145)', () => {
    expect(lineItemsError([line('Conseil', 1, 50000), line('Offert', 2, 0)])).toBe('La ligne « Offert » a un montant nul : indiquez un prix.');
  });
});
