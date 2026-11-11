// What the in-app assistant knows about the business: a compact snapshot of
// the data the app has already loaded, so it can answer managers' questions
// (who owes what, what to chase first, how the month is going) without any
// extra database access.

import { invoiceBalance, todayISO } from '@/lib/invoice-status';
import { invoiceRef } from '@/lib/invoice-number';
import type { Invoice, Payment } from '@/lib/schemas';

interface ClientLite { name: string }

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

export function businessSnapshot(
  org: { name: string; plan: string },
  invoices: Invoice[],
  payments: Payment[],
  clients: Record<string, ClientLite>,
  today = todayISO(),
) {
  const month = today.slice(0, 7);
  const issued = invoices.filter(i => i.status !== 'draft');
  const open = issued
    .filter(i => i.status === 'pending' || i.status === 'overdue')
    .map(i => ({ inv: i, balance: invoiceBalance(i, payments).balance }))
    .filter(o => o.balance > 0);
  const clientName = (code: string) => clients[code]?.name ?? code;

  const byClient = new Map<string, number>();
  for (const o of open) byClient.set(o.inv.client, (byClient.get(o.inv.client) ?? 0) + o.balance);

  return {
    entreprise: org.name,
    plan: org.plan,
    date_du_jour: today,
    factures: {
      brouillons: invoices.length - issued.length,
      emises: issued.length,
      payees: issued.filter(i => i.status === 'paid').length,
      en_attente: issued.filter(i => i.status === 'pending').length,
      en_retard: issued.filter(i => i.status === 'overdue').length,
    },
    reste_a_encaisser_fcfa: open.reduce((s, o) => s + o.balance, 0),
    facture_ce_mois_fcfa: issued.filter(i => i.issued.startsWith(month)).reduce((s, i) => s + i.amount, 0),
    encaisse_ce_mois_fcfa: payments.filter(p => p.status === 'completed' && p.date.startsWith(month)).reduce((s, p) => s + p.amount, 0),
    factures_en_retard: open
      .filter(o => o.inv.status === 'overdue')
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 15)
      .map(o => ({
        numero: invoiceRef(o.inv), client: clientName(o.inv.client), objet: o.inv.subject,
        reste_fcfa: o.balance, echeance: o.inv.due, jours_de_retard: Math.max(0, daysBetween(o.inv.due, today)),
      })),
    plus_gros_soldes_clients: [...byClient.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, solde]) => ({ client: clientName(code), solde_fcfa: solde })),
  };
}
