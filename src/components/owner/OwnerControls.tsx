// « Responsable » controls for the tables and records (PRO-172): a filter
// by owner, the admins' reassign menu, and the line on a record page.

import { useId, useState } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import { useTeam, type TeamMember } from '@/lib/use-team';
import { useReassign } from '@/lib/use-reassign';
import type { OwnedTable } from '@/lib/api/owners';

/** « Responsable : Tous / Awa / … » above a table. */
export function OwnerFilter({ options, value, onChange }: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const id = useId();
  if (options.length < 2 && value === 'all') return null;
  return (
    <label className="dt-select" htmlFor={id}>
      <span>Responsable</span>
      <select id={id} value={value} onChange={e => onChange(e.target.value)}>
        <option value="all">Tous</option>
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Pick a member and apply: for the selection bar and the record pages. */
export function ReassignControl({ team, current, onAssign, label = 'Réattribuer à', busy }: {
  team: TeamMember[];
  /** Owner now (single record): left out of the choices. */
  current?: string;
  onAssign: (ownerId: string) => void;
  label?: string;
  busy?: boolean;
}) {
  const id = useId();
  const [to, setTo] = useState('');
  const choices = team.filter(m => m.id !== current && m.role !== 'observer');
  return (
    <span className="owner-assign">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={to} onChange={e => setTo(e.target.value)} disabled={busy || choices.length === 0}>
        <option value="">{choices.length ? 'Choisir…' : 'Aucun autre membre'}</option>
        {choices.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <button type="button" className="btn btn-sm" disabled={!to || busy} onClick={() => { onAssign(to); setTo(''); }}>
        Valider
      </button>
    </span>
  );
}

/**
 * « Responsable : Awa » on a record page; admins can give it to another
 * member from here. `className` styles the line for where it sits.
 */
export function OwnerLine({ table, id, ownerId, ownerName, className }: {
  table: OwnedTable;
  id: string;
  ownerId?: string;
  ownerName?: string;
  className?: string;
}) {
  const { managesOrg } = usePermissions();
  const team = useTeam(managesOrg);
  const { reassign, busy } = useReassign();
  const [editing, setEditing] = useState(false);
  const departed = !ownerId && !!ownerName;
  return (
    <div className={`owner-line${className ? ` ${className}` : ''}`}>
      <span className="owner-line-label">Responsable</span>
      <strong>{ownerName ?? '—'}</strong>
      {departed && <span className="owner-line-note">a quitté l’équipe</span>}
      {managesOrg && !editing && (
        <button type="button" className="owner-line-edit" onClick={() => setEditing(true)}>Changer</button>
      )}
      {managesOrg && editing && (
        <ReassignControl
          team={team}
          current={ownerId}
          busy={busy}
          label="Nouveau responsable"
          onAssign={to => {
            const name = team.find(m => m.id === to)?.name ?? '';
            void reassign(table, [id], to, name).then(ok => { if (ok) setEditing(false); });
          }}
        />
      )}
    </div>
  );
}
