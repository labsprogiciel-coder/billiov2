// Mentions an invoice must carry (facture normalisée, CGI art. 562 and
// Arrêté n°2023-216): which of them are missing from the organisation's
// settings or from the client before an invoice is issued.
//
// The list comes from the DGI's summaries and is still to be checked against
// the official texts (PRO-132). Until then Billio warns and lets the user
// issue anyway; it doesn't block.

import { getFiscalIdLabel } from '@/lib/ohada';
import type { PaymentSettings } from '@/lib/api/payment-settings';

export type ComplianceFix = 'business' | 'payments' | 'client';

export interface ComplianceIssue {
  key:   string;
  /** What is missing, as shown to the user */
  label: string;
  /** Where it is filled in */
  fix:   ComplianceFix;
}

export interface SellerInfo {
  name: string; address: string; city: string; country: string;
  ifu: string; rccm: string; taxRegime: string; divisionFiscale: string;
}

export interface ClientInfo {
  name: string; city?: string; country?: string; ifu?: string;
  withholdingScenario?: string;
}

const blank = (v: string | undefined) => !v || !v.trim() || v.trim() === '—';

/** Seller mentions missing from the organisation's settings. */
export function sellerIssues(org: SellerInfo, payments: PaymentSettings | null): ComplianceIssue[] {
  const id = getFiscalIdLabel(org.country);
  const issues: ComplianceIssue[] = [];
  const add = (missing: boolean, key: string, label: string, fix: ComplianceFix = 'business') => {
    if (missing) issues.push({ key, label, fix });
  };
  add(blank(org.name), 'seller-name', "Nom de l'entreprise");
  add(blank(org.address) && blank(org.city), 'seller-address', "Adresse de l'entreprise");
  add(blank(org.ifu), 'seller-ifu', `${id} de l'entreprise`);
  add(blank(org.rccm), 'seller-rccm', 'RCCM');
  add(blank(org.taxRegime), 'seller-regime', "Régime d'imposition");
  add(blank(org.divisionFiscale), 'seller-division', 'Service des impôts de rattachement');
  // null: the payment settings couldn't be loaded, so don't claim they're missing
  if (payments) {
    add(!payments.methodBankEnabled || blank(payments.methodBankIban), 'seller-bank', 'Coordonnées bancaires (RIB / IBAN)', 'payments');
  }
  return issues;
}

/** Client mentions missing from the client's record. */
export function clientIssues(client: ClientInfo | undefined): ComplianceIssue[] {
  if (!client) return [];
  const issues: ComplianceIssue[] = [];
  if (blank(client.city)) issues.push({ key: 'client-address', label: 'Adresse du client', fix: 'client' });
  // A client declared without an IFU (withholding at 25 %) or abroad has none
  const expectsNoIfu = client.withholdingScenario === 'resident-without-ifu' || client.withholdingScenario === 'non-resident';
  if (blank(client.ifu) && !expectsNoIfu) {
    issues.push({ key: 'client-ifu', label: `${getFiscalIdLabel(client.country)} du client (nécessaire pour qu'un client professionnel déduise la TVA)`, fix: 'client' });
  }
  return issues;
}
