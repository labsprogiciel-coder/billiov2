// The command box of the ERP top bar (PRO-162): opened by a click or Ctrl K
// (Cmd K on a Mac). Empty, it lists quick actions and pages; typing searches
// clients, invoices and quotes. Arrows move, Enter opens, Escape closes.
// The quick actions also run from their single key (N, D, P, C) anywhere
// outside a text field. What is listed comes from src/lib/commands.ts.

import { Fragment, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import StatusPill from '@/components/sales/StatusPill';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { highlight } from '@/lib/command-search';
import { withIntent } from '@/lib/command-intent';
import {
  actionForKey, buildCommandIndex, commandResults, type CommandAccess, type CommandItem,
} from '@/lib/commands';
import { SALES_TAB_FEATURE } from '@/lib/nav';
import { fmt } from '@/data';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const SHORTCUT_LABEL = IS_MAC ? '⌘ K' : 'Ctrl K';
/** Backdrops of the app's modals and side panels, while one is open. */
const OVERLAY_OPEN = '.scrim.open, .acc-scrim.open, .ig-scrim.open, .inv-overlay, [aria-modal="true"]';

/** Typing goes to this element: shortcuts must leave it alone. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export default function CommandBox() {
  const { clients, invoices, quotes, hasFeature } = useApp();
  const { writable, managesOrg } = usePermissions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-o${i}`;

  const access = useMemo<CommandAccess>(() => ({
    writable, managesOrg,
    quotes: hasFeature(SALES_TAB_FEATURE.quotes!),
    payments: hasFeature(SALES_TAB_FEATURE.payments!),
  }), [writable, managesOrg, hasFeature]);

  // Folded once per data change; built only while the box is open
  const index = useMemo(() => open ? buildCommandIndex(clients, invoices, quotes) : null, [open, clients, invoices, quotes]);
  // Typing stays responsive: results catch up a moment later on large lists
  const deferred = useDeferredValue(query);
  const results = useMemo(() => index ? commandResults(deferred, index, access) : [], [deferred, index, access]);
  useEffect(() => { setActive(0); }, [deferred]);

  const show = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    setOpen(true);
  }, []);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) returnFocus.current?.focus?.();
  }, []);

  const run = useCallback((item: CommandItem) => {
    close(false);
    navigate(item.to, item.intent ? withIntent(item.intent) : undefined);
  }, [close, navigate]);

  // Ctrl K / Cmd K from anywhere; a quick action's key outside text fields
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close(); else show();
        return;
      }
      if (open || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.length !== 1) return;
      if (isTypingTarget(e.target)) return;
      // Not while a dialog, menu or slide-over panel is open: a stray key
      // would leave the page and lose what is being filled in
      if (e.target instanceof Element && e.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      if (document.querySelector(OVERLAY_OPEN)) return;
      const action = actionForKey(e.key, access);
      if (!action) return;
      e.preventDefault();
      run(action);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, show, close, run, access]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  const onInputKey = (e: React.KeyboardEvent) => {
    const n = results.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); setActive(i => (i + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setActive(i => (i - 1 + n) % n); }
    else if (e.key === 'Home' && n && !query) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && n && !query) { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const item = results[active]; if (item) run(item); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    // The box is modal and its input is the only stop: keep focus here
    else if (e.key === 'Tab') e.preventDefault();
  };

  const searching = deferred.trim() !== '';
  let lastGroup = '';

  return (
    <>
      <button type="button" className="tn-cmd" onClick={show} aria-haspopup="dialog" aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}>
        <Icon name="search" size={14} ariaHidden />
        <span className="tn-cmd-label">Rechercher ou lancer une commande</span>
        <kbd>{SHORTCUT_LABEL}</kbd>
      </button>

      {open && (
        <div className="cmd-scrim" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
          <div className="cmd-panel" role="dialog" aria-modal="true" aria-label="Rechercher ou lancer une commande">
            <div className="cmd-input">
              <Icon name="search" size={16} ariaHidden />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={results.length ? optionId(active) : undefined}
                aria-autocomplete="list"
                aria-label="Rechercher un client, une facture, un devis ou une commande"
                placeholder="Client, IFU, n° de facture ou de devis, commande…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                autoComplete="off"
                spellCheck={false}
              />
              <kbd>Échap</kbd>
            </div>

            <div id={listId} role="listbox" aria-label="Résultats" className="cmd-list">
              {results.length === 0 && (
                <div className="cmd-empty" role="presentation">Aucun résultat pour « {deferred.trim()} »</div>
              )}
              {results.map((item, i) => {
                const heading = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <Fragment key={item.id}>
                    {heading && <div className="cmd-group" role="presentation">{heading === 'Pages' && !searching ? 'Aller à' : heading}</div>}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      className={`cmd-item${i === active ? ' on' : ''}`}
                      onMouseMove={() => { if (i !== active) setActive(i); }}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => run(item)}
                    >
                      <span className="cmd-ico"><Icon name={item.icon} size={15} ariaHidden /></span>
                      <span className="cmd-text">
                        <span className="cmd-title"><Marked text={item.title} query={searching ? deferred : ''} /></span>
                        {item.detail && <span className="cmd-detail"><Marked text={item.detail} query={searching ? deferred : ''} /></span>}
                      </span>
                      {item.amount !== undefined && <span className="cmd-amount">{fmt(item.amount)} <small>F CFA</small></span>}
                      {item.status && <StatusPill {...item.status} />}
                      {item.shortcut && <kbd aria-label={`Raccourci ${item.shortcut}`}>{item.shortcut}</kbd>}
                    </div>
                  </Fragment>
                );
              })}
            </div>

            <div className="cmd-foot" aria-hidden="true">
              <span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span>
              <span><kbd>Entrée</kbd> ouvrir</span>
              <span><kbd>Échap</kbd> fermer</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  return <>{highlight(text, query).map((c, i) => c.hit ? <mark key={i}>{c.text}</mark> : <Fragment key={i}>{c.text}</Fragment>)}</>;
}
