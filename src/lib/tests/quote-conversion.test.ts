import { beforeEach, describe, expect, it, vi } from 'vitest';

// The conversion's database calls, replaced so each failure can be staged
const api = vi.hoisted(() => ({
  createInvoice: vi.fn(), updateInvoice: vi.fn(), fetchInvoiceIssue: vi.fn(), removeInvoice: vi.fn(),
  fetchLineItems: vi.fn(), saveLineItems: vi.fn(), deleteLineItems: vi.fn(),
  updateQuote: vi.fn(), recordInvoiceIssuanceEntry: vi.fn(),
}));
vi.mock('@/lib/api/invoices', () => ({
  createInvoice: api.createInvoice, updateInvoice: api.updateInvoice, fetchInvoiceIssue: api.fetchInvoiceIssue,
  removeInvoice: api.removeInvoice, newDraftId: () => 'BR-TEST',
}));
vi.mock('@/lib/api/line-items', () => ({ fetchLineItems: api.fetchLineItems, saveLineItems: api.saveLineItems, deleteLineItems: api.deleteLineItems }));
vi.mock('@/lib/api/quotes', () => ({ updateQuote: api.updateQuote }));
vi.mock('@/lib/api/accounting', () => ({ recordInvoiceIssuanceEntry: api.recordInvoiceIssuanceEntry }));

import { ConversionOutcomeUnknownError, convertQuoteToInvoice } from '@/lib/api/quote-conversion';
import type { Quote } from '@/lib/schemas';

const quote = { id: 'DEV-1', subject: 'Audit', client: 'TK', amount: 118000, status: 'accepted', ownerId: 'u-awa', ownerName: 'Awa' } as unknown as Quote;
const opts = { canInvoiceTVA: true, clientName: 'TK' };

beforeEach(() => {
  Object.values(api).forEach(f => f.mockReset());
  api.fetchLineItems.mockResolvedValue([]);
  // Like the database: returns the saved draft, owned by the member named
  api.createInvoice.mockImplementation(async (_org: string, p: Record<string, unknown>) => ({ ...p, ownerName: p.ownerId === 'u-awa' ? 'Awa' : undefined }));
  for (const f of [api.saveLineItems, api.updateQuote, api.deleteLineItems, api.removeInvoice, api.recordInvoiceIssuanceEntry]) f.mockResolvedValue(undefined);
});

describe('convertQuoteToInvoice', () => {
  it('saves a draft, marks the quote, then issues it with the number from the database', async () => {
    api.updateInvoice.mockResolvedValue({ number: 'FACT-2026-0001', firstIssuedAt: '2026-11-11T10:00:00Z' });
    const { invoice } = await convertQuoteToInvoice('org', quote, opts);
    expect(api.createInvoice.mock.calls[0][1]).toMatchObject({ id: 'BR-TEST', status: 'draft', ownerId: 'u-awa' });
    // The invoice keeps the quote's « Responsable » (PRO-172)
    expect(invoice).toMatchObject({ status: 'pending', number: 'FACT-2026-0001', ownerId: 'u-awa', ownerName: 'Awa' });
  });

  it('keeps an invoice whose issue committed although the response was lost', async () => {
    api.updateInvoice.mockRejectedValue(new Error('network'));
    api.fetchInvoiceIssue.mockResolvedValue({ status: 'pending', number: 'FACT-2026-0002' });
    const { invoice } = await convertQuoteToInvoice('org', quote, opts);
    expect(invoice.number).toBe('FACT-2026-0002');
    expect(api.removeInvoice).not.toHaveBeenCalled();
    expect(api.updateQuote).toHaveBeenCalledTimes(1);   // marked invoiced, not restored
  });

  it('rolls back when the invoice is still a draft', async () => {
    api.updateInvoice.mockRejectedValue(new Error('solo_invoice_limit'));
    api.fetchInvoiceIssue.mockResolvedValue({ status: 'draft' });
    await expect(convertQuoteToInvoice('org', quote, opts)).rejects.toThrow('solo_invoice_limit');
    expect(api.updateQuote).toHaveBeenLastCalledWith('org', 'DEV-1', { status: 'accepted' });
    expect(api.removeInvoice).toHaveBeenCalledWith('org', 'BR-TEST');
  });

  it("changes nothing when it can't tell whether the invoice was issued", async () => {
    api.updateInvoice.mockRejectedValue(new Error('network'));
    api.fetchInvoiceIssue.mockRejectedValue(new Error('network'));
    await expect(convertQuoteToInvoice('org', quote, opts)).rejects.toBeInstanceOf(ConversionOutcomeUnknownError);
    expect(api.updateQuote).toHaveBeenCalledTimes(1);
    expect(api.deleteLineItems).not.toHaveBeenCalled();
    expect(api.removeInvoice).not.toHaveBeenCalled();
  });
});
