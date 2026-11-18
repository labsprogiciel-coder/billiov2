import { describe, expect, it } from 'vitest';
import { cashReceiptStamp } from '@/lib/tax-bf';
import { cashStampMention } from '@/lib/amount-in-words';

describe('timbre quittance (CGI art. 519), PRO-142 mention s', () => {
  it('follows the scale, bounds included', () => {
    expect([999, 1000, 5000, 5001, 10000, 10001, 50000].map(cashReceiptStamp)).toEqual([0, 30, 30, 50, 50, 100, 100]);
  });
  it('adds 50 F per started block of 50 000 F above 50 000 F', () => {
    expect(cashReceiptStamp(50001)).toBe(150);
    expect(cashReceiptStamp(100000)).toBe(150);
    expect(cashReceiptStamp(100001)).toBe(200);
    expect(cashReceiptStamp(118000)).toBe(200);
    expect(cashReceiptStamp(13250001)).toBe(100 + 50 * 265);
  });
  it('prints the mention only when a stamp is due', () => {
    expect(cashStampMention(118000)).toBe('Montant timbre quittance en cas de règlement en espèces : 200 F CFA.');
    expect(cashStampMention(500)).toBeNull();
  });
});
