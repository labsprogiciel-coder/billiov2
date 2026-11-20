// Copies of an issued invoice (PRO-144, DGI spec 2.11, 2.18, 3 f): every PDF after the original says
// « DUPLICATA », keeps the number, and shows the seller and client as they were at issue.

import type { Invoice } from '@/lib/schemas';

type Snapshot = NonNullable<Invoice['issueSnapshot']>;

const text = (v: unknown): string | undefined => typeof v === 'string' && v.trim() !== '' ? v : undefined;

/**
 * Keeps `base`, with every field the snapshot holds put back as it was at issue, empty ones
 * included: a phone added since the issue stays off the copy. A field the snapshot doesn't hold
 * (taken before it was recorded) keeps today's value.
 */
function withSnapshot<T extends object>(base: T, part: Record<string, unknown> | null | undefined, fields: Record<string, string>): T {
  if (!part) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, column] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(part, column)) out[key] = text(part[column]);
  }
  return out as T;
}

const SELLER_FIELDS = {
  name: 'name', address: 'address', city: 'city', country: 'country', email: 'email', phone: 'phone',
  ifu: 'ifu', rccm: 'rccm', taxRegime: 'tax_regime', divisionFiscale: 'division_fiscale', cadastralRef: 'cadastral_ref',
};
const CLIENT_FIELDS = {
  name: 'name', contact: 'contact', email: 'email', phone: 'phone', city: 'city', country: 'country',
  ifu: 'ifu', rccm: 'rccm', taxRegime: 'tax_regime', fiscalDivision: 'fiscal_division', clientType: 'client_type',
  // The withholding at issue sets the amount payable: a copy keeps it
  withholdingScenario: 'withholding_scenario',
};

/** The seller and client to print on an issued invoice: as they were at issue, when the database took them. */
export function partiesAtIssue<B extends object, C extends object>(invoice: Pick<Invoice, 'issueSnapshot'>, biz: B, client: C): { biz: B; client: C } {
  const snap: Snapshot | undefined = invoice.issueSnapshot;
  return {
    biz: withSnapshot(biz, snap?.seller, SELLER_FIELDS),
    client: withSnapshot(client, snap?.client, CLIENT_FIELDS),
  };
}

/** The mention a copy carries, under the title. */
export const duplicateMention = (ref: string, issuedOn: string) => `Duplicata de la facture ${ref} émise le ${issuedOn}`;

/**
 * The PDF of an invoice: a draft as is; an issued invoice as its original the first time, as a
 * « DUPLICATA » after. The original is drawn before it is claimed, so a failed render leaves it
 * to the next try; if another download claimed it meanwhile, this one is drawn again as a copy.
 */
export async function originalOrCopy(
  invoice: Pick<Invoice, 'status' | 'originalPrintedAt'>,
  claim: () => Promise<boolean>,
  render: (duplicate: boolean) => Promise<Blob>,
): Promise<Blob> {
  if (invoice.status === 'draft') return render(false);
  if (invoice.originalPrintedAt) return render(true);
  const original = await render(false);
  return (await claim()) ? original : render(true);
}
