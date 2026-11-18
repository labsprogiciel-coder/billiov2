import { describe, expect, it } from 'vitest';
import { duplicateMention, partiesAtIssue } from '@/lib/invoice-copy';

describe('copies of an issued invoice (PRO-144)', () => {
  const biz = { name: 'Studio Wend (nouveau nom)', address: 'Nouvelle adresse', city: 'Ouagadougou', country: 'Burkina Faso', email: 'a@b.bf', phone: '', ifu: 'NEW', rccm: 'R' };
  const client = { name: 'TK Renamed', city: 'Bobo', ifu: 'X', av: 'av-a' };

  it('prints the seller and client as they were at issue', () => {
    const { biz: b, client: c } = partiesAtIssue({ issueSnapshot: {
      seller: { name: 'Studio Wend', address: 'Av. Kwame Nkrumah', ifu: '00012345A', tax_regime: 'RNI', cadastral_ref: null },
      client: { name: 'TechKonsult', city: 'Ouagadougou', ifu: '00099999B', client_type: 'PM' },
    } }, biz, client);
    expect(b).toMatchObject({ name: 'Studio Wend', address: 'Av. Kwame Nkrumah', ifu: '00012345A', taxRegime: 'RNI', city: 'Ouagadougou' });
    expect(c).toMatchObject({ name: 'TechKonsult', city: 'Ouagadougou', ifu: '00099999B', clientType: 'PM', av: 'av-a' });
  });

  it('keeps today’s details when there is no snapshot', () => {
    expect(partiesAtIssue({}, biz, client)).toEqual({ biz, client });
  });

  it('names the original on the copy', () => {
    expect(duplicateMention('FACT-2026-0007', '3 novembre 2026')).toBe('Duplicata de la facture FACT-2026-0007 émise le 3 novembre 2026');
  });
});
