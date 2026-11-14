// The ERP top bar (PRO-161), shown instead of the side menu when VITE_UI_V2
// is on. Areas across the top; Facturation and Comptabilité open a menu of
// their pages on hover, on focus, or with the ▾ button (touch and keyboard).
// Settings, templates and sign-out live in the account menu.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import BillioMark from '@/components/BillioMark';
import UpgradeModal from '@/components/UpgradeModal';
import { useApp } from '@/context/AppContext';
import { ACCOUNTING_ENABLED } from '@/lib/features';
import { PLAN_LABELS, minPlanForFeature, type Feature } from '@/lib/plans';
import { ACCOUNTING_MENU, SALES_MENU, isLinkActive, type MenuGroup, type MenuLink } from '@/lib/nav';

export default function TopNav({ onLogout }: { onLogout: () => void }) {
  const { invoices, openingBalancesAdopted, hasFeature } = useApp();
  const { pathname } = useLocation();
  const [locked, setLocked] = useState<Feature | null>(null);

  const overdue = useMemo(() => invoices.filter(i => i.status === 'overdue').length, [invoices]);
  const salesActive = pathname.startsWith('/invoices') || pathname.startsWith('/quotes');
  const accountingMenu = useMemo<MenuGroup[]>(() => ACCOUNTING_MENU.map(g => ({
    ...g,
    // Same rule as the side menu: once opening balances are adopted the page is done
    links: g.links.filter(l => l.to !== '/accounting/opening-balances' || !openingBalancesAdopted),
  })), [openingBalancesAdopted]);

  return (
    <>
      {locked && <UpgradeModal feature={locked} onClose={() => setLocked(null)} />}
      <header className="topnav">
        <NavLink to="/dashboard" className="tn-brand" aria-label="Billio, tableau de bord">
          <span className="tn-mark"><BillioMark size={16} /></span>
          <span className="tn-name">Billio</span>
        </NavLink>

        <nav className="tn-areas" aria-label="Navigation principale">
          <NavLink to="/dashboard" className={({ isActive }) => `tn-link${isActive ? ' on' : ''}`}>Tableau de bord</NavLink>
          <AreaMenu
            label="Facturation" to="/invoices" active={salesActive}
            badge={overdue > 0 ? <span className="tn-count" aria-label={`${overdue} en retard`}>{overdue}</span> : undefined}
            groups={[{ title: '', links: SALES_MENU }]}
            hasFeature={hasFeature} onLocked={setLocked}
          />
          <NavLink to="/contacts" className={({ isActive }) => `tn-link${isActive ? ' on' : ''}`}>Contacts</NavLink>
          <NavLink to="/products" className={({ isActive }) => `tn-link${isActive ? ' on' : ''}`}>Produits</NavLink>
          {ACCOUNTING_ENABLED && (
            <AreaMenu
              label="Comptabilité" to={accountingMenu[0].links[0].to} active={pathname.startsWith('/accounting')}
              groups={accountingMenu} wide
              hasFeature={hasFeature} onLocked={setLocked}
            />
          )}
        </nav>

        <AccountMenu onLogout={onLogout} />
      </header>
    </>
  );
}

/** Items of an open menu: arrows move between them, Escape closes. */
function useMenuKeys(open: boolean, menuRef: React.RefObject<HTMLElement | null>, close: (refocus: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const list = items();
      if (!list.length || !menuRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1
        : e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next].focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, menuRef, close]);
}

function AreaMenu({ label, to, active, badge, groups, wide, hasFeature, onLocked }: {
  label: string; to: string; active: boolean; badge?: ReactNode; groups: MenuGroup[]; wide?: boolean;
  hasFeature: (f: Feature) => boolean; onLocked: (f: Feature) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  const menuId = useId();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  const close = useMemo(() => (refocus: boolean) => {
    setOpen(false);
    if (refocus) toggleRef.current?.focus();
  }, []);
  useMenuKeys(open, menuRef, close);

  // Close on a click or focus outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('focusin', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('focusin', onDown); };
  }, [open]);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  const go = (link: MenuLink) => {
    setOpen(false);
    if (link.feature && !hasFeature(link.feature)) { onLocked(link.feature); return; }
    navigate(link.to);
    // A ?tab= switch keeps the same path, so <Page> won't move focus itself:
    // put it on the new page's heading rather than leaving it on the closed menu
    requestAnimationFrame(() => document.querySelector<HTMLElement>('h1.page-h1')?.focus({ preventScroll: true }));
  };

  return (
    <div
      ref={rootRef}
      className={`tn-area${active ? ' on' : ''}`}
      onMouseEnter={() => { window.clearTimeout(leaveTimer.current); setOpen(true); }}
      onMouseLeave={() => { leaveTimer.current = window.setTimeout(() => setOpen(false), 150); }}
    >
      <NavLink to={to} className="tn-link" aria-current={active ? 'page' : undefined}>
        {label}{badge}
      </NavLink>
      <button
        ref={toggleRef}
        type="button"
        className="tn-toggle"
        aria-label={`Pages de ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
          }
        }}
      >
        <Icon name="chevron-down" size={14} ariaHidden />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label={label} className={`tn-menu${wide ? ' wide' : ''}`}>
          {groups.map(g => (
            <div key={g.title || 'all'} className="tn-group" role="group" aria-label={g.title || undefined}>
              {g.title && <div className="tn-group-title" aria-hidden="true">{g.title}</div>}
              {g.links.map(link => {
                const isLocked = !!link.feature && !hasFeature(link.feature);
                const current = isLinkActive(link.to, pathname, search);
                return (
                  <button
                    key={link.to}
                    type="button"
                    role="menuitem"
                    className={`tn-mi${current ? ' on' : ''}`}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => go(link)}
                  >
                    <span className="tn-mi-label">
                      {link.label}
                      {isLocked && link.feature && (
                        <span className={`nav-plan-badge nav-plan-badge--${minPlanForFeature(link.feature)}`}>
                          {PLAN_LABELS[minPlanForFeature(link.feature)]}
                        </span>
                      )}
                    </span>
                    <span className="tn-mi-hint">{link.hint}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountMenu({ onLogout }: { onLogout: () => void }) {
  const { userLabel, userInitials, plan } = useApp();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const close = useMemo(() => (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);
  useMenuKeys(open, menuRef, close);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('focusin', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('focusin', onDown); };
  }, [open]);

  const go = (to: string) => { setOpen(false); navigate(to); };

  return (
    <div ref={rootRef} className="tn-account">
      <button
        ref={btnRef}
        type="button"
        className="tn-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Compte de ${userLabel || 'l’utilisateur'}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="tn-avatar">{userInitials}</span>
        <Icon name="chevron-down" size={14} ariaHidden />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Compte" className="tn-menu tn-menu-right">
          <div className="tn-who">
            <b>{userLabel || '…'}</b>
            <small>Plan {PLAN_LABELS[plan]}</small>
          </div>
          <button type="button" role="menuitem" className="tn-mi" onClick={() => go('/settings')}>
            <span className="tn-mi-label"><Icon name="settings" size={15} ariaHidden /> Paramètres</span>
          </button>
          <button type="button" role="menuitem" className="tn-mi" onClick={() => go('/templates')}>
            <span className="tn-mi-label"><Icon name="layout-grid" size={15} ariaHidden /> Modèles de facture</span>
          </button>
          <div className="tn-sep" role="separator" />
          <button type="button" role="menuitem" className="tn-mi danger" onClick={() => { setOpen(false); onLogout(); }}>
            <span className="tn-mi-label"><Icon name="logout" size={15} ariaHidden /> Se déconnecter</span>
          </button>
        </div>
      )}
    </div>
  );
}
