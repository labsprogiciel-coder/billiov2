// « Responsable » controls for the tables and records (PRO-172): a filter
// by owner, the admins' reassign menu, and the line on a record page.

import { useEffect, useId, useRef, useState } from 'react';
import { normalizeSearch } from '@/lib/data-table';
import Icon from '@/components/Icon';
import { usePermissions } from '@/lib/use-permissions';
import { useTeam, type TeamMember } from '@/lib/use-team';
import { useReassign } from '@/lib/use-reassign';
import type { OwnedTable } from '@/lib/api/owners';

/** « Responsable : Tous / Awa / … » (or « Saisi par ») above a table. */
export function OwnerFilter({ options, value, onChange, label = 'Responsable' }: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  /** « Saisi par » for payments. */
  label?: string;
}) {
  const id = useId();
  if (options.length < 2 && value === 'all') return null;
  return (
    <label className="dt-select" htmlFor={id}>
      <span>{label}</span>
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

const ROLE_LABEL: Record<string, string> = { owner: 'Propriétaire', admin: 'Administrateur', accountant: 'Comptable', member: 'Membre' };

/** Pick the new « Responsable » of one record (admins). */
export function ReassignDialog({ team, current, currentName, onAssign, onClose, busy }: {
  team: TeamMember[];
  current?: string;
  currentName?: string;
  onAssign: (ownerId: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const members = team.filter(m => m.role !== 'observer');
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  const choices = members.filter(m => {
    const hay = normalizeSearch(`${m.name} ${ROLE_LABEL[m.role] ?? m.role}`);
    return words.every(w => hay.includes(w));
  });
  const [to, setTo] = useState('');

  // Focus inside on open, keep Tab inside, give focus back on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input[type="search"]')?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      // The radios are one stop (the chosen one, else the first); arrows move between them
      const radios = Array.from(dialogRef.current.querySelectorAll<HTMLInputElement>('input[type="radio"]:not([disabled])'));
      const radioStop = radios.find(r => r.checked) ?? radios[0];
      const buttons = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const searchBox = dialogRef.current.querySelector<HTMLElement>('input[type="search"]');
      const f = [buttons[0], searchBox, ...(radioStop ? [radioStop] : []), ...buttons.slice(1)].filter((el): el is HTMLElement => !!el);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);

  return (
    <div className="inv-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div ref={dialogRef} className="inv-modal owner-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}>
        <div className="inv-modal-head">
          <div className="inv-modal-title" id={titleId}>Changer de responsable</div>
          <button type="button" className="btn btn-icon" onClick={onClose} disabled={busy} aria-label="Fermer">
            <Icon name="x" size={16} ariaHidden />
          </button>
        </div>
        <div className="inv-modal-body">
          <p className="owner-dialog-now">Responsable actuel : <strong>{currentName ?? 'aucun'}</strong></p>
          <label className="dt-search owner-search">
            <Icon name="search" size={14} ariaHidden />
            <span className="sr-only">Rechercher un membre</span>
            <input
              type="search"
              value={query}
              placeholder="Rechercher un membre…"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                // Enter picks the only match; ↓ goes to the list
                if (e.key === 'Enter') { e.preventDefault(); const only = choices.filter(m => m.id !== current); if (only.length === 1) setTo(only[0].id); }
                if (e.key === 'ArrowDown') { e.preventDefault(); dialogRef.current?.querySelector<HTMLElement>('input[type="radio"]:not([disabled])')?.focus(); }
              }}
            />
          </label>
          {members.length === 0 ? <p className="dt-muted">Chargement de l’équipe…</p>
            : choices.length === 0 ? <p className="dt-muted">Aucun membre ne correspond à « {query.trim()} ».</p> : (
            <fieldset className="owner-choices">
              <legend className="sr-only">Nouveau responsable</legend>
              {choices.map(m => (
                <label key={m.id} className={`owner-choice${m.id === current ? ' current' : ''}`}>
                  <input type="radio" name="owner" value={m.id} checked={to === m.id} disabled={m.id === current || busy} onChange={() => setTo(m.id)} />
                  <span className="owner-choice-name">{m.name}</span>
                  <span className="owner-choice-role">{m.id === current ? 'actuel' : ROLE_LABEL[m.role] ?? m.role}</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <div className="inv-modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={!to || busy} onClick={() => onAssign(to)}>
            {busy ? 'Enregistrement…' : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * « Responsable : Awa » on a record page; admins can give it to another
 * member from here (a dialog). `className` styles the line for where it sits.
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
      {managesOrg && (
        <button type="button" className="owner-line-edit" aria-haspopup="dialog" onClick={() => setEditing(true)}>Changer</button>
      )}
      {managesOrg && editing && (
        <ReassignDialog
          team={team}
          current={ownerId}
          currentName={ownerName}
          busy={busy}
          onClose={() => setEditing(false)}
          onAssign={to => {
            const name = team.find(m => m.id === to)?.name ?? '';
            void reassign(table, [id], to, name).then(ok => { if (ok) setEditing(false); });
          }}
        />
      )}
    </div>
  );
}
