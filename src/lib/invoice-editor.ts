// The invoice editor (PRO-167): totals and the problems shown on each line. One discount per invoice;
// the VAT is totalled per DGI tax group (PRO-138).

import { taxSummary, type GroupTotal } from '@/lib/tax-groups';
import { calculateServiceWithholding, type ServiceWithholdingScenario } from '@/lib/tax-bf';
import { filledLines } from '@/lib/line-validation';
import type { LineItem } from '@/lib/schemas';

export interface EditorTotals {
  subtotal: number; discount: number; net: number; tax: number; total: number;
  /** The VAT of each tax group used */
  groups: GroupTotal[];
  /** Service withholding the client keeps (Art.207/212), as the PDF prints it; null for none */
  withholding: number | null;
  /** What the client pays: the total less the withholding */
  toPay: number;
}

export function editorTotals(lines: LineItem[], discountPct: number, chargesVat: boolean, scenario?: ServiceWithholdingScenario | null): EditorTotals {
  const { subtotal, discount, net, tax, total, groups } = taxSummary(filledLines(lines), discountPct, chargesVat);
  const withholding = scenario ? calculateServiceWithholding(net, scenario) : null;
  return { subtotal, discount, net, tax, total, groups, withholding, toPay: total - (withholding ?? 0) };
}

/**
 * What is wrong with each line, by line id. Empty lines are ignored (they are
 * not saved). A line worth 0 can be saved in a draft but blocks issuing (PRO-145).
 */
export function lineProblems(lines: LineItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of filledLines(lines)) {
    if (l.desc.trim() === '') out[l.id] = 'Ajoutez une description.';
    else if (!(l.qty > 0)) out[l.id] = 'La quantité doit être supérieure à zéro.';
    else if (l.price < 0) out[l.id] = 'Le prix ne peut pas être négatif.';
    else if (l.qty * l.price <= 0) out[l.id] = 'Montant nul : indiquez un prix.';
  }
  return out;
}

/** Why the draft can't be saved yet, or null. `quote`: `due` is the validity date (PRO-185). */
export function draftProblem(client: string, issued: string, due: string, lines: LineItem[], quote = false): string | null {
  if (!client) return 'Choisissez un client.';
  if (filledLines(lines).length === 0) return 'Ajoutez au moins une ligne.';
  if (filledLines(lines).some(l => l.desc.trim() === '')) return 'Chaque ligne doit avoir une description.';
  if (filledLines(lines).some(l => !(l.qty > 0) || l.price < 0)) return 'Corrigez les lignes signalées.';
  if (due < issued) return quote ? 'La date de validité doit suivre la date du devis.' : 'L’échéance doit suivre la date de facturation.';
  return null;
}

/** Why the invoice can't be issued yet (on top of the draft's checks), or null. */
export function issueProblem(client: string, issued: string, due: string, lines: LineItem[]): string | null {
  const draft = draftProblem(client, issued, due, lines);
  if (draft) return draft;
  if (Object.keys(lineProblems(lines)).length > 0) return 'Une ligne a un montant nul : corrigez-la avant d’émettre.';
  return null;
}
