// Supabase query + write functions for the accounting module.
// Each function is MOCK-aware: when VITE_MOCK_AUTH=true it returns the
// same mock constants used by the static prototype pages.

import { supabase } from '@/lib/supabase';
import { invoiceSalesLines, salesAdjustmentLines, type EntryLine } from '@/lib/invoice-entry';
import { todayISO } from '@/lib/invoice-status';
import {
  CLASSES, ACCOUNTS, JOURNALS, ENTRIES, OPENING,
  FIXED_ASSETS, SUPPLIER_BILLS,
} from '@/lib/accounting-data';
import type {
  AccountClass, Account, Journal, JournalEntry, FixedAsset, SupplierBill,
} from '@/lib/accounting-data';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

// ─── Type: DB row shapes ────────────────────────────────────────────────────

export interface FiscalPeriod {
  id: string;
  orgId: string;
  year: number;
  month: number;
  status: 'open' | 'closed';
  closedAt: string | null;
}

export interface AccountBalance {
  accountNum: string;
  totalDebit: number;
  totalCredit: number;
  net: number; // positive = debit balance
}

// ─── Row mappers ────────────────────────────────────────────────────────────

function toAccountClass(row: Record<string, unknown>): [number, AccountClass] {
  return [
    Number(row.id),
    { name: String(row.name), short: String(row.short), color: String(row.color) },
  ];
}

function toAccount(row: Record<string, unknown>): Account {
  return {
    num:    String(row.num),
    label:  String(row.label),
    nature: row.nature as 'D' | 'C',
  };
}

function toJournal(row: Record<string, unknown>): [string, Journal] {
  const code = String(row.code);
  // icon is not stored in DB — derive from code to match mock data
  const ICONS: Record<string, string> = {
    VE: 'receipt', AC: 'truck-delivery', BQ: 'building-bank',
    CA: 'cash', OD: 'arrows-exchange',
  };
  return [code, {
    code,
    name:  String(row.name),
    icon:  ICONS[code] ?? 'book',
    color: String(row.color),
  }];
}

function toJournalEntry(
  row: Record<string, unknown>,
  lines: Array<Record<string, unknown>>,
): JournalEntry {
  return {
    id:      String(row.id),
    journal: String(row.journal_code ?? row.code ?? ''),
    date:    String(row.date),
    piece:   String(row.piece ?? ''),
    label:   String(row.label),
    posted:  Boolean(row.posted),
    lines:   lines.map(l => ({
      acct: String(l.account_num),
      d:    Number(l.debit),
      c:    Number(l.credit),
    })),
  };
}

function toFixedAsset(row: Record<string, unknown>): FixedAsset {
  return {
    id:              String(row.id),
    name:            String(row.name),
    acct:            String(row.account_num),
    icon:            String(row.icon ?? 'building-warehouse'),
    acquisitionDate: String(row.acquisition_date),
    usefulLife:      Number(row.useful_life),
    method:          String(row.method),
    grossValue:      Number(row.gross_value),
  };
}

function toSupplierBill(row: Record<string, unknown>): SupplierBill {
  const ht  = Number(row.ht_amount);
  const tva = Number(row.tva_amount);
  const stored = row.acct_lines as SupplierBill['acctLines'] | null | undefined;
  const acctLines: SupplierBill['acctLines'] =
    stored && stored.length > 0
      ? stored
      : [
          { acct: '605', label: 'Autres achats',    amount: ht,        side: 'D' },
          { acct: '445', label: 'TVA récupérable',  amount: tva,       side: 'D' },
          { acct: '401', label: 'Fournisseurs',     amount: ht + tva,  side: 'C' },
        ];
  return {
    id:        String(row.id),
    supplier:  String(row.supplier),
    city:      String(row.city ?? ''),
    piece:     String(row.piece),
    date:      String(row.date),
    dueDate:   String(row.due_date),
    htAmount:  ht,
    tvaAmount: tva,
    status:        row.status as SupplierBill['status'],
    paymentMethod: (row.payment_method as SupplierBill['paymentMethod']) ?? 'wire',
    acctLines,
    ifu:            row.ifu ? String(row.ifu) : undefined,
    rccm:           row.rccm ? String(row.rccm) : undefined,
    taxRegime:      row.tax_regime ? String(row.tax_regime) : undefined,
    fiscalDivision: row.fiscal_division ? String(row.fiscal_division) : undefined,
  };
}

function toFiscalPeriod(row: Record<string, unknown>): FiscalPeriod {
  return {
    id:       String(row.id),
    orgId:    String(row.org_id),
    year:     Number(row.year),
    month:    Number(row.month),
    status:   row.status as FiscalPeriod['status'],
    closedAt: row.closed_at ? String(row.closed_at) : null,
  };
}

// ─── Reference data (account classes + accounts) ────────────────────────────

export async function fetchAccountClasses(): Promise<Record<number, AccountClass>> {
  if (MOCK) return CLASSES;
  const { data, error } = await supabase
    .from('account_classes')
    .select('*')
    .order('id');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map(r => toAccountClass(r as Record<string, unknown>)));
}

export async function fetchAccounts(orgId: string): Promise<Account[]> {
  if (MOCK) return ACCOUNTS;
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .order('num');
  if (error) throw error;
  return (data ?? []).map(r => toAccount(r as Record<string, unknown>));
}

// ─── Journals ───────────────────────────────────────────────────────────────

export async function fetchJournals(orgId: string): Promise<Record<string, Journal>> {
  if (MOCK) return JOURNALS;
  const { data, error } = await supabase
    .from('journals')
    .select('*')
    .eq('org_id', orgId)
    .order('code');
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map(r => toJournal(r as Record<string, unknown>))
  );
}

// ─── Fiscal periods ──────────────────────────────────────────────────────────

export async function fetchFiscalPeriods(orgId: string, year: number): Promise<FiscalPeriod[]> {
  if (MOCK) {
    return Array.from({ length: 12 }, (_, i) => ({
      id: `mock-${year}-${i + 1}`,
      orgId,
      year,
      month: i + 1,
      status: (i < 5 ? 'closed' : 'open') as FiscalPeriod['status'],
      closedAt: null,
    }));
  }
  const { data, error } = await supabase
    .from('fiscal_periods')
    .select('*')
    .eq('org_id', orgId)
    .eq('year', year)
    .order('month');
  if (error) throw error;
  return (data ?? []).map(r => toFiscalPeriod(r as Record<string, unknown>));
}

export async function closeFiscalPeriod(periodId: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase
    .from('fiscal_periods')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', periodId);
  if (error) throw error;
}

// ─── Opening balances ────────────────────────────────────────────────────────

export async function fetchOpeningBalances(
  orgId: string,
  year: number,
): Promise<Record<string, number>> {
  if (MOCK) return OPENING;
  const { data, error } = await supabase
    .from('opening_balances')
    .select('account_num, signed_amount')
    .eq('org_id', orgId)
    .eq('exercise_year', year);
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map(r => [String(r.account_num), Number(r.signed_amount)])
  );
}

export async function fetchOpeningBalanceAdopted(
  orgId: string,
  year: number,
): Promise<boolean> {
  if (MOCK) return false;
  const { count, error } = await supabase
    .from('opening_balances')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('exercise_year', year);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function adoptOpeningBalances(
  orgId: string,
  opts: {
    year: number;
    date: string;
    piece: string;
    label: string;
    lines: Array<{ acct: string; d: number; c: number }>;
  },
): Promise<void> {
  if (MOCK) return;

  const validLines = opts.lines.filter(l => l.acct && (l.d || l.c));

  // Auto-balance with account 110 (Report à nouveau) if the entry is unbalanced
  const totalD = validLines.reduce((s, l) => s + l.d, 0);
  const totalC = validLines.reduce((s, l) => s + l.c, 0);
  const diff = Math.round(totalD - totalC);
  if (Math.abs(diff) >= 1) {
    const existing110 = validLines.find(l => l.acct === '110');
    if (existing110) {
      if (diff > 0) existing110.c += diff;
      else          existing110.d += -diff;
    } else {
      validLines.push(diff > 0
        ? { acct: '110', d: 0,     c: diff  }
        : { acct: '110', d: -diff, c: 0     },
      );
    }
  }

  const { error: obErr } = await supabase
    .from('opening_balances')
    .upsert(
      validLines.map(l => ({
        org_id:        orgId,
        exercise_year: opts.year,
        account_num:   l.acct,
        signed_amount: l.d - l.c,
      })),
      { onConflict: 'org_id,exercise_year,account_num' },
    );
  if (obErr) throw obErr;

  const { journalId, periodId } = await resolveJournalAndPeriod(orgId, 'OD', opts.date);
  const entryId = await createJournalEntry(orgId, {
    journalId,
    periodId,
    date:  opts.date,
    piece: opts.piece,
    label: opts.label,
    lines: validLines.map(l => ({ accountNum: l.acct, debit: l.d, credit: l.c })),
  });
  await postJournalEntry(entryId);
}

// ─── Account balances (from v_account_balances view) ─────────────────────────

export async function fetchAccountBalances(orgId: string): Promise<AccountBalance[]> {
  if (MOCK) return []; // mock computes balances in-memory from ENTRIES
  const { data, error } = await supabase
    .from('v_account_balances')
    .select('account_num, total_debit, total_credit, net')
    .eq('org_id', orgId);
  if (error) throw error;
  return (data ?? []).map(r => ({
    accountNum:  String(r.account_num),
    totalDebit:  Number(r.total_debit),
    totalCredit: Number(r.total_credit),
    net:         Number(r.net),
  }));
}

// ─── Journal entries ──────────────────────────────────────────────────────────

export async function fetchJournalEntries(
  orgId: string,
  opts: { periodId?: string; journalCode?: string; includeDraft?: boolean } = {},
): Promise<JournalEntry[]> {
  if (MOCK) {
    let entries = [...ENTRIES];
    if (!opts.includeDraft) entries = entries.filter(e => e.posted);
    if (opts.journalCode)   entries = entries.filter(e => e.journal === opts.journalCode);
    return entries;
  }

  let query = supabase
    .from('journal_entries')
    .select(`
      id, date, piece, label, posted,
      journals!inner ( code ),
      entry_lines ( account_num, debit, credit )
    `)
    .eq('org_id', orgId)
    .order('date', { ascending: false });

  if (opts.periodId)    query = query.eq('period_id', opts.periodId);
  if (opts.journalCode) query = query.eq('journals.code', opts.journalCode);
  if (!opts.includeDraft) query = query.eq('posted', true);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(row => {
    const r = row as Record<string, unknown>;
    const lines = (r.entry_lines as Array<Record<string, unknown>>) ?? [];
    const journal = (r.journals as Record<string, unknown>) ?? {};
    return toJournalEntry({ ...r, journal_code: journal.code }, lines);
  });
}

export async function createJournalEntry(
  orgId: string,
  payload: {
    journalId: string;
    periodId: string;
    date: string;
    piece: string;
    label: string;
    lines: Array<{ accountNum: string; debit: number; credit: number }>;
  },
): Promise<string> {
  if (MOCK) return `MOCK-${Date.now()}`;
  const { data, error } = await supabase
    .from('journal_entries')
    .insert({
      org_id:     orgId,
      journal_id: payload.journalId,
      period_id:  payload.periodId,
      date:       payload.date,
      piece:      payload.piece,
      label:      payload.label,
      posted:     false,
    })
    .select('id')
    .single();
  if (error) throw error;

  const entryId = String((data as Record<string, unknown>).id);
  const { error: linesErr } = await supabase.from('entry_lines').insert(
    payload.lines.map(l => ({
      entry_id:    entryId,
      account_num: l.accountNum,
      debit:       l.debit,
      credit:      l.credit,
    }))
  );
  if (linesErr) {
    // Don't leave an entry with no lines behind (best effort: deleting a draft is admin-only)
    await supabase.from('journal_entries').delete().eq('id', entryId);
    throw linesErr;
  }
  return entryId;
}

/**
 * Saves a manual entry (Journaux → Nouvelle écriture) as a draft. The form
 * knows the journal by its code and the entry by its date, so the journal and
 * fiscal period ids are looked up here, as for invoice entries.
 */
export async function createManualJournalEntry(
  orgId: string,
  payload: {
    journalCode: string;
    date: string;
    piece: string;
    label: string;
    lines: Array<{ accountNum: string; debit: number; credit: number }>;
  },
): Promise<string> {
  if (payload.lines.length === 0) throw new Error('A journal entry needs at least one line');
  if (MOCK) return `MOCK-${Date.now()}`;
  const { journalId, periodId } = await resolveJournalAndPeriod(orgId, payload.journalCode, payload.date);
  return createJournalEntry(orgId, {
    journalId, periodId,
    date: payload.date, piece: payload.piece, label: payload.label, lines: payload.lines,
  });
}

export async function postJournalEntry(entryId: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase
    .from('journal_entries')
    .update({ posted: true })
    .eq('id', entryId);
  if (error) throw error;
}

export async function deleteJournalEntry(entryId: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase
    .from('journal_entries')
    .delete()
    .eq('id', entryId);
  if (error) throw error;
}

// ─── Fixed assets ─────────────────────────────────────────────────────────────

export async function fetchFixedAssets(orgId: string): Promise<FixedAsset[]> {
  if (MOCK) return FIXED_ASSETS;
  const { data, error } = await supabase
    .from('fixed_assets')
    .select('*')
    .eq('org_id', orgId)
    .order('id');
  if (error) throw error;
  return (data ?? []).map(r => toFixedAsset(r as Record<string, unknown>));
}

export async function createFixedAsset(
  orgId: string,
  asset: Omit<FixedAsset, 'id'> & { id: string },
): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('fixed_assets').insert({
    id:                asset.id,
    org_id:            orgId,
    name:              asset.name,
    account_num:       asset.acct,
    amort_account_num: asset.acct.startsWith('2') ? '281' + asset.acct.slice(1) : '281',
    gross_value:       asset.grossValue,
    acquisition_date:  asset.acquisitionDate,
    useful_life:       asset.usefulLife,
    method:            asset.method,
    icon:              asset.icon,
  });
  if (error) throw error;
}

// ─── Supplier bills ───────────────────────────────────────────────────────────

export async function fetchSupplierBills(
  orgId: string,
  status?: SupplierBill['status'],
): Promise<SupplierBill[]> {
  if (MOCK) {
    return status ? SUPPLIER_BILLS.filter(b => b.status === status) : [...SUPPLIER_BILLS];
  }
  let query = supabase
    .from('supplier_bills')
    .select('*')
    .eq('org_id', orgId)
    .order('due_date');
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(r => toSupplierBill(r as Record<string, unknown>));
}

// ─── Shared helper: resolve journal ID + fiscal period ID ────────────────────

async function resolveJournalAndPeriod(
  orgId: string,
  journalCode: string,
  date: string,
): Promise<{ journalId: string; periodId: string }> {
  const { data: journal, error: jErr } = await supabase
    .from('journals')
    .select('id')
    .eq('org_id', orgId)
    .eq('code', journalCode)
    .single();
  if (jErr || !journal) throw jErr ?? new Error(`${journalCode} journal not found`);

  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  const { data: period } = await supabase
    .from('fiscal_periods')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('year', year)
    .eq('month', month)
    .single();

  let periodId: string;
  if (period) {
    const p = period as Record<string, unknown>;
    if (p.status === 'closed') throw new Error(`Fiscal period ${year}-${String(month).padStart(2, '0')} is closed`);
    periodId = String(p.id);
  } else {
    const { data: newPeriod, error: cpErr } = await supabase
      .from('fiscal_periods')
      .insert({ org_id: orgId, year, month, status: 'open' })
      .select('id')
      .single();
    if (cpErr || !newPeriod) throw cpErr ?? new Error('Failed to create fiscal period');
    periodId = String((newPeriod as Record<string, unknown>).id);
  }

  return {
    journalId: String((journal as Record<string, unknown>).id),
    periodId,
  };
}

// ─── Auto-entry helpers ───────────────────────────────────────────────────────

/**
 * Books the sales entry of an invoice when it is issued. Idempotent: it posts
 * only what the books are missing for this invoice, so a retry, a double click
 * or an entry left over from an earlier edit never doubles the sale.
 */
export async function recordInvoiceIssuanceEntry(
  orgId: string,
  opts: {
    invoiceId: string;
    htAmount: number;
    tvaAmount: number;
    date: string;
    clientName: string;
  },
): Promise<void> {
  await syncInvoiceSalesEntry(orgId, opts);
}

export async function recordInvoicePaymentEntry(
  orgId: string,
  opts: {
    invoiceId: string;
    total: number;
    date: string;
    clientName: string;
    /** Retenue TVA 30% withheld by assujettied client and remitted directly to DGI (→ D 4449) */
    tvaRetenue?: number;
    /** Retenue sur prestations de services 20–25% withheld by client (→ D 4091) */
    serviceWithholding?: number;
  },
): Promise<void> {
  if (MOCK) return;
  const { journalId, periodId } = await resolveJournalAndPeriod(orgId, 'BQ', opts.date);
  const tvaRet = opts.tvaRetenue       ?? 0;
  const svcRet = opts.serviceWithholding ?? 0;
  const netReceived = opts.total - tvaRet - svcRet;
  const entryId = await createJournalEntry(orgId, {
    journalId,
    periodId,
    date:  opts.date,
    piece: `REG-${opts.invoiceId}`,
    label: `Règlement reçu — ${opts.clientName} (${opts.invoiceId})`,
    lines: [
      { accountNum: '521',  debit: netReceived, credit: 0          },
      ...(tvaRet > 0 ? [{ accountNum: '4449', debit: tvaRet, credit: 0 }] : []),
      ...(svcRet > 0 ? [{ accountNum: '4091', debit: svcRet, credit: 0 }] : []),
      { accountNum: '411',  debit: 0,           credit: opts.total },
    ],
  });
  await postJournalEntry(entryId);
}

export async function recordSupplierBillEntry(
  orgId: string,
  opts: {
    piece: string;
    htAmount: number;
    tvaAmount: number;
    date: string;
    supplierName: string;
  },
): Promise<void> {
  if (MOCK) return;
  const { journalId, periodId } = await resolveJournalAndPeriod(orgId, 'AC', opts.date);
  const total = opts.htAmount + opts.tvaAmount;
  const entryId = await createJournalEntry(orgId, {
    journalId,
    periodId,
    date:  opts.date,
    piece: opts.piece,
    label: `Facture achat — ${opts.supplierName}`,
    lines: [
      { accountNum: '605', debit: opts.htAmount,  credit: 0     },
      { accountNum: '445', debit: opts.tvaAmount, credit: 0     },
      { accountNum: '401', debit: 0,              credit: total },
    ],
  });
  await postJournalEntry(entryId);
}

const PAYMENT_METHOD_JOURNAL: Record<string, string> = {
  wire:   'BQ',
  momo:   'BQ',
  cash:   'CA',
  cheque: 'BQ',
};
const PAYMENT_METHOD_ACCOUNT: Record<string, string> = {
  wire:   '521',
  momo:   '521',
  cash:   '571',
  cheque: '521',
};

export async function recordSupplierBillPaymentEntry(
  orgId: string,
  opts: {
    piece: string;
    total: number;
    date: string;
    supplierName: string;
    paymentMethod: string;
  },
): Promise<void> {
  if (MOCK) return;
  const journal = PAYMENT_METHOD_JOURNAL[opts.paymentMethod] ?? 'BQ';
  const creditAcct = PAYMENT_METHOD_ACCOUNT[opts.paymentMethod] ?? '521';
  const today = new Date().toISOString().slice(0, 10);
  const { journalId, periodId } = await resolveJournalAndPeriod(orgId, journal, today);
  const entryId = await createJournalEntry(orgId, {
    journalId,
    periodId,
    date:  today,
    piece: `REG-${opts.piece}`,
    label: `Règlement fournisseur — ${opts.supplierName}`,
    lines: [
      { accountNum: '401',      debit: opts.total, credit: 0          },
      { accountNum: creditAcct, debit: 0,          credit: opts.total },
    ],
  });
  await postJournalEntry(entryId);
}

/**
 * Brings the sales entry of an issued invoice in line with its amounts after
 * an edit. Posted entries can't be changed or deleted, so instead of
 * replacing the original this posts one adjustment with the difference
 * between every posted VE line of the invoice and what the invoice now says.
 * Nothing is booked when they already match. Returns whether an adjustment
 * was posted.
 */
export async function updateInvoiceIssuanceEntry(
  orgId: string,
  opts: { invoiceId: string; htAmount: number; tvaAmount: number; date: string; clientName: string },
): Promise<boolean> {
  return syncInvoiceSalesEntry(orgId, opts);
}

async function syncInvoiceSalesEntry(
  orgId: string,
  opts: { invoiceId: string; htAmount: number; tvaAmount: number; date: string; clientName: string },
): Promise<boolean> {
  if (MOCK) return false;
  const piece = `VE-${opts.invoiceId}`;
  const { data, error } = await supabase
    .from('journal_entries')
    .select('piece, entry_lines ( account_num, debit, credit )')
    .eq('org_id', orgId)
    .eq('posted', true)
    .or(`piece.eq.${piece},piece.like.${piece}-R*`);
  if (error) throw error;

  const entries = (data ?? []) as Array<{ piece: string; entry_lines: Array<{ account_num: string; debit: number; credit: number }> }>;
  const current: EntryLine[] = entries.flatMap(e => e.entry_lines.map(l => ({
    accountNum: l.account_num, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
  })));
  const lines = salesAdjustmentLines(current, invoiceSalesLines(opts.htAmount, opts.tvaAmount));
  if (lines.length === 0) return false;

  // Book the correction in the invoice's own period, or today's if that one is closed
  let ids: { journalId: string; periodId: string };
  let date = opts.date;
  try {
    ids = await resolveJournalAndPeriod(orgId, 'VE', date);
  } catch (err) {
    if (!(err instanceof Error && /is closed/.test(err.message))) throw err;
    date = todayISO();
    ids = await resolveJournalAndPeriod(orgId, 'VE', date);
  }
  const entryId = await createJournalEntry(orgId, {
    ...ids,
    date,
    // The first entry is the invoice itself; later ones are numbered corrections
    piece: entries.length === 0 ? piece : `${piece}-R${entries.filter(e => e.piece !== piece).length + 1}`,
    label: entries.length === 0
      ? `Facture — ${opts.clientName} (${opts.invoiceId})`
      : `Rectification facture — ${opts.clientName} (${opts.invoiceId})`,
    lines,
  });
  await postJournalEntry(entryId);
  return true;
}

export async function deleteInvoiceEntries(orgId: string, invoiceId: string): Promise<void> {
  if (MOCK) return;
  const { data, error } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('org_id', orgId)
    .in('piece', [`VE-${invoiceId}`, `REG-${invoiceId}`]);
  if (error) throw error;
  if (!data?.length) return;
  await Promise.all(
    (data as Array<Record<string, unknown>>).map(r => deleteJournalEntry(String(r.id)))
  );
}

export async function recordCreditNoteEntry(
  orgId: string,
  opts: {
    creditNoteId: string;
    invoiceId: string;
    htAmount: number;
    tvaAmount: number;
    date: string;
    clientName: string;
  },
): Promise<void> {
  if (MOCK) return;
  const { journalId, periodId } = await resolveJournalAndPeriod(orgId, 'VE', opts.date);
  const total = opts.htAmount + opts.tvaAmount;
  // Mirror of recordInvoiceIssuanceEntry but with debits/credits swapped
  const entryId = await createJournalEntry(orgId, {
    journalId,
    periodId,
    date:  opts.date,
    piece: `AV-${opts.creditNoteId}`,
    label: `Avoir — ${opts.clientName} (réf. ${opts.invoiceId})`,
    lines: [
      { accountNum: '706', debit: opts.htAmount,  credit: 0     },
      ...(opts.tvaAmount > 0 ? [{ accountNum: '443', debit: opts.tvaAmount, credit: 0 }] : []),
      { accountNum: '411', debit: 0,               credit: total },
    ],
  });
  await postJournalEntry(entryId);
}

export async function markBillPaid(billId: string): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase
    .from('supplier_bills')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', billId);
  if (error) throw error;
}

export async function createSupplierBill(
  orgId: string,
  bill: Omit<SupplierBill, 'id' | 'acctLines'>,
): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('supplier_bills').insert({
    org_id:          orgId,
    supplier:        bill.supplier,
    city:            bill.city,
    piece:           bill.piece,
    date:            bill.date,
    due_date:        bill.dueDate,
    ht_amount:       bill.htAmount,
    tva_amount:      bill.tvaAmount,
    payment_method:  bill.paymentMethod,
    status:          'open',
    ifu:              bill.ifu ?? '',
    rccm:             bill.rccm ?? '',
    tax_regime:       bill.taxRegime ?? '',
    fiscal_division:  bill.fiscalDivision ?? '',
  });
  if (error) throw error;
}

// ─── Accounts (custom / org-level) ────────────────────────────────────────────

export async function createAccount(
  orgId: string,
  account: Account,
): Promise<void> {
  if (MOCK) return;
  const { error } = await supabase.from('accounts').insert({
    num:    account.num,
    label:  account.label,
    nature: account.nature,
    org_id: orgId,
  });
  if (error) throw error;
}

/**
 * The journal entries of one invoice (PRO-166): its sale (VE-<id>, and any
 * VE-<id>-R… corrections), its payments (REG-<id>) and its credit notes
 * (AV-<credit note id>), drafts included. Demo mode has no books: [].
 */
export async function fetchInvoiceEntries(orgId: string, invoiceId: string, creditNoteIds: string[] = []): Promise<JournalEntry[]> {
  if (MOCK) return [];
  const pieces = [`piece.eq.VE-${invoiceId}`, `piece.like.VE-${invoiceId}-R*`, `piece.eq.REG-${invoiceId}`, ...creditNoteIds.map(c => `piece.eq.AV-${c}`)];
  const { data, error } = await supabase
    .from('journal_entries')
    .select(`id, date, piece, label, posted, journals ( code ), entry_lines ( account_num, debit, credit )`)
    .eq('org_id', orgId)
    .or(pieces.join(','))
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => {
    const r = row as Record<string, unknown>;
    const lines = (r.entry_lines as Array<Record<string, unknown>>) ?? [];
    const journal = (r.journals as Record<string, unknown>) ?? {};
    return toJournalEntry({ ...r, journal_code: journal.code }, lines);
  });
}
