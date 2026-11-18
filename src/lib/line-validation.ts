// Checks on invoice / quote lines before they are saved.

import type { LineItem } from '@/lib/schemas';

/**
 * Lines the user actually filled in; untouched blank rows are dropped. A row
 * whose quantity was changed counts as touched, so validation reports its
 * missing description instead of silently discarding it.
 */
export function filledLines(lines: LineItem[]): LineItem[] {
  return lines.filter(l => l.desc.trim() !== '' || l.price !== 0 || l.qty !== 1);
}

/** French error message, or null when the lines can be saved. */
export function lineItemsError(lines: LineItem[]): string | null {
  const filled = filledLines(lines);
  if (filled.length === 0) return 'Ajoutez au moins une ligne.';
  if (filled.some(l => l.desc.trim() === '')) return 'Chaque ligne doit avoir une description.';
  if (filled.some(l => l.qty <= 0)) return 'Les quantités doivent être supérieures à zéro.';
  if (filled.some(l => l.price < 0)) return 'Les prix ne peuvent pas être négatifs.';
  // DGI spec 2.24–2.25 (PRO-145): no line worth zero or less. Discounts are the invoice's discount;
  // other reductions go through a credit note (RRR)
  const zero = filled.find(l => l.qty * l.price <= 0);
  if (zero) return `La ligne « ${zero.desc.trim()} » a un montant nul : indiquez un prix.`;
  if (filled.reduce((s, l) => s + l.qty * l.price, 0) <= 0) return 'Le total doit être supérieur à zéro.';
  return null;
}
