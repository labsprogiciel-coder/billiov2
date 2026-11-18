// Factures in the ERP look (PRO-165): summary strip and the shared dense table.
// InvoicesPage renders this instead of its cards and list when VITE_UI_V2 is on;
// the actions (open, send, remind, PDF) stay in the page. Credit notes are
// listed with the invoices (PRO-168), each just above the invoice it credits.

import { useEffect, useMemo, useState } from 'react';
import DataTable, { SummaryStrip, type Column, type RowAction, type StatusFilter } from '@/components/DataTable';
import { useApp } from '@/context/AppContext';
import { OwnerFilter, ReassignControl } from '@/components/owner/OwnerControls';
import { usePermissions } from '@/lib/use-permissions';
import { useTeam } from '@/lib/use-team';
import { useReassign } from '@/lib/use-reassign';

import { useNavigate } from 'react-router-dom';
import { useCreditNoteDrafts, useCreditNotes } from '@/lib/use-credit-notes';
import { creditNoteRef, invoiceRef } from '@/lib/invoice-number';
import { CREDIT_NATURES } from '@/lib/credit-note';
import { bookingStatus, docRows, invoiceFigures, invoiceRowStatus, invoiceRows, ownerKey, ownerOptions, type DocRow } from '@/lib/sales-tables';
import { fmt, fmtCompact, fmtDate } from '@/data';
import StatusPill from '@/components/sales/StatusPill';
import { fetchBookedInvoiceIds } from '@/lib/api/accounting';
import { ACCOUNTING_ENABLED } from '@/lib/features';

const FILTERS: StatusFilter<DocRow>[] = [
  { key: 'draft',   label: 'Brouillons', match: r => r.kind === 'credit' ? r.creditNote.status === 'draft' : r.status === 'draft' },
  { key: 'overdue', label: 'En retard',  match: r => r.kind === 'invoice' && r.status === 'overdue' },
  { key: 'paid',    label: 'Payées',     match: r => r.kind === 'invoice' && r.status === 'paid' },
];
const TYPES = [{ key: 'invoice', label: 'Factures' }, { key: 'credit', label: 'Avoirs' }];
const NATURES = CREDIT_NATURES.map(n => ({ key: n.code, label: `${n.code} · ${n.label}` }));
const docKey = (r: DocRow) => r.kind === 'credit' ? r.key : r.id;

export interface InvoiceListProps {
  writable: boolean;
  onOpen: (id: string) => void;
  onSend: (id: string) => void;
  onDownload: (id: string) => void;
  /** An invoice's PDF is being made: other downloads wait. */
  downloading: boolean;
  /** Bumped to show the late invoices (command box). */
  showLate?: number;
}

export default function InvoiceList({ writable, onOpen, onSend, onDownload, downloading, showLate = 0 }: InvoiceListProps) {
  const { invoices, payments, clientsMap, userId, userRole, orgId } = useApp();
  const creditNotes = useCreditNotes();
  const creditDrafts = useCreditNoteDrafts();
  const navigate = useNavigate();

  const invRows = useMemo(() => invoiceRows(invoices, payments, creditNotes), [invoices, payments, creditNotes]);
  const figures = useMemo(() => invoiceFigures(invRows), [invRows]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [natureFilter, setNatureFilter] = useState('all');
  const rows = useMemo(() => {
    // Two queries: a draft issued between them shows once, as issued
    const issuedIds = new Set(creditNotes.map(c => c.id));
    const all = docRows(invRows, [...creditDrafts.filter(d => !issuedIds.has(d.id)), ...creditNotes], invoices);
    return all.filter(r => (typeFilter === 'all' || r.kind === typeFilter)
      && (typeFilter !== 'credit' || natureFilter === 'all' || (r.kind === 'credit' && r.creditNote.nature === natureFilter)));
  }, [invRows, creditDrafts, creditNotes, invoices, typeFilter, natureFilter]);
  // « Responsable » (PRO-172): members start on their own records
  const { managesOrg, credits, postable } = usePermissions();
  const team = useTeam(managesOrg);
  const { reassign, busy: reassigning } = useReassign();
  const [ownerFilter, setOwnerFilter] = useState('all');
  const ownerChoices = useMemo(() => ownerOptions(rows), [rows]);
  const ownedRows = useMemo(
    () => ownerFilter === 'all' ? rows : rows.filter(r => ownerKey(r) === ownerFilter),
    [rows, ownerFilter],
  );
  // « Comptabilité » (PRO-174): for the roles that post entries, when accounting is on
  const showBooks = postable && ACCOUNTING_ENABLED;
  const [booked, setBooked] = useState<Set<string> | null>(null);
  const issuedKey = useMemo(() => invoices.filter(i => i.status !== 'draft').map(i => i.id).join(','), [invoices]);
  useEffect(() => {
    if (!showBooks || !orgId) return;
    let live = true;
    fetchBookedInvoiceIds(orgId)
      .then(ids => { if (live) setBooked(ids); })
      .catch(err => console.error('[fetchBookedInvoiceIds]', err));
    return () => { live = false; };
  }, [showBooks, orgId, issuedKey]);
  const filters = useMemo(() => showBooks
    ? [...FILTERS, { key: 'unbooked', label: 'À comptabiliser', match: (r: DocRow) => bookingStatus(r, booked)?.tone === 'wait' }]
    : FILTERS, [showBooks, booked]);
  // Members only see their own records (the database filters them): no « Toute l'équipe » switch or Responsable filter
  const onlyOwn = userRole === 'member';
  const mine = useMemo(() => ({
    label: 'Mes factures', isMine: (r: { ownerId?: string }) => r.ownerId === userId, defaultOn: userRole === 'member',
  }), [userId, userRole]);
  const clientName = (id: string) => clientsMap[id]?.name ?? id;
  const search = useMemo(() => ({
    placeholder: 'N°, client, objet ou motif…',
    text: (r: DocRow) => r.kind === 'credit'
      ? `${creditNoteRef(r.creditNote)} avoir ${r.creditNote.nature ?? ''} ${r.origin ? invoiceRef(r.origin) : r.creditNote.invoiceId} ${clientsMap[r.client]?.name ?? r.client} ${r.creditNote.reason}`
      : `${invoiceRef(r)} ${r.id} ${clientsMap[r.client]?.name ?? r.client} ${r.subject}`,
  }), [clientsMap]);
  const credited = (r: DocRow) => r.kind === 'credit' ? r.creditNote : null;
  const openRow = (r: DocRow) => {
    if (r.kind === 'invoice') { onOpen(r.id); return; }
    const cn = r.creditNote;
    if (cn.status === 'draft' && credits) navigate(`/credit-notes/${cn.id}/edit`);
    else navigate(`/invoices/${cn.invoiceId}`);
  };

  const columns: Column<DocRow>[] = [
    {
      key: 'number', header: 'N°', width: '170px',
      cell: r => {
        const cn = credited(r);
        if (cn) {
          return (
            <span className="dt-doc">
              {cn.status === 'draft' ? <span className="dt-muted">Brouillon d’avoir</span> : <b className="dt-ref">{creditNoteRef(cn)}</b>}
              <small className="dt-credit-of">Avoir{cn.nature ? ` ${cn.nature}` : ''} · sur {r.kind === 'credit' && r.origin ? invoiceRef(r.origin) : cn.invoiceId}</small>
            </span>
          );
        }
        return r.kind === 'invoice' && r.status === 'draft'
          ? <span className="dt-muted">Brouillon</span>
          : <b className="dt-ref">{r.kind === 'invoice' ? invoiceRef(r) : ''}</b>;
      },
    },
    { key: 'client', header: 'Client', cell: r => clientName(r.client) },
    { key: 'subject', header: 'Objet ou motif', cell: r => <span className="dt-clip">{r.kind === 'credit' ? r.creditNote.reason || '—' : r.subject}</span> },
    { key: 'owner', header: 'Responsable', cell: r => r.ownerName ?? <span className="dt-muted">—</span> },
    { key: 'issued', header: 'Émission', cell: r => fmtDate(r.issued) },
    { key: 'due', header: 'Échéance', cell: r => r.kind === 'credit' ? <span className="dt-muted">—</span> : fmtDate(r.due) },
    { key: 'amount', header: 'Montant TTC', align: 'right', cell: r => r.kind === 'credit' ? <span className="dt-credit-amt">− {fmt(r.creditNote.amount)}</span> : fmt(r.amount) },
    {
      key: 'balance', header: 'Reste dû', align: 'right',
      cell: r => r.kind === 'credit' || r.status === 'draft' || r.balance === 0 ? <span className="dt-muted">—</span> : <b>{fmt(r.balance)}</b>,
    },
    {
      key: 'status', header: 'Statut',
      cell: r => r.kind === 'credit'
        ? <StatusPill tone={r.creditNote.status === 'draft' ? 'draft' : 'muted'} label={r.creditNote.status === 'draft' ? 'Brouillon' : 'Avoir émis'} />
        : <StatusPill {...invoiceRowStatus(r)} />,
    },
    ...(showBooks ? [{
      key: 'books', header: 'Comptabilité',
      cell: (r: DocRow) => { const b = bookingStatus(r, booked); return b ? <StatusPill {...b} /> : <span className="dt-muted">—</span>; },
    }] : []),
  ];

  const rowActions = (r: DocRow): RowAction<DocRow>[] => r.kind === 'credit' ? [
    r.creditNote.status === 'draft' && credits
      ? { label: 'Reprendre', icon: 'edit', onSelect: () => openRow(r) }
      : { label: 'Ouvrir la facture', icon: 'eye', onSelect: () => openRow(r) },
  ] : [
    { label: r.status === 'draft' && writable ? 'Modifier' : 'Ouvrir', icon: r.status === 'draft' && writable ? 'edit' : 'eye', onSelect: () => onOpen(r.id) },
    ...(writable && r.status === 'pending' ? [{ label: 'Envoyer au client', icon: 'send', onSelect: () => onSend(r.id) }] : []),
    ...(writable && r.status === 'overdue' ? [{ label: 'Envoyer une relance', icon: 'send', onSelect: () => onSend(r.id) }] : []),
    ...(r.status !== 'draft' && !downloading ? [{ label: 'Télécharger le PDF', icon: 'download', onSelect: () => onDownload(r.id) }] : []),
  ];

  return (
    <>
      <SummaryStrip items={[
        { label: 'Total facturé', value: fmtCompact(figures.invoiced.amount), unit: 'F CFA', note: `${figures.invoiced.count} factures émises` },
        { label: 'En attente', value: fmtCompact(figures.waiting.amount), unit: 'F CFA', note: `${figures.waiting.count} à encaisser` },
        {
          label: 'En retard', value: fmtCompact(figures.late.amount), unit: 'F CFA',
          note: `${figures.late.count} ${figures.late.count === 1 ? 'facture' : 'factures'} en retard`,
          tone: figures.late.count > 0 ? 'late' : undefined,
        },
        { label: 'Encaissé', value: fmtCompact(figures.collected.amount), unit: 'F CFA', note: `sur ${figures.collected.count} factures`, tone: 'good' },
      ]} />
      <DataTable
        key={showLate}
        initialFilter={showLate ? 'overdue' : undefined}
        caption="Factures"
        rows={ownedRows}
        rowKey={docKey}
        rowLabel={r => r.kind === 'credit'
          ? (r.creditNote.status === 'draft' ? 'le brouillon d’avoir' : `l’avoir ${creditNoteRef(r.creditNote)}`)
          : r.status === 'draft' ? `le brouillon ${r.subject}` : `la facture ${invoiceRef(r)}`}
        noun={typeFilter === 'credit' ? { one: 'avoir', many: 'avoirs' } : typeFilter === 'invoice' ? { one: 'facture', many: 'factures' } : { one: 'document', many: 'documents' }}
        columns={columns}
        filters={filters}
        search={search}
        onRowClick={openRow}
        rowActions={rowActions}
        mine={onlyOwn ? undefined : mine}
        toolbarExtra={<>
          <OwnerFilter label="Type" options={TYPES} value={typeFilter} onChange={t => { setTypeFilter(t); if (t !== 'credit') setNatureFilter('all'); }} />
          {typeFilter === 'credit' && <OwnerFilter label="Nature" options={NATURES} value={natureFilter} onChange={setNatureFilter} />}
          {!onlyOwn && <OwnerFilter options={ownerChoices} value={ownerFilter} onChange={setOwnerFilter} />}
        </>}
        selectable={managesOrg}
        bulkActions={(selected, clear) => (
          <ReassignControl
            team={team}
            busy={reassigning}
            onAssign={id => {
              const name = team.find(m => m.id === id)?.name ?? '';
              // Credit notes follow their invoice's « Responsable »
              const ids = selected.flatMap(r => r.kind === 'invoice' ? [r.id] : []);
              void reassign('invoices', ids, id, name).then(ok => { if (ok) clear(); });
            }}
          />
        )}
        footerSummary={shown => <>Reste dû <b>{fmt(shown.reduce((s, r) => s + (r.kind === 'invoice' ? r.balance : 0), 0))} F CFA</b></>}
        emptyMessage={invoices.length === 0 ? 'Aucune facture pour le moment. Créez votre première facture.' : 'Aucune facture ne correspond.'}
      />
    </>
  );
}
