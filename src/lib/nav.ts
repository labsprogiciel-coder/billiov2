// What the app's navigation links to, and which plan feature each place needs.
// Shared by the side menu (Sidebar) and the ERP top bar (TopNav, PRO-161).

import type { Feature } from '@/lib/plans';

/** Facturation tabs (?tab=) that need a higher plan; Factures is on every plan. */
export type SalesTab = 'invoices' | 'quotes' | 'payments';
export const SALES_TAB_FEATURE: Partial<Record<SalesTab, Feature>> = {
  quotes:   'quotes',
  payments: 'payments_mobilemoney',
};

// Maps each accounting route to the Feature that must be unlocked to open it.
// Routes not listed here are available on every plan.
// Business+: full SYSCOHADA. Cabinet+: fixed assets, period closing.
export const ROUTE_FEATURE: Record<string, Feature> = {
  '/accounting/opening-balances':     'accounting_syscohada',
  '/accounting/chart-of-accounts':    'accounting_syscohada',
  '/accounting/journals':             'accounting_syscohada',
  '/accounting/trial-balance':        'accounting_syscohada',
  '/accounting/financial-statements': 'accounting_syscohada',
  '/accounting/tax':                  'accounting_syscohada',
  '/accounting/fixed-assets':         'fixed_assets',
  '/accounting/period-closing':       'period_closing',
};

export interface MenuLink {
  label: string;
  /** One line under the label in the top bar menus. */
  hint: string;
  to: string;
  /** Plan feature needed to open it. */
  feature?: Feature;
}

export const SALES_MENU: MenuLink[] = [
  { label: 'Factures',  hint: 'Émises, brouillons, retards',     to: '/invoices' },
  { label: 'Devis',     hint: 'Envoyés, acceptés, convertis',    to: '/invoices?tab=quotes',   feature: SALES_TAB_FEATURE.quotes },
  { label: 'Paiements', hint: 'Encaissements par méthode',       to: '/invoices?tab=payments', feature: SALES_TAB_FEATURE.payments },
];

export interface MenuGroup { title: string; links: MenuLink[] }

const acc = (label: string, hint: string, to: string): MenuLink => ({ label, hint, to, feature: ROUTE_FEATURE[to] });

export const ACCOUNTING_MENU: MenuGroup[] = [
  { title: 'Saisie', links: [
    acc('Journaux',        'Écritures VT, AC, BQ, CA, OD',       '/accounting/journals'),
    acc('À-nouveaux',      'Soldes d’ouverture de l’exercice',   '/accounting/opening-balances'),
    acc('Immobilisations', 'Registre et amortissements',         '/accounting/fixed-assets'),
  ] },
  { title: 'États', links: [
    acc('Balance',          'Soldes de tous les comptes', '/accounting/trial-balance'),
    acc('États financiers', 'Résultat et bilan à date',   '/accounting/financial-statements'),
    acc('Plan comptable',   'Comptes SYSCOHADA',          '/accounting/chart-of-accounts'),
  ] },
  { title: 'Fiscal et clôture', links: [
    acc('Fiscalité', 'TVA, retenues, IS',          '/accounting/tax'),
    acc('Clôture',   'Périodes et fin d’exercice', '/accounting/period-closing'),
  ] },
];

/**
 * Whether `link` is the page at `pathname` + `search`. A link with a ?tab=
 * matches only that tab; a bare /invoices matches when no other tab is set.
 */
export function isLinkActive(link: string, pathname: string, search: string): boolean {
  const [path, query = ''] = link.split('?');
  if (path !== pathname) return false;
  const want = new URLSearchParams(query).get('tab');
  const have = new URLSearchParams(search).get('tab');
  return want === have || (!want && (have === null || have === 'invoices'));
}
