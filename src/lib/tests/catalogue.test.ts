import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/schemas';
import { catalogueCsvRows, catalogueFigures } from '@/lib/catalogue';

const item = (id: string, price: number, used: number, sku = 'X'): Product =>
  ({ id, name: id, sku, type: 'service', unit: 'heure', price, tax: 18, used, ico: '', color: '' });

describe('catalogueFigures', () => {
  it('finds the most used item, the revenue and the items without a price', () => {
    const f = catalogueFigures([item('a', 1000, 3), item('b', 500, 10), item('c', 0, 4)]);
    expect(f).toMatchObject({ count: 3, revenue: 8000, noPrice: 1 });
    expect(f.top?.id).toBe('b');
  });
  it('has no top item when nothing was used', () => {
    expect(catalogueFigures([item('a', 1, 0)]).top).toBeUndefined();
  });
});

describe('catalogueCsvRows', () => {
  it('leaves the placeholder code empty', () => {
    expect(catalogueCsvRows([item('a', 10, 1, '—')])[0]).toEqual(['', 'a', 'Service', 'heure', 10, 18, 1]);
  });
});
