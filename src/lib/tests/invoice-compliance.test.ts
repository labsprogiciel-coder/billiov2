import { describe, expect, it } from 'vitest';
import { clientIssues, sellerIssues, type SellerInfo } from '@/lib/invoice-compliance';
import type { PaymentSettings } from '@/lib/api/payment-settings';

const complete: SellerInfo = {
  name: 'Studio Wend', address: 'Av. Kwame Nkrumah', city: 'Ouagadougou', country: 'Burkina Faso',
  ifu: '00012345B', rccm: 'BF-OUA-2021-B-1234', taxRegime: 'RNI', divisionFiscale: 'DME Centre',
};
// Only the bank fields matter here (importing the real defaults loads the Supabase client)
const noBank = { methodBankEnabled: false, methodBankIban: '' } as PaymentSettings;
const bank = { ...noBank, methodBankEnabled: true, methodBankIban: 'BF00 0000' };
const keys = (l: { key: string }[]) => l.map(i => i.key);

describe('sellerIssues', () => {
  it('is empty when every mention is filled in', () => {
    expect(sellerIssues(complete, bank)).toEqual([]);
  });

  it('lists each missing mention with where to fix it', () => {
    const issues = sellerIssues({ ...complete, ifu: ' ', rccm: '', taxRegime: '', divisionFiscale: '' }, bank);
    expect(keys(issues)).toEqual(['seller-ifu', 'seller-rccm', 'seller-regime', 'seller-division']);
    expect(issues.every(i => i.fix === 'business')).toBe(true);
    expect(issues[0].label).toBe("IFU de l'entreprise");
  });

  it('uses the country fiscal ID label', () => {
    expect(sellerIssues({ ...complete, country: 'Sénégal', ifu: '' }, bank)[0].label).toBe("NINEA de l'entreprise");
  });

  it('accepts a city without a street address', () => {
    expect(keys(sellerIssues({ ...complete, address: '' }, bank))).toEqual([]);
    expect(keys(sellerIssues({ ...complete, address: '', city: '' }, bank))).toEqual(['seller-address']);
  });

  it('asks for bank details in the payment settings', () => {
    expect(sellerIssues(complete, noBank)).toEqual([
      { key: 'seller-bank', label: 'Coordonnées bancaires (RIB / IBAN)', fix: 'payments' },
    ]);
    expect(keys(sellerIssues(complete, { ...bank, methodBankIban: '  ' }))).toEqual(['seller-bank']);
  });

  it("doesn't report bank details when the payment settings couldn't be loaded", () => {
    expect(sellerIssues(complete, null)).toEqual([]);
  });
});

describe('clientIssues', () => {
  it('is empty for a client with an address and an IFU', () => {
    expect(clientIssues({ name: 'TK', city: 'Ouagadougou', ifu: '00067890C' })).toEqual([]);
  });

  it("treats the app's '—' placeholder as missing", () => {
    expect(keys(clientIssues({ name: 'TK', city: '—', ifu: '00067890C' }))).toEqual(['client-address']);
  });

  it('asks for the IFU of a client that should have one', () => {
    expect(keys(clientIssues({ name: 'TK', city: 'Ouaga' }))).toEqual(['client-ifu']);
    expect(keys(clientIssues({ name: 'TK', city: 'Ouaga', withholdingScenario: 'resident-with-ifu' }))).toEqual(['client-ifu']);
  });

  it("doesn't ask for an IFU the client is declared not to have", () => {
    expect(clientIssues({ name: 'TK', city: 'Ouaga', withholdingScenario: 'resident-without-ifu' })).toEqual([]);
    expect(clientIssues({ name: 'TK', city: 'Paris', withholdingScenario: 'non-resident' })).toEqual([]);
  });

  it('is empty for an unknown client', () => {
    expect(clientIssues(undefined)).toEqual([]);
  });
});
