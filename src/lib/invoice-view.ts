// What the invoice page of the ERP look (PRO-166) shows besides the document:
// the status badge, the issue line, the activity, the client's total
// balance, and the expected sales entry. Kept free of React to be tested.

import type { CreditNote, Invoice, Payment } from '@/lib/schemas';
import { daysOverdue, invoiceBalance, todayISO } from '@/lib/invoice-status';
import { creditNoteRef } from '@/lib/invoice-number';
import { splitTtc } from '@/lib/vat';
import type { RowStatus } from '@/lib/sales-tables';

/** « En retard · 36 jours », « Payée », … */
export function invoiceBadge(invoice: Pick<Invoice, 'status' | 'due'>, balance: number, paid: number, today: string = todayISO()): RowStatus {
  switch (invoice.status) {
    case 'draft': return { label: 'Brouillon', tone: 'draft' };
    case 'paid': return { label: 'Payée', tone: 'paid' };
    case 'overdue': {
      const d = daysOverdue(invoice.due, today);
      return { label: `En retard · ${d} jour${d > 1 ? 's' : ''}${paid > 0 && balance > 0 ? ' · partiellement payée' : ''}`, tone: 'late' };
    }
    case 'pending':
      if (paid > 0 && balance > 0) return { label: 'Partiellement payée', tone: 'partial' };
      if (invoice.due === today) return { label: 'Échéance aujourd’hui', tone: 'partial' };
      return { label: 'En attente', tone: 'wait' };
  }
}

/** « 14 novembre 2026 à 09:42 » in the user's time zone. */
export function fmtDateTime(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return isoDateTime;
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
}

export interface ActivityEntry {
  /** YYYY-MM-DD (or a full timestamp) to sort by */
  at: string;
  kind: 'created' | 'issued' | 'due' | 'payment' | 'credit' | 'overdue';
  text: string;
}

/** What happened to the invoice, newest first: issued, payments, credit notes, passing its due date. */
export function invoiceActivity(
  invoice: Invoice, payments: Payment[], creditNotes: CreditNote[], fmtAmount: (n: number) => string, today: string = todayISO(),
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  out.push({ at: invoice.issued, kind: 'created', text: invoice.status === 'draft' ? 'Brouillon créé' : 'Facture créée' });
  if (invoice.status !== 'draft') {
    out.push({
      at: invoice.firstIssuedAt ?? invoice.issued, kind: 'issued',
      text: `Émise${invoice.issuedByName ? ` par ${invoice.issuedByName}` : ''}${invoice.number ? ` sous le n° ${invoice.number}` : ''}`,
    });
  }
  for (const p of payments.filter(x => x.inv === invoice.id)) {
    const state = p.status === 'completed' ? '' : p.status === 'pending' ? ' (en attente)' : ' (échoué)';
    out.push({ at: p.date, kind: 'payment', text: `Paiement de ${fmtAmount(p.amount)} F CFA${state}${p.createdByName ? ` · saisi par ${p.createdByName}` : p.source === 'online' ? ' · en ligne' : ''}` });
  }
  for (const c of creditNotes.filter(x => x.invoiceId === invoice.id)) {
    out.push({ at: c.issued, kind: 'credit', text: `Avoir ${creditNoteRef(c)} de ${fmtAmount(c.amount)} F CFA${c.reason ? ` · ${c.reason}` : ''}` });
  }
  if (invoice.status === 'overdue' && invoice.due < today) {
    out.push({ at: invoice.due, kind: 'overdue', text: 'Échéance dépassée' });
  }
  // Newest first; on the same day, the later step first
  const order: Record<ActivityEntry['kind'], number> = { created: 0, issued: 1, due: 2, overdue: 3, credit: 4, payment: 5 };
  return out.sort((a, b) => b.at.slice(0, 10).localeCompare(a.at.slice(0, 10)) || order[b.kind] - order[a.kind]);
}

/** What the client still owes on all its invoices. */
export function clientBalance(code: string, invoices: Invoice[], payments: Payment[], creditNotes: Pick<CreditNote, 'invoiceId' | 'amount'>[]): number {
  return invoices
    .filter(i => i.client === code && (i.status === 'pending' || i.status === 'overdue'))
    .reduce((s, i) => s + invoiceBalance(i, payments, creditNotes).balance, 0);
}

export interface EntryLineView { account: string; label: string; debit: number; credit: number }

/** The sales entry an issued invoice books: 411 at TTC, 706 at HT, 443 for VAT. */
export function expectedSalesEntry(amountTtc: number, chargesVat: boolean): EntryLineView[] {
  const { ht, tva } = splitTtc(amountTtc, chargesVat);
  return [
    { account: '411', label: 'Clients', debit: amountTtc, credit: 0 },
    { account: '706', label: 'Prestations de services', debit: 0, credit: ht },
    ...(tva ? [{ account: '443', label: 'État, TVA facturée', debit: 0, credit: tva }] : []),
  ];
}
