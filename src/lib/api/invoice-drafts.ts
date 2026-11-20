// Saving and issuing from the full-page editor (PRO-167). Same order as the
// side panel before it (PRO-141): the draft and its lines are saved first,
// then the invoice is issued and the database gives the legal number, so a
// failure before that uses up no number.

import { createInvoice, fetchInvoiceIssue, newDraftId, removeInvoice, updateInvoice } from '@/lib/api/invoices';
import { deleteLineItems, saveLineItems } from '@/lib/api/line-items';
import { filledLines } from '@/lib/line-validation';
import type { Invoice, LineItem } from '@/lib/schemas';
import type { RichDoc } from '@/lib/rich-text';

/** The draft was issued meanwhile (elsewhere): the editor's changes were not saved. */
export class DraftIssuedError extends Error {
  readonly invoiceId: string;
  constructor(invoiceId: string) { super(`invoice ${invoiceId} is no longer a draft`); this.name = 'DraftIssuedError'; this.invoiceId = invoiceId; }
}

export interface DraftFields {
  client: string;
  subject: string;
  issued: string;
  due: string;
  discountPct: number;
  /** TTC of the lines, after discount and VAT */
  amount: number;
  /** Notes and conditions, already cleaned; null for none */
  notes: RichDoc | null;
}

/**
 * Creates the draft (no `id`) or updates it, and replaces its lines. A new
 * draft whose lines fail to save is removed again, so a retry doesn't leave a
 * draft without lines behind. Returns the draft as stored.
 */
export async function saveInvoiceDraft(orgId: string, opts: {
  id?: string;
  fields: DraftFields;
  lines: LineItem[];
  /** For a new draft: who is « Responsable » (the database checks it), e.g. the quote's */
  ownerId?: string;
}): Promise<Invoice> {
  const { fields } = opts;
  const subject = fields.subject.trim() || 'Facture sans titre';
  const lines = filledLines(opts.lines);
  if (!opts.id) {
    const id = newDraftId();
    const draft: Invoice = { id, subject, client: fields.client, issued: fields.issued, due: fields.due, amount: fields.amount, status: 'draft', discountPct: fields.discountPct, notes: fields.notes ?? undefined };
    const stored = await createInvoice(orgId, { ...draft, ownerId: opts.ownerId });
    try {
      await saveLineItems(orgId, lines, { invoiceId: id });
    } catch (err) {
      await removeInvoice(orgId, id).catch(e => console.error('[rollback] removeInvoice failed:', e));
      throw err;
    }
    return { ...draft, ownerId: stored.ownerId, ownerName: stored.ownerName };
  }
  // Only while it is still a draft: issued meanwhile (another tab or person), nothing is written
  try {
    await updateInvoice(orgId, opts.id, { subject, client: fields.client, issued: fields.issued, due: fields.due, amount: fields.amount, discountPct: fields.discountPct, notes: fields.notes }, { onlyDraft: true });
  } catch (err) {
    const stored = await fetchInvoiceIssue(orgId, opts.id).catch(() => null);
    if (stored && stored.status !== 'draft') throw new DraftIssuedError(opts.id);
    throw err;
  }
  // Issued meanwhile between the header and the lines: the database refuses the lines, say so plainly
  try {
    await deleteLineItems(orgId, { invoiceId: opts.id });
    await saveLineItems(orgId, lines, { invoiceId: opts.id });
  } catch (err) {
    const stored = await fetchInvoiceIssue(orgId, opts.id).catch(() => null);
    if (stored && stored.status !== 'draft') throw new DraftIssuedError(opts.id);
    throw err;
  }
  return { id: opts.id, subject, client: fields.client, issued: fields.issued, due: fields.due, amount: fields.amount, status: 'draft', discountPct: fields.discountPct, notes: fields.notes ?? undefined };
}

/**
 * Issues a saved draft. When the response is lost, reads the invoice back:
 * an issue that committed keeps its number. Throws when it wasn't issued.
 */
export async function issueSavedDraft(orgId: string, id: string, amount: number): Promise<{ number?: string; firstIssuedAt?: string; issuedByName?: string }> {
  try {
    return await updateInvoice(orgId, id, { status: 'pending', amount });
  } catch (err) {
    const stored = await fetchInvoiceIssue(orgId, id).catch(() => null);
    if (!stored || stored.status === 'draft') throw err;
    return stored;
  }
}
