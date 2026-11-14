import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import UpgradeModal from '@/components/UpgradeModal';
import { useApp } from '@/context/AppContext';
import { PLAN_LABELS, minPlanForFeature, type Feature } from '@/lib/plans';
import BillioMark from '@/components/BillioMark';
import { ACCOUNTING_ENABLED } from '@/lib/features';
import { ROUTE_FEATURE } from '@/lib/nav';

type NavItem = { icon: string; label: string; to: string };

const NAV_WORKSPACE: NavItem[] = [
  { icon: 'layout-dashboard', label: 'Tableau de bord', to: '/dashboard' },
  { icon: 'receipt',          label: 'Facturation',     to: '/invoices'  },
  { icon: 'users',            label: 'Contacts',        to: '/contacts'  },
  { icon: 'package',          label: 'Produits',        to: '/products'  },
  { icon: 'layout-grid',      label: 'Modèles',         to: '/templates' },
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
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  // Menu keyboard support: focus the first item on open, arrows move, Escape returns to the pill
  useEffect(() => {
    if (!menuOpen) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey  = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); pillRef.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = items();
      if (list.length === 0) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next].focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

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

          {ACCOUNTING_ENABLED && (<>
            <div className="nav-section">Comptabilité</div>
            {NAV_ACCOUNTING
              .filter(({ to }) => to !== '/accounting/opening-balances' || !openingBalancesAdopted)
              .map(item => renderNavItem(item))
            }
          </>)}

          <div className="nav-section">Compte</div>
          {NAV_ACCOUNT.map(item => renderNavItem(item))}
        </nav>

        <div className="sidebar-bottom" ref={menuRef}>
          {menuOpen && (
            <div className="user-menu" role="menu" aria-label="Compte">
              <button type="button" role="menuitem" className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/settings'); }}>
                <Icon name="settings" size={15} ariaHidden /> Paramètres
              </button>
              <button type="button" role="menuitem" className="user-menu-item danger" onClick={() => { setMenuOpen(false); onLogout(); }}>
                <Icon name="logout" size={15} ariaHidden /> Se déconnecter
              </button>
            </div>
          )}
          <button
            ref={pillRef}
            type="button"
            className="user-pill"
            onClick={() => setMenuOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <div className="avatar">{userInitials}</div>
            <div style={{ textAlign: 'left' }}>
              <div className="user-name">{userLabel || '…'}</div>
              <div className="user-plan">Plan {PLAN_LABELS[plan]}</div>
            </div>
            <Icon name="chevron-up" ariaHidden />
          </button>
        </div>
      </aside>
    </>
  );
}
