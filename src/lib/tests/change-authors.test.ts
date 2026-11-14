import { describe, expect, it } from 'vitest';
import { lastChangeLabel } from '@/lib/change-label';
import { paymentAuthor, paymentAuthorOptions } from '@/lib/sales-tables';

describe('lastChangeLabel', () => {
  const day = (d: string) => `<${d}>`;
  it('says when and by whom', () => {
    expect(lastChangeLabel({ updatedAt: '2026-11-12T10:00:00', updatedByName: 'Awa' }, day)).toBe('Modifié le <2026-11-12> par Awa');
    expect(lastChangeLabel({ updatedAt: '2026-11-12T10:00:00' }, day)).toBe('Modifié le <2026-11-12>');
  });
  it('says nothing without a date', () => {
    expect(lastChangeLabel({}, day)).toBeNull();
    expect(lastChangeLabel({ updatedAt: 'n/a', updatedByName: 'Awa' }, day)).toBeNull();
  });
});

describe('paymentAuthor', () => {
  it('names who recorded it; online payments come from Paystack', () => {
    expect(paymentAuthor({ source: 'manual', createdByName: 'Awa' })).toBe('Awa');
    expect(paymentAuthor({ source: 'online', createdByName: undefined })).toBe('En ligne');
    expect(paymentAuthor({ source: 'manual', createdByName: undefined })).toBe('Inconnu');
  });
  it('lists authors by name, then online and unknown', () => {
    expect(paymentAuthorOptions([
      { source: 'online' }, { source: 'manual', createdByName: 'Paul' }, { source: 'manual' },
      { source: 'manual', createdByName: 'Awa' }, { source: 'manual', createdByName: 'Paul' },
    ]).map(o => o.label)).toEqual(['Awa', 'Paul', 'En ligne', 'Inconnu']);
  });
});
