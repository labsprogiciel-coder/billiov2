// What each role sees on the invoice list and the invoice page (PRO-174): rendered to HTML for each
// role, with the app's data from the demo set (the new interface, the default since PRO-179).
// No screen may offer an action the database refuses.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UserRole } from '@/lib/permissions';
import type { CreditNote } from '@/lib/schemas';

const state = vi.hoisted(() => ({ role: 'admin' as UserRole }));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/features', async (orig) => ({ ...(await orig<typeof import('@/lib/features')>()), ACCOUNTING_ENABLED: true }));
vi.mock('@/context/AppContext', async () => {
  const data = await import('@/data');
  const { DEFAULT_CONFIG } = await import('@/lib/invoice-template');
  const clientsMap = Object.fromEntries(data.INITIAL_CLIENTS.map(c => [c.code, { name: c.name, city: c.city, av: c.av }]));
  const noop = () => {};
  return {
    useApp: () => ({
      invoices: data.INITIAL_INVOICES, payments: data.INITIAL_PAYMENTS, quotes: [], activity: [], products: [], clients: data.INITIAL_CLIENTS, clientsMap,
      setInvoices: noop, setPayments: noop, setQuotes: noop, setActivity: noop, showToast: noop,
      orgId: 'org-1', userId: 'u-1', userRole: state.role, userLabel: 'Test', loading: false,
      orgSettings: { name: 'Studio', taxRegime: 'RNI', country: 'Burkina Faso' }, invoiceTemplate: DEFAULT_CONFIG, plan: 'business',
    }),
  };
});
const issuedCredit: CreditNote = { id: 'AV-1', invoiceId: 'INV-0041', subject: 'Remise', client: 'TK', issued: '2026-06-02', amount: 1000, reason: 'Geste', status: 'issued', nature: 'RRR', lines: [], discountPct: 0, number: 'AV-2026-0001' };
const draftCredit: CreditNote = { ...issuedCredit, id: 'AV-2', status: 'draft', number: undefined };
vi.mock('@/lib/use-credit-notes', () => ({ useCreditNotes: () => [issuedCredit], useCreditNoteDrafts: () => [draftCredit] }));
vi.mock('@/lib/use-team', () => ({ useTeam: () => [] }));
// « Autres actions » renders its items only once opened: render them, so the tests see every action offered
vi.mock('@/components/MoreMenu', async () => {
  const { createElement: h } = await import('react');
  return { default: ({ label, items }: { label: string; items: { label: string }[] }) =>
    h('div', { 'data-menu': label }, label, items.map(i => h('span', { key: i.label, 'data-menu-item': '' }, i.label))) };
});
vi.mock('@/lib/use-reassign', () => ({ useReassign: () => ({ reassign: async () => true, busy: false }) }));

const ROLES: UserRole[] = ['admin', 'accountant', 'member', 'observer'];

async function renderList(role: UserRole): Promise<string> {
  state.role = role;
  const { default: InvoiceList } = await import('@/components/sales/InvoiceList');
  const writable = role !== 'observer';
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(InvoiceList, { writable, onOpen: () => {}, onSend: () => {}, onDownload: () => {}, downloading: false })));
}

describe('invoice list per role (PRO-174)', () => {
  it.each(ROLES)('%s', async role => {
    const html = await renderList(role);
    const books = role === 'admin' || role === 'accountant';
    // The « Comptabilité » column and its filter: the roles that post entries
    expect(html.includes('>Comptabilité<'), 'Comptabilité column').toBe(books);
    expect(html.includes('À comptabiliser'), 'À comptabiliser filter').toBe(books);
    // Selecting rows only serves to change the « Responsable »: admins only
    expect(html.includes('type="checkbox"'), 'row checkboxes').toBe(role === 'admin');
    // Members see their own records: no switch to everyone's
    expect(html.includes('Mes factures'), 'own/all switch').toBe(role !== 'member');
  });
});

async function renderInvoice(role: UserRole, id: string): Promise<string> {
  state.role = role;
  const { default: InvoicePage } = await import('@/pages/InvoicePage');
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/invoices/${id}`] },
    createElement(Routes, null, createElement(Route, { path: '/invoices/:id', element: createElement(InvoicePage) }))));
}

describe('invoice page per role (PRO-174)', () => {
  it.each(ROLES)('%s, on an issued invoice', async role => {
    const data = await import('@/data');
    const issued = data.INITIAL_INVOICES.find(i => i.status === 'pending' || i.status === 'overdue')!;
    const html = await renderInvoice(role, issued.id);
    expect(html).toContain(issued.subject);
    const credits = role === 'admin' || role === 'accountant';
    expect(/Créer un avoir|Émettre un avoir/.test(html), 'credit note').toBe(credits);
    expect(html.includes('Enregistrer un paiement'), 'record a payment').toBe(role !== 'observer');
    expect(/Envoyer|Relancer/.test(html), 'send').toBe(role !== 'observer');
    // An issued invoice is corrected with a credit note, never edited (DGI)
    expect(html.includes('Modifier la facture'), 'edit panel').toBe(false);
    expect(/>\s*Modifier\s*<\/button>/.test(html), 'edit button').toBe(false);
    expect(html.includes('<span data-menu-item="">Modifier</span>'), '« Modifier » in Autres actions').toBe(false);
  });

  it.each(ROLES)('%s, on a draft', async role => {
    const data = await import('@/data');
    const draft = data.INITIAL_INVOICES.find(i => i.status === 'draft');
    if (!draft) return;
    const html = await renderInvoice(role, draft.id);
    expect(html.includes('Autres actions'), 'more actions').toBe(role !== 'observer');
    expect(html.includes('<span data-menu-item="">Supprimer la facture</span>'), 'delete a draft').toBe(role === 'admin');
    // The same pattern the issued invoice is checked with finds a draft's edit button
    expect(/>\s*Modifier\s*<\/button>/.test(html), 'edit button').toBe(role !== 'observer');
    expect(html.includes('Émettre la facture'), 'issue').toBe(role !== 'observer');
  });
});
