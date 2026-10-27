import type { ReactNode } from 'react';
import Icon from '@/components/Icon';

export interface PageTab<K extends string> {
  key:    K;
  label:  string;
  icon:   string;
  count?: number;
  /** Shown instead of the count when the tab needs a higher plan. */
  badge?: ReactNode;
}

/** Segmented tab switcher used at the top of a list, on the same row as its filters. */
export default function PageTabs<K extends string>({ tabs, active, onChange }: {
  tabs:     PageTab<K>[];
  active:   K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="page-tabs" role="tablist">
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={'page-tab' + (active === t.key ? ' active' : '')}
          onClick={() => onChange(t.key)}
        >
          <Icon name={t.icon} size={14} ariaHidden />
          {t.label}
          {t.badge ?? (t.count !== undefined && <span className="page-tab-cnt">{t.count}</span>)}
        </button>
      ))}
    </div>
  );
}
