// Figures above the catalogue table (PRO-170).

import type { Product } from '@/lib/schemas';

export interface CatalogueFigures {
  count: number;
  /** The item on the most invoice and quote lines. */
  top?: Product;
  /** Price × times used: what the catalogue items brought in at their current price. */
  revenue: number;
  /** Items at 0: they make zero-amount lines (PRO-145). */
  noPrice: number;
}

export function catalogueFigures(products: Product[]): CatalogueFigures {
  let top: Product | undefined;
  for (const p of products) if (p.used > 0 && (!top || p.used > top.used)) top = p;
  return {
    count: products.length,
    top,
    revenue: products.reduce((s, p) => s + p.price * p.used, 0),
    noPrice: products.filter(p => !(p.price > 0)).length,
  };
}

/** The catalogue as CSV rows, for the « Exporter » button. */
export function catalogueCsvRows(products: Product[]): (string | number)[][] {
  return products.map(p => [p.sku === '—' ? '' : p.sku, p.name, p.type === 'service' ? 'Service' : 'Produit', p.unit, p.price, p.tax, p.used]);
}
export const CATALOGUE_CSV_HEADER = ['Code', 'Article', 'Type', 'Unité', 'Prix HT (F CFA)', 'TVA (%)', 'Utilisations'];
