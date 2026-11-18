// Per-feature hooks for the accounting module.
// Each hook calls the API layer, wires org_id from AppContext, and returns
// the same data shapes the page components already consume — so page diffs
// are limited to swapping imports + adding a loading guard.

import { useState, useEffect, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import {
  fetchAccountClasses,
  fetchAccounts,
  fetchJournals,
  fetchFiscalPeriods,
  fetchOpeningBalances,
  fetchJournalEntries,
  fetchFixedAssets,
  postJournalEntry,
  deleteJournalEntry,
  createManualJournalEntry,
  createFixedAsset as apiCreateFixedAsset,
  createAccount as apiCreateAccount,
  closeFiscalPeriod as apiClosePeriod,
} from '@/lib/api/accounting';
import type { FiscalPeriod, AccountBalance } from '@/lib/api/accounting';
import {
  movementsOf, closingSigned, ledgerOf, openingOf, allMovements,
  ACCOUNTS, CLASSES, JOURNALS, ENTRIES, OPENING,
  FIXED_ASSETS, SUPPLIER_BILLS,
} from '@/lib/accounting-data';
import type {
  AccountClass, Account, Journal, JournalEntry, FixedAsset, SupplierBill,
} from '@/lib/accounting-data';
import { exerciseYear } from '@/lib/period';
import { balanceFns, exerciseMovements } from '@/lib/ledger';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

// ─── Shared helper ───────────────────────────────────────────────────────────

// Module-level SWR cache — survives unmount/remount within a session.
// Keys are scoped per-org (e.g. "journals:org-uuid") so switching orgs
// never leaks data. Realtime + manual reload() keep entries fresh after writes.
const SWR_CACHE = new Map<string, unknown>();

function useAsyncData<T>(
  cacheKey: string,
  loader: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; error: string | null; reload: () => void; setData: Dispatch<SetStateAction<T | null>> } {
  const cached = SWR_CACHE.get(cacheKey) as T | undefined;
  // Initialise from cache: page renders immediately with stale data on revisit
  const [data,    setData]    = useState<T | null>(cached ?? null);
  // Only show skeleton when there is genuinely nothing to display yet
  const [loading, setLoading] = useState(cached === undefined);
  const [error,   setError]   = useState<string | null>(null);
  const [tick,    setTick]    = useState(0);

  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Show skeleton only on a true first load (no stale data in cache)
    if (!SWR_CACHE.has(cacheKey)) setLoading(true);
    loader()
      .then(d => {
        if (!cancelled) {
          SWR_CACHE.set(cacheKey, d);
          setData(d);
          setLoading(false);
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(String(e?.message ?? e));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, tick, ...deps]);

  return { data, loading, error, reload, setData };
}

// ─── Chart of Accounts ───────────────────────────────────────────────────────

export interface ChartData {
  classes:  Record<number, AccountClass>;
  accounts: Account[];
  journals: Record<string, Journal>;
  opening:  Record<string, number>;
  /** Every entry of the exercise, drafts included: balances are computed from them (see ledger.ts) */
  entries:  JournalEntry[];
  year:     number;
}

export function useChartOfAccounts() {
  const { orgId } = useApp();
  // Per load, so a tab left open across 31 December fetches the new exercise
  const year = exerciseYear();
  const result = useAsyncData<ChartData>(`chart:${orgId}:${year}`, async () => {
    const [classes, accounts, journals, opening, entries] = await Promise.all([
      fetchAccountClasses(),
      fetchAccounts(orgId),
      fetchJournals(orgId),
      fetchOpeningBalances(orgId, year),
      fetchJournalEntries(orgId, { includeDraft: true, year }),
    ]);
    return { classes, accounts, journals, opening, entries, year };
  }, [orgId, year]);

  const addAccount = useCallback(async (account: Account) => {
    await apiCreateAccount(orgId, account);
    result.reload();
  }, [orgId, result]);

  return { ...result, addAccount };
}

// ─── Journals ────────────────────────────────────────────────────────────────

export interface JournalsData {
  journals: Record<string, Journal>;
  accounts: Account[];
  entries:  JournalEntry[];
  /** The current exercise's opening balances and months, for the entry composer */
  opening:  Record<string, number>;
  periods:  FiscalPeriod[];
  year:     number;
}

export function useJournalsData(includeDraft = true) {
  const { orgId } = useApp();
  const year = exerciseYear();
  const load = useCallback(async (): Promise<JournalsData> => {
    const [journals, accounts, entries, opening, periods] = await Promise.all([
      fetchJournals(orgId),
      fetchAccounts(orgId),
      fetchJournalEntries(orgId, { includeDraft }),
      fetchOpeningBalances(orgId, year),
      fetchFiscalPeriods(orgId, year),
    ]);
    return { journals, accounts, entries, opening, periods, year };
  }, [orgId, includeDraft, year]);

  const result = useAsyncData<JournalsData>(`journals:${orgId}:${includeDraft}`, load, [orgId, includeDraft]);

  const postEntry = useCallback(async (entryId: string) => {
    // Optimistic: flip posted flag immediately so the drawer closes with correct status
    result.setData((prev: JournalsData | null) => prev ? {
      ...prev,
      entries: prev.entries.map((e: JournalEntry) => e.id === entryId ? { ...e, posted: true } : e),
    } : null);
    try {
      await postJournalEntry(entryId);
    } finally {
      result.reload();
    }
  }, [result]);

  const removeEntry = useCallback(async (entryId: string) => {
    // Optimistic: remove from list immediately
    result.setData((prev: JournalsData | null) => prev ? {
      ...prev,
      entries: prev.entries.filter((e: JournalEntry) => e.id !== entryId),
    } : null);
    try {
      await deleteJournalEntry(entryId);
    } finally {
      result.reload();
    }
  }, [result]);

  /** Saves a typed entry as a draft; its id. Posting it is `postEntry`, so a failed post can be retried on the same draft. */
  const createEntry = useCallback(async (payload: Parameters<typeof createManualJournalEntry>[1]): Promise<string> => {
    try {
      return await createManualJournalEntry(orgId, payload);
    } finally {
      result.reload();
    }
  }, [orgId, result]);

  // Realtime: reload on any journal_entries change for this org
  useEffect(() => {
    if (MOCK || !orgId) return;
    const ch = supabase
      .channel(`journal_entries:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'journal_entries', filter: `org_id=eq.${orgId}` },
        () => result.reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...result, postEntry, removeEntry, createEntry };
}

// ─── Trial Balance ────────────────────────────────────────────────────────────

export interface TrialBalanceData {
  classes:  Record<number, AccountClass>;
  accounts: Account[];
  journals: Record<string, Journal>;
  opening:  Record<string, number>;
  entries:  JournalEntry[];
  year:     number;
}

export function useTrialBalance() {
  const { orgId } = useApp();
  // Per load, so a tab left open across 31 December fetches the new exercise
  const year = exerciseYear();
  return useAsyncData<TrialBalanceData>(`trial:${orgId}:${year}`, async () => {
    const [classes, accounts, journals, opening, entries] = await Promise.all([
      fetchAccountClasses(),
      fetchAccounts(orgId),
      fetchJournals(orgId),
      fetchOpeningBalances(orgId, year),
      fetchJournalEntries(orgId, { includeDraft: true, year }),
    ]);
    return { classes, accounts, journals, opening, entries, year };
  }, [orgId, year]);
}

// ─── Financial Statements ────────────────────────────────────────────────────

export interface FinancialStatementsData {
  opening:  Record<string, number>;
  entries:  JournalEntry[];
  year:     number;
  accounts: Account[];
}

export function useFinancialStatements() {
  const { orgId } = useApp();
  // Per load, so a tab left open across 31 December fetches the new exercise
  const year = exerciseYear();
  return useAsyncData<FinancialStatementsData>(`fin-stmt:${orgId}:${year}`, async () => {
    const [opening, entries, accounts] = await Promise.all([
      fetchOpeningBalances(orgId, year),
      fetchJournalEntries(orgId, { includeDraft: false, year }),
      fetchAccounts(orgId),
    ]);
    return { opening, entries, year, accounts };
  }, [orgId, year]);
}

// ─── Fixed Assets ─────────────────────────────────────────────────────────────

export function useFixedAssets() {
  const { orgId } = useApp();
  const result = useAsyncData<FixedAsset[]>(
    `fixed-assets:${orgId}`,
    () => fetchFixedAssets(orgId),
    [orgId],
  );

  const createAsset = useCallback(async (asset: Omit<FixedAsset, 'id'> & { id: string }) => {
    await apiCreateFixedAsset(orgId, asset);
    result.reload();
  }, [orgId, result]);

  // Realtime: reload on any fixed_assets change for this org
  useEffect(() => {
    if (MOCK || !orgId) return;
    const ch = supabase
      .channel(`fixed_assets:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fixed_assets', filter: `org_id=eq.${orgId}` },
        () => result.reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...result, createAsset };
}

// ─── Suppliers ────────────────────────────────────────────────────────────────

// ─── Tax ──────────────────────────────────────────────────────────────────────

export interface TaxData {
  journals: Record<string, Journal>;
  entries:  JournalEntry[]; // posted only
}

export function useTaxData() {
  const { orgId } = useApp();
  // Every year: the deadlines early in the year are for the previous exercise
  const result = useAsyncData<TaxData>(`tax:${orgId}`, async () => {
    const [journals, entries] = await Promise.all([
      fetchJournals(orgId),
      fetchJournalEntries(orgId, { includeDraft: false }),
    ]);
    return { journals, entries };
  }, [orgId]);

  // Reload whenever a journal entry is posted (e.g. invoice paid, payment recorded).
  useEffect(() => {
    if (MOCK || !orgId) return;
    const ch = supabase
      .channel(`tax-entries:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'journal_entries', filter: `org_id=eq.${orgId}` },
        () => result.reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}

// ─── Period Closing ───────────────────────────────────────────────────────────

export interface PeriodClosingData {
  periods:  FiscalPeriod[];
  entries:  JournalEntry[]; // the exercise's, drafts included (they block closing a month)
  opening:  Record<string, number>;
  year:     number;
}

export function usePeriodClosing() {
  const { orgId } = useApp();
  // Per load, so a tab left open across 31 December fetches the new exercise
  const year = exerciseYear();
  const result = useAsyncData<PeriodClosingData>(`period-closing:${orgId}:${year}`, async () => {
    const [periods, entries, opening] = await Promise.all([
      fetchFiscalPeriods(orgId, year),
      fetchJournalEntries(orgId, { includeDraft: true, year }),
      fetchOpeningBalances(orgId, year),
    ]);
    return { periods, entries, opening, year };
  }, [orgId, year]);

  const closePeriod = useCallback(async (periodId: string) => {
    await apiClosePeriod(periodId);
    result.reload();
  }, [result]);

  return { ...result, closePeriod };
}

// ─── Balance helpers ──────────────────────────────────────────────────────────
// Opening, movements and closing per account over the exercise, from its
// entries (ledger.ts). `includeDraft`: drafts count in the movements too.

export function useBalanceFns(
  data: { entries: JournalEntry[]; opening: Record<string, number>; year: number } | null,
  includeDraft = false,
) {
  return useMemo(() => {
    const movements = exerciseMovements(data?.entries ?? [], data?.year ?? exerciseYear(), { includeDraft });
    return balanceFns(movements, data?.opening ?? {});
  }, [data, includeDraft]);
}

// ─── Re-export computed helpers so pages import from one place ────────────────
// In MOCK mode these work directly on ENTRIES / OPENING (in-memory).
// In real mode pages will receive pre-computed balances from the DB view
// and should prefer those over calling these functions.

export {
  movementsOf, closingSigned, ledgerOf, openingOf, allMovements,
  ACCOUNTS, CLASSES, JOURNALS, ENTRIES, OPENING,
  FIXED_ASSETS, SUPPLIER_BILLS,
};
export type { AccountClass, Account, Journal, JournalEntry, FixedAsset, SupplierBill };
export type { FiscalPeriod, AccountBalance };
