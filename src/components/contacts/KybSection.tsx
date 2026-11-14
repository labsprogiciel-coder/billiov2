// The « Dossier KYB » of a client record (PRO-176): the documents its type
// needs, their state, and what each role can do with them. Collapsible; it
// opens by itself when something needs doing, and shows the summary closed.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Icon from '@/components/Icon';
import StatusPill from '@/components/sales/StatusPill';
import SendDocumentDialog from '@/components/SendDocumentDialog';
import { KYB_ACCEPT, kybFileError } from '@/lib/api/client-documents';
import {
  addMonths, documentsToRequest, kybItems, kybRequestMessage, kybStateLabel, kybSummary, kybSummaryLabel,
  type ClientDocument, type KybItem, type KybState,
} from '@/lib/kyb';
import type { ClientDocumentsApi } from '@/lib/use-client-documents';
import type { ClientType } from '@/lib/client-type';
import type { StatusTone } from '@/lib/sales-tables';
import { todayISO } from '@/lib/invoice-status';
import { contactValue } from '@/lib/share-links';
import { fmtDate } from '@/data';

const TONE: Record<KybState, StatusTone> = {
  verified: 'paid', expiring: 'partial', 'to-check': 'wait', expired: 'late', rejected: 'late', missing: 'draft',
};

export interface KybPermissions { write: boolean; check: boolean; remove: boolean }

export default function KybSection({ client, type, docs, api, can, orgName }: {
  client: { code: string; name: string; email?: string; phone?: string };
  type: ClientType;
  docs: ClientDocument[];
  api: ClientDocumentsApi;
  can: KybPermissions;
  orgName: string;
}) {
  const items = kybItems(type, docs, todayISO());
  const summary = kybSummary(items);
  // Opens by itself when something needs doing (per client)
  const [open, setOpen] = useState(summary.needsAttention);
  const [shownFor, setShownFor] = useState(client.code);
  if (shownFor !== client.code) { setShownFor(client.code); setOpen(summary.needsAttention); }
  const [uploading, setUploading] = useState<{ item: KybItem; datesOnly?: boolean } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const bodyId = useId();
  const toRequest = documentsToRequest(items);

  if (items.length === 0) {
    return (
      <section className="cr-section">
        <h3>Dossier KYB</h3>
        <p className="dt-muted">Aucun document demandé pour un client comptant.</p>
      </section>
    );
  }

  return (
    <section className="cr-section">
      <h3>
        <button type="button" className="cr-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} ariaHidden />
          Dossier KYB
        </button>
      </h3>
      <p className={`kyb-summary${summary.complete ? ' ok' : summary.expired || summary.missing ? ' late' : ''}`}>
        {summary.complete && <Icon name="circle-check-filled" size={13} ariaHidden />} {kybSummaryLabel(summary)}
      </p>
      {open && (
        <div id={bodyId}>
          <ul className="kyb-list">
            {items.map(item => (
              <KybRow
                key={item.doc.key}
                item={item}
                can={can}
                onOpen={() => item.stored && void api.open(item.stored)}
                onUpload={() => setUploading({ item })}
                onDates={() => setUploading({ item, datesOnly: true })}
                onStatus={s => item.stored && void api.setStatus(item.stored, s)}
                onRemove={() => {
                  if (item.stored && window.confirm(`Supprimer « ${item.doc.label} » de ce dossier ?`)) void api.remove(item.stored);
                }}
              />
            ))}
          </ul>
          {can.write && toRequest.length > 0 && (
            <button type="button" className="btn btn-sm kyb-request" onClick={() => setRequesting(true)}>
              <Icon name="send" size={14} ariaHidden /> Demander les pièces ({toRequest.length})
            </button>
          )}
        </div>
      )}

      {uploading && (
        <KybUploadDialog
          item={uploading.item}
          datesOnly={uploading.datesOnly}
          onClose={() => setUploading(null)}
          onSave={async ({ file, issuedOn, expiresOn }) => {
            const ok = uploading.datesOnly && uploading.item.stored
              ? await api.setDates(uploading.item.stored, { issuedOn, expiresOn })
              : file ? await api.upload({ clientCode: client.code, docType: uploading.item.doc.key, file, issuedOn, expiresOn }) : false;
            if (ok) setUploading(null);
          }}
        />
      )}
      {requesting && (
        <SendDocumentDialog
          title="Demander les pièces"
          recipientName={client.name}
          email={contactValue(client.email)}
          phone={contactValue(client.phone)}
          subject={`Documents pour votre dossier client – ${orgName}`}
          message={kybRequestMessage(client.name, orgName, items)}
          onSent={() => {}}
          onClose={() => setRequesting(false)}
        />
      )}
    </section>
  );
}

function KybRow({ item, can, onOpen, onUpload, onDates, onStatus, onRemove }: {
  item: KybItem;
  can: KybPermissions;
  onOpen: () => void;
  onUpload: () => void;
  onDates: () => void;
  onStatus: (s: ClientDocument['status']) => void;
  onRemove: () => void;
}) {
  const s = item.stored;
  const detail: string[] = [];
  if (s) {
    if (item.validUntil) detail.push(`${item.state === 'expired' ? 'expiré le' : 'valable jusqu’au'} ${fmtDate(item.validUntil)}`);
    if (s.status === 'verified' && s.verifiedByName) detail.push(`vérifié par ${s.verifiedByName}`);
    else if (s.status === 'rejected' && s.verifiedByName) detail.push(`refusé par ${s.verifiedByName}`);
    else if (s.uploadedByName) detail.push(`ajouté par ${s.uploadedByName}`);
  }

  // The one action most likely next, as a button; the rest in « ⋯ »
  const mainKind: 'upload' | 'verify' | 'view' | null =
    !s || item.state === 'rejected' || item.state === 'expired' ? (can.write ? 'upload' : s ? 'view' : null)
      : item.state === 'to-check' && can.check ? 'verify'
        : 'view';
  const main: ReactNode =
    mainKind === 'upload' ? <button type="button" className="btn btn-sm" onClick={onUpload}>{s ? 'Remplacer' : 'Ajouter'}</button>
      : mainKind === 'verify' ? <button type="button" className="btn btn-sm btn-primary" onClick={() => onStatus('verified')}>Vérifier</button>
        : mainKind === 'view' ? <button type="button" className="btn btn-sm" onClick={onOpen}>Voir</button>
          : null;
  const more: { label: string; danger?: boolean; run: () => void }[] = !s ? [] : [
    ...(mainKind !== 'view' ? [{ label: 'Voir le fichier', run: onOpen }] : []),
    ...(can.check && item.state === 'to-check' ? [{ label: 'Refuser', run: () => onStatus('rejected') }] : []),
    ...(can.check && s.status !== 'pending' ? [{ label: 'Remettre à vérifier', run: () => onStatus('pending') }] : []),
    ...(can.write && mainKind !== 'upload' ? [{ label: 'Remplacer le fichier', run: onUpload }] : []),
    ...(can.write ? [{ label: 'Modifier les dates', run: onDates }] : []),
    ...(can.remove ? [{ label: 'Supprimer', danger: true, run: onRemove }] : []),
  ];

  return (
    <li className="kyb-row">
      <Icon name="file-text" size={15} ariaHidden />
      <div className="kyb-text">
        <span className="kyb-label">{item.doc.label}</span>
        {detail.length > 0 && <small>{detail.join(' · ')}</small>}
        {!s && item.doc.validityMonths && <small>valable {item.doc.validityMonths} mois</small>}
      </div>
      <StatusPill label={kybStateLabel(item)} tone={TONE[item.state]} />
      <div className="kyb-actions">
        {main}
        {more.length > 0 && <RowMore label={`Autres actions pour ${item.doc.label}`} items={more} />}
      </div>
    </li>
  );
}

function RowMore({ label, items }: { label: string; items: { label: string; danger?: boolean; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const i = list.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length]?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('focusin', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('focusin', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="dt-menu-root" ref={rootRef}>
      <button ref={btnRef} type="button" className="dt-more-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(o => !o)}>
        <Icon name="dots" size={16} ariaHidden />
      </button>
      {open && (
        <div className="dt-menu" role="menu" aria-label={label}>
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" className={`dt-mi${it.danger ? ' danger' : ''}`} onClick={() => { setOpen(false); it.run(); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Add or replace a document's file (with its dates), or fix its dates. */
function KybUploadDialog({ item, datesOnly, onSave, onClose }: {
  item: KybItem;
  datesOnly?: boolean;
  onSave: (v: { file?: File; issuedOn?: string; expiresOn?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [issuedOn, setIssuedOn] = useState(datesOnly ? item.stored?.issuedOn ?? '' : '');
  const [expiresOn, setExpiresOn] = useState(datesOnly ? item.stored?.expiresOn ?? '' : '');
  const [busy, setBusy] = useState(false);
  const months = item.doc.validityMonths;
  const computed = !expiresOn && months && issuedOn ? addMonths(issuedOn, months) : null;
  const datesWrong = !!issuedOn && !!expiresOn && expiresOn < issuedOn;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input')?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, busy]);

  const canSave = !busy && !datesWrong && (datesOnly || (!!file && !fileError));

  return (
    <div className="inv-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div ref={dialogRef} className="inv-modal owner-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}>
        <div className="inv-modal-head">
          <div className="inv-modal-title" id={titleId}>{datesOnly ? 'Dates : ' : item.stored ? 'Remplacer : ' : 'Ajouter : '}{item.doc.label}</div>
          <button type="button" className="btn btn-icon" onClick={onClose} disabled={busy} aria-label="Fermer"><Icon name="x" size={16} ariaHidden /></button>
        </div>
        <form className="inv-modal-body kyb-form" onSubmit={async e => {
          e.preventDefault();
          if (!canSave) return;
          setBusy(true);
          await onSave({ file: file ?? undefined, issuedOn: issuedOn || undefined, expiresOn: expiresOn || computed || undefined });
          setBusy(false);
        }}>
          {!datesOnly && (
            <div className="form-group">
              <label className="form-label" htmlFor={`${titleId}-file`}>Fichier (PDF, JPG ou PNG, 10 Mo max.)</label>
              <input id={`${titleId}-file`} type="file" accept={KYB_ACCEPT} className="form-input" disabled={busy} onChange={e => {
                const f = e.target.files?.[0] ?? null;
                setFile(f); setFileError(f ? kybFileError(f) : null);
              }} />
              {fileError && <p className="form-error" role="alert">{fileError}</p>}
              {item.stored && <p className="form-hint">Le nouveau fichier remplace l’actuel et devra être vérifié.</p>}
            </div>
          )}
          <div className="kyb-dates">
            <div className="form-group">
              <label className="form-label" htmlFor={`${titleId}-issued`}>Date de délivrance</label>
              <input id={`${titleId}-issued`} type="date" className="form-input" value={issuedOn} max={todayISO()} disabled={busy} onChange={e => setIssuedOn(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor={`${titleId}-expires`}>Date d’expiration</label>
              <input id={`${titleId}-expires`} type="date" className="form-input" value={expiresOn} min={issuedOn || undefined} disabled={busy} onChange={e => setExpiresOn(e.target.value)} />
            </div>
          </div>
          {datesWrong && <p className="form-error" role="alert">L’expiration doit suivre la délivrance.</p>}
          {months && <p className="form-hint">Valable {months} mois après sa délivrance{computed ? ` : jusqu’au ${fmtDate(computed)}` : ''}, sauf date d’expiration indiquée.</p>}
          <div className="inv-modal-foot kyb-foot">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={!canSave}>{busy ? 'Envoi…' : datesOnly ? 'Enregistrer' : 'Ajouter le document'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
