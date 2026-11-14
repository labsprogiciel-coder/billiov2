// The dashboard of the ERP look (PRO-164): figures over a month, quarter or
// year to date, cash collected per period, the invoices to chase, and the
// latest invoices. App.tsx renders it instead of DashboardPage when
// VITE_UI_V2 is on. Members see their own records only (the database
// filters them), so their dashboard is theirs.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import Page from '@/components/Page';
import { PageSkeleton } from '@/components/SkeletonLoader';
import DataTable, { SummaryStrip, type Column } from '@/components/DataTable';
import StatusPill from '@/components/sales/StatusPill';
import CashChart from '@/components/dashboard/CashChart';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { useCreditNotes } from '@/lib/use-credit-notes';
import { withIntent } from '@/lib/command-intent';
import { invoiceRef } from '@/lib/invoice-number';
import { todayISO } from '@/lib/invoice-status';
import { invoiceRowStatus, invoiceRows, type InvoiceRow } from '@/lib/sales-tables';
import { cashSeries, invoicesToChase, periodFigures, type Period } from '@/lib/dashboard-periods';
import { fmt, fmtCompact, fmtDate, fmtDateLong } from '@/data';

const PERIODS: { key: Period; label: string; strip: string }[] = [
  { key: 'month', label: 'Mois', strip: 'ce mois' },
  { key: 'quarter', label: 'Trimestre', strip: 'ce trimestre' },
  { key: 'year', label: 'Année', strip: 'cette année' },
];

export default function DashboardV2Page() {
  const { invoices, payments, clientsMap, orgSettings, loading } = useApp();
  const { writable } = usePermissions();
  const navigate = useNavigate();
  const creditNotes = useCreditNotes();
  const [period, setPeriod] = useState<Period>('month');
  // Keyed on the date too, so a dashboard left open past midnight recomputes
  const today = todayISO();

  const f = useMemo(() => periodFigures(invoices, payments, creditNotes, period, today), [invoices, payments, creditNotes, period, today]);
  const bars = useMemo(() => cashSeries(payments, period, today), [payments, period, today]);
  const toChase = useMemo(() => invoicesToChase(invoices, payments, creditNotes, today), [invoices, payments, creditNotes, today]);
  const latest = useMemo(
    () => invoiceRows(invoices, payments, creditNotes).sort((a, b) => b.issued.localeCompare(a.issued)).slice(0, 8),
    [invoices, payments, creditNotes],
  );
  const p = PERIODS.find(x => x.key === period)!;
  const clientName = (code: string) => clientsMap[code]?.name ?? code;

  if (loading) return <PageSkeleton title="Tableau de bord" variant="dashboard" />;

  const columns: Column<InvoiceRow>[] = [
    { key: 'n', header: 'N°', width: '140px', cell: r => r.status === 'draft' ? <span className="dt-muted">Brouillon</span> : <b className="dt-ref">{invoiceRef(r)}</b> },
    { key: 'client', header: 'Client', cell: r => clientName(r.client) },
    { key: 'subject', header: 'Objet', cell: r => <span className="dt-clip">{r.subject}</span> },
    { key: 'issued', header: 'Émission', cell: r => fmtDate(r.issued) },
    { key: 'amount', header: 'Montant TTC', align: 'right', cell: r => fmt(r.amount) },
    { key: 'balance', header: 'Reste dû', align: 'right', cell: r => r.balance ? <b>{fmt(r.balance)}</b> : <span className="dt-muted">—</span> },
    { key: 'status', header: 'Statut', cell: r => <StatusPill {...invoiceRowStatus(r, today)} /> },
  ];

  return (
    <Page
      title="Tableau de bord"
      subtitle={<>{orgSettings.name ? `${orgSettings.name} · ` : ''}données au {fmtDateLong(today)}</>}
      actions={<>
        <div className="dt-switch" role="group" aria-label="Période">
          {PERIODS.map(x => (
            <button key={x.key} type="button" aria-pressed={period === x.key} onClick={() => setPeriod(x.key)}>{x.label}</button>
          ))}
        </div>
        {writable && (
          <button className="btn btn-primary" onClick={() => navigate('/invoices', withIntent({ command: 'new-invoice' }))}>
            <Icon name="plus" ariaHidden /> Nouvelle facture
          </button>
        )}
      </>}
    >
      <SummaryStrip items={[
        {
          label: `Facturé ${p.strip}`, value: fmtCompact(f.invoiced), unit: 'F CFA',
          note: f.changePct === null ? 'rien sur la période précédente'
            : f.changePct === 0 ? 'stable vs période précédente'
            : `${f.changePct > 0 ? '+' : '−'}${Math.abs(f.changePct)} % vs période précédente`,
          tone: f.changePct !== null && f.changePct > 0 ? 'good' : undefined,
        },
        {
          label: 'Impayé', value: fmtCompact(f.outstanding), unit: 'F CFA',
          note: f.overdueCount ? `dont ${f.overdueCount} facture${f.overdueCount > 1 ? 's' : ''} en retard` : 'aucune facture en retard',
          tone: f.overdueCount ? 'late' : 'good',
        },
        {
          label: `Encaissé ${p.strip}`, value: fmtCompact(f.collected), unit: 'F CFA',
          note: f.collectedPct === null ? 'rien de facturé sur la période' : `${f.collectedPct} % du facturé`,
        },
        {
          label: 'Délai moyen de paiement', value: f.avgDaysToPay === null ? '—' : f.avgDaysToPay.toLocaleString('fr-FR'), unit: f.avgDaysToPay === null ? undefined : 'jours',
          note: f.settledCount ? `sur ${f.settledCount} facture${f.settledCount > 1 ? 's' : ''} soldée${f.settledCount > 1 ? 's' : ''} ${p.strip}` : `aucune facture soldée ${p.strip}`,
        },
      ]} />

      <div className="dash-grid">
        <section className="dash-panel" aria-labelledby="dash-cash">
          <h2 id="dash-cash" className="dash-title">Encaissé par {period === 'quarter' ? 'trimestre' : 'mois'}</h2>
          <CashChart bars={bars} caption={`Encaissé par ${period === 'quarter' ? 'trimestre' : 'mois'}`} />
        </section>

        <section className="dash-panel" aria-labelledby="dash-chase">
          <div className="dash-head">
            <h2 id="dash-chase" className="dash-title">À relancer <span className="cr-count">{toChase.length}</span></h2>
            {toChase.length > 0 && <button type="button" className="dt-linkcell" onClick={() => navigate('/invoices', withIntent({ command: 'show-late' }))}>Tout voir</button>}
          </div>
          {toChase.length === 0 ? (
            <p className="dash-empty"><Icon name="circle-check-filled" size={15} ariaHidden /> Aucune facture en retard.</p>
          ) : (
            <ul className="chase-list">
              {toChase.slice(0, 6).map(c => (
                <li key={c.invoice.id}>
                  <button type="button" className="chase-open" onClick={() => navigate(`/invoices/${c.invoice.id}`)}>
                    <b>{invoiceRef(c.invoice)}</b>
                    <span>{clientName(c.invoice.client)}</span>
                  </button>
                  <span className="chase-late">{c.daysLate} j de retard</span>
                  <span className="chase-amt">{fmt(c.balance)}</span>
                  {writable && (
                    <button type="button" className="btn btn-sm" onClick={() => navigate(`/invoices/${c.invoice.id}`, { state: { openSend: true } })}
                      aria-label={`Relancer pour ${invoiceRef(c.invoice)}`}>Relancer</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="dash-head dash-latest">
        <h2 className="dash-title">Dernières factures</h2>
        <button type="button" className="dt-linkcell" onClick={() => navigate('/invoices')}>Toutes les factures</button>
      </div>
      <DataTable
        caption="Dernières factures"
        rows={latest}
        rowKey={r => r.id}
        rowLabel={r => r.status === 'draft' ? `le brouillon ${r.subject}` : `la facture ${invoiceRef(r)}`}
        noun={{ one: 'facture', many: 'factures' }}
        columns={columns}
        onRowClick={r => navigate(`/invoices/${r.id}`)}
        pageSize={8}
        emptyMessage="Aucune facture pour le moment."
      />
    </Page>
  );
}
