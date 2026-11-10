// Sales journal entry of an invoice (journal VE): what it should contain, and
// the correcting entry that brings the books in line after the invoice changes.
//
// Posted entries can't be edited or deleted, so a change is booked as a
// separate adjustment holding the difference between what the books show for
// the invoice and what it should be. Summing every VE entry of the invoice
// (original plus adjustments) always gives the current amounts, including
// after earlier duplicates.

export interface EntryLine { accountNum: string; debit: number; credit: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The lines an issued invoice should have in the sales journal. */
export function invoiceSalesLines(htAmount: number, tvaAmount: number): EntryLine[] {
  const total = round2(htAmount + tvaAmount);
  return [
    { accountNum: '411', debit: total, credit: 0 },
    { accountNum: '706', debit: 0,     credit: round2(htAmount) },
    ...(tvaAmount > 0 ? [{ accountNum: '443', debit: 0, credit: round2(tvaAmount) }] : []),
  ];
}

/** Net balance (debit − credit) per account. */
function netByAccount(lines: EntryLine[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const l of lines) net.set(l.accountNum, round2((net.get(l.accountNum) ?? 0) + (l.debit || 0) - (l.credit || 0)));
  return net;
}

/**
 * Lines of the entry that turns `current` (every posted VE line of the
 * invoice) into `target`. Empty when the books already match.
 */
export function salesAdjustmentLines(current: EntryLine[], target: EntryLine[]): EntryLine[] {
  const have = netByAccount(current);
  const want = netByAccount(target);
  const accounts = [...new Set([...want.keys(), ...have.keys()])];
  const lines: EntryLine[] = [];
  for (const acct of accounts) {
    const diff = round2((want.get(acct) ?? 0) - (have.get(acct) ?? 0));
    if (Math.abs(diff) < 0.005) continue;
    lines.push(diff > 0 ? { accountNum: acct, debit: diff, credit: 0 } : { accountNum: acct, debit: 0, credit: -diff });
  }
  return lines;
}
