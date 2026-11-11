import { describe, expect, it } from 'vitest';
import { invoiceLimitReached, isInvoiceLimitError, issuedThisMonth } from '@/lib/invoice-limit';

const now = new Date('2026-11-15T10:00:00Z');
const inv = (status: 'draft' | 'pending' | 'paid' | 'overdue', firstIssuedAt?: string, issued = '2026-11-02') =>
  ({ status, issued, firstIssuedAt });

describe('issuedThisMonth', () => {
  it('counts invoices first issued this UTC month, not drafts', () => {
    expect(issuedThisMonth([
      inv('pending', '2026-11-01T00:00:00Z'), inv('paid', '2026-11-14T23:59:00Z'), inv('overdue', '2026-11-03T08:00:00Z'),
      inv('draft'), inv('pending', '2026-10-31T23:59:59Z'),
    ], now)).toBe(3);
  });

  it('goes by the issue timestamp, not the (editable) invoice date', () => {
    expect(issuedThisMonth([inv('pending', '2026-11-05T09:00:00Z', '2026-09-01')], now)).toBe(1);
    expect(issuedThisMonth([inv('pending', '2026-10-05T09:00:00Z', '2026-11-20')], now)).toBe(0);
  });

  it('still counts an issued invoice that went back to draft', () => {
    expect(issuedThisMonth([inv('draft', '2026-11-05T09:00:00Z')], now)).toBe(1);
  });

  it('falls back to the invoice date for invoices without a database timestamp', () => {
    expect(issuedThisMonth([inv('pending', undefined, '2026-11-15')], now)).toBe(1);
  });
});

describe('invoiceLimitReached', () => {
  const five = Array.from({ length: 5 }, () => inv('pending', '2026-11-10T10:00:00Z'));
  it('stops Solo at 5 issued invoices a month', () => {
    expect(invoiceLimitReached('solo', five.slice(0, 4), now)).toBe(false);
    expect(invoiceLimitReached('solo', five, now)).toBe(true);
  });
  it('never limits paid plans', () => {
    expect(invoiceLimitReached('business', [...five, ...five], now)).toBe(false);
  });
});

describe('isInvoiceLimitError', () => {
  it('recognises the database error', () => {
    expect(isInvoiceLimitError({ message: 'solo_invoice_limit', code: 'P0001' })).toBe(true);
    expect(isInvoiceLimitError(new Error('network'))).toBe(false);
    expect(isInvoiceLimitError({ code: 'BL001', message: 'anything' })).toBe(true);
    expect(isInvoiceLimitError({ code: 'P0001', message: 'other error' })).toBe(false);
    expect(isInvoiceLimitError(null)).toBe(false);
  });
});
