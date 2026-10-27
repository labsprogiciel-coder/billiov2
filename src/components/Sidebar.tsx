import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import Icon from '@/components/Icon';
import UpgradeModal from '@/components/UpgradeModal';
import { useApp } from '@/context/AppContext';
import { PLAN_LABELS, minPlanForFeature, type Feature } from '@/lib/plans';
import BillioMark from '@/components/BillioMark';

type NavItem = { icon: string; label: string; to: string };

const NAV_WORKSPACE: NavItem[] = [
  { icon: 'layout-dashboard', label: 'Tableau de bord', to: '/dashboard' },
  { icon: 'receipt',          label: 'Facturation',     to: '/invoices'  },
  { icon: 'users',            label: 'Contacts',        to: '/contacts'  },
  { icon: 'package',          label: 'Produits',        to: '/products'  },
  { icon: 'layout-grid',      label: 'Modèles',         to: '/templates' },
];

const NAV_FINANCE: NavItem[] = [
  { icon: 'chart-bar',   label: 'Rapports',  to: '/reports'  },
  { icon: 'credit-card', label: 'Paiements', to: '/payments' },
];

const NAV_ACCOUNTING: NavItem[] = [
  { icon: 'arrows-exchange',    label: 'Ouverture',        to: '/accounting/opening-balances'     },
  { icon: 'book',               label: 'Plan comptable',   to: '/accounting/chart-of-accounts'    },
  { icon: 'notebook',           label: 'Journaux',         to: '/accounting/journals'             },
  { icon: 'book-2',             label: 'Balance générale', to: '/accounting/trial-balance'        },
  { icon: 'report-money',       label: 'États financiers', to: '/accounting/financial-statements' },
  { icon: 'building-warehouse', label: 'Immobilisations',  to: '/accounting/fixed-assets'         },
  { icon: 'percentage',         label: 'Fiscalité',        to: '/accounting/tax'                  },
  { icon: 'lock',               label: 'Clôture',          to: '/accounting/period-closing'       },
];

const NAV_ACCOUNT: NavItem[] = [
  { icon: 'settings', label: 'Paramètres', to: '/settings' },
];

// Maps each route to the Feature that must be unlocked to access it.
// Routes not listed here are available on all plans (including Solo).
//
// Solo now includes: basic DGI-compliant accounting, financial statements,
// basic VAT tracking, online payment links — so those routes are ungated.
// Business+ gates: full SYSCOHADA, unlimited invoicing, quotes, AI reminders.
// Cabinet+ gates: fixed assets, period closing.
const ROUTE_FEATURE: Record<string, Feature> = {
  // Business+
  '/reports':                            'reports',
  '/payments':                           'payments_mobilemoney',
  '/accounting/opening-balances':        'accounting_syscohada',
  '/accounting/chart-of-accounts':       'accounting_syscohada',
  '/accounting/journals':                'accounting_syscohada',
  '/accounting/trial-balance':           'accounting_syscohada',
  '/accounting/financial-statements':    'accounting_syscohada',
  '/accounting/tax':                     'accounting_syscohada',
  // Cabinet+
  '/accounting/fixed-assets':            'fixed_assets',
  '/accounting/period-closing':          'period_closing',
};

// Badge colour per plan tier
const PLAN_BADGE_CLASS: Record<string, string> = {
  business:   'nav-plan-badge--business',
  cabinet:    'nav-plan-badge--cabinet',
  enterprise: 'nav-plan-badge--enterprise',
};

export default function Sidebar({ onLogout }: { onLogout: () => void }) {
  const { invoices, userLabel, userInitials, openingBalancesAdopted, plan, hasFeature } = useApp();
  const [lockedFeature, setLockedFeature] = useState<Feature | null>(null);
  // Quote detail pages live under /quotes but belong to the Facturation item
  const onQuotePage = useLocation().pathname.startsWith('/quotes');

  const overdueCount = useMemo(
    () => invoices.filter(i => i.status === 'overdue').length,
    [invoices],
  );

  function renderNavItem({ icon, label, to }: NavItem, extraBadge?: React.ReactNode) {
    const feature = ROUTE_FEATURE[to];
    const locked  = feature ? !hasFeature(feature) : false;

    if (locked) {
      const requiredPlan = minPlanForFeature(feature);
      return (
        <button
          key={to}
          className="nav-item nav-item--locked"
          onClick={() => setLockedFeature(feature)}
        >
          <Icon name={icon} ariaHidden />
          <span className="nav-item-label">{label}</span>
          <span className={`nav-plan-badge ${PLAN_BADGE_CLASS[requiredPlan] ?? ''}`}>
            {PLAN_LABELS[requiredPlan]}
          </span>
        </button>
      );
    }

    return (
      <NavLink
        key={to}
        to={to}
        className={({ isActive }) => `nav-item${isActive || (to === '/invoices' && onQuotePage) ? ' active' : ''}`}
      >
        <Icon name={icon} ariaHidden />
        {label}
        {extraBadge}
      </NavLink>
    );
  }

  return (
    <>
      {lockedFeature && (
        <UpgradeModal feature={lockedFeature} onClose={() => setLockedFeature(null)} />
      )}

      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark">
            <div className="logo-icon"><BillioMark size={18} /></div>
            <div>
              <div className="logo-text">Billio</div>
              <div className="logo-tag">Facturation</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">Workspace</div>
          {NAV_WORKSPACE.map(item => renderNavItem(
            item,
            item.to === '/invoices' && overdueCount > 0
              ? <span className="nav-badge">{overdueCount}</span>
              : undefined,
          ))}

          <div className="nav-section">Finance</div>
          {NAV_FINANCE.map(item => renderNavItem(item))}

          <div className="nav-section">Comptabilité</div>
          {NAV_ACCOUNTING
            .filter(({ to }) => to !== '/accounting/opening-balances' || !openingBalancesAdopted)
            .map(item => renderNavItem(item))
          }

          <div className="nav-section">Compte</div>
          {NAV_ACCOUNT.map(item => renderNavItem(item))}
        </nav>

        <div className="sidebar-bottom">
          <div
            className="user-pill"
            onClick={onLogout}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onLogout()}
            title="Se déconnecter"
            role="button"
            tabIndex={0}
          >
            <div className="avatar">{userInitials}</div>
            <div>
              <div className="user-name">{userLabel || '…'}</div>
              <div className="user-plan">Plan {PLAN_LABELS[plan]}</div>
            </div>
            <Icon name="logout" ariaHidden />
          </div>
        </div>
      </aside>
    </>
  );
}
