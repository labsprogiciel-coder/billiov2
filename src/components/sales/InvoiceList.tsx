// Factures in the ERP look (PRO-165): summary strip and the shared dense table.
// InvoicesPage renders this instead of its cards and list when VITE_UI_V2 is on;
// the actions (open, send, remind, PDF) stay in the page.

import { useMemo, useState } from 'react';
import DataTable, { SummaryStrip, type Column, type RowAction, type StatusFilter } from '@/components/DataTable';
import { useApp } from '@/context/AppContext';
import { OwnerFilter, ReassignControl } from '@/components/owner/OwnerControls';
import { usePermissions } from '@/lib/use-permissions';
import { useTeam } from '@/lib/use-team';
import { useReassign } from '@/lib/use-reassign';

import { useCreditNotes } from '@/lib/use-credit-notes';
import { invoiceRef } from '@/lib/invoice-number';
import { invoiceFigures, invoiceRowStatus, invoiceRows, ownerKey, ownerOptions, type InvoiceRow } from '@/lib/sales-tables';
import { fmt, fmtCompact, fmtDate } from '@/data';
import StatusPill from '@/components/sales/StatusPill';

const FILTERS: StatusFilter<InvoiceRow>[] = [
  { key: 'draft',   label: 'Brouillons', match: r => r.status === 'draft' },
  { key: 'overdue', label: 'En retard',  match: r => r.status === 'overdue' },
  { key: 'paid',    label: 'Payées',     match: r => r.status === 'paid' },
];

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
  const { invoices, payments, clientsMap, userId, userRole } = useApp();
  const creditNotes = useCreditNotes();

  const rows = useMemo(() => invoiceRows(invoices, payments, creditNotes), [invoices, payments, creditNotes]);
  const figures = useMemo(() => invoiceFigures(rows), [rows]);
  // « Responsable » (PRO-172): members start on their own records
  const { managesOrg } = usePermissions();
  const team = useTeam(managesOrg);
  const { reassign, busy: reassigning } = useReassign();
  const [ownerFilter, setOwnerFilter] = useState('all');
  const ownerChoices = useMemo(() => ownerOptions(rows), [rows]);
  const ownedRows = useMemo(
    () => ownerFilter === 'all' ? rows : rows.filter(r => ownerKey(r) === ownerFilter),
    [rows, ownerFilter],
  );
  // Members only see their own records (the database filters them): no « Toute l'équipe » switch or Responsable filter
  const onlyOwn = userRole === 'member';
  const mine = useMemo(() => ({
    label: 'Mes factures', isMine: (r: { ownerId?: string }) => r.ownerId === userId, defaultOn: userRole === 'member',
  }), [userId, userRole]);
  const clientName = (id: string) => clientsMap[id]?.name ?? id;
  const search = useMemo(() => ({
    placeholder: 'N°, client ou objet…',
    text: (r: InvoiceRow) => `${invoiceRef(r)} ${r.id} ${clientsMap[r.client]?.name ?? r.client} ${r.subject}`,
  }), [clientsMap]);

  const columns: Column<InvoiceRow>[] = [
    {
      key: 'number', header: 'N°', width: '150px',
      cell: r => r.status === 'draft'
        ? <span className="dt-muted">Brouillon</span>
        : <b className="dt-ref">{invoiceRef(r)}</b>,
    },
    { key: 'client', header: 'Client', cell: r => clientName(r.client) },
    { key: 'subject', header: 'Objet', cell: r => <span className="dt-clip">{r.subject}</span> },
    { key: 'owner', header: 'Responsable', cell: r => r.ownerName ?? <span className="dt-muted">—</span> },
    { key: 'issued', header: 'Émission', cell: r => fmtDate(r.issued) },
    { key: 'due', header: 'Échéance', cell: r => fmtDate(r.due) },
    { key: 'amount', header: 'Montant TTC', align: 'right', cell: r => fmt(r.amount) },
    {
      key: 'balance', header: 'Reste dû', align: 'right',
      cell: r => r.status === 'draft' || r.balance === 0 ? <span className="dt-muted">—</span> : <b>{fmt(r.balance)}</b>,
    },
    { key: 'status', header: 'Statut', cell: r => <StatusPill {...invoiceRowStatus(r)} /> },
  ];

  const rowActions = (r: InvoiceRow): RowAction<InvoiceRow>[] => [
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
        rowKey={r => r.id}
        rowLabel={r => r.status === 'draft' ? `le brouillon ${r.subject}` : `la facture ${invoiceRef(r)}`}
        noun={{ one: 'facture', many: 'factures' }}
        columns={columns}
        filters={FILTERS}
        search={search}
        onRowClick={r => onOpen(r.id)}
        rowActions={rowActions}
        mine={onlyOwn ? undefined : mine}
        toolbarExtra={onlyOwn ? undefined : <OwnerFilter options={ownerChoices} value={ownerFilter} onChange={setOwnerFilter} />}
        selectable={managesOrg}
        bulkActions={(selected, clear) => (
          <ReassignControl
            team={team}
            busy={reassigning}
            onAssign={id => {
              const name = team.find(m => m.id === id)?.name ?? '';
              void reassign('invoices', selected.map(r => r.id), id, name).then(ok => { if (ok) clear(); });
            }}
          />
        )}
        footerSummary={shown => <>Reste dû <b>{fmt(shown.reduce((s, r) => s + r.balance, 0))} F CFA</b></>}
        emptyMessage={invoices.length === 0 ? 'Aucune facture pour le moment. Créez votre première facture.' : 'Aucune facture ne correspond.'}
      />
    </>
  );
}
