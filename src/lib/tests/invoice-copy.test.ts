import { describe, expect, it, vi } from 'vitest';
import { duplicateMention, originalOrCopy, partiesAtIssue } from '@/lib/invoice-copy';

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

  it('keeps a field empty at issue empty, even if filled since; keeps today’s value for a field not recorded', () => {
    const today = { name: 'TK', phone: '+226 70 00 00 00', email: 'new@tk.bf', withholdingScenario: 'construction', av: 'av-a' };
    const { client: c } = partiesAtIssue({ issueSnapshot: { client: { name: 'TK', phone: null, email: '  ', withholding_scenario: null } } }, biz, today);
    expect(c.phone).toBeUndefined();
    expect(c.email).toBeUndefined();
    // No withholding at issue: none on the copy, whatever the client's scenario now (the amount payable stays)
    expect(c.withholdingScenario).toBeUndefined();
    // Snapshots taken before a field was recorded: today's value
    const { client: older } = partiesAtIssue({ issueSnapshot: { client: { name: 'TK' } } }, biz, today);
    expect(older).toMatchObject({ phone: '+226 70 00 00 00', withholdingScenario: 'construction' });
  });

  it('keeps the withholding scenario of the issue', () => {
    const { client: c } = partiesAtIssue({ issueSnapshot: { client: { withholding_scenario: 'non_resident' } } }, biz, { ...client, withholdingScenario: 'construction' });
    expect(c.withholdingScenario).toBe('non_resident');
  });

  describe('original or copy', () => {
    const blob = (duplicate: boolean) => new Blob([duplicate ? 'copy' : 'original']);
    const read = (b: Blob) => b.text();

    it('draws the original before claiming it, so a failed render leaves it to the next try', async () => {
      const claim = vi.fn(async () => true);
      await expect(originalOrCopy({ status: 'pending' }, claim, async () => { throw new Error('render failed'); })).rejects.toThrow();
      expect(claim).not.toHaveBeenCalled();
      expect(await read(await originalOrCopy({ status: 'pending' }, claim, async d => blob(d)))).toBe('original');
      expect(claim).toHaveBeenCalledOnce();
    });

    it('draws a copy when another download claimed the original meanwhile', async () => {
      const render = vi.fn(async (d: boolean) => blob(d));
      expect(await read(await originalOrCopy({ status: 'overdue' }, async () => false, render))).toBe('copy');
      expect(render.mock.calls).toEqual([[false], [true]]);
    });

    it('goes straight to a copy once the original exists, and never claims for a draft', async () => {
      const claim = vi.fn(async () => true);
      const render = vi.fn(async (d: boolean) => blob(d));
      expect(await read(await originalOrCopy({ status: 'paid', originalPrintedAt: '2026-11-10T10:00:00Z' }, claim, render))).toBe('copy');
      expect(await read(await originalOrCopy({ status: 'draft' }, claim, render))).toBe('original');
      expect(claim).not.toHaveBeenCalled();
      expect(render.mock.calls).toEqual([[true], [false]]);
    });
  });

  it('names the original on the copy', () => {
    expect(duplicateMention('FACT-2026-0007', '3 novembre 2026')).toBe('Duplicata de la facture FACT-2026-0007 émise le 3 novembre 2026');
  });
});
