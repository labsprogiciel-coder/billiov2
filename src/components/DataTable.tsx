// The shared dense table of the ERP redesign (PRO-163): summary strip, toolbar
// (Toute l'équipe / Mes … switch, status filters with counts, search, extra filters),
// striped rows that can open a record, a row menu, selection with a bulk
// action bar, and a footer with totals and pages.
//
// Roles: the table doesn't know who is signed in. Each page decides what to
// pass from src/lib/permissions.ts: no `selectable`, `rowActions` or
// `bulkActions` for observers, columns with `hidden` for what a role can't see.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Icon from '@/components/Icon';
import {
  applyTableQuery, filterCounts, paginate, pagerItems, type StatusFilter,
} from '@/lib/data-table';

export type { StatusFilter } from '@/lib/data-table';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** CSS width of the column, e.g. '120px' or '20%'. */
  width?: string;
  /** For a role that mustn't see this column. */
  hidden?: boolean;
}

export interface RowAction<T> {
  label: string;
  icon?: string;
  onSelect: (row: T) => void;
  danger?: boolean;
}

export interface DataTableProps<T> {
  /** What the table lists, for screen readers (e.g. « Factures »). */
  caption: string;
  rows: T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  /** Singular and plural of what a row is: { one: 'facture', many: 'factures' }. */
  noun: { one: string; many: string };
  /** Status filters; « Toutes » is added first. */
  filters?: StatusFilter<T>[];
  allLabel?: string;
  search?: { placeholder: string; text: (row: T) => string };
  /** The « Toute l'équipe / Mes … » switch. */
  mine?: { label: string; allLabel?: string; isMine: (row: T) => boolean; defaultOn?: boolean };
  /** More filters on the right of the toolbar (period, Responsable…). */
  toolbarExtra?: ReactNode;
  /** Makes rows open a record (click, Enter or Space). */
  onRowClick?: (row: T) => void;
  /** Accessible name of a row, e.g. its invoice number. */
  rowLabel: (row: T) => string;
  rowActions?: (row: T) => RowAction<T>[];
  selectable?: boolean;
  /** Buttons of the bar shown while rows are selected. */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  pageSize?: number;
  /** Shown after the count in the footer, e.g. the amount due of the shown rows. */
  footerSummary?: (shown: T[]) => ReactNode;
  emptyMessage?: ReactNode;
  /** Status filter selected at first (e.g. « En retard » from the command box). */
  initialFilter?: string;
  /**
   * Told the rows the filters and search keep (all pages), e.g. for an export of
   * what's listed. Keep them in a ref: setting state here renders the table again.
   */
  onShownChange?: (shown: T[]) => void;
}

export default function DataTable<T>({
  caption, rows, rowKey, columns, noun, filters = [], allLabel = 'Toutes', search, mine,
  toolbarExtra, onRowClick, rowLabel, rowActions, selectable, bulkActions,
  pageSize = 25, footerSummary, emptyMessage, onShownChange, initialFilter,
}: DataTableProps<T>) {
  const [filter, setFilter] = useState(initialFilter ?? 'all');
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(!!mine?.defaultOn);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const captionId = useId();

  const shown = useMemo(
    () => applyTableQuery(rows, { filter, filters, query, searchText: search?.text, mineOnly, isMine: mine?.isMine }),
    [rows, filter, filters, query, search, mineOnly, mine],
  );
  const counts = useMemo(
    () => filterCounts(rows, { filter, filters, query, searchText: search?.text, mineOnly, isMine: mine?.isMine }),
    [rows, filter, filters, query, search, mineOnly, mine],
  );
  const slice = paginate(shown, page, pageSize);
  useEffect(() => { onShownChange?.(shown); }, [shown, onShownChange]);

  // A new filter or search starts again from page 1; selection follows what's shown
  useEffect(() => { setPage(1); }, [filter, query, mineOnly]);
  useEffect(() => {
    const visible = new Set(shown.map(rowKey));
    setSelected(prev => {
      const next = new Set([...prev].filter(k => visible.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [shown, rowKey]);

  const cols = columns.filter(c => !c.hidden);
  const pageKeys = slice.rows.map(rowKey);
  const allOnPage = pageKeys.length > 0 && pageKeys.every(k => selected.has(k));
  const someOnPage = pageKeys.some(k => selected.has(k));
  const selectedRows = shown.filter(r => selected.has(rowKey(r)));
  const clear = () => setSelected(new Set());
  const toggle = (k: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const togglePage = () => setSelected(prev => {
    const next = new Set(prev);
    pageKeys.forEach(k => { if (allOnPage) next.delete(k); else next.add(k); });
    return next;
  });

  const label = (n: number) => `${n} ${n === 1 ? noun.one : noun.many}`;
  const hasToolbar = !!(mine || filters.length || search || toolbarExtra);

  return (
    <div className="dt">
      {hasToolbar && (
        <div className="dt-toolbar">
          {mine && (
            <div className="dt-switch" role="group" aria-label="Afficher">
              <button type="button" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>{mine.allLabel ?? 'Toute l’équipe'}</button>
              <button type="button" aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>{mine.label}</button>
            </div>
          )}
          {filters.length > 0 && (
            <div className="dt-filters" role="group" aria-label="Filtrer par statut">
              {[{ key: 'all', label: allLabel }, ...filters].map(f => (
                <button key={f.key} type="button" className="dt-chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label} <span className="dt-chip-ct">{counts[f.key] ?? 0}</span>
                </button>
              ))}
            </div>
          )}
          <div className="dt-toolbar-end">
            {search && (
              <label className="dt-search">
                <Icon name="search" size={14} ariaHidden />
                <span className="sr-only">{search.placeholder}</span>
                <input type="search" value={query} placeholder={search.placeholder} onChange={e => setQuery(e.target.value)} />
              </label>
            )}
            {toolbarExtra}
          </div>
        </div>
      )}

      {selectable && selectedRows.length > 0 && (
        <div className="dt-bulk" role="region" aria-label="Actions sur la sélection">
          <b>{selectedRows.length} {selectedRows.length === 1 ? 'sélectionnée' : 'sélectionnées'}</b>
          {bulkActions?.(selectedRows, clear)}
          <button type="button" className="dt-link" onClick={clear}>Tout désélectionner</button>
        </div>
      )}

      <div className="dt-scroll">
        <table className="dt-table" aria-labelledby={captionId}>
          <caption id={captionId} className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable && (
                <th className="dt-cb" scope="col">
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner les ${noun.many} de la page`}
                    checked={allOnPage}
                    ref={el => { if (el) el.indeterminate = !allOnPage && someOnPage; }}
                    onChange={togglePage}
                  />
                </th>
              )}
              {cols.map(c => (
                <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined} className={c.align === 'right' ? 'num' : undefined}>
                  {c.header}
                </th>
              ))}
              {rowActions && <th className="dt-more" scope="col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {slice.rows.map(row => {
              const k = rowKey(row);
              const isSel = selected.has(k);
              return (
                <tr
                  key={k}
                  className={`${onRowClick ? 'dt-click' : ''}${isSel ? ' dt-sel' : ''}`}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? `Ouvrir ${rowLabel(row)}` : undefined}
                  onClick={onRowClick ? e => {
                    // Clicks on the row's own controls don't open it
                    if ((e.target as HTMLElement).closest('button, a, input, label')) return;
                    onRowClick(row);
                  } : undefined}
                  onKeyDown={onRowClick ? e => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); }
                  } : undefined}
                >
                  {selectable && (
                    <td className="dt-cb">
                      <input type="checkbox" aria-label={`Sélectionner ${rowLabel(row)}`} checked={isSel} onChange={() => toggle(k)} />
                    </td>
                  )}
                  {cols.map(c => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>{c.cell(row)}</td>
                  ))}
                  {rowActions && (
                    <td className="dt-more"><RowMenu row={row} label={rowLabel(row)} actions={rowActions(row)} /></td>
                  )}
                </tr>
              );
            })}
            {slice.rows.length === 0 && (
              <tr className="dt-empty">
                <td colSpan={cols.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}>
                  {emptyMessage ?? `Aucune ${noun.one} ne correspond.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="dt-foot">
        <span aria-live="polite">
          {slice.total === shown.length && shown.length === rows.length
            ? label(rows.length)
            : `${label(shown.length)} sur ${rows.length}`}
          {slice.pageCount > 1 && ` · ${slice.from}–${slice.to} affichées`}
          {footerSummary && <> · {footerSummary(shown)}</>}
        </span>
        {slice.pageCount > 1 && (
          <nav className="dt-pager" aria-label="Pages">
            <button type="button" aria-label="Page précédente" disabled={slice.page === 1} onClick={() => setPage(slice.page - 1)}>‹</button>
            {pagerItems(slice.page, slice.pageCount).map((n, i) => n === null
              ? <span key={`gap-${i}`} className="dt-gap" aria-hidden="true">…</span>
              : <button key={n} type="button" aria-current={n === slice.page ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>)}
            <button type="button" aria-label="Page suivante" disabled={slice.page === slice.pageCount} onClick={() => setPage(slice.page + 1)}>›</button>
          </nav>
        )}
      </div>
    </div>
  );
}

function RowMenu<T>({ row, label, actions }: { row: T; label: string; actions: RowAction<T>[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();
    const onDown = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = items(); if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length].focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('focusin', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('focusin', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!actions.length) return null;
  return (
    <div className="dt-menu-root" ref={rootRef}>
      <button ref={btnRef} type="button" className="dt-more-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions pour ${label}`} onClick={() => setOpen(o => !o)}>
        <Icon name="dots" size={16} ariaHidden />
      </button>
      {open && (
        <div className="dt-menu" role="menu" aria-label={`Actions pour ${label}`}>
          {actions.map(a => (
            <button key={a.label} type="button" role="menuitem" className={`dt-mi${a.danger ? ' danger' : ''}`} onClick={() => { setOpen(false); a.onSelect(row); }}>
              {a.icon && <Icon name={a.icon} size={15} ariaHidden />}{a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface StripItem {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  tone?: 'late' | 'good';
}

/** The figures above a table, in one box. */
export function SummaryStrip({ items }: { items: StripItem[] }) {
  return (
    <dl className="dt-strip" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(it => (
        <div key={it.label}>
          <dt>{it.label}</dt>
          <dd className="dt-strip-value">{it.value}{it.unit && <small>{it.unit}</small>}</dd>
          {it.note && <dd className={`dt-strip-note${it.tone ? ` ${it.tone}` : ''}`}>{it.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
