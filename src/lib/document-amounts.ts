// What a printed document adds up to (InvoicePDF), kept apart so it can be tested.

import { vatOn } from '@/lib/vat';
import { taxSummary } from '@/lib/tax-groups';
import type { LineItem } from '@/lib/schemas';

/**
 * Discount, VAT and total of a document. A credit note passes its stored total
 * (`storedTotal`): the total printed is that one, and the rounding left over
 * goes into the VAT (or the discount, without VAT), so a note whose total was
 * reconciled with the invoice, or that has only an amount, prints what it is.
 */
export function documentAmounts(subtotal: number, discountPct: number, showVat: boolean, storedTotal?: number) {
  let discountAmt = Math.round(subtotal * (discountPct / 100));
  let discountedSub = subtotal - discountAmt;
  let tax = vatOn(discountedSub, showVat);
  if (storedTotal !== undefined && storedTotal !== discountedSub + tax) {
    if (showVat) tax = storedTotal - discountedSub;
    else { discountedSub = storedTotal; discountAmt = subtotal - storedTotal; }
  }
  return { discountAmt, discountedSub, tax, total: discountedSub + tax };
}

/**
 * The same, per DGI tax group (PRO-138), from the document's lines. A credit note's stored total
 * is printed as it is: the leftover goes on the VAT of its largest taxed group (or on the discount,
 * without VAT).
 */
export function documentTaxes(lines: Pick<LineItem, 'qty' | 'price' | 'taxGroup'>[], discountPct: number, showVat: boolean, storedTotal?: number) {
  const s = taxSummary(lines, discountPct, showVat);
  let { discount, net, tax } = s;
  const groups = s.groups.map(g => ({ ...g }));
  if (storedTotal !== undefined && storedTotal !== net + tax) {
    const taxed = groups.filter(g => g.rate > 0);
    if (showVat && taxed.length > 0) {
      const gap = storedTotal - net - tax;
      taxed.reduce((a, b) => b.base > a.base ? b : a).tax += gap;
      tax += gap;
    } else {
      // Without VAT the leftover is a discount: shown on the totals, the groups keep their bases
      discount = s.subtotal - storedTotal; net = storedTotal;
      if (groups.length === 1) groups[0].base = storedTotal;
    }
  }
  return { subtotal: s.subtotal, discountAmt: discount, discountedSub: net, tax, total: net + tax, groups };
}
