// DGI tax groups (PRO-138): each invoice line carries one, and the VAT is totalled per group.
// Source: DGI technical specification v2.0 for business invoicing systems (note n°2025-0889, 2.15).

import type { LineItem } from '@/lib/schemas';

export const TAX_GROUP_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'] as const;
export type TaxGroupCode = typeof TAX_GROUP_CODES[number];

export interface TaxGroup { code: TaxGroupCode; label: string; /** VAT rate, 0 when the group carries none */ rate: number }

export const TAX_GROUPS: Record<TaxGroupCode, TaxGroup> = {
  A: { code: 'A', label: 'Exonéré', rate: 0 },
  B: { code: 'B', label: 'TVA taxable 1', rate: 0.18 },
  C: { code: 'C', label: 'TVA taxable 2', rate: 0.10 },
  D: { code: 'D', label: 'Exportation de produits taxables', rate: 0 },
  E: { code: 'E', label: 'TVA régime dérogatoire', rate: 0 },
  F: { code: 'F', label: 'TVA régime dérogatoire', rate: 0.18 },
  G: { code: 'G', label: 'TVA régime dérogatoire', rate: 0.10 },
  H: { code: 'H', label: 'Régime synthétique', rate: 0 },
  I: { code: 'I', label: 'Consignation d’emballage', rate: 0 },
  J: { code: 'J', label: 'Dépôts, garantie et caution', rate: 0 },
  K: { code: 'K', label: 'Débours', rate: 0 },
  L: { code: 'L', label: 'Taxe de développement touristique', rate: 0.10 },
  M: { code: 'M', label: 'Taxe de séjour hôtelier', rate: 0.10 },
  N: { code: 'N', label: 'PBA, droits fixes', rate: 0 },
  O: { code: 'O', label: 'Réservé', rate: 0 },
  P: { code: 'P', label: 'Réservé', rate: 0 },
};

/** The groups a user can pick on a line (the reserved ones are left out). */
export const SELECTABLE_GROUPS: TaxGroup[] = TAX_GROUP_CODES.filter(c => c !== 'O' && c !== 'P').map(c => TAX_GROUPS[c]);

export const isTaxGroup = (v: unknown): v is TaxGroupCode => typeof v === 'string' && (TAX_GROUP_CODES as readonly string[]).includes(v);

/** « B · 18 % », « A · Exonéré »: how a group is named in a picker or a column. */
export function groupShort(code: TaxGroupCode): string {
  const g = TAX_GROUPS[code];
  return g.rate > 0 ? `${code} · ${Math.round(g.rate * 100)} %` : `${code} · ${SHORT[code] ?? g.label}`;
}
const SHORT: Partial<Record<TaxGroupCode, string>> = {
  D: 'Export', E: 'Dérogatoire', H: 'Synthétique', I: 'Emballages', J: 'Cautions', N: 'PBA',
};

/** The group a new line gets: B for an organisation that charges VAT, H (synthetic regime) otherwise. */
export const defaultTaxGroup = (chargesVat: boolean): TaxGroupCode => chargesVat ? 'B' : 'H';

/** The group of a catalogue item, from its stored rate: 18 % → B, 10 % → C, none → A (exempt). */
export function productTaxGroup(ratePct: number, chargesVat: boolean): TaxGroupCode {
  if (!chargesVat) return 'H';
  if (ratePct >= 18) return 'B';
  if (ratePct >= 10) return 'C';
  return 'A';
}

/** The group a line is taxed in. An organisation that doesn't charge VAT has every line in H. */
export function lineGroup(line: Pick<LineItem, 'taxGroup'>, chargesVat: boolean): TaxGroupCode {
  if (!chargesVat) return 'H';
  return line.taxGroup ?? 'B';
}

export interface GroupTotal { code: TaxGroupCode; label: string; rate: number; /** after the discount */ base: number; tax: number }
export interface TaxSummary {
  subtotal: number; discount: number; net: number; tax: number; total: number;
  /** One row per group used, in code order */
  groups: GroupTotal[];
}

/**
 * Totals of a document, per tax group. The discount is shared out between the groups in proportion
 * to their amounts (the leftover franc on the largest group), so the discount and the net are the
 * same as with one rate; the VAT of each group is rounded on its own.
 */
export function taxSummary(lines: Pick<LineItem, 'qty' | 'price' | 'taxGroup'>[], discountPct: number, chargesVat: boolean): TaxSummary {
  const gross = new Map<TaxGroupCode, number>();
  for (const l of lines) {
    // a line worth nothing (an empty row of a form) adds no group
    if (l.qty * l.price === 0) continue;
    const code = lineGroup(l, chargesVat);
    gross.set(code, (gross.get(code) ?? 0) + l.qty * l.price);
  }
  const subtotal = [...gross.values()].reduce((s, v) => s + v, 0);
  const discount = Math.round(subtotal * (discountPct / 100));
  const codes = TAX_GROUP_CODES.filter(c => gross.has(c));
  const shares = codes.map(c => subtotal > 0 ? Math.round(discount * (gross.get(c)! / subtotal)) : 0);
  if (codes.length > 0) {
    const largest = codes.reduce((best, c, i) => gross.get(c)! > gross.get(codes[best])! ? i : best, 0);
    shares[largest] += discount - shares.reduce((s, v) => s + v, 0);
  }
  const groups = codes.map((code, i) => {
    const base = gross.get(code)! - shares[i];
    const rate = TAX_GROUPS[code].rate;
    return { code, label: TAX_GROUPS[code].label, rate, base, tax: Math.round(base * rate) };
  });
  const net = subtotal - discount;
  const tax = groups.reduce((s, g) => s + g.tax, 0);
  return { subtotal, discount, net, tax, total: net + tax, groups };
}

/**
 * Splits a VAT-inclusive amount (a credit note, a quote's total) into pre-tax and VAT parts, in the
 * document's own proportions. With one group this is the usual split at that group's rate.
 */
export function splitByGroups(ttc: number, summary: TaxSummary): { ht: number; tva: number } {
  if (summary.tax === 0 || summary.total === 0) return { ht: ttc, tva: 0 };
  if (summary.groups.length === 1) {
    const ht = Math.round(ttc / (1 + summary.groups[0].rate));
    return { ht, tva: ttc - ht };
  }
  if (ttc === summary.total) return { ht: summary.net, tva: summary.tax };
  const ht = Math.round(ttc * (summary.net / summary.total));
  return { ht, tva: ttc - ht };
}

/**
 * The VAT rows of a totals block. One group: one row, « TVA (18 %) » as before. Several: one row per
 * group, « TVA 18 % · B », « Exonéré · A », so an exempt line is shown as such (CGI art. 562).
 */
export function vatRows(groups: GroupTotal[]): { key: string; label: string; amount: number }[] {
  const name = (g: GroupTotal) => g.rate > 0 ? `TVA ${Math.round(g.rate * 100)} %` : g.code === 'H' ? 'Sans TVA' : g.code === 'A' ? 'Exonéré' : g.label;
  if (groups.length === 1) {
    const g = groups[0];
    return [{ key: g.code, label: g.rate > 0 ? `TVA (${Math.round(g.rate * 100)} %)` : `TVA (${name(g).toLowerCase()})`, amount: g.tax }];
  }
  return groups.map(g => ({ key: g.code, label: `${name(g)} · ${g.code}`, amount: g.tax }));
}

/**
 * Pre-tax and VAT parts of a stored total, from the document's lines; a document saved without
 * lines is split at the single rate, as before.
 */
export function splitDocument(ttc: number, lines: Pick<LineItem, 'qty' | 'price' | 'taxGroup'>[], discountPct: number, chargesVat: boolean): { ht: number; tva: number } {
  const s = taxSummary(lines, discountPct, chargesVat);
  if (s.total <= 0) {
    if (!chargesVat) return { ht: ttc, tva: 0 };
    const ht = Math.round(ttc / (1 + TAX_GROUPS.B.rate));
    return { ht, tva: ttc - ht };
  }
  return splitByGroups(ttc, s);
}
