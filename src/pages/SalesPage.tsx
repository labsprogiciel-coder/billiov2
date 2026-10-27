import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageTabs from '@/components/PageTabs';
import UpgradeModal from '@/components/UpgradeModal';
import { useApp } from '@/context/AppContext';
import { PLAN_LABELS, minPlanForFeature } from '@/lib/plans';
import InvoicesPage from '@/pages/InvoicesPage';
import QuotesPage from '@/pages/QuotesPage';

type Tab = 'invoices' | 'quotes';

/** Facturation: one page with a tab per document type (?tab=quotes). */
export default function SalesPage() {
  const { invoices, quotes, hasFeature } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Quotes need a higher plan; a locked tab opens the upgrade modal instead
  const canQuotes       = hasFeature('quotes');
  const requestedQuotes = searchParams.get('tab') === 'quotes';
  const tab: Tab = requestedQuotes && canQuotes ? 'quotes' : 'invoices';

  // A link to the locked quotes tab (e.g. the dashboard's "Nouveau devis")
  // explains why the user lands on invoices instead
  useEffect(() => {
    if (requestedQuotes && !canQuotes) {
      setShowUpgrade(true);
      setSearchParams({}, { replace: true });
    }
  }, [requestedQuotes, canQuotes, setSearchParams]);

  function selectTab(next: Tab) {
    if (next === 'quotes' && !canQuotes) { setShowUpgrade(true); return; }
    setSearchParams(next === 'quotes' ? { tab: 'quotes' } : {}, { replace: true });
  }

  const quotesPlan = minPlanForFeature('quotes');
  const tabs = (
    <PageTabs<Tab>
      tabs={[
        { key: 'invoices', label: 'Factures', icon: 'receipt',   count: invoices.length },
        { key: 'quotes',   label: 'Devis',    icon: 'file-text', count: quotes.length,
          badge: canQuotes ? undefined : <span className={`nav-plan-badge nav-plan-badge--${quotesPlan}`}>{PLAN_LABELS[quotesPlan]}</span> },
      ]}
      active={tab}
      onChange={selectTab}
      idPrefix="sales"
    />
  );

  return (
    <>
      {showUpgrade && <UpgradeModal feature="quotes" onClose={() => setShowUpgrade(false)} />}
      {tab === 'quotes' ? <QuotesPage tabs={tabs} /> : <InvoicesPage tabs={tabs} />}
    </>
  );
}
