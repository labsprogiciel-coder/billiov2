import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import Icon from '@/components/Icon';
import { tabPanelId, tabId } from '@/lib/tab-ids';

export interface PageTab<K extends string> {
  key:    K;
  label:  string;
  icon:   string;
  count?: number;
  /** Shown instead of the count when the tab needs a higher plan. */
  badge?: ReactNode;
}

// Pages render their tab bar inside each tab's content, so switching tabs
// mounts a new bar; the tab picked with the keyboard is focused once it exists.
let pendingFocusId: string | null = null;

/**
 * Segmented tab switcher used at the top of a list, on the same row as its
 * filters. Follows the WAI-ARIA tabs pattern: only the active tab is in the
 * tab order, and Left/Right/Home/End move between tabs.
 */
export default function PageTabs<K extends string>({ tabs, active, onChange, idPrefix }: {
  tabs:     PageTab<K>[];
  active:   K;
  onChange: (key: K) => void;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!pendingFocusId?.startsWith(`${idPrefix}-tab-`)) return;
    document.getElementById(pendingFocusId)?.focus();
    pendingFocusId = null;
  });

  function onKeyDown(e: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
               : e.key === 'ArrowLeft'  ? (index === 0 ? last : index - 1)
               : e.key === 'Home'       ? 0
               : e.key === 'End'        ? last
               : -1;
    if (next < 0) return;
    e.preventDefault();
    pendingFocusId = tabId(idPrefix, tabs[next].key);
    refs.current[next]?.focus();
    onChange(tabs[next].key);
  }

  return (
    <div className="page-tabs" role="tablist">
      {tabs.map((t, i) => (
        <button
          key={t.key}
          ref={el => { refs.current[i] = el; }}
          type="button"
          role="tab"
          id={tabId(idPrefix, t.key)}
          aria-selected={active === t.key}
          aria-controls={tabPanelId(idPrefix)}
          tabIndex={active === t.key ? 0 : -1}
          className={'page-tab' + (active === t.key ? ' active' : '')}
          onClick={() => onChange(t.key)}
          onKeyDown={e => onKeyDown(e, i)}
        >
          <Icon name={t.icon} size={14} ariaHidden />
          {t.label}
          {t.badge ?? (t.count !== undefined && <span className="page-tab-cnt">{t.count}</span>)}
        </button>
      ))}
    </div>
  );
}
