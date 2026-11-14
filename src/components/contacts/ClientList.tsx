// The client list of the ERP look (PRO-169): the shared dense table, next to
// the selected client's record (ClientRecordPanel). ContactsPage renders it
// instead of its cards and list when VITE_UI_V2 is on.

import { useMemo, useState } from 'react';
import DataTable, { type Column, type StatusFilter } from '@/components/DataTable';
import { OwnerFilter, ReassignControl } from '@/components/owner/OwnerControls';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { useTeam } from '@/lib/use-team';
import { useReassign } from '@/lib/use-reassign';
import { clientTypeOf } from '@/lib/client-type';
import { ownerKey, ownerOptions } from '@/lib/sales-tables';
import type { ClientRow } from '@/lib/client-table';
import { fmt } from '@/data';
import StatusPill from '@/components/sales/StatusPill';
import { kybSummaryLabel, type KybSummary } from '@/lib/kyb';


export default function ClientList({ rows, year, selected, onSelect, kyb }: {
  rows: ClientRow[];
  /** Each client's KYB summary (PRO-176), by code. */
  kyb?: Map<string, KybSummary>;
  year: number;
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  const { userId, userRole } = useApp();
  const filters = useMemo<StatusFilter<ClientRow>[]>(() => [
    { key: 'lead',    label: 'Prospects',  match: c => c.status === 'lead' },
    { key: 'balance', label: 'Avec solde', match: c => c.balance > 0 },
    { key: 'late',    label: 'En retard',  match: c => c.late },
    ...(kyb ? [{ key: 'kyb', label: 'KYB incomplet', match: (c: ClientRow) => { const k = kyb.get(c.code); return !!k && k.required > 0 && !k.complete; } }] : []),
  ], [kyb]);
  const { managesOrg } = usePermissions();
  const team = useTeam(managesOrg);
  const { reassign, busy } = useReassign();
  const [ownerFilter, setOwnerFilter] = useState('all');
  const ownerChoices = useMemo(() => ownerOptions(rows), [rows]);
  const shown = useMemo(() => ownerFilter === 'all' ? rows : rows.filter(r => ownerKey(r) === ownerFilter), [rows, ownerFilter]);
  const mine = useMemo(() => ({
    label: 'Mes clients', isMine: (c: ClientRow) => c.ownerId === userId, defaultOn: userRole === 'member',
  }), [userId, userRole]);
  const search = useMemo(() => ({
    placeholder: 'Nom, IFU, ville ou contact…',
    text: (c: ClientRow) => `${c.name} ${c.ifu ?? ''} ${c.city} ${c.contact} ${c.code}`,
  }), []);

  const columns: Column<ClientRow>[] = [
    {
      key: 'name', header: 'Client',
      cell: c => (
        <span className={`cl-cell${c.code === selected ? ' on' : ''}`}>
          <b>{c.name}</b>
          <small>{c.ifu ? `IFU ${c.ifu}` : c.status === 'lead' ? 'Prospect' : 'Sans IFU'}</small>
        </span>
      ),
    },
    { key: 'type', header: 'Type', width: '64px', cell: c => <span className="dt-tag" title={clientTypeOf(c)}>{clientTypeOf(c)}</span> },
    { key: 'city', header: 'Ville', cell: c => c.city !== '—' ? c.city : <span className="dt-muted">—</span> },
    { key: 'owner', header: 'Responsable', cell: c => c.ownerName ?? <span className="dt-muted">—</span> },
    {
      key: 'kyb', header: 'Dossier KYB', hidden: !kyb,
      cell: c => {
        const k = kyb?.get(c.code);
        if (!k || k.required === 0) return <span className="dt-muted">—</span>;
        const tone = k.complete ? 'paid' : k.expired || k.missing ? 'late' : 'wait';
        return <span title={kybSummaryLabel(k)}><StatusPill label={k.complete ? 'Complet' : `${k.verified}/${k.required}`} tone={tone} /></span>;
      },
    },
    { key: 'year', header: `Facturé ${year}`, align: 'right', cell: c => c.invoicedYear ? fmt(c.invoicedYear) : <span className="dt-muted">—</span> },
    {
      key: 'balance', header: 'Solde dû', align: 'right',
      cell: c => c.balance === 0 ? <span className="dt-muted">—</span>
        : <b className={c.late ? 'dt-late' : undefined} title={c.late ? 'Dont une partie en retard' : undefined}>{fmt(c.balance)}</b>,
    },
  ];

  return (
    <DataTable
      caption="Clients"
      rows={shown}
      rowKey={c => c.code}
      rowLabel={c => c.name}
      noun={{ one: 'client', many: 'clients' }}
      allLabel="Tous"
      columns={columns}
      filters={filters}
      search={search}
      mine={mine}
      toolbarExtra={<OwnerFilter options={ownerChoices} value={ownerFilter} onChange={setOwnerFilter} />}
      onRowClick={c => onSelect(c.code)}
      selectable={managesOrg}
      bulkActions={(sel, clear) => (
        <ReassignControl
          team={team}
          busy={busy}
          onAssign={id => {
            const name = team.find(m => m.id === id)?.name ?? '';
            void reassign('clients', sel.map(c => c.code), id, name).then(ok => { if (ok) clear(); });
          }}
        />
      )}
      footerSummary={list => <>Solde dû <b>{fmt(list.reduce((s, c) => s + c.balance, 0))} F CFA</b></>}
      emptyMessage={rows.length === 0 ? 'Aucun client pour le moment. Ajoutez votre premier client.' : 'Aucun client ne correspond.'}
    />
  );
}
