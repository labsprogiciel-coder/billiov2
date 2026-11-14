import { describe, expect, it } from 'vitest';
import { ACCOUNTING_MENU, ROUTE_FEATURE, SALES_MENU, isLinkActive } from '@/lib/nav';

describe('isLinkActive', () => {
  it('matches the Facturation tab in the URL', () => {
    expect(isLinkActive('/invoices', '/invoices', '')).toBe(true);
    expect(isLinkActive('/invoices', '/invoices', '?tab=invoices')).toBe(true);
    expect(isLinkActive('/invoices', '/invoices', '?tab=quotes')).toBe(false);
    expect(isLinkActive('/invoices?tab=quotes', '/invoices', '?tab=quotes')).toBe(true);
    expect(isLinkActive('/invoices?tab=quotes', '/invoices', '')).toBe(false);
    expect(isLinkActive('/accounting/tax', '/accounting/tax', '')).toBe(true);
    expect(isLinkActive('/accounting/tax', '/accounting/journals', '')).toBe(false);
  });
});

describe('top bar menus', () => {
  it('list every accounting page once, with its plan gate', () => {
    const links = ACCOUNTING_MENU.flatMap(g => g.links);
    expect(links.map(l => l.to).sort()).toEqual(Object.keys(ROUTE_FEATURE).sort());
    for (const l of links) expect(l.feature).toBe(ROUTE_FEATURE[l.to]);
  });

  it('gate Devis and Paiements like the Facturation tabs', () => {
    expect(SALES_MENU.map(l => [l.label, l.feature])).toEqual([
      ['Factures', undefined], ['Devis', 'quotes'], ['Paiements', 'payments_mobilemoney'],
    ]);
  });
});
