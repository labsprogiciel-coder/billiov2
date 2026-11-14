// A client's record beside the list (PRO-169): identity and tax details,
// contact, Responsable, ledger account, figures, latest invoices and quotes,
// and the actions on it.

import { useEffect, useRef, useState } from 'react';
import KybSection from '@/components/contacts/KybSection';
import type { ClientDocumentsApi } from '@/lib/use-client-documents';
import { useApp } from '@/context/AppContext';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import StatusPill from '@/components/sales/StatusPill';
import { OwnerLine } from '@/components/owner/OwnerControls';
import { fiscalDivisionLabel } from '@/components/FiscalDivisionSelect';
import { usePermissions } from '@/lib/use-permissions';
import { clientTypeDef, clientTypeOf } from '@/lib/client-type';
import { getFiscalIdLabel } from '@/lib/ohada';
import { invoiceRef } from '@/lib/invoice-number';
import { withIntent } from '@/lib/command-intent';
import { QUOTE_STATUS, invoiceRowStatus, type InvoiceRow } from '@/lib/sales-tables';
import type { ClientRow } from '@/lib/client-table';
import type { Quote } from '@/lib/schemas';
import { clientInitials, fmt, fmtCompact, fmtDate } from '@/data';

const STATUS: Record<ClientRow['status'], string> = { active: 'Actif', lead: 'Prospect', inactive: 'Inactif' };

export default function ClientRecordPanel({ client, year, docs, kyb, onEdit, onDelete, onClose }: {
  client: ClientRow | null;
  /** The KYB documents (PRO-176). */
  kyb?: ClientDocumentsApi;
  year: number;
  docs: { invoices: InvoiceRow[]; quotes: Quote[]; invoiceCount: number; quoteCount: number };
  onEdit: (code: string) => void;
  onDelete: (code: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { writable, deletable, postable } = usePermissions();
  const { orgSettings } = useApp();
  const orgName = orgSettings.name;

  if (!client) {
    return (
      <aside className="cr-panel cr-empty" aria-label="Fiche client">
        <Icon name="user" size={22} ariaHidden />
        <p>Sélectionnez un client pour voir sa fiche.</p>
      </aside>
    );
  }

  const type = clientTypeDef(clientTypeOf(client));
  const filled = (v?: string) => !!v && v !== '—';
  const row = (label: string, value?: string) => filled(value) ? <div className="cr-row"><dt>{label}</dt><dd>{value}</dd></div> : null;

  return (
    <aside className="cr-panel" aria-label={`Fiche de ${client.name}`}>
      <div className="cr-head">
        <div className={`cr-av ${client.av}`} aria-hidden="true">{clientInitials(client.name)}</div>
        <div className="cr-title">
          <h2 className="cr-name">{client.name}</h2>
          <div className="cr-sub">
            <span className="dt-tag" title={type.label}>{type.code}</span>
            <span>{type.label}</span>
            <StatusPill label={STATUS[client.status]} tone={client.status === 'active' ? 'paid' : client.status === 'lead' ? 'wait' : 'muted'} />
          </div>
        </div>
        <button type="button" className="icon-btn cr-close" onClick={onClose} aria-label="Fermer la fiche"><Icon name="x" size={16} ariaHidden /></button>
      </div>

      {(writable || deletable) && (
        <div className="cr-actions">
          {writable && (
            <button type="button" className="btn btn-primary cr-main" onClick={() => navigate('/invoices', withIntent({ command: 'new-invoice', client: client.code }))}>
              <Icon name="plus" size={15} ariaHidden /> Nouvelle facture
            </button>
          )}
          {writable && <button type="button" className="btn" onClick={() => onEdit(client.code)}><Icon name="edit" size={15} ariaHidden /> Modifier</button>}
          {deletable && <MoreMenu label={`Autres actions pour ${client.name}`} onDelete={() => onDelete(client.code)} />}
        </div>
      )}

      <dl className="cr-figures">
        <div><dt>Facturé {year}</dt><dd>{fmtCompact(client.invoicedYear)} <small>F CFA</small></dd></div>
        <div><dt>Payé</dt><dd>{fmtCompact(client.paid)} <small>F CFA</small></dd></div>
        <div><dt>Solde dû</dt><dd className={client.late ? 'dt-late' : undefined}>{fmtCompact(client.balance)} <small>F CFA</small></dd></div>
      </dl>

      <section className="cr-section">
        <OwnerLine table="clients" id={client.code} ownerId={client.ownerId} ownerName={client.ownerName} />
      </section>

      <section className="cr-section">
        <h3>Identité fiscale</h3>
        <dl>
          {row(getFiscalIdLabel(client.country), client.ifu)}
          {row('RCCM', client.rccm)}
          {row('Régime', client.taxRegime)}
          {filled(client.fiscalDivision) && row('Service des impôts', fiscalDivisionLabel(client.fiscalDivision!))}
          {!filled(client.ifu) && type.ifuRequired && <div className="cr-warn"><Icon name="alert-triangle" size={13} ariaHidden /> IFU manquant : requis pour facturer ce type de client.</div>}
          {![client.ifu, client.rccm, client.taxRegime, client.fiscalDivision].some(filled) && !type.ifuRequired && <p className="dt-muted">Aucune information fiscale.</p>}
        </dl>
      </section>

      <section className="cr-section">
        <h3>Adresse et contact</h3>
        <dl>
          {row('Ville', [client.city, client.country].filter(filled).join(', '))}
          {row('Contact principal', client.contact)}
          {row('E-mail', client.email)}
          {row('Téléphone', client.phone)}
        </dl>
      </section>

      {postable && (
        <section className="cr-section">
          <h3>Comptabilité</h3>
          <dl>
            <div className="cr-row"><dt>Compte</dt><dd>411 Clients · réf. {client.code}</dd></div>
          </dl>
        </section>
      )}

      {kyb && (
        <KybSection
          client={client}
          type={type.code}
          docs={kyb.docs.filter(d => d.clientCode === client.code)}
          api={kyb}
          can={{ write: writable, check: postable, remove: deletable }}
          orgName={orgName}
        />
      )}

      <section className="cr-section">
        <h3>Factures <span className="cr-count">{docs.invoiceCount}</span></h3>
        {docs.invoices.length === 0 ? <p className="dt-muted">Aucune facture.</p> : (
          <ul className="cr-docs">
            {docs.invoices.map(i => (
              <li key={i.id}>
                <button type="button" className="dt-linkcell" onClick={() => navigate(`/invoices/${i.id}`)}>{i.status === 'draft' ? 'Brouillon' : invoiceRef(i)}</button>
                <span className="cr-doc-date">{fmtDate(i.issued)}</span>
                <span className="cr-doc-amt">{fmt(i.amount)}</span>
                <StatusPill {...invoiceRowStatus(i)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cr-section">
        <h3>Devis <span className="cr-count">{docs.quoteCount}</span></h3>
        {docs.quotes.length === 0 ? <p className="dt-muted">Aucun devis.</p> : (
          <ul className="cr-docs">
            {docs.quotes.map(q => (
              <li key={q.id}>
                <button type="button" className="dt-linkcell" onClick={() => navigate(`/quotes/${q.id}`)}>{q.id}</button>
                <span className="cr-doc-date">{fmtDate(q.issued)}</span>
                <span className="cr-doc-amt">{fmt(q.amount)}</span>
                <StatusPill {...QUOTE_STATUS[q.status]} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

/** « ⋯ » next to the record's buttons: rarely used, risky actions. */
function MoreMenu({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('focusin', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('focusin', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="dt-menu-root" ref={rootRef}>
      <button ref={btnRef} type="button" className="btn cr-more" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(o => !o)}>
        <Icon name="dots" size={16} ariaHidden />
      </button>
      {open && (
        <div className="dt-menu" role="menu" aria-label={label}>
          <button type="button" role="menuitem" className="dt-mi danger" onClick={() => { setOpen(false); onDelete(); }}>
            <Icon name="trash" size={15} ariaHidden /> Supprimer le client
          </button>
        </div>
      )}
    </div>
  );
}

