// Credit notes (« factures d'avoir », PRO-168 and PRO-143): their natures, and
// what the invoice editor computes in credit note mode. Kept free of React so
// it can be tested.

import { TAX_GROUPS, defaultTaxGroup, taxSummary } from '@/lib/tax-groups';
import { filledLines } from '@/lib/line-validation';
import { documentHasVat, splitTtc } from '@/lib/vat';
import { editorTotals, type EditorTotals } from '@/lib/invoice-editor';
import type { CreditNote, Invoice, LineItem } from '@/lib/schemas';
import type { JournalEntry } from '@/lib/accounting-data';

export type CreditNature = NonNullable<CreditNote['nature']>;
export type CreditLine = CreditNote['lines'][number];

export const CREDIT_NATURES: readonly { code: CreditNature; label: string; hint: string }[] = [
  { code: 'COR', label: 'Correction', hint: 'Une erreur de prix, de quantité ou de mention' },
  { code: 'RAN', label: 'Annulation', hint: 'La facture est annulée avant tout paiement ou livraison' },
  { code: 'RAM', label: 'Après paiement ou livraison', hint: 'Retour, prestation non rendue, après paiement ou livraison' },
  { code: 'RRR', label: 'Rabais, remise, ristourne', hint: 'Un geste commercial accordé après coup' },
];

export const natureLabel = (code: CreditNature): string => {
  const n = CREDIT_NATURES.find(x => x.code === code);
  return n ? `${n.code} · ${n.label}` : code;
};

/**
 * How much of each invoice line is left to credit, by line id: what was
 * invoiced less what issued credit notes already credited on that line.
 * Credit notes from before PRO-168 have no lines: they only count in the
 * amount check (creditableAmount), not here.
 */
export function creditableQty(invoiceLines: LineItem[], issued: Pick<CreditNote, 'lines'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of filledLines(invoiceLines)) out[l.id] = l.qty;
  for (const cn of issued) {
    for (const l of cn.lines) if (l.sourceId && l.sourceId in out) out[l.sourceId] = Math.max(0, out[l.sourceId] - l.qty);
  }
  return out;
}

/** The lines a credit note carries: the invoice lines with a quantity to credit, linked to their source. */
export function creditLines(invoiceLines: LineItem[], qty: Record<string, number>): CreditLine[] {
  return filledLines(invoiceLines)
    .filter(l => (qty[l.id] ?? 0) > 0)
    .map(l => ({ id: crypto.randomUUID(), desc: l.desc, unit: l.unit ?? 'unité', qty: qty[l.id], price: l.price, productId: l.productId, taxGroup: l.taxGroup, sourceId: l.id }));
}

/** Whether the invoice charged VAT, read from its stored total (a later change of regime doesn't matter). */
export function invoiceChargedVat(invoice: Pick<Invoice, 'amount' | 'discountPct'>, invoiceLines: LineItem[], regimeChargesVat: boolean): boolean {
  const withVat = taxSummary(filledLines(invoiceLines), invoice.discountPct ?? 0, true);
  return documentHasVat(invoice.amount, withVat.net, regimeChargesVat, withVat.total);
}

/**
 * Whether the invoice's sales entry (piece VE-<id>) carried VAT (account 443
 * credited); null when it isn't found. For an invoice without stored lines,
 * whose VAT can't be read from its lines and total: the regime may have
 * changed since it was issued.
 */
export function vatFromSalesEntry(entries: Pick<JournalEntry, 'piece' | 'lines'>[], invoiceId: string): boolean | null {
  const sale = entries.find(e => e.piece === `VE-${invoiceId}`);
  if (!sale) return null;
  return sale.lines.some(l => l.acct.startsWith('443') && l.c > 0);
}

/**
 * The VAT of an amount-only credit note: the invoice's sales entry when it
 * can be read, else what the user said; null while unknown (the note can't be
 * issued: today's regime may not be the one the invoice was issued under).
 */
export function amountOnlyVat(entryVat: boolean | null, choice: boolean | null): boolean | null {
  return entryVat ?? choice;
}

/**
 * The one line an amount-only note keeps: its amount before tax. Only once
 * its VAT is known; while « À préciser » it keeps none, so a reopened draft is
 * still « À préciser » rather than read as « Non ».
 */
export function amountOnlyLines(opts: { total: number; net: number; vatKnown: boolean; desc: string }): CreditLine[] {
  if (opts.total <= 0 || !opts.vatKnown) return [];
  return [{ id: 'montant', desc: opts.desc, unit: 'forfait', qty: 1, price: opts.net }];
}

/** What a reopened amount-only draft said about VAT: its line holds the amount before tax; none, unknown. */
export function vatChoiceFromDraft(cn: Pick<CreditNote, 'lines' | 'amount'>): boolean | null {
  const l = cn.lines.find(x => !x.sourceId);
  return l ? l.price * l.qty !== cn.amount : null;
}

/**
 * Whether a credit note carried VAT, from its own accounting entry (piece
 * AV-<id>, 443 debited); null when not found. For older amount-only notes,
 * issued with the regime of their day.
 */
export function vatFromCreditEntry(entries: Pick<JournalEntry, 'piece' | 'lines'>[], creditNoteId: string): boolean | null {
  const e = entries.find(x => x.piece === `AV-${creditNoteId}`);
  if (!e) return null;
  return e.lines.some(l => l.acct.startsWith('443') && l.d > 0);
}

/**
 * The VAT to print for a credit note without lines (older ones). Only its
 * own entry is certain: the invoice's sales entry, or the invoice as shown,
 * are an estimate (the regime of the note's day may have differed).
 */
export function legacyCreditVat(entries: Pick<JournalEntry, 'piece' | 'lines'>[] | null, creditNoteId: string, invoiceId: string, fallback: boolean): { vat: boolean; estimated: boolean } {
  const own = entries ? vatFromCreditEntry(entries, creditNoteId) : null;
  if (own !== null) return { vat: own, estimated: false };
  const sale = entries ? vatFromSalesEntry(entries, invoiceId) : null;
  return { vat: sale ?? fallback, estimated: true };
}

/** Totals of the credit note: the invoice's discount and VAT applied to the credited lines. */
export function creditTotals(lines: CreditLine[], invoice: { discountPct?: number }, chargedVat: boolean): EditorTotals {
  return editorTotals(lines, invoice.discountPct ?? 0, chargedVat);
}

/**
 * The credit that empties every line takes exactly what is left of the
 * invoice. Discount and VAT are rounded per credit note, so successive partial
 * credits can end a franc or two away from the invoice total. Only that small
 * gap (`tolerance`) is absorbed, in the VAT (or the discount, without VAT); a
 * larger gap (older amount-only credit notes) is left for the checks to refuse.
 */
export function reconcileFinalCredit(t: EditorTotals, opts: { emptiesInvoice: boolean; left: number; chargedVat: boolean; tolerance: number }): EditorTotals {
  const diff = opts.left - t.total;
  if (!opts.emptiesInvoice || diff === 0 || Math.abs(diff) > opts.tolerance) return t;
  const taxed = t.groups.filter(g => g.rate > 0);
  const onGroup = taxed.length ? taxed.reduce((a, b) => b.base > a.base ? b : a).code : null;
  return opts.chargedVat
    ? { ...t, tax: t.tax + diff, total: opts.left, toPay: opts.left, groups: t.groups.map(g => g.code === onGroup ? { ...g, tax: g.tax + diff } : g) }
    : { ...t, discount: t.discount - diff, net: t.net + diff, total: opts.left, toPay: opts.left };
}

/** A credit note on an invoice without stored lines: an amount TTC, split into HT and VAT. */
export function amountTotals(amount: number, chargedVat: boolean): EditorTotals {
  const { ht, tva } = splitTtc(amount, chargedVat);
  const g = TAX_GROUPS[defaultTaxGroup(chargedVat)];
  return { subtotal: ht, discount: 0, net: ht, tax: tva, total: amount, withholding: null, toPay: amount, groups: [{ code: g.code, label: g.label, rate: g.rate, base: ht, tax: tva }] };
}

/**
 * The most a new credit note may amount to: the invoice total less the issued
 * credit notes. A full credit of every line that is left gives exactly this.
 */
export function creditableAmount(invoice: Pick<Invoice, 'amount'>, issued: Pick<CreditNote, 'amount'>[]): number {
  return Math.max(0, invoice.amount - issued.reduce((s, c) => s + c.amount, 0));
}

/** Why the credit note can't be issued yet, or null. `paid`: completed payments on the invoice. */
export function creditIssueProblem(opts: { nature?: CreditNature | ''; reason: string; total: number; max: number; paid: number }): string | null {
  if (!opts.nature) return 'Choisissez la nature de l’avoir.';
  if (opts.nature === 'RAN' && opts.paid > 0) return 'RAN (annulation) n’est possible que si la facture n’a reçu aucun paiement : choisissez RAM.';
  if (!opts.reason.trim()) return 'Indiquez le motif de l’avoir.';
  if (opts.total <= 0) return 'Indiquez au moins une quantité à créditer.';
  if (opts.total > opts.max) return 'Cet avoir dépasse ce qui reste à créditer sur la facture.';
  return null;
}
