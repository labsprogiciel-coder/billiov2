// What the command box (PRO-162) lists: quick actions and pages when empty,
// then clients, invoices, quotes and actions matching what is typed. Plain
// data (where to go, what to ask the page), so it can be tested; the box in
// src/components/CommandBox.tsx draws and runs it.

import type { ClientRecord, Invoice, Quote } from '@/lib/schemas';
import type { CommandIntent } from '@/lib/command-intent';
import { buildIndex, fold, queryWords, searchIndex, type Indexed } from '@/lib/command-search';
import { invoiceRef } from '@/lib/invoice-number';
import { QUOTE_STATUS, type RowStatus } from '@/lib/sales-tables';

export type CommandGroup = 'Actions' | 'Pages' | 'Clients' | 'Factures' | 'Devis';

export interface CommandItem {
  id: string;
  group: CommandGroup;
  title: string;
  /** Second line, e.g. the client of an invoice. */
  detail?: string;
  amount?: number;
  status?: RowStatus;
  icon: string;
  /** Single key that runs it from anywhere (outside text fields). */
  shortcut?: string;
  to: string;
  intent?: CommandIntent;
}

export interface CommandAccess {
  /** May create and change records (not an observer). */
  writable: boolean;
  /** Admin: settings. */
  managesOrg: boolean;
  quotes: boolean;
  payments: boolean;
}

const INVOICE_STATUS: Record<Invoice['status'], RowStatus> = {
  draft:   { label: 'Brouillon',  tone: 'draft' },
  pending: { label: 'En attente', tone: 'wait' },
  overdue: { label: 'En retard',  tone: 'late' },
  paid:    { label: 'Payée',      tone: 'paid' },
};

/** The quick actions, in the order shown, with their keys. */
export function quickActions(a: CommandAccess): CommandItem[] {
  if (!a.writable) return [];
  return [
    { id: 'new-invoice', group: 'Actions', title: 'Nouvelle facture', icon: 'file-invoice', shortcut: 'N', to: '/invoices', intent: { command: 'new-invoice' } },
    ...(a.quotes ? [{ id: 'new-quote', group: 'Actions' as const, title: 'Nouveau devis', icon: 'file-text', shortcut: 'D', to: '/quotes', intent: { command: 'new-quote' } as const }] : []),
    ...(a.payments ? [{ id: 'new-payment', group: 'Actions' as const, title: 'Enregistrer un paiement', icon: 'credit-card', shortcut: 'P', to: '/payments', intent: { command: 'new-payment' } as const }] : []),
    { id: 'new-client', group: 'Actions', title: 'Nouveau client', icon: 'user-plus', shortcut: 'C', to: '/contacts', intent: { command: 'new-client' } },
  ];
}

export function pageLinks(a: CommandAccess): CommandItem[] {
  return [
    { id: 'go-late', group: 'Pages', title: 'Factures en retard', icon: 'alert-triangle', to: '/invoices', intent: { command: 'show-late' } },
    { id: 'go-invoices', group: 'Pages', title: 'Factures', icon: 'receipt', to: '/invoices' },
    ...(a.quotes ? [{ id: 'go-quotes', group: 'Pages' as const, title: 'Devis', icon: 'file-text', to: '/quotes' }] : []),
    ...(a.payments ? [{ id: 'go-payments', group: 'Pages' as const, title: 'Paiements', icon: 'credit-card', to: '/payments' }] : []),
    { id: 'go-contacts', group: 'Pages', title: 'Contacts', icon: 'users', to: '/contacts' },
    { id: 'go-products', group: 'Pages', title: 'Produits', icon: 'package', to: '/products' },
    { id: 'go-dashboard', group: 'Pages', title: 'Tableau de bord', icon: 'layout-dashboard', to: '/dashboard' },
    ...(a.managesOrg ? [{ id: 'go-settings', group: 'Pages' as const, title: 'Paramètres', icon: 'settings', to: '/settings' }] : []),
  ];
}

export interface CommandIndex {
  clients: Indexed<ClientRecord>[];
  invoices: Indexed<Invoice>[];
  quotes: Indexed<Quote>[];
  clientName: (code: string) => string;
}

/** Folds every record once; rebuild when the data changes, not per keystroke. */
export function buildCommandIndex(clients: ClientRecord[], invoices: Invoice[], quotes: Quote[]): CommandIndex {
  const names = new Map(clients.map(c => [c.code, c.name]));
  const clientName = (code: string) => names.get(code) ?? code;
  return {
    clients: buildIndex(clients, c => ({ primary: c.name, rest: [c.ifu, c.code, c.contact, c.city] })),
    invoices: buildIndex(invoices, i => ({ primary: invoiceRef(i), rest: [i.id, clientName(i.client), i.subject] })),
    quotes: buildIndex(quotes, q => ({ primary: q.id, rest: [clientName(q.client), q.subject] })),
    clientName,
  };
}

const PER_GROUP = 5;

/** What to list for `query`: the empty state, or matches grouped. */
export function commandResults(query: string, index: CommandIndex, a: CommandAccess): CommandItem[] {
  const actions = quickActions(a);
  const pages = pageLinks(a);
  if (!queryWords(query).length) return [...actions, ...pages];

  const clients = searchIndex(index.clients, query, PER_GROUP);
  const invoices = searchIndex(index.invoices, query, PER_GROUP);
  const quotes = a.quotes ? searchIndex(index.quotes, query, PER_GROUP) : [];

  const words = queryWords(query);
  const named = (title: string) => { const t = fold(title); return words.every(w => t.includes(w)); };
  // Actions follow the search: « Nouvelle facture pour Kossi BTP »
  const top = clients[0];
  const forClient: CommandItem[] = top && a.writable ? [
    { id: `new-invoice-${top.code}`, group: 'Actions', title: `Nouvelle facture pour ${top.name}`, icon: 'file-invoice', to: '/invoices', intent: { command: 'new-invoice', client: top.code } },
    ...(a.quotes ? [{ id: `new-quote-${top.code}`, group: 'Actions' as const, title: `Nouveau devis pour ${top.name}`, icon: 'file-text', to: '/quotes', intent: { command: 'new-quote', client: top.code } as const }] : []),
  ] : [];

  return [
    ...clients.map((c): CommandItem => ({
      id: `client-${c.code}`, group: 'Clients', title: c.name, detail: [c.ifu && `IFU ${c.ifu}`, c.city].filter(Boolean).join(' · '),
      amount: c.balance > 0 ? c.balance : undefined, icon: 'user', to: '/contacts', intent: { command: 'open-client', client: c.code },
    })),
    ...invoices.map((i): CommandItem => ({
      id: `invoice-${i.id}`, group: 'Factures', title: invoiceRef(i), detail: `${index.clientName(i.client)} · ${i.subject}`,
      amount: i.amount, status: INVOICE_STATUS[i.status], icon: 'receipt', to: `/invoices/${i.id}`,
    })),
    ...quotes.map((q): CommandItem => ({
      id: `quote-${q.id}`, group: 'Devis', title: q.id, detail: `${index.clientName(q.client)} · ${q.subject}`,
      amount: q.amount, status: QUOTE_STATUS[q.status], icon: 'file-text', to: `/quotes/${q.id}`,
    })),
    ...forClient,
    ...actions.filter(x => named(x.title)),
    ...pages.filter(x => named(x.title)),
  ];
}

/** The quick action for a key pressed outside text fields, if any. */
export function actionForKey(key: string, a: CommandAccess): CommandItem | undefined {
  return quickActions(a).find(x => x.shortcut === key.toUpperCase());
}
