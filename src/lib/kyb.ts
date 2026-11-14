// The KYB file of a client (PRO-176): which business documents its type
// needs, and the state of each from what is stored (client_documents).
// The list and the validity periods are a proposal to confirm.

import type { ClientType } from '@/lib/client-type';

export interface KybDoc {
  key: string;
  label: string;
  /** Months a copy stays valid after its issue date, when the document says so. */
  validityMonths?: number;
}

const RCCM: KybDoc     = { key: 'rccm', label: 'Extrait RCCM' };
const IFU: KybDoc      = { key: 'ifu', label: 'Attestation IFU' };
const STATUTS: KybDoc  = { key: 'statuts', label: 'Statuts de la société' };
const ASF: KybDoc      = { key: 'asf', label: 'Attestation de situation fiscale', validityMonths: 3 };
const CNSS: KybDoc     = { key: 'cnss', label: 'Attestation CNSS', validityMonths: 3 };
const CNIB_GERANT: KybDoc = { key: 'cnib-gerant', label: 'CNIB du gérant' };
const CNIB: KybDoc     = { key: 'cnib', label: 'CNIB ou passeport' };
const RIB: KybDoc      = { key: 'rib', label: 'Relevé d’identité bancaire (RIB)' };

export const KYB_DOCS: Record<ClientType, KybDoc[]> = {
  PM: [RCCM, IFU, STATUTS, ASF, CNSS, CNIB_GERANT, RIB],
  PC: [RCCM, IFU, ASF, CNIB],
  PP: [CNIB],
  CC: [],
};

/** A stored document (a row of client_documents). */
export interface ClientDocument {
  id: string;
  clientCode: string;
  docType: string;
  filePath: string;
  fileName: string;
  issuedOn?: string;
  expiresOn?: string;
  status: 'pending' | 'verified' | 'rejected';
  uploadedByName?: string;
  uploadedAt?: string;
  verifiedByName?: string;
  verifiedAt?: string;
}

export type KybState = 'verified' | 'expiring' | 'to-check' | 'expired' | 'rejected' | 'missing';

export interface KybItem {
  doc: KybDoc;
  stored?: ClientDocument;
  state: KybState;
  /** Last day of validity, when known. */
  validUntil?: string;
  /** Days left, for « Expire dans N j ». */
  daysLeft?: number;
}

/** Warn this many days before a document expires. */
export const EXPIRY_WARNING_DAYS = 30;

/** Adds months to a YYYY-MM-DD date (same day, clamped to the month's end). */
export function addMonths(isoDay: string, months: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** Last day a document is valid: its expiry date, else its issue date plus the document's validity. */
export function validUntil(doc: KybDoc, stored: Pick<ClientDocument, 'issuedOn' | 'expiresOn'>): string | undefined {
  if (stored.expiresOn) return stored.expiresOn;
  if (doc.validityMonths && stored.issuedOn) return addMonths(stored.issuedOn, doc.validityMonths);
  return undefined;
}

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);

export function kybItems(type: ClientType, stored: ClientDocument[], today: string): KybItem[] {
  return KYB_DOCS[type].map(doc => {
    const s = stored.find(d => d.docType === doc.key);
    if (!s) return { doc, state: 'missing' as const };
    const until = validUntil(doc, s);
    const daysLeft = until ? dayDiff(today, until) : undefined;
    let state: KybState;
    if (daysLeft !== undefined && daysLeft < 0) state = 'expired';
    else if (s.status === 'rejected') state = 'rejected';
    else if (s.status === 'pending') state = 'to-check';
    else if (daysLeft !== undefined && daysLeft <= EXPIRY_WARNING_DAYS) state = 'expiring';
    else state = 'verified';
    return { doc, stored: s, state, validUntil: until, daysLeft };
  });
}

export interface KybSummary {
  required: number;
  /** Checked and still valid (including those expiring soon). */
  verified: number;
  toCheck: number;
  expired: number;
  /** Missing, or refused (a new one is needed). */
  missing: number;
  /** Every required document is checked and valid. */
  complete: boolean;
  /** Something for the team to do: missing, expired, refused or to check. */
  needsAttention: boolean;
}

export function kybSummary(items: KybItem[]): KybSummary {
  const n = (...states: KybState[]) => items.filter(i => states.includes(i.state)).length;
  const verified = n('verified', 'expiring');
  const s = { required: items.length, verified, toCheck: n('to-check'), expired: n('expired'), missing: n('missing', 'rejected') };
  return { ...s, complete: verified === items.length, needsAttention: s.toCheck + s.expired + s.missing > 0 };
}

/** « 4 sur 7 vérifiés · 1 expiré · 1 manquant » */
export function kybSummaryLabel(s: KybSummary): string {
  if (s.required === 0) return 'Aucun document demandé';
  const parts = [`${s.verified} sur ${s.required} vérifié${s.verified > 1 ? 's' : ''}`];
  if (s.toCheck) parts.push(`${s.toCheck} à vérifier`);
  if (s.expired) parts.push(`${s.expired} expiré${s.expired > 1 ? 's' : ''}`);
  if (s.missing) parts.push(`${s.missing} manquant${s.missing > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

export const KYB_STATE_LABEL: Record<KybState, string> = {
  verified: 'Vérifié', expiring: 'Expire bientôt', 'to-check': 'À vérifier', expired: 'Expiré', rejected: 'Refusé', missing: 'Manquant',
};

/** Label of an item's state, with the days left when it expires soon. */
export function kybStateLabel(item: KybItem): string {
  if (item.state === 'expiring' && item.daysLeft !== undefined) return item.daysLeft === 0 ? 'Expire aujourd’hui' : `Expire dans ${item.daysLeft} j`;
  return KYB_STATE_LABEL[item.state];
}

/** The documents to ask the client for: missing, refused, expired or about to expire. */
export function documentsToRequest(items: KybItem[]): KybItem[] {
  return items.filter(i => i.state === 'missing' || i.state === 'rejected' || i.state === 'expired' || i.state === 'expiring');
}

/** The message of « Demander les pièces ». */
export function kybRequestMessage(clientName: string, orgName: string, items: KybItem[]): string {
  const lines = documentsToRequest(items).map(i => {
    const why = i.state === 'expired' ? ' (expiré)' : i.state === 'expiring' ? ' (bientôt expiré)' : i.state === 'rejected' ? ' (à renvoyer)' : '';
    return `- ${i.doc.label}${why}`;
  });
  return [
    `Bonjour ${clientName},`,
    '',
    `Pour tenir à jour votre dossier client chez ${orgName || 'nous'}, pourriez-vous nous transmettre les documents suivants :`,
    ...lines,
    '',
    'Merci d’avance.',
    orgName,
  ].join('\n').trim();
}
