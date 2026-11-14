// Filtering, counting and paging for the shared dense table (PRO-163,
// src/components/DataTable.tsx). Kept free of React so it can be tested.

export interface StatusFilter<T> {
  key: string;
  label: string;
  match: (row: T) => boolean;
}

export interface TableQuery<T> {
  /** Key of the active status filter; 'all' (or an unknown key) keeps every row. */
  filter: string;
  filters: StatusFilter<T>[];
  /** Free text typed in the search box. */
  query: string;
  searchText?: (row: T) => string;
  /** « Mes … »: keep only the user's own rows. */
  mineOnly: boolean;
  isMine?: (row: T) => boolean;
}

/** Lower case, no accents, single spaces: « Écheance  » matches « echeance ». */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Rows kept by the « Toutes / Mes … » switch and the search box (not the status filter). */
function scoped<T>(rows: T[], q: TableQuery<T>): T[] {
  const words = normalizeSearch(q.query).split(' ').filter(Boolean);
  return rows.filter(r => {
    if (q.mineOnly && q.isMine && !q.isMine(r)) return false;
    if (!words.length || !q.searchText) return true;
    const hay = normalizeSearch(q.searchText(r));
    return words.every(w => hay.includes(w));
  });
}

/** The rows to show: switch, search, then status filter. */
export function applyTableQuery<T>(rows: T[], q: TableQuery<T>): T[] {
  const base = scoped(rows, q);
  const f = q.filters.find(x => x.key === q.filter);
  return f ? base.filter(f.match) : base;
}

/**
 * How many rows each status filter would show, given the switch and the
 * search, so the counts on the filter chips match what clicking them shows.
 */
export function filterCounts<T>(rows: T[], q: TableQuery<T>): Record<string, number> {
  const base = scoped(rows, q);
  const counts: Record<string, number> = { all: base.length };
  for (const f of q.filters) counts[f.key] = base.filter(f.match).length;
  return counts;
}

export interface PageSlice<T> {
  rows: T[];
  /** 1-based, clamped to the pages that exist. */
  page: number;
  pageCount: number;
  /** 1-based index of the first and last row shown (0 when empty). */
  from: number;
  to: number;
  total: number;
}

export function paginate<T>(rows: T[], page: number, size: number): PageSlice<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (p - 1) * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: p, pageCount, from: total ? start + 1 : 0, to: start + slice.length, total };
}

/** Page numbers to show in the pager: first, last, and the current one's neighbours, with gaps as null. */
export function pagerItems(page: number, pageCount: number): (number | null)[] {
  const keep = new Set([1, pageCount, page - 1, page, page + 1].filter(n => n >= 1 && n <= pageCount));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}
