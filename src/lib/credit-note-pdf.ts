// The « FACTURE D'AVOIR » PDF of a credit note (PRO-168), from the invoice
// template, like invoices.

import { renderInvoicePdf } from '@/lib/render-pdf';
import { invoiceRef } from '@/lib/invoice-number';
import { printedNature } from '@/lib/credit-note';
import { splitTtc } from '@/lib/vat';
import type { InvoicePDFProps } from '@/components/InvoicePDF';
import type { CreditNote, Invoice, LineItem } from '@/lib/schemas';

export async function renderCreditNotePdf(opts: {
  creditNote: CreditNote;
  invoice: Invoice;
  /** Whether the original invoice charged VAT: for credit notes without lines */
  chargedVat: boolean;
  client: InvoicePDFProps['client'];
  biz: InvoicePDFProps['biz'];
  template: InvoicePDFProps['template'];
}): Promise<Blob> {
  const { creditNote: cn, invoice } = opts;
  // Credit notes from before PRO-168 only have an amount: one line for it
  const lines: LineItem[] = cn.lines.length > 0
    ? cn.lines
    : [{ id: 'avoir', desc: cn.subject || `Avoir sur ${invoiceRef(invoice)}`, unit: 'unité', qty: 1, price: splitTtc(cn.amount, opts.chargedVat).ht }];
  return renderInvoicePdf({
    template: opts.template,
    invoice: {
      id: cn.id, number: cn.number, subject: cn.reason, client: cn.client, issued: cn.issued, due: cn.issued,
      amount: cn.amount, status: cn.status === 'issued' ? 'pending' : 'draft', discountPct: cn.lines.length > 0 ? cn.discountPct : 0,
      firstIssuedAt: cn.issuedTs, issuedByName: cn.issuedByName,
    },
    lines,
    client: opts.client,
    biz: opts.biz,
    title: 'Facture d’avoir',
    documentKind: 'avoir',
    clientLabel: 'Avoir au profit de',
    creditNote: {
      nature: cn.nature ? printedNature(cn.nature) : '—',
      // For a discount (RRR) the DGI's original reference is « RRR »; the balance is still reduced on the invoice
      originalRef: cn.nature === 'RRR' ? 'RRR' : invoiceRef(invoice),
      creditedRef: invoiceRef(invoice),
      originalIssued: invoice.issued,
      reason: cn.reason,
      storedTotal: cn.amount,
    },
  });
}

/** Opens a PDF in a tab opened beforehand (while the click still counted). */
export function showPdf(blob: Blob, tab: Window | null) {
  const url = URL.createObjectURL(blob);
  if (tab) tab.location.href = url; else window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
