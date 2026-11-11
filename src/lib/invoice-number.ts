// Legal invoice numbers (PRO-141; DGI spec v2.0, 2.18): the database gives an
// invoice its number (FACT-2026-0001) when it is issued, from an unbroken
// series per organisation and year. Drafts have no number yet and are shown by
// their internal reference.

import type { CreditNote, Invoice } from '@/lib/schemas';

/**
 * Internal reference of a new invoice (its key; drafts are shown by it). It is
 * not the legal number: the database gives that when the invoice is issued
 * (invoices.number, supabase/migrations/20261113_invoice_numbering.sql), so
 * drafts never use up a number.
 */
export function newDraftId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return 'BR-' + rand.slice(0, 8).toUpperCase();
}

/** What to show for an invoice: its legal number, or its draft reference. */
export function invoiceRef(inv: Pick<Invoice, 'id' | 'number'>): string {
  return inv.number ?? inv.id;
}

/** What to show for a credit note: its legal number (older ones: their id). */
export function creditNoteRef(cn: Pick<CreditNote, 'id' | 'number'>): string {
  return cn.number ?? cn.id;
}

/** The database refused to delete (or un-issue) an issued invoice or credit note. */
export function isIssuedLockedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ('code' in err && (err as { code: unknown }).code === 'BL002') return true;
  const msg = 'message' in err ? String((err as { message: unknown }).message) : '';
  return msg.includes('issued_invoice_locked') || msg.includes('issued_document_locked');
}
