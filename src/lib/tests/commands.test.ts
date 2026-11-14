import { describe, expect, it } from 'vitest';
import type { ClientRecord, Invoice, Quote } from '@/lib/schemas';
import { buildIndex, fold, highlight, searchIndex } from '@/lib/command-search';
import { actionForKey, buildCommandIndex, commandResults, type CommandAccess } from '@/lib/commands';
import { readIntent } from '@/lib/command-intent';

const client = (code: string, name: string, ifu?: string): ClientRecord => ({
  code, av: 'av-a', name, contact: '', email: '', phone: '', city: 'Ouagadougou', ifu,
  invoices: 0, billed: 0, balance: 0, status: 'active',
});
const invoice = (id: string, clientCode: string, subject: string, number?: string): Invoice =>
  ({ id, subject, client: clientCode, issued: '2026-11-01', due: '2026-11-30', amount: 100_000, status: 'pending', discountPct: 0, number });
const quote = (id: string, clientCode: string, subject: string): Quote =>
  ({ id, subject, client: clientCode, issued: '2026-11-01', valid: '2026-12-01', expSoon: false, amount: 50_000, status: 'sent' });

const clients = [client('KB', 'Kossi BTP', '00012345A'), client('SH', 'Société Hôtelière du Sahel'), client('FT', 'Faso Tech')];
const invoices = [
  invoice('INV-1', 'KB', 'Gros œuvre bâtiment', 'FACT-2026-0031'),
  invoice('INV-2', 'SH', 'Rénovation chambres', 'FACT-2026-0032'),
  invoice('BR-ABC', 'FT', 'Maintenance réseau'),
];
const quotes = [quote('DEV-0118', 'KB', 'Extension entrepôt')];
const index = buildCommandIndex(clients, invoices, quotes);
const all: CommandAccess = { writable: true, managesOrg: true, quotes: true, payments: true };

describe('fold and highlight', () => {
  it('folds accents and case without changing plain text length', () => {
    expect(fold('Société Hôtelière')).toBe('societe hoteliere');
    expect(fold('Société').length).toBe('Société'.length);
  });
  it('marks the matching letters of the original text', () => {
    expect(highlight('Société Hôtelière', 'hotel')).toEqual([
      { text: 'Société ', hit: false }, { text: 'Hôtel', hit: true }, { text: 'ière', hit: false },
    ]);
    expect(highlight('Kossi BTP', '')).toEqual([{ text: 'Kossi BTP', hit: false }]);
  });
});

describe('searchIndex', () => {
  it('ranks a match at the start first and needs every word', () => {
    const idx = buildIndex(['Faso Kossi', 'Kossi BTP', 'Kossi Transport'], s => ({ primary: s, rest: [] }));
    expect(searchIndex(idx, 'kossi', 5)).toEqual(['Kossi BTP', 'Kossi Transport', 'Faso Kossi']);
    expect(searchIndex(idx, 'kossi trans', 5)).toEqual(['Kossi Transport']);
    expect(searchIndex(idx, '', 5)).toEqual([]);
  });
  it('stays quick with thousands of records', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => invoice(`INV-${i}`, 'KB', `Travaux lot ${i}`, `FACT-2026-${String(i).padStart(5, '0')}`));
    const big = buildCommandIndex(clients, many, []);
    const t0 = performance.now();
    for (const q of ['k', 'ko', 'kos', 'koss', 'lot 1999', 'zzz']) commandResults(q, big, all);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe('commandResults', () => {
  it('lists quick actions and pages when empty', () => {
    const ids = commandResults('', index, all).map(r => r.id);
    expect(ids.slice(0, 4)).toEqual(['new-invoice', 'new-quote', 'new-payment', 'new-client']);
    expect(ids).toContain('go-late');
    expect(ids).toContain('go-settings');
  });
  it('finds clients by name or IFU, invoices and quotes by number, client or subject', () => {
    const groups = (q: string) => commandResults(q, index, all).filter(r => r.group !== 'Actions' && r.group !== 'Pages').map(r => `${r.group}:${r.title}`);
    expect(groups('kos')).toEqual(['Clients:Kossi BTP', 'Factures:FACT-2026-0031', 'Devis:DEV-0118']);
    expect(groups('00012345')).toEqual(['Clients:Kossi BTP']);
    expect(groups('0032')).toEqual(['Factures:FACT-2026-0032']);
    expect(groups('renovation')).toEqual(['Factures:FACT-2026-0032']);
    expect(groups('entrepot')).toEqual(['Devis:DEV-0118']);
    expect(groups('BR-ABC')).toEqual(['Factures:BR-ABC']);
  });
  it('offers actions for the client found', () => {
    const titles = commandResults('kossi', index, all).filter(r => r.group === 'Actions').map(r => r.title);
    expect(titles).toEqual(['Nouvelle facture pour Kossi BTP', 'Nouveau devis pour Kossi BTP']);
    const r = commandResults('kossi', index, all).find(x => x.id === 'new-invoice-KB');
    expect(r?.intent).toEqual({ command: 'new-invoice', client: 'KB' });
  });
  it('shows only what the role and plan allow', () => {
    const observer: CommandAccess = { writable: false, managesOrg: false, quotes: true, payments: true };
    const ids = commandResults('', index, observer).map(r => r.id);
    expect(ids.some(i => i.startsWith('new-'))).toBe(false);
    expect(ids).not.toContain('go-settings');
    expect(commandResults('kossi', index, observer).some(r => r.group === 'Actions')).toBe(false);
    const solo: CommandAccess = { writable: true, managesOrg: true, quotes: false, payments: false };
    expect(commandResults('', index, solo).map(r => r.id)).not.toContain('new-quote');
    expect(commandResults('kos', index, solo).some(r => r.group === 'Devis')).toBe(false);
  });
  it('finds actions and pages by name', () => {
    expect(commandResults('retard', index, all).map(r => r.id)).toContain('go-late');
    expect(commandResults('paiement', index, all).map(r => r.id)).toEqual(['new-payment', 'go-payments']);
  });
});

describe('shortcuts and intents', () => {
  it('maps keys to the allowed quick actions', () => {
    expect(actionForKey('n', all)?.id).toBe('new-invoice');
    expect(actionForKey('d', { ...all, quotes: false })).toBeUndefined();
    expect(actionForKey('n', { ...all, writable: false })).toBeUndefined();
    expect(actionForKey('x', all)).toBeUndefined();
  });
  it('reads an intent from history state only when well formed', () => {
    expect(readIntent({ intent: { command: 'new-client' } })).toEqual({ command: 'new-client' });
    expect(readIntent(null)).toBeNull();
    expect(readIntent({ openSend: true })).toBeNull();
  });
});
