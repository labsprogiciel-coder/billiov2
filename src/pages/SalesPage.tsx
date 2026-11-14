import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageTabs from '@/components/PageTabs';
import UpgradeModal from '@/components/UpgradeModal';
import { useApp } from '@/context/AppContext';
import { PLAN_LABELS, minPlanForFeature, type Feature } from '@/lib/plans';
import InvoicesPage from '@/pages/InvoicesPage';
import QuotesPage from '@/pages/QuotesPage';
import PaymentsPage from '@/pages/PaymentsPage';
import { SALES_TAB_FEATURE, type SalesTab } from '@/lib/nav';
import { UI_V2 } from '@/lib/features';

type Tab = SalesTab;
const TAB_FEATURE = SALES_TAB_FEATURE;

function parseTab(value: string | null): Tab {
  return value === 'quotes' || value === 'payments' ? value : 'invoices';
}

/** Facturation: one page with a tab per document type (?tab=quotes|payments). */
export default function SalesPage() {
  const { invoices, quotes, payments, hasFeature } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [lockedFeature, setLockedFeature] = useState<Feature | null>(null);

  const canUse    = (t: Tab) => { const f = TAB_FEATURE[t]; return !f || hasFeature(f); };
  const requested = parseTab(searchParams.get('tab'));
  const tab: Tab  = canUse(requested) ? requested : 'invoices';

  // A link to a locked tab (e.g. the dashboard's "Nouveau devis") explains
  // why the user lands on invoices instead
  const requestedLocked = !canUse(requested);
  useEffect(() => {
    if (requestedLocked) {
      setLockedFeature(TAB_FEATURE[requested] ?? null);
      setSearchParams({}, { replace: true });
    }
  }, [requestedLocked, requested, setSearchParams]);

  function selectTab(next: Tab) {
    if (!canUse(next)) { setLockedFeature(TAB_FEATURE[next] ?? null); return; }
    setSearchParams(next === 'invoices' ? {} : { tab: next }, { replace: true });
  }

  const lockBadge = (t: Tab) => {
    const f = TAB_FEATURE[t];
    if (!f || hasFeature(f)) return undefined;
    const plan = minPlanForFeature(f);
    return <span className={`nav-plan-badge nav-plan-badge--${plan}`}>{PLAN_LABELS[plan]}</span>;
  };

  // In the ERP look the Facturation menu in the top bar replaces these tabs
  const tabs = UI_V2 ? undefined : (
    <PageTabs<Tab>
      tabs={[
        { key: 'invoices', label: 'Factures',  icon: 'receipt',     count: invoices.length },
        { key: 'quotes',   label: 'Devis',     icon: 'file-text',   count: quotes.length,   badge: lockBadge('quotes') },
        { key: 'payments', label: 'Paiements', icon: 'credit-card', count: payments.length, badge: lockBadge('payments') },
      ]}
      active={tab}
      onChange={selectTab}
      idPrefix="sales"
    />
  );

  return (
    <>
      {lockedFeature && <UpgradeModal feature={lockedFeature} onClose={() => setLockedFeature(null)} />}
      {tab === 'quotes'   ? <QuotesPage tabs={tabs} />
     : tab === 'payments' ? <PaymentsPage tabs={tabs} />
     :                      <InvoicesPage tabs={tabs} />}
    </>
  );
}
