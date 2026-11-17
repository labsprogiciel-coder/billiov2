// Paramètres (PRO-171): the checks on the organisation's fields while they
// are typed, and the DGI checklist shown beside the form. The checklist reads
// the same rules as the invoice editor's checks (sellerIssues), so a line
// missing here is a warning there.

import { cadastralRequired, parseCadastralRef } from '@/lib/cadastral';
import { sellerIssues, type SellerInfo } from '@/lib/invoice-compliance';
import { getFiscalIdLabel } from '@/lib/ohada';
export { ifuProblem } from '@/lib/ifu';
import type { PaymentSettings } from '@/lib/api/payment-settings';

/** Why the cadastral reference can't be right, or null (empty is left to the checklist). */
export function cadastralProblem(value: string): string | null {
  if (!value.trim()) return null;
  return parseCadastralRef(value) ? null : 'La référence compte 11 chiffres (section, îlot, parcelle), par exemple 0412 007 0153.';
}

/** Where a checklist line is fixed: a settings section, and the field to focus there. */
export interface ChecklistFix { tab: 'business' | 'payments'; field?: string }

export interface ChecklistRow {
  key:    string;
  label:  string;
  /** ok: filled in; missing: blocks or warns at issue; auto: Billio prints it; info: not required yet */
  state:  'ok' | 'missing' | 'unknown' | 'auto' | 'info';
  hint?:  string;
  fix?:   ChecklistFix;
}

/** Ids of the Entreprise fields, for the checklist's « Corriger » links. */
export const FIELD_IDS = {
  name: 'set-name', address: 'set-address', ifu: 'set-ifu', rccm: 'set-rccm',
  regime: 'set-regime', division: 'set-division', cadastre: 'set-cadastre',
} as const;

/**
 * The DGI checklist for the organisation. `payments` null: the payment
 * settings couldn't be read, so the bank line is « unknown », not missing.
 */
export function complianceChecklist(seller: SellerInfo, payments: PaymentSettings | null): ChecklistRow[] {
  const missing = new Set(sellerIssues(seller, payments).map(i => i.key));
  const row = (key: string, label: string, fix: ChecklistFix, hint?: string): ChecklistRow =>
    ({ key, label, state: missing.has(key) ? 'missing' : 'ok', fix, hint });
  const rows: ChecklistRow[] = [
    row('seller-name', 'Raison sociale', { tab: 'business', field: FIELD_IDS.name }),
    row('seller-address', 'Adresse', { tab: 'business', field: FIELD_IDS.address }),
    row('seller-ifu', `${getFiscalIdLabel(seller.country)} au bon format`, { tab: 'business', field: FIELD_IDS.ifu }),
    row('seller-rccm', 'RCCM', { tab: 'business', field: FIELD_IDS.rccm }),
    row('seller-regime', 'Régime fiscal', { tab: 'business', field: FIELD_IDS.regime }),
    row('seller-division', 'Division fiscale', { tab: 'business', field: FIELD_IDS.division }),
    ...(cadastralRequired(seller.country) ? [row('seller-cadastre', 'Référence cadastrale', { tab: 'business', field: FIELD_IDS.cadastre })] : []),
    payments === null
      ? { key: 'seller-bank', label: 'Coordonnées bancaires', state: 'unknown' as const, hint: 'Non vérifiées : les moyens de paiement n’ont pas pu être chargés.', fix: { tab: 'payments' as const } }
      : row('seller-bank', 'Coordonnées bancaires', { tab: 'payments' }, 'Paiements'),
    { key: 'numbering', label: 'Numérotation continue par exercice', state: 'auto' },
    { key: 'mentions', label: 'Total en lettres, date, heure et opérateur', state: 'auto' },
  ];
  return rows;
}

/** How many lines still need the user. */
export const checklistMissing = (rows: ChecklistRow[]) => rows.filter(r => r.state === 'missing').length;
