import { describe, expect, it } from 'vitest';
import { creditNoteRef, invoiceRef, isIssuedLockedError, newDraftId } from '@/lib/invoice-number';

describe('invoice numbers', () => {
  it('shows the legal number of an issued invoice, the reference of a draft', () => {
    expect(invoiceRef({ id: 'BR-1A2B3C4D', number: 'FACT-2026-0007' })).toBe('FACT-2026-0007');
    expect(invoiceRef({ id: 'BR-1A2B3C4D' })).toBe('BR-1A2B3C4D');
    // Issued before the new series: number = old id
    expect(invoiceRef({ id: 'INV-0041', number: 'INV-0041' })).toBe('INV-0041');
    expect(creditNoteRef({ id: 'AV-0003', number: 'AV-2026-0001' })).toBe('AV-2026-0001');
    expect(creditNoteRef({ id: 'AV-0003' })).toBe('AV-0003');
  });

  it("gives drafts a reference that doesn't look like a legal number", () => {
    const ids = new Set(Array.from({ length: 200 }, newDraftId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^BR-[0-9A-F]{8}$/);
  });

  it('recognises the database refusing to delete an issued document', () => {
    expect(isIssuedLockedError({ code: 'BL002', message: 'issued_document_locked' })).toBe(true);
    expect(isIssuedLockedError({ message: 'issued_invoice_locked' })).toBe(true);
    expect(isIssuedLockedError({ code: 'BL001', message: 'solo_invoice_limit' })).toBe(false);
    expect(isIssuedLockedError(null)).toBe(false);
  });
});
