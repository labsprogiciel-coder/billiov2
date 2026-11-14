import { describe, expect, it } from 'vitest';
import {
  addMonths, documentsToRequest, kybItems, kybRequestMessage, kybStateLabel, kybSummary, kybSummaryLabel,
  type ClientDocument,
} from '@/lib/kyb';

const today = '2026-11-14';
const doc = (docType: string, status: ClientDocument['status'], dates: Partial<Pick<ClientDocument, 'issuedOn' | 'expiresOn'>> = {}): ClientDocument =>
  ({ id: docType, clientCode: 'KB', docType, filePath: `o/KB/${docType}.pdf`, fileName: `${docType}.pdf`, status, ...dates });

describe('addMonths', () => {
  it('keeps the day, clamped to the month’s end', () => {
    expect(addMonths('2026-08-14', 3)).toBe('2026-11-14');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('kybItems and kybSummary', () => {
  const items = kybItems('PM', [
    doc('rccm', 'verified'),
    doc('ifu', 'verified', { expiresOn: '2026-11-30' }),         // 16 days left
    doc('statuts', 'pending'),
    doc('asf', 'verified', { issuedOn: '2026-07-01' }),           // 3 months: ended 1 October
    doc('cnss', 'verified', { issuedOn: '2026-10-01' }),          // valid until 1 January
    doc('cnib-gerant', 'rejected'),
  ], today);

  it('works out each document’s state', () => {
    expect(Object.fromEntries(items.map(i => [i.doc.key, i.state]))).toEqual({
      rccm: 'verified', ifu: 'expiring', statuts: 'to-check', asf: 'expired', cnss: 'verified', 'cnib-gerant': 'rejected', rib: 'missing',
    });
    expect(kybStateLabel(items[1])).toBe('Expire dans 16 j');
    expect(items[3].validUntil).toBe('2026-10-01');
  });

  it('sums them up', () => {
    const s = kybSummary(items);
    expect(s).toMatchObject({ required: 7, verified: 3, toCheck: 1, expired: 1, missing: 2, complete: false, needsAttention: true });
    expect(kybSummaryLabel(s)).toBe('3 sur 7 vérifiés · 1 à vérifier · 1 expiré · 2 manquants');
  });

  it('is complete when every document is checked and valid', () => {
    const s = kybSummary(kybItems('PP', [doc('cnib', 'verified', { expiresOn: '2030-01-01' })], today));
    expect(s).toMatchObject({ complete: true, needsAttention: false });
    expect(kybSummaryLabel(kybSummary(kybItems('CC', [], today)))).toBe('Aucun document demandé');
  });

  it('asks for what is missing, refused or expiring', () => {
    expect(documentsToRequest(items).map(i => i.doc.key)).toEqual(['ifu', 'asf', 'cnib-gerant', 'rib']);
    const msg = kybRequestMessage('Kossi BTP', 'Faso Conseil', items);
    expect(msg).toContain('- Attestation de situation fiscale (expiré)');
    expect(msg).toContain('- Relevé d’identité bancaire (RIB)');
    expect(msg.startsWith('Bonjour Kossi BTP,')).toBe(true);
  });
});
