import { Navigate, useSearchParams } from 'react-router-dom';
import InvoicesPage from '@/pages/InvoicesPage';
import { salesTabRedirect } from '@/lib/sales-tables';

/**
 * /invoices: the invoice list. Devis and Paiements are pages of their own (/quotes, /payments,
 * PRO-165); old ?tab= links go there.
 */
export default function SalesPage() {
  const [searchParams] = useSearchParams();
  const to = salesTabRedirect(searchParams.get('tab'));
  return to ? <Navigate to={to} replace /> : <InvoicesPage />;
}
