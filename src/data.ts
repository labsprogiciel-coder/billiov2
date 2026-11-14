// Shared types, static data, and mock INITIAL_* arrays used across pages and the service layer

import type {
  InvoiceStatus,
  Client,
  Invoice,
  Activity,
  LineItem,
  ClientRecord,
  Payment,
  Product,
  Quote,
} from '@/lib/schemas';

export type { InvoiceStatus as Status, Client, Invoice, ActivityKind, ActivityPart, Activity, LineItem } from '@/lib/schemas';

export type FilterKey = 'all' | InvoiceStatus;

// ---------------------------------------------------------------------------
// Mock clients — source of truth for MOCK mode; also used to seed CLIENTS lookup
// ---------------------------------------------------------------------------

export const INITIAL_CLIENTS: ClientRecord[] = [
  { code: 'OT', av: 'av-a', name: 'Orange Télécoms',  contact: 'Fatou Sanogo',       email: 'fatou@orange.bf',          phone: '+226 70 11 22 33', city: 'Ouagadougou',    invoices: 11, billed: 9_400_000, balance: 0,       status: 'active' },
  { code: 'SB', av: 'av-b', name: 'Sahel Banque',      contact: 'Mariam Koné',         email: 'm.kone@sahelbanque.bf',    phone: '+226 76 44 55 66', city: 'Bobo-Dioulasso', invoices: 5,  billed: 6_800_000, balance: 0,       status: 'active' },
  { code: 'TK', av: 'av-c', name: 'TechKonsult',       contact: 'Adama Ouédraogo',     email: 'adama@techkonsult.bf',     phone: '+226 70 12 34 56', city: 'Ouagadougou',    invoices: 8,  billed: 4_200_000, balance: 780_000, status: 'active' },
  { code: 'AM', av: 'av-d', name: 'AgroMali SA',       contact: 'Ibrahima Diarra',     email: 'i.diarra@agromali.ml',     phone: '+223 20 22 33 44', city: 'Bamako',         invoices: 6,  billed: 3_100_000, balance: 450_000, status: 'active' },
  { code: 'MF', av: 'av-f', name: 'MinFin Burkina',    contact: 'Salif Traoré',        email: 's.traore@finances.gov.bf', phone: '+226 25 30 60 90', city: 'Ouagadougou',    invoices: 2,  billed: 1_500_000, balance: 0,       status: 'active' },
  { code: 'BF', av: 'av-e', name: 'BurkinaFarm',       contact: 'Boukary Zongo',       email: 'b.zongo@burkinafarm.bf',   phone: '+226 78 90 12 34', city: 'Koudougou',      invoices: 3,  billed: 1_200_000, balance: 320_000, status: 'active' },
  { code: 'NC', av: 'av-g', name: 'Nieta Cosmetics',   contact: 'Aïcha Diallo',        email: 'aicha@nieta.ml',           phone: '+223 66 77 88 99', city: 'Bamako',         invoices: 1,  billed: 280_000,   balance: 0,       status: 'active' },
  { code: 'FE', av: 'av-h', name: 'Faso Energy',       contact: 'Awa Bamba',           email: 'awa.bamba@fasoenergy.bf',  phone: '+226 70 55 66 77', city: 'Ouagadougou',    invoices: 0,  billed: 0,         balance: 0,       status: 'lead'   },
];

// Simple code → {name, city, av} lookup — derived from INITIAL_CLIENTS.
// Used as a fallback before context clients load.
export const CLIENTS: Record<string, Client> = Object.fromEntries(
  INITIAL_CLIENTS.map(c => [c.code, { name: c.name, city: c.city, av: c.av }])
);

// ---------------------------------------------------------------------------
// Mock invoices (dates as ISO strings)
// ---------------------------------------------------------------------------

export const INITIAL_INVOICES: Invoice[] = [
  { id: 'INV-0041', subject: 'Refonte web — phase 2',        client: 'TK', issued: '2026-06-01', due: '2026-06-15', amount: 780_000,   status: 'overdue', discountPct: 0 },
  { id: 'INV-0040', subject: 'Licence intégration ERP',      client: 'SB', issued: '2026-05-28', due: '2026-06-12', amount: 1_200_000, status: 'paid',    discountPct: 0 },
  { id: 'INV-0039', subject: 'Audit sécurité T2',            client: 'AM', issued: '2026-05-22', due: '2026-06-05', amount: 450_000,   status: 'overdue', discountPct: 0 },
  { id: 'INV-0038', subject: 'Dév. appli mobile — sprint 4', client: 'OT', issued: '2026-05-18', due: '2026-06-02', amount: 960_000,   status: 'paid',    discountPct: 0 },
  { id: 'INV-0037', subject: 'Abonnement SaaS annuel',       client: 'BF', issued: '2026-05-14', due: '2026-05-28', amount: 320_000,   status: 'pending', discountPct: 0 },
  { id: 'INV-0036', subject: 'Conseil infra réseau',         client: 'MF', issued: '2026-05-05', due: '2026-05-19', amount: 625_000,   status: 'draft',   discountPct: 0 },
];

// ---------------------------------------------------------------------------
// Mock activities
// ---------------------------------------------------------------------------

export const INITIAL_ACTIVITY: Activity[] = [
  { kind: 'paid',    parts: [{ text: 'Sahel Banque', bold: true }, { text: ' a payé #INV-0040' }],                             time: "Aujourd'hui, 9h14" },
  { kind: 'sent',    parts: [{ text: 'Relance envoyée à ' }, { text: 'TechKonsult', bold: true }, { text: ' pour #INV-0041' }], time: 'Hier, 15h40' },
  { kind: 'viewed',  parts: [{ text: 'BurkinaFarm', bold: true }, { text: ' a consulté #INV-0037' }],                          time: '4 juin, 11h02' },
  { kind: 'paid',    parts: [{ text: 'Orange Télécoms', bold: true }, { text: ' a payé #INV-0038' }],                          time: '2 juin, 14h15' },
  { kind: 'overdue', parts: [{ text: 'AgroMali SA', bold: true }, { text: ' — facture en retard' }],                          time: '5 juin, automatique' },
];

// ---------------------------------------------------------------------------
// Mock payments (dates as ISO strings)
// ---------------------------------------------------------------------------

export const INITIAL_PAYMENTS: Payment[] = [
  { id: 'PAI-2052', date: '2026-06-09', client: 'TK', inv: 'INV-0041', method: 'momo', ref: 'MTN · ****7741',      amount: 780_000,   status: 'pending',   source: 'manual' },
  { id: 'PAI-2051', date: '2026-06-09', client: 'SB', inv: 'INV-0040', method: 'cheque', ref: 'ch_3PXyZ2',         amount: 1_200_000, status: 'completed', source: 'online' },
  { id: 'PAI-2050', date: '2026-06-09', client: 'OT', inv: 'INV-0038', method: 'wire',   ref: 'VIR · #WV8842',    amount: 960_000,   status: 'completed', source: 'online' },
  { id: 'PAI-2049', date: '2026-06-08', client: 'BF', inv: 'INV-0037', method: 'cash', ref: 'Reçu #0211',          amount: 320_000,   status: 'completed', source: 'manual' },
  { id: 'PAI-2048', date: '2026-06-04', client: 'NC', inv: 'INV-0036', method: 'momo', ref: 'Orange · ****2210',   amount: 280_000,   status: 'completed', source: 'online' },
  { id: 'PAI-2047', date: '2026-06-03', client: 'TK', inv: 'INV-0041', method: 'momo', ref: 'MTN · ****5532',      amount: 720_000,   status: 'completed', source: 'manual' },
  { id: 'PAI-2046', date: '2026-06-02', client: 'AM', inv: 'INV-0039', method: 'cash', ref: 'Reçu #0208',          amount: 600_000,   status: 'completed', source: 'manual' },
  { id: 'PAI-2045', date: '2026-06-01', client: 'OT', inv: 'INV-0038', method: 'wire',  ref: 'VIR · #WV8703',    amount: 1_240_000, status: 'completed', source: 'online' },
];

// ---------------------------------------------------------------------------
// Mock products
// ---------------------------------------------------------------------------

export const INITIAL_PRODUCTS: Product[] = [
  { id: '1', name: 'Développement web',     sku: 'DEV-WEB',  type: 'service', unit: 'heure',   price: 35_000,  tax: 18, used: 38, ico: 'server',        color: 'ico-blue'   },
  { id: '2', name: 'Brand & UI design',     sku: 'DSN-UIX',  type: 'service', unit: 'projet',  price: 450_000, tax: 18, used: 12, ico: 'sparkles',      color: 'ico-violet' },
  { id: '3', name: 'Dév. appli mobile',     sku: 'DEV-MOB',  type: 'service', unit: 'projet',  price: 600_000, tax: 18, used: 9,  ico: 'device-mobile', color: 'ico-blue'   },
  { id: '4', name: 'Audit sécurité',        sku: 'SEC-AUD',  type: 'service', unit: 'projet',  price: 400_000, tax: 18, used: 7,  ico: 'shield-check',  color: 'ico-amber'  },
  { id: '5', name: 'Conseil SEO',           sku: 'MKT-SEO',  type: 'service', unit: 'heure',   price: 30_000,  tax: 18, used: 21, ico: 'chart-bar',     color: 'ico-green'  },
  { id: '6', name: 'Hébergement géré',      sku: 'OPS-HOST', type: 'service', unit: 'mois',    price: 45_000,  tax: 18, used: 31, ico: 'server',        color: 'ico-teal'   },
  { id: '7', name: 'Licence SaaS annuelle', sku: 'LIC-SAAS', type: 'product', unit: 'licence', price: 320_000, tax: 18, used: 14, ico: 'sparkles',      color: 'ico-violet' },
  { id: '8', name: 'Nom de domaine (.bf)',  sku: 'DOM-BF',   type: 'product', unit: 'an',      price: 18_000,  tax: 18, used: 26, ico: 'world',         color: 'ico-green'  },
  { id: '9', name: 'Certificat SSL',        sku: 'SEC-SSL',  type: 'product', unit: 'an',      price: 25_000,  tax: 18, used: 19, ico: 'lock',          color: 'ico-rose'   },
];

// ---------------------------------------------------------------------------
// Mock quotes (dates as ISO strings)
// ---------------------------------------------------------------------------

export const INITIAL_QUOTES: Quote[] = [
  { id: 'DEV-0118', subject: 'Refonte site web — périmètre complet', client: 'TK', issued: '2026-06-04', valid: '2026-06-18', expSoon: true,  amount: 1_250_000, status: 'sent'     },
  { id: 'DEV-0117', subject: 'Intégration API core banking',         client: 'SB', issued: '2026-06-02', valid: '2026-06-16', expSoon: false, amount: 3_400_000, status: 'accepted' },
  { id: 'DEV-0116', subject: 'Contrat sécurité annuel',              client: 'AM', issued: '2026-05-30', valid: '2026-06-13', expSoon: false, amount: 1_800_000, status: 'sent'     },
  { id: 'DEV-0115', subject: 'Application mobile — phase 1',         client: 'OT', issued: '2026-05-27', valid: '2026-06-10', expSoon: false, amount: 2_150_000, status: 'accepted' },
  { id: 'DEV-0114', subject: 'Boutique e-commerce',                  client: 'BF', issued: '2026-05-22', valid: '2026-06-05', expSoon: false, amount: 680_000,   status: 'expired'  },
  { id: 'DEV-0113', subject: 'Audit infrastructure IT',              client: 'MF', issued: '2026-05-20', valid: '2026-06-03', expSoon: false, amount: 920_000,   status: 'declined' },
  { id: 'DEV-0112', subject: 'Pack identité visuelle',               client: 'TK', issued: '2026-05-16', valid: '2026-05-30', expSoon: false, amount: 450_000,   status: 'draft'    },
];

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: 'Payée', overdue: 'En retard', pending: 'En attente', draft: 'Brouillon',
};

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const fmt = (n: number) => n.toLocaleString('fr-FR');

export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  // French decimal comma: 1,3 M (not 1.3M)
  if (a >= 1_000_000) return (n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M';
  return Math.round(n).toLocaleString('fr-FR');
}

/** French short date: "1 juin" this year, "1 juin 2025" for any other year. */
export function fmtDate(iso: string, today: Date = new Date()): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('fr-FR', d.getFullYear() === today.getFullYear()
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function fmtDateLong(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** Format an ISO date string as "Éch. 15 juin". */
export function fmtDue(iso: string): string {
  return `Éch. ${fmtDate(iso)}`;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function nextId(invoices: Invoice[]): string {
  const nums = invoices.map(i => parseInt(i.id.split('-')[1], 10)).filter(n => !isNaN(n));
  const max  = nums.length ? Math.max(...nums) : 0;
  return 'INV-' + String(max + 1).padStart(4, '0');
}

/** Two-letter avatar text from a client name ("Sahel Banque" → "SB"). */
export function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function newLineItem(desc = '', qty = 1, price = 0, unit = 'unité', productId?: string): LineItem {
  return { id: crypto.randomUUID(), desc, unit, qty, price, ...(productId ? { productId } : {}) };
}

// ---------------------------------------------------------------------------
// Demo team (PRO-172): who is « Responsable » of the demo records
// ---------------------------------------------------------------------------

export const MOCK_TEAM: { id: string; name: string; role: string }[] = [
  { id: 'mock-user', name: 'Vous (démo)',    role: 'admin' },
  { id: 'demo-awa',  name: 'Awa Ouédraogo',  role: 'member' },
  { id: 'demo-issa', name: 'Issa Traoré',    role: 'accountant' },
];

/** Owner of a record created in demo mode: the one named, else the demo user. */
export function mockOwner(ownerId?: string): { ownerId: string; ownerName: string } {
  const m = MOCK_TEAM.find(t => t.id === ownerId) ?? MOCK_TEAM[0];
  return { ownerId: m.id, ownerName: m.name };
}

// Spread the demo records over the team, so « Mes … » has something to show
for (const list of [INITIAL_INVOICES, INITIAL_QUOTES, INITIAL_CLIENTS] as { ownerId?: string; ownerName?: string }[][]) {
  list.forEach((r, i) => Object.assign(r, mockOwner(MOCK_TEAM[i % MOCK_TEAM.length].id)));
}

// Who recorded the demo payments (online ones have no one) and changed the items (PRO-173)
INITIAL_PAYMENTS.forEach((p, i) => { if (p.source !== 'online') p.createdByName = MOCK_TEAM[i % MOCK_TEAM.length].name; });
INITIAL_PRODUCTS.forEach((p, i) => {
  p.updatedAt = new Date(Date.UTC(2026, 4, 2 + i * 3, 9)).toISOString();
  p.updatedByName = MOCK_TEAM[(i + 1) % MOCK_TEAM.length].name;
});

// Some demo clients are companies with their tax identifiers (PRO-169 record, KYB file)
const DEMO_COMPANIES: Record<string, { ifu: string; rccm: string; taxRegime: string }> = {
  OT: { ifu: '00012345A', rccm: 'BF-OUA-2015-B-1201', taxRegime: 'RNI' },
  SB: { ifu: '00023456B', rccm: 'BF-BBD-2012-B-0457', taxRegime: 'RNI' },
  AM: { ifu: '00034567C', rccm: 'ML-BKO-2018-B-2210', taxRegime: 'RSI' },
};
INITIAL_CLIENTS.forEach(c => { const d = DEMO_COMPANIES[c.code]; if (d) Object.assign(c, d, { clientType: 'PM' }); });
