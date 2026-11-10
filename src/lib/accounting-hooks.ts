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
  fetchAccountBalances,
  fetchJournalEntries,
  fetchFixedAssets,
  fetchSupplierBills,
  postJournalEntry,
  deleteJournalEntry,
  createManualJournalEntry,
  createFixedAsset as apiCreateFixedAsset,
  markBillPaid as apiBillPaid,
  createSupplierBill as apiCreateBill,
  createAccount as apiCreateAccount,
  closeFiscalPeriod as apiClosePeriod,
  recordSupplierBillEntry,
  recordSupplierBillPaymentEntry,
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
  balances: AccountBalance[]; // empty in MOCK — computed in-memory instead
}

export function useChartOfAccounts() {
  const { orgId } = useApp();
  // Per load, so a tab left open across 31 December fetches the new exercise
  const year = exerciseYear();
  const result = useAsyncData<ChartData>(`chart:${orgId}:${year}`, async () => {
    const [classes, accounts, journals, opening, balances] = await Promise.all([
      fetchAccountClasses(),
      fetchAccounts(orgId),
      fetchJournals(orgId),
      fetchOpeningBalances(orgId, year),
      fetchAccountBalances(orgId),
    ]);
    return { classes, accounts, journals, opening, balances };
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
}

export function useJournalsData(includeDraft = true) {
  const { orgId } = useApp();
  const load = useCallback(async (): Promise<JournalsData> => {
    const [journals, accounts, entries] = await Promise.all([
      fetchJournals(orgId),
      fetchAccounts(orgId),
      fetchJournalEntries(orgId, { includeDraft }),
    ]);
    return { journals, accounts, entries };
  }, [orgId, includeDraft]);

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

  const saveEntry = useCallback(async (payload: Parameters<typeof createManualJournalEntry>[1]) => {
    await createManualJournalEntry(orgId, payload);
    result.reload();
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

  return { ...result, postEntry, removeEntry, saveEntry };
}

// ─── Trial Balance ────────────────────────────────────────────────────────────

export interface TrialBalanceData {
  classes:  Record<number, AccountClass>;
  accounts: Account[];
  journals: Record<string, Journal>;
  opening:  Record<string, number>;
  balances: AccountBalance[];
  // In MOCK mode, movementsOf / closingSigned / ledgerOf are still the mock functions.
  // In real mode the page derives the same numbers from opening + balances.
}

export function useTrialBalance() {
  const { orgId } = useApp();
  // Per load, so a tab left open across 31 December fetches the new exercise
  const year = exerciseYear();
  return useAsyncData<TrialBalanceData>(`trial:${orgId}:${year}`, async () => {
    const [classes, accounts, journals, opening, balances] = await Promise.all([
      fetchAccountClasses(),
      fetchAccounts(orgId),
      fetchJournals(orgId),
      fetchOpeningBalances(orgId, year),
      fetchAccountBalances(orgId),
    ]);
    return { classes, accounts, journals, opening, balances };
  }, [orgId, year]);
}

// ─── Financial Statements ────────────────────────────────────────────────────

export interface FinancialStatementsData {
  opening:  Record<string, number>;
  balances: AccountBalance[];
}

export function useFinancialStatements() {
  const { orgId } = useApp();
  // Per load, so a tab left open across 31 December fetches the new exercise
  const year = exerciseYear();
  return useAsyncData<FinancialStatementsData>(`fin-stmt:${orgId}:${year}`, async () => {
    const [opening, balances] = await Promise.all([
      fetchOpeningBalances(orgId, year),
      fetchAccountBalances(orgId),
    ]);
    return { opening, balances };
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

/** `enabled: false` skips the query (e.g. while the accounting module is switched off). */
export function useSupplierBills(enabled = true) {
  const { orgId } = useApp();
  const result = useAsyncData<SupplierBill[]>(
    enabled ? `supplier-bills:${orgId}` : 'supplier-bills:disabled',
    () => enabled ? fetchSupplierBills(orgId) : Promise.resolve([]),
    [orgId, enabled],
  );

  const markPaid = useCallback(async (billId: string) => {
    const bill = result.data?.find(b => b.id === billId);
    result.setData(prev => prev?.map(b =>
      b.id === billId ? { ...b, status: 'paid' as const } : b
    ) ?? null);
    try {
      await apiBillPaid(billId);
      if (bill) {
        await recordSupplierBillPaymentEntry(orgId, {
          piece:         bill.piece,
          total:         bill.htAmount + bill.tvaAmount,
          date:          new Date().toISOString().slice(0, 10),
          supplierName:  bill.supplier,
          paymentMethod: bill.paymentMethod,
        });
      }
    } finally {
      result.reload();
    }
  }, [orgId, result]);

  const createBill = useCallback(async (bill: Omit<SupplierBill, 'id' | 'acctLines'>) => {
    await apiCreateBill(orgId, bill);
    await recordSupplierBillEntry(orgId, {
      piece:        bill.piece,
      htAmount:     bill.htAmount,
      tvaAmount:    bill.tvaAmount,
      date:         bill.date,
      supplierName: bill.supplier,
    });
    result.reload();
  }, [orgId, result]);

  // Realtime: reload on any supplier_bills change for this org
  useEffect(() => {
    if (MOCK || !orgId) return;
    const ch = supabase
      .channel(`supplier_bills:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_bills', filter: `org_id=eq.${orgId}` },
        () => result.reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...result, markPaid, createBill };
}

// ─── Tax ──────────────────────────────────────────────────────────────────────

export interface TaxData {
  journals: Record<string, Journal>;
  entries:  JournalEntry[]; // posted only
}

export function useTaxData() {
  const { orgId } = useApp();
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
  entries:  JournalEntry[]; // all (need draft count)
  opening:  Record<string, number>;
  balances: AccountBalance[];
}

export function usePeriodClosing() {
  const { orgId } = useApp();
  // Per load, so a tab left open across 31 December fetches the new exercise
  const year = exerciseYear();
  const result = useAsyncData<PeriodClosingData>(`period-closing:${orgId}:${year}`, async () => {
    const [periods, entries, opening, balances] = await Promise.all([
      fetchFiscalPeriods(orgId, year),
      fetchJournalEntries(orgId, { includeDraft: true }),
      fetchOpeningBalances(orgId, year),
      fetchAccountBalances(orgId),
    ]);
    return { periods, entries, opening, balances };
  }, [orgId, year]);

  const closePeriod = useCallback(async (periodId: string) => {
    await apiClosePeriod(periodId);
    result.reload();
  }, [result]);

  return { ...result, closePeriod };
}

// ─── Balance helpers ──────────────────────────────────────────────────────────
// Builds O(1) lookup fns from the data returned by any hook with { balances, opening }.
// When data is null (still loading) or an account has no row, all values are 0.

export function useBalanceFns(
  data: { balances: AccountBalance[]; opening: Record<string, number> } | null,
  _showDraft = false,
) {
  return useMemo(() => {
    const map = new Map((data?.balances ?? []).map(b => [b.accountNum, { debit: b.totalDebit, credit: b.totalCredit }]));
    const openMap = data?.opening ?? {};
    const mvtOf = (num: string) => map.get(num) ?? { debit: 0, credit: 0 };
    const openFn = (num: string) => openMap[num] ?? 0;
    return {
      mvtOf,
      signedOf: (num: string) => { const m = mvtOf(num); return openFn(num) + m.debit - m.credit; },
      openingOf: openFn,
    };
  }, [data]);
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
