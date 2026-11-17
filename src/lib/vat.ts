// VAT used on invoices, quotes, credit notes and supplier bills. Billio
// applies the standard OHADA/Burkina Faso rate of 18 %, and only for
// organisations under the RNI tax regime (others can't charge VAT).

export const VAT_RATE = 0.18;
export const VAT_LABEL = 'TVA (18 %)';

/** Whether the organisation may charge VAT. */
export function chargesVat(taxRegime: string | undefined): boolean {
  return taxRegime === 'RNI';
}

/** VAT due on a pre-tax amount (0 when VAT doesn't apply). */
export function vatOn(ht: number, applies: boolean): number {
  return applies ? Math.round(ht * VAT_RATE) : 0;
}

/** Splits a VAT-inclusive amount into pre-tax and VAT parts. */
export function splitTtc(ttc: number, applies: boolean): { ht: number; tva: number } {
  if (!applies) return { ht: ttc, tva: 0 };
  const ht = Math.round(ttc / (1 + VAT_RATE));
  return { ht, tva: ttc - ht };
}

/**
 * Whether a saved document included VAT, read from its stored total rather
 * than the organisation's current regime (which may have changed since it was
 * issued). Falls back to `fallback` when the total can't tell, e.g. an empty
 * document.
 */
export function documentHasVat(storedTotal: number, ht: number, fallback: boolean, withVatTotal?: number): boolean {
  // `withVatTotal`: what the document comes to with its VAT, when its lines have several rates (PRO-138)
  const withVat = withVatTotal ?? ht + vatOn(ht, true);
  if (!(storedTotal > 0) || withVat === ht) return fallback;
  return Math.abs(storedTotal - withVat) < Math.abs(storedTotal - ht);
}
