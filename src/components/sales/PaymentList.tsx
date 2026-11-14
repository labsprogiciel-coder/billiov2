// Paiements in the ERP look (PRO-165): summary strip and the shared dense table.
// PaymentsPage renders this instead of its cards and list when VITE_UI_V2 is on;
// recording a payment and the « Relevé » export stay in the page.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable, { SummaryStrip, type Column, type StatusFilter } from '@/components/DataTable';
import StatusPill from '@/components/sales/StatusPill';
import { useApp } from '@/context/AppContext';
import { invoiceRef } from '@/lib/invoice-number';
import { PAYMENT_STATUS, PAY_METHOD_LABEL, paymentAuthor, paymentAuthorOptions, paymentFigures } from '@/lib/sales-tables';
import { OwnerFilter } from '@/components/owner/OwnerControls';
import { fmt, fmtCompact, fmtDate } from '@/data';
import type { Payment } from '@/lib/schemas';

const FILTERS: StatusFilter<Payment>[] = [
  { key: 'momo',    label: 'Mobile Money', match: p => p.method === 'momo' },
  { key: 'wire',    label: 'Virement',     match: p => p.method === 'wire' },
  { key: 'cash',    label: 'Espèces',      match: p => p.method === 'cash' },
  { key: 'cheque',  label: 'Chèque',       match: p => p.method === 'cheque' },
  { key: 'online',  label: 'En ligne',     match: p => p.source === 'online' },
  { key: 'pending', label: 'En attente',   match: p => p.status === 'pending' },
];

export default function PaymentList({ onShownChange }: { onShownChange: (shown: Payment[]) => void }) {
  const { payments, invoices, clientsMap } = useApp();
  const navigate = useNavigate();
  const figures = useMemo(() => paymentFigures(payments), [payments]);
  // « Saisi par » filter (PRO-173)
  const [author, setAuthor] = useState('all');
  const authorChoices = useMemo(() => paymentAuthorOptions(payments), [payments]);
  const rows = useMemo(() => author === 'all' ? payments : payments.filter(p => paymentAuthor(p) === author), [payments, author]);
  // Payments point to the invoice's internal id; show its legal number
  const invRef = useMemo(() => {
    const byId = new Map(invoices.map(i => [i.id, invoiceRef(i)]));
    return (id: string) => byId.get(id);
  }, [invoices]);
  const clientName = (id: string) => clientsMap[id]?.name ?? id;
  // Stable between renders: the table recomputes its rows when this changes,
  // and reports them to the page (onShownChange), which would render again
  const search = useMemo(() => ({
    placeholder: 'Référence, client ou facture…',
    text: (p: Payment) => `${p.ref} ${clientsMap[p.client]?.name ?? p.client} ${invRef(p.inv) ?? p.inv} ${PAY_METHOD_LABEL[p.method]}`,
  }), [clientsMap, invRef]);

  const columns: Column<Payment>[] = [
    { key: 'date', header: 'Date', width: '110px', cell: p => fmtDate(p.date) },
    { key: 'ref', header: 'Référence', cell: p => p.source === 'online' ? <span className="dt-muted">via Paystack</span> : (p.ref || <span className="dt-muted">—</span>) },
    { key: 'client', header: 'Client', cell: p => clientName(p.client) },
    {
      key: 'invoice', header: 'Facture',
      cell: p => {
        const ref = invRef(p.inv);
        return ref
          ? <button type="button" className="dt-linkcell" onClick={() => navigate(`/invoices/${p.inv}`)} aria-label={`Ouvrir la facture ${ref}`}>{ref}</button>
          : <span className="dt-muted">{p.inv}</span>;
      },
    },
    { key: 'method', header: 'Méthode', cell: p => PAY_METHOD_LABEL[p.method] },
    { key: 'by', header: 'Saisi par', cell: p => p.source === 'online' || !p.createdByName ? <span className="dt-muted">{paymentAuthor(p)}</span> : p.createdByName },
    { key: 'amount', header: 'Montant', align: 'right', cell: p => <b className={p.status === 'completed' ? undefined : 'dt-muted'}>{fmt(p.amount)}</b> },
    { key: 'status', header: 'Statut', cell: p => <StatusPill {...PAYMENT_STATUS[p.status]} /> },
  ];

  return (
    <>
      <SummaryStrip items={[
        { label: 'Total encaissé', value: fmtCompact(figures.collected.amount), unit: 'F CFA', note: `${figures.collected.count} paiements reçus`, tone: 'good' },
        { label: 'Mobile Money', value: fmtCompact(figures.momo.amount), unit: 'F CFA', note: `${figures.share.momo} % du total` },
        { label: 'Virement bancaire', value: fmtCompact(figures.wire.amount), unit: 'F CFA', note: `${figures.share.wire} % du total` },
        { label: 'Espèces et chèques', value: fmtCompact(figures.cashCheque.amount), unit: 'F CFA', note: `${figures.share.cashCheque} % du total` },
      ]} />
      <DataTable
        caption="Paiements"
        rows={rows}
        toolbarExtra={<OwnerFilter label="Saisi par" options={authorChoices} value={author} onChange={setAuthor} />}
        rowKey={p => p.id}
        rowLabel={p => `le paiement du ${fmtDate(p.date)}`}
        noun={{ one: 'paiement', many: 'paiements' }}
        allLabel="Tous"
        columns={columns}
        filters={FILTERS}
        search={search}
        footerSummary={shown => <>Encaissé <b>{fmt(shown.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount, 0))} F CFA</b></>}
        emptyMessage={payments.length === 0 ? 'Aucun paiement pour le moment. Les paiements reçus apparaîtront ici.' : 'Aucun paiement ne correspond.'}
        onShownChange={onShownChange}
      />
    </>
  );
}
