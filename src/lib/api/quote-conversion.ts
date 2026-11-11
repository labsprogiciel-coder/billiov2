import { createInvoice, fetchInvoiceIssue, newDraftId, removeInvoice, updateInvoice } from '@/lib/api/invoices';
import { fetchLineItems, saveLineItems, deleteLineItems } from '@/lib/api/line-items';
import { updateQuote } from '@/lib/api/quotes';
import { recordInvoiceIssuanceEntry } from '@/lib/api/accounting';
import type { Invoice, Quote } from '@/lib/schemas';
import { splitTtc } from '@/lib/vat';

/**
 * The invoice may or may not have been issued (the request failed and its
 * state couldn't be read back). Nothing was rolled back: the user should
 * reload and check before converting again.
 */
export class ConversionOutcomeUnknownError extends Error {
  readonly invoiceId: string;
  constructor(invoiceId: string, cause: unknown) {
    super(`quote conversion outcome unknown for invoice ${invoiceId}`, { cause });
    this.name = 'ConversionOutcomeUnknownError';
    this.invoiceId = invoiceId;
  }
}

/**
 * Turns a quote into a pending invoice with the same lines, then marks the
 * quote invoiced. The invoice is saved as a draft with its lines, the quote is
 * marked, and only then is the invoice issued: the database gives the legal
 * number at that point (PRO-141), so a failure before uses up no number, and
 * the draft and its lines are removed again so a retry doesn't leave a
 * duplicate behind.
 *
 * The invoice keeps the quote's stored amount, so a later change of tax
 * regime doesn't change what the client was quoted.
 */
export async function convertQuoteToInvoice(
  orgId: string,
  quote: Quote,
  opts: { canInvoiceTVA: boolean; clientName: string },
): Promise<{ invoice: Invoice; accountingOk: boolean }> {
  const today   = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  const quoteLines = await fetchLineItems(orgId, { quoteId: quote.id });
  const invId      = newDraftId();
  const draft: Invoice = {
    id: invId, subject: quote.subject, client: quote.client, issued: today, due: dueDate,
    amount: quote.amount, status: 'draft', discountPct: 0,
  };

  await createInvoice(orgId, draft);
  let quoteMarked = false;
  let issued: { firstIssuedAt?: string; number?: string } | null = null;
  try {
    await saveLineItems(orgId, quoteLines, { invoiceId: invId });
    await updateQuote(orgId, quote.id, { status: 'invoiced' });
    quoteMarked = true;
    issued = await updateInvoice(orgId, invId, { status: 'pending' });
  } catch (err) {
    // The issue may have committed even though its response was lost. An
    // issued invoice can't be removed, so keep it (and the quote marked).
    let stored: Awaited<ReturnType<typeof fetchInvoiceIssue>> = null;
    if (quoteMarked) {
      try {
        stored = await fetchInvoiceIssue(orgId, invId);
      } catch {
        // Can't tell whether it was issued: leave everything as it is
        throw new ConversionOutcomeUnknownError(invId, err);
      }
    }
    if (stored && stored.status !== 'draft') {
      issued = stored;
    } else {
      if (quoteMarked) await updateQuote(orgId, quote.id, { status: quote.status }).catch(e => console.error('[rollback] updateQuote failed:', e));
      await deleteLineItems(orgId, { invoiceId: invId }).catch(() => {});
      await removeInvoice(orgId, invId).catch(e => console.error('[rollback] removeInvoice failed:', e));
      throw err;
    }
  }
  const invoice: Invoice = {
    ...draft, status: 'pending', number: issued?.number,
    firstIssuedAt: issued?.firstIssuedAt ?? new Date().toISOString(),
  };

  const { ht: htAmount, tva: tvaAmount } = splitTtc(quote.amount, opts.canInvoiceTVA);
  let accountingOk = true;
  try {
    await recordInvoiceIssuanceEntry(orgId, { invoiceId: invId, htAmount, tvaAmount, date: today, clientName: opts.clientName });
  } catch (err) {
    console.error('[recordInvoiceIssuanceEntry] failed:', err);
    accountingOk = false;
  }

  return { invoice, accountingOk };
}
