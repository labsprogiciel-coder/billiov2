// The panels beside an invoice in the ERP look (PRO-166): Règlement,
// Comptabilité (admins and accountants), Client, Responsable and Activité.

import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { OwnerLine } from '@/components/owner/OwnerControls';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { fetchInvoiceEntries } from '@/lib/api/accounting';
import { fetchClientCreditNotes, fetchCreditNoteDrafts } from '@/lib/api/credit-notes';
import { renderCreditNotePdf, showPdf } from '@/lib/credit-note-pdf';
import { creditNoteRef } from '@/lib/invoice-number';
import { legacyCreditVat } from '@/lib/credit-note';
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

export default function InvoiceSide({ invoice, total, paid, credited, amountDue, creditNotes, client, vatOnInvoice, refreshKey = 0 }: {
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
  /** Goes up once a payment, issue, credit note or edit has been posted: entries are read again. */
  refreshKey?: number;
}) {
  const { invoices, payments, quotes, orgId, activity: teamActivity, clientsMap, orgSettings, invoiceTemplate, showToast } = useApp();
  const { postable, credits } = usePermissions();
  const navigate = useNavigate();
  // null while loading; 'error' when the entries couldn't be read (not the same as none)
  const [entries, setEntries] = useState<JournalEntry[] | 'error' | null>(null);
  const [retry, setRetry] = useState(0);
  const creditIds = creditNotes.map(c => c.id).join(',');

  useEffect(() => {
    if (!postable || !orgId || invoice.status === 'draft') return;
    let live = true;
    fetchInvoiceEntries(orgId, invoice.id, creditIds ? creditIds.split(',') : [])
      .then(e => { if (live) setEntries(e); })
      .catch(err => { console.error('[fetchInvoiceEntries]', err); if (live) setEntries('error'); });
    return () => { live = false; };
  }, [postable, orgId, invoice.id, invoice.status, creditIds, refreshKey, retry]);

  // The client's balance counts the credit notes on all their invoices, not only this one
  const [clientCredits, setClientCredits] = useState<CreditNote[] | 'error' | null>(null);
  useEffect(() => {
    if (!orgId) return;
    let live = true;
    // Back to « … » while it reloads, rather than the previous balance
    setClientCredits(null);
    fetchClientCreditNotes(orgId, invoice.client)
      .then(c => { if (live) setClientCredits(c); })
      .catch(err => { console.error('[fetchClientCreditNotes]', err); if (live) setClientCredits('error'); });
    return () => { live = false; };
  }, [orgId, invoice.client, creditIds, refreshKey]);

  // Draft credit notes on this invoice (PRO-168): not counted, but not to be forgotten
  const [creditDrafts, setCreditDrafts] = useState<CreditNote[]>([]);
  useEffect(() => {
    if (!orgId || invoice.status === 'draft') return;
    let live = true;
    fetchCreditNoteDrafts(orgId, invoice.id)
      .then(d => { if (live) setCreditDrafts(d); })
      .catch(err => console.error('[fetchCreditNoteDrafts]', err));
    return () => { live = false; };
  }, [orgId, invoice.id, invoice.status, refreshKey]);
  const [pdfFor, setPdfFor] = useState<string | null>(null);
  async function openCreditPdf(cn: CreditNote) {
    const rec = clientsMap[invoice.client];
    if (!rec || pdfFor) return;
    const tab = window.open('', '_blank');
    setPdfFor(cn.id);
    try {
      // A note without lines (older ones): its own accounting entry says whether it carried VAT,
      // else the invoice's sales entry, else the invoice as shown here
      const { vat: chargedVat, estimated } = legacyCreditVat(Array.isArray(entries) ? entries : null, cn.id, invoice.id, vatOnInvoice);
      if (estimated && cn.lines.length === 0) showToast('L’écriture de cet ancien avoir n’a pas pu être lue : la TVA du PDF est estimée d’après la facture.', true);
      showPdf(await renderCreditNotePdf({ creditNote: cn, invoice, chargedVat, client: rec, biz: orgSettings, template: invoiceTemplate }), tab);
    } catch (err) {
      tab?.close();
      console.error('[creditNotePdf]', err);
      showToast('Le PDF de l’avoir n’a pas pu être généré. Réessayez.', true);
    } finally {
      setPdfFor(null);
    }
  }

  const activity = invoiceActivity(invoice, payments, creditNotes, fmt);
  // Sends and reminders are logged in the team's activity with the invoice's number
  const ref = `#${invoiceRef(invoice)}`;
  const sends = teamActivity.filter(a => a.kind === 'sent' && a.parts.some(p => p.text === ref));
  // This invoice's credit notes may be newer than the client-wide list
  const allCredits = Array.isArray(clientCredits)
    ? [...clientCredits.filter(c => !creditNotes.some(n => n.id === c.id)), ...creditNotes]
    : null;
  const owed = allCredits ? clientBalance(invoice.client, invoices, payments, allCredits) : null;
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

      {invoice.status !== 'draft' && (creditNotes.length > 0 || creditDrafts.length > 0) && (
        <Card title="Avoirs">
          <ul className="iv-credits">
            {creditNotes.map(cn => (
              <li key={cn.id}>
                <div>
                  <b>{creditNoteRef(cn)}</b>{cn.nature && <span className="iv-nature">{cn.nature}</span>}
                  <small>{fmtDateLong(cn.issued)}{cn.reason ? ` · ${cn.reason}` : ''}</small>
                </div>
                <span className="iv-credit-amt">− {fmt(cn.amount)}</span>
                <button type="button" className="dt-linkcell" onClick={() => void openCreditPdf(cn)} disabled={pdfFor !== null}>{pdfFor === cn.id ? '…' : 'PDF'}</button>
              </li>
            ))}
            {creditDrafts.map(cn => (
              <li key={cn.id} className="draft">
                <div>
                  <b>Brouillon d’avoir</b>{cn.nature && <span className="iv-nature">{cn.nature}</span>}
                  <small>{cn.reason || 'sans motif'}</small>
                </div>
                <span className="iv-credit-amt">− {fmt(cn.amount)}</span>
                {credits && <button type="button" className="dt-linkcell" onClick={() => navigate(`/credit-notes/${cn.id}/edit`)}>Reprendre</button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {postable && invoice.status !== 'draft' && (
        <Card title="Comptabilité">
          {entries === null ? <p className="dt-muted">Chargement…</p>
            : entries === 'error' ? (
              <p className="dt-muted iv-note">
                Les écritures n’ont pas pu être chargées.{' '}
                <button type="button" className="dt-linkcell" onClick={() => { setEntries(null); setRetry(r => r + 1); }}>Réessayer</button>
              </p>
            )
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
          <div><dt>Solde total</dt><dd className={owed !== null && owed > 0 ? 'iv-strong' : undefined}>
            {owed !== null ? `${fmt(owed)} F CFA` : clientCredits === 'error' ? 'Indisponible' : '…'}
          </dd></div>
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
