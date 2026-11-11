import { describe, expect, it } from 'vitest';
import { businessSnapshot } from '@/lib/assistant-context';
import type { Invoice, Payment } from '@/lib/schemas';

const inv = (id: string, client: string, amount: number, status: Invoice['status'], issued: string, due: string, number?: string): Invoice =>
  ({ id, client, amount, status, issued, due, subject: 'Prestation', discountPct: 0, number });
const pay = (invId: string, amount: number, date: string): Payment =>
  ({ id: 'P' + invId, inv: invId, client: '', amount, date, status: 'completed', method: 'wire', ref: '', source: 'manual' });

describe('businessSnapshot', () => {
  const invoices = [
    inv('A', 'TK', 100_000, 'overdue', '2026-10-01', '2026-10-15', 'FACT-2026-0001'),
    inv('B', 'SB', 50_000, 'pending', '2026-11-02', '2026-11-30', 'FACT-2026-0002'),
    inv('C', 'TK', 30_000, 'paid', '2026-11-03', '2026-11-10', 'FACT-2026-0003'),
    inv('D', 'SB', 20_000, 'draft', '2026-11-05', '2026-11-20'),
  ];
  const payments = [pay('A', 40_000, '2026-11-04'), pay('C', 30_000, '2026-11-05')];
  const clients = { TK: { name: 'TechKonsult' }, SB: { name: 'Sahel Banque' } };
  const s = businessSnapshot({ name: 'Studio', plan: 'business' }, invoices, payments, clients, '2026-11-11');

  it('counts invoices by status, drafts apart', () => {
    expect(s.factures).toEqual({ brouillons: 1, emises: 3, payees: 1, en_attente: 1, en_retard: 1 });
  });
  it('sums what is left to collect, net of payments', () => {
    expect(s.reste_a_encaisser_fcfa).toBe(60_000 + 50_000);
    expect(s.facture_ce_mois_fcfa).toBe(80_000);
    expect(s.encaisse_ce_mois_fcfa).toBe(70_000);
  });
  it('lists overdue invoices with their legal number, client and days late', () => {
    expect(s.factures_en_retard).toEqual([
      { numero: 'FACT-2026-0001', client: 'TechKonsult', objet: 'Prestation', reste_fcfa: 60_000, echeance: '2026-10-15', jours_de_retard: 27 },
    ]);
    expect(s.plus_gros_soldes_clients[0]).toEqual({ client: 'TechKonsult', solde_fcfa: 60_000 });
  });
});
