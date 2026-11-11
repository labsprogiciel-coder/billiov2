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
  it('requires the IFU of a company (PM) and an individual trader (PC)', () => {
    expect(keys(clientIssues({ name: 'TK', clientType: 'PM' }))).toEqual(['client-ifu']);
    expect(keys(clientIssues({ name: 'TK', clientType: 'PC' }))).toEqual(['client-ifu']);
    expect(clientIssues({ name: 'TK', clientType: 'PM', ifu: '00067890C' })).toEqual([]);
  });

  it("doesn't require an IFU for an individual (PP) or a cash client (CC)", () => {
    expect(clientIssues({ name: 'Awa', clientType: 'PP' })).toEqual([]);
    expect(clientIssues({ name: 'Client comptant', clientType: 'CC' })).toEqual([]);
  });

  it('infers the type of clients saved before types existed', () => {
    expect(clientIssues({ name: 'Old', ifu: '00067890C' })).toEqual([]);   // PM with its IFU
    expect(clientIssues({ name: 'Old' })).toEqual([]);                     // PP
  });

  it("doesn't ask for an IFU the client is declared not to have", () => {
    expect(clientIssues({ name: 'TK', clientType: 'PM', withholdingScenario: 'resident-without-ifu' })).toEqual([]);
    expect(clientIssues({ name: 'TK', clientType: 'PM', withholdingScenario: 'non-resident' })).toEqual([]);
  });

  it("requires the name, not the address (printed only on the client's request)", () => {
    expect(keys(clientIssues({ name: ' ', clientType: 'PP' }))).toEqual(['client-name']);
    expect(clientIssues({ name: 'TK', city: '—', clientType: 'PP' })).toEqual([]);
  });

  it('is empty for an unknown client', () => {
    expect(clientIssues(undefined)).toEqual([]);
  });
});
