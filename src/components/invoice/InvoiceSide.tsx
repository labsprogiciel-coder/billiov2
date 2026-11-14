// The panels beside an invoice in the ERP look (PRO-166): Règlement,
// Comptabilité (admins and accountants), Client, Responsable and Activité.

import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { OwnerLine } from '@/components/owner/OwnerControls';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { fetchInvoiceEntries } from '@/lib/api/accounting';
import { withIntent } from '@/lib/command-intent';
import { clientBalance, expectedSalesEntry, invoiceActivity, fmtDateTime } from '@/lib/invoice-view';
import { contactValue } from '@/lib/share-links';
import { invoiceRef } from '@/lib/invoice-number';
import type { JournalEntry } from '@/lib/accounting-data';
import type { CreditNote, Invoice } from '@/lib/schemas';
import { fmt, fmtDateLong } from '@/data';

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rail-card iv-card" aria-label={title}>
      <div className="iv-card-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export default function InvoiceSide({ invoice, total, paid, credited, amountDue, creditNotes, client, vatOnInvoice }: {
  invoice: Invoice;
  /** TTC of the invoice (its lines for a draft). */
  total: number;
  paid: number;
  credited: number;
  amountDue: number;
  creditNotes: CreditNote[];
  client: { code: string; name: string; contact?: string; email?: string; phone?: string };
  /** Whether this invoice carries VAT (for the expected entry). */
  vatOnInvoice: boolean;
}) {
  const { invoices, payments, quotes, orgId, activity: teamActivity } = useApp();
  const { postable } = usePermissions();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const creditIds = creditNotes.map(c => c.id).join(',');

  useEffect(() => {
    if (!postable || !orgId || invoice.status === 'draft') return;
    let live = true;
    fetchInvoiceEntries(orgId, invoice.id, creditIds ? creditIds.split(',') : [])
      .then(e => { if (live) setEntries(e); })
      .catch(err => { console.error('[fetchInvoiceEntries]', err); if (live) setEntries([]); });
    return () => { live = false; };
  }, [postable, orgId, invoice.id, invoice.status, creditIds]);

  const activity = invoiceActivity(invoice, payments, creditNotes, fmt);
  // Sends and reminders are logged in the team's activity with the invoice's number
  const ref = `#${invoiceRef(invoice)}`;
  const sends = teamActivity.filter(a => a.kind === 'sent' && a.parts.some(p => p.text === ref));
  const owed = clientBalance(invoice.client, invoices, payments, creditNotes);
  const fromQuote = quotes.find(q => q.invoiceId === invoice.id);
  const contact = contactValue(client.contact), email = contactValue(client.email), phone = contactValue(client.phone);

  return (
    <aside className="rail iv-rail" aria-label="Informations sur la facture">
      <Card title="Règlement">
        <dl className="iv-rows">
          <div><dt>Total TTC</dt><dd>{fmt(total)} F CFA</dd></div>
          <div><dt>Payé</dt><dd>{paid ? `− ${fmt(paid)} F CFA` : '—'}</dd></div>
          <div><dt>Avoirs</dt><dd>{credited ? `− ${fmt(credited)} F CFA` : '—'}</dd></div>
          <div className="iv-due"><dt>Reste dû</dt><dd className={invoice.status === 'overdue' && amountDue > 0 ? 'dt-late' : undefined}>{fmt(invoice.status === 'draft' ? total : amountDue)} F CFA</dd></div>
        </dl>
      </Card>

      {postable && invoice.status !== 'draft' && (
        <Card title="Comptabilité">
          {entries === null ? <p className="dt-muted">Chargement…</p>
            : entries.length > 0 ? entries.map(e => (
              <div key={e.id} className="iv-entry">
                <div className="iv-entry-head">
                  <b>{e.journal} · {e.piece}</b>
                  <span>{fmtDateLong(e.date)}{e.posted ? '' : ' · brouillon'}</span>
                </div>
                <table className="iv-lines">
                  <thead><tr><th scope="col">Compte</th><th scope="col" className="num">Débit</th><th scope="col" className="num">Crédit</th></tr></thead>
                  <tbody>{e.lines.map((l, i) => <tr key={i}><td>{l.acct}</td><td className="num">{l.d ? fmt(l.d) : ''}</td><td className="num">{l.c ? fmt(l.c) : ''}</td></tr>)}</tbody>
                </table>
              </div>
            )) : (
              <>
                <p className="dt-muted iv-note">Aucune écriture trouvée pour cette facture. L’écriture de vente attendue :</p>
                <table className="iv-lines">
                  <thead><tr><th scope="col">Compte</th><th scope="col" className="num">Débit</th><th scope="col" className="num">Crédit</th></tr></thead>
                  <tbody>{expectedSalesEntry(invoice.amount, vatOnInvoice).map(l => (
                    <tr key={l.account}><td title={l.label}>{l.account} {l.label}</td><td className="num">{l.debit ? fmt(l.debit) : ''}</td><td className="num">{l.credit ? fmt(l.credit) : ''}</td></tr>
                  ))}</tbody>
                </table>
              </>
            )}
        </Card>
      )}

      <Card
        title="Client"
        action={<button type="button" className="dt-linkcell" onClick={() => navigate('/contacts', withIntent({ command: 'open-client', client: client.code }))}>Voir la fiche</button>}
      >
        <p className="iv-client">{client.name}</p>
        <dl className="iv-rows">
          {contact && <div><dt>Contact</dt><dd>{contact}</dd></div>}
          {email && <div><dt>E-mail</dt><dd><a href={`mailto:${email}`}>{email}</a></dd></div>}
          {phone && <div><dt>Téléphone</dt><dd>{phone}</dd></div>}
          <div><dt>Solde total</dt><dd className={owed > 0 ? 'iv-strong' : undefined}>{fmt(owed)} F CFA</dd></div>
        </dl>
      </Card>

      <Card title="Responsable">
        <OwnerLine table="invoices" id={invoice.id} ownerId={invoice.ownerId} ownerName={invoice.ownerName} />
        {fromQuote && <p className="doc-link">Issue du devis <button type="button" className="dt-linkcell" onClick={() => navigate(`/quotes/${fromQuote.id}`)}>{fromQuote.id}</button></p>}
      </Card>

      <Card title="Activité">
        {sends.length > 0 && (
          <ol className="iv-activity iv-sends" aria-label="Envois et relances">
            {sends.map((a, i) => (
              <li key={i} className="iv-act sent">
                <span className="iv-dot" aria-hidden="true" />
                <div><div>{a.parts.map(p => p.text).join('')}</div><small>{a.time}</small></div>
              </li>
            ))}
          </ol>
        )}
        <ol className="iv-activity">
          {activity.map((a, i) => (
            <li key={i} className={`iv-act ${a.kind}`}>
              <span className="iv-dot" aria-hidden="true" />
              <div><div>{a.text}</div><small>{a.at.length > 10 ? fmtDateTime(a.at) : fmtDateLong(a.at)}</small></div>
            </li>
          ))}
        </ol>
      </Card>
    </aside>
  );
}
