// Devis in the ERP look (PRO-165): summary strip and the shared dense table.
// QuotesPage renders this instead of its cards and list when VITE_UI_V2 is on;
// converting, reminding, duplicating and deleting stay in the page.

import { useMemo } from 'react';
import DataTable, { SummaryStrip, type Column, type RowAction, type StatusFilter } from '@/components/DataTable';
import Icon from '@/components/Icon';
import StatusPill from '@/components/sales/StatusPill';
import { useApp } from '@/context/AppContext';
import { QUOTE_STATUS, quoteFigures } from '@/lib/sales-tables';
import { fmt, fmtCompact, fmtDate } from '@/data';
import type { Quote } from '@/lib/schemas';

const FILTERS: StatusFilter<Quote>[] = [
  { key: 'draft',    label: 'Brouillons', match: q => q.status === 'draft' },
  { key: 'sent',     label: 'Envoyés',    match: q => q.status === 'sent' },
  { key: 'accepted', label: 'Acceptés',   match: q => q.status === 'accepted' },
  { key: 'invoiced', label: 'Facturés',   match: q => q.status === 'invoiced' },
  { key: 'closed',   label: 'Refusés ou expirés', match: q => q.status === 'declined' || q.status === 'expired' },
];

/** Quotes that can still be turned into an invoice (as in the list before PRO-165). */
const canConvert = (q: Quote) => q.status === 'draft' || q.status === 'sent' || q.status === 'accepted';

export interface QuoteListProps {
  writable: boolean;
  deletable: boolean;
  onOpen: (id: string) => void;
  onConvert: (quote: Quote) => void;
  onRemind: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** A duplicate is being made: others wait. */
  duplicating: boolean;
}

export default function QuoteList({ writable, deletable, onOpen, onConvert, onRemind, onDuplicate, onDelete, duplicating }: QuoteListProps) {
  const { quotes, clientsMap } = useApp();
  const figures = useMemo(() => quoteFigures(quotes), [quotes]);
  const clientName = (id: string) => clientsMap[id]?.name ?? id;
  const search = useMemo(() => ({
    placeholder: 'N°, client ou objet…',
    text: (q: Quote) => `${q.id} ${clientsMap[q.client]?.name ?? q.client} ${q.subject}`,
  }), [clientsMap]);

  const columns: Column<Quote>[] = [
    { key: 'number', header: 'N°', width: '130px', cell: q => <b className="dt-ref">{q.id}</b> },
    { key: 'client', header: 'Client', cell: q => clientName(q.client) },
    { key: 'subject', header: 'Objet', cell: q => <span className="dt-clip">{q.subject}</span> },
    // Who is in charge of each quote comes with PRO-172
    { key: 'owner', header: 'Responsable', cell: () => null, hidden: true },
    { key: 'issued', header: 'Émission', cell: q => fmtDate(q.issued) },
    {
      key: 'valid', header: 'Valide jusqu’au',
      cell: q => <>{fmtDate(q.valid)}{q.status === 'sent' && q.expSoon && <span className="dt-warn"> · expire bientôt</span>}</>,
    },
    { key: 'amount', header: 'Montant TTC', align: 'right', cell: q => fmt(q.amount) },
    { key: 'status', header: 'Statut', cell: q => <StatusPill {...QUOTE_STATUS[q.status]} /> },
    {
      // An accepted quote is waiting to be invoiced: put the button in the row
      key: 'next', header: <span className="sr-only">Suite</span>, width: '110px',
      cell: q => writable && q.status === 'accepted'
        ? <button type="button" className="btn btn-sm btn-primary" onClick={() => onConvert(q)} aria-label={`Facturer le devis ${q.id}`}>
            <Icon name="arrow-right" size={13} ariaHidden /> Facturer
          </button>
        : null,
    },
  ];

  const rowActions = (q: Quote): RowAction<Quote>[] => [
    { label: writable && q.status === 'draft' ? 'Modifier' : 'Ouvrir', icon: writable && q.status === 'draft' ? 'edit' : 'eye', onSelect: () => onOpen(q.id) },
    ...(writable && canConvert(q) && q.status !== 'accepted' ? [{ label: 'Facturer', icon: 'arrow-right', onSelect: onConvert }] : []),
    ...(writable && q.status === 'sent' ? [{ label: 'Envoyer une relance', icon: 'send', onSelect: () => onRemind(q.id) }] : []),
    ...(writable && !duplicating && (q.status === 'declined' || q.status === 'expired' || q.status === 'invoiced')
      ? [{ label: 'Dupliquer', icon: 'copy', onSelect: () => onDuplicate(q.id) }] : []),
    ...(deletable ? [{ label: 'Supprimer', icon: 'trash', danger: true, onSelect: () => onDelete(q.id) }] : []),
  ];

  return (
    <>
      <SummaryStrip items={[
        { label: 'En attente de réponse', value: fmtCompact(figures.waiting.amount), unit: 'F CFA', note: `${figures.waiting.count} devis envoyés` },
        { label: 'Acceptés', value: fmtCompact(figures.accepted.amount), unit: 'F CFA', note: `${figures.accepted.count} à facturer`, tone: figures.accepted.count > 0 ? 'good' : undefined },
        { label: 'Taux d’acceptation', value: figures.rate.percent, unit: '%', note: `${figures.rate.won} sur ${figures.rate.decided} décidés` },
        { label: 'Devisé sur 90 jours', value: fmtCompact(figures.quoted90.amount), unit: 'F CFA', note: `${figures.quoted90.count} devis` },
      ]} />
      <DataTable
        caption="Devis"
        rows={quotes}
        rowKey={q => q.id}
        rowLabel={q => `le devis ${q.id}`}
        noun={{ one: 'devis', many: 'devis' }}
        allLabel="Tous"
        columns={columns}
        filters={FILTERS}
        search={search}
        onRowClick={q => onOpen(q.id)}
        rowActions={rowActions}
        footerSummary={shown => <>Total <b>{fmt(shown.reduce((s, q) => s + q.amount, 0))} F CFA</b></>}
        emptyMessage={quotes.length === 0 ? 'Aucun devis pour le moment. Créez un devis pour commencer.' : 'Aucun devis ne correspond.'}
      />
    </>
  );
}
