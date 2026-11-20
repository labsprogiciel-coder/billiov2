import { useState } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import posthog from 'posthog-js';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { invoiceRef } from '@/lib/invoice-number';
import { fetchLineItems } from '@/lib/api/line-items';
import { claimOriginal } from '@/lib/api/invoices';
import { originalOrCopy, partiesAtIssue } from '@/lib/invoice-copy';
import { renderInvoicePdf } from '@/lib/render-pdf';
import { paymentUrlForInvoice } from '@/lib/api/payment-links';
import { downloadBlob } from '@/lib/download';
import { paymentMethodsNotReadyMessage, usePaymentMethods } from '@/lib/use-payment-methods';
import Page from '@/components/Page';
import InvoiceList from '@/components/sales/InvoiceList';
import { useCommandIntent } from '@/lib/command-intent';

/** Factures: the list (PRO-165). Invoices are written on their own page, /invoices/new (PRO-167). */
export default function InvoicesPage() {
  const { writable } = usePermissions();
  const { invoices, setInvoices, showToast, clientsMap, orgSettings, invoiceTemplate, orgId, loading } = useApp();
  const navigate = useNavigate();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { lines: paymentMethods, status: paymentMethodsStatus, online } = usePaymentMethods();

  // From the command box (PRO-162): a new invoice, maybe for a client; the late ones
  const [showLate, setShowLate] = useState(0);
  useCommandIntent(intent => {
    if (intent.command === 'show-late') { setShowLate(n => n + 1); return; }
    if (intent.command !== 'new-invoice' || !writable) return false;
    navigate(intent.client ? `/invoices/new?client=${encodeURIComponent(intent.client)}` : '/invoices/new', { replace: true });
    return 'navigated';
  }, !loading);

  // Same PDF as the invoice page, without leaving the list
  const downloadPdf = async (id: string) => {
    const invoice = invoices.find(i => i.id === id);
    if (!invoice || downloadingId) return;
    if (paymentMethodsStatus !== 'ready') { showToast(paymentMethodsNotReadyMessage(paymentMethodsStatus), true); return; }
    setDownloadingId(id);
    try {
      const lines = await fetchLineItems(orgId, { invoiceId: id });
      if (lines.length === 0) {
        showToast('Cette facture n\'a aucune ligne : ouvrez-la pour vérifier avant de télécharger le PDF.', true);
        return;
      }
      // The first PDF of an issued invoice is the original, every later one a « DUPLICATA » drawn as issued (PRO-144)
      const { biz, client } = partiesAtIssue(invoice, orgSettings, clientsMap[invoice.client] ?? { name: invoice.client, city: '—', av: 'av-a' });
      const paymentUrl = await paymentUrlForInvoice(orgId, invoice, online);
      const blob = await originalOrCopy(invoice, () => claimOriginal(orgId, invoice.id, setInvoices), duplicate => renderInvoicePdf({
        template: invoiceTemplate,
        invoice, lines, client, biz, duplicate,
        paymentTerms: orgSettings.paymentTerms || 'Net 14 jours',
        deliveryTerms: orgSettings.deliveryTerms || 'À convenir',
        paymentMethods,
        paymentUrl,
      }));
      downloadBlob(blob, `facture-${invoiceRef(invoice).toLowerCase()}.pdf`);
      posthog.capture('invoice_pdf_downloaded', { invoice_id: id, from: 'list' });
    } catch (err) {
      console.error('[downloadPdf] failed:', err);
      showToast('Impossible de générer le PDF. Veuillez réessayer.', true);
    } finally {
      setDownloadingId(null);
    }
  };

  // Sending happens from the invoice page's send dialog (email / WhatsApp)
  const openSend = (id: string) => navigate(`/invoices/${id}`, { state: { openSend: true } });

  if (loading) return <PageSkeleton title="Factures" subtitle="Gérez et suivez vos factures" metrics={4} rows={6} />;

  return (
    <Page
      title="Factures"
      subtitle="Gérez et suivez vos factures"
      actions={writable && (
        <button className="btn btn-primary" onClick={() => navigate('/invoices/new')}>
          <Icon name="plus" ariaHidden /> Nouvelle facture
        </button>
      )}
    >
      <InvoiceList
        writable={writable}
        onOpen={id => navigate(`/invoices/${id}`)}
        onSend={openSend}
        onDownload={id => void downloadPdf(id)}
        downloading={downloadingId !== null}
        showLate={showLate}
      />
    </Page>
  );
}
