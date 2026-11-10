import { useState, useMemo, useEffect, useRef } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import KPIStrip from '@/components/accounting/KPIStrip';
import DrawerPanel from '@/components/accounting/DrawerPanel';
import JournalBadge from '@/components/accounting/JournalBadge';
import { EmptyState } from '@/components/EmptyState';
import StatusPill from '@/components/accounting/StatusPill';
import type { JournalEntry, Journal, Account } from '@/lib/accounting-data';
import { fmt, fmtCompact, acctOf } from '@/lib/accounting-data';
import { useJournalsData } from '@/lib/accounting-hooks';
import { JournalsEmptyIllustration } from '@/components/accounting/EmptyIllustrations';
import { exerciseYear } from '@/lib/period';

function entryTotal(e: JournalEntry) {
  return e.lines.reduce((s, l) => s + l.d, 0);
}

function isBalanced(e: JournalEntry) {
  const d = e.lines.reduce((s, l) => s + l.d, 0);
  const c = e.lines.reduce((s, l) => s + l.c, 0);
  return Math.abs(d - c) < 0.01;
}

function entryStatus(e: JournalEntry): string {
  if (!isBalanced(e)) return 'unbalanced';
  return e.posted ? 'posted' : 'draft';
}

interface ComposerLine { acct: string; debit: string; credit: string }
const EMPTY_LINE: ComposerLine = { acct: '', debit: '', credit: '' };

function EntryDrawer({
  entry, journals, onClose, onPost,
}: { entry: JournalEntry; journals: Record<string, Journal>; onClose: () => void; onPost: (id: string) => Promise<void> }) {
  const j = journals[entry.journal];
  const total = entryTotal(entry);
  const balanced = isBalanced(entry);
  const { postable } = usePermissions();
  return (
    <DrawerPanel open onClose={onClose} title={entry.label} subtitle={`${entry.id} · ${entry.date}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        {j && <JournalBadge journal={j} />}
        <StatusPill status={entryStatus(entry)} />
        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{entry.piece}</span>
      </div>

      <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 110px 110px', gap: 8, padding: '8px 14px', background: 'var(--color-background-secondary)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-secondary)' }}>
          <span>Compte</span><span>Libellé</span><span style={{ textAlign: 'right' }}>Débit</span><span style={{ textAlign: 'right' }}>Crédit</span>
        </div>
        {entry.lines.map((l, i) => {
          const a = acctOf(l.acct);
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 110px 110px', gap: 8, padding: '10px 14px', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: 12.5, alignItems: 'center' }}>
              <span className="mono" style={{ fontWeight: 700, color: 'var(--brand)' }}>{l.acct}</span>
              <span style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a?.label ?? '—'}</span>
              <span className="mono" style={{ textAlign: 'right', fontWeight: l.d > 0 ? 600 : 400, color: l.d > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{l.d > 0 ? fmt(l.d) : '—'}</span>
              <span className="mono" style={{ textAlign: 'right', fontWeight: l.c > 0 ? 600 : 400, color: l.c > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{l.c > 0 ? fmt(l.c) : '—'}</span>
            </div>
          );
        })}
      </div>

      <div className={`balance-banner ${balanced ? 'ok' : 'err'}`}>
        <Icon name={balanced ? 'circle-check' : 'alert-triangle'} size={16} />
        {balanced ? `Écriture équilibrée · ${fmt(total)} F CFA` : 'Écriture déséquilibrée'}
      </div>

      {postable && !entry.posted && (
        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
          onClick={() => onPost(entry.id).then(onClose)}
        >
          <Icon name="check" />Comptabiliser
        </button>
      )}
    </DrawerPanel>
  );
}

interface ComposerState { journal: string; date: string; label: string; piece: string; lines: ComposerLine[] }

function Composer({
  journals, accounts, onClose, onSave,
}: {
  journals: Record<string, Journal>;
  accounts: Account[];
  onClose: () => void;
  onSave: (p: { journalCode: string; date: string; piece: string; label: string; lines: Array<{ accountNum: string; debit: number; credit: number }> }) => Promise<void>;
}) {
  const [state, setState] = useState<ComposerState>({
    journal: Object.keys(journals)[0] ?? 'VE',
    date: new Date().toISOString().slice(0, 10),
    label: '', piece: '', lines: [EMPTY_LINE, EMPTY_LINE],
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // A save that finishes after this composer was closed must not close a newer one
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // An old error no longer applies once the entry is edited
  useEffect(() => { setSaveError(null); }, [state]);

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      await onSave({
        journalCode: state.journal,
        date: state.date,
        piece: state.piece.trim(),
        label: state.label.trim(),
        lines: state.lines
          .filter(l => l.acct && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
          .map(l => ({ accountNum: l.acct, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 })),
      });
      if (mounted.current) onClose();
    } catch (err) {
      console.error('[saveEntry]', err);
      if (!mounted.current) return;
      const msg = err instanceof Error ? err.message : '';
      setSaveError(/is closed/.test(msg)
        ? 'Cette période est clôturée : choisissez une date dans une période ouverte.'
        : 'L\'écriture n\'a pas pu être enregistrée. Vérifiez votre connexion et réessayez.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const debitTotal  = state.lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const creditTotal = state.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(debitTotal - creditTotal) < 0.01 && debitTotal > 0;
  // A line with an amount but no account would be dropped on save and unbalance the entry
  const amountWithoutAccount = state.lines.some(l => !l.acct && ((parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0));

  const setLine = (i: number, field: keyof ComposerLine, value: string) =>
    setState(p => ({ ...p, lines: p.lines.map((l, j) => j === i ? { ...l, [field]: value } : l) }));
  const addLine    = () => setState(p => ({ ...p, lines: [...p.lines, EMPTY_LINE] }));
  const removeLine = (i: number) => setState(p => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }));

  const acctLabel = (num: string) => {
    const found = accounts.find(a => a.num === num);
    return found?.label ?? acctOf(num)?.label ?? null;
  };

  const balanceStatus = debitTotal === 0 ? 'idle' : balanced ? 'ok' : 'err';

  return (
    <>
      <div className="acc-scrim open" onClick={onClose} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: 540, maxWidth: '96%', height: '100%', background: 'var(--color-background-primary)', boxShadow: 'var(--shadow-drawer)', zIndex: 31, display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div style={{ padding: '20px 24px 18px', borderBottom: '0.5px solid var(--color-border-tertiary)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--brand)', background: 'var(--brand-tint)', padding: '3px 8px', borderRadius: 6, marginBottom: 8 }}>
              <Icon name="plus" size={11} />Nouvelle écriture
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.2 }}>Saisie manuelle</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 3 }}>Double-entrée · SYSCOHADA</div>
          </div>
          <button className="acc-drawer-close" onClick={onClose} style={{ marginTop: 2 }}><Icon name="x" size={16} /></button>
        </div>

        <fieldset disabled={saving} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', border: 0, margin: 0, minWidth: 0 }}>

          {/* ── Row 1: Journal + Libellé ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="form-label">Journal</label>
              <select className="form-input" value={state.journal} onChange={e => setState(p => ({ ...p, journal: e.target.value }))}>
                {Object.values(journals).map(j => <option key={j.code} value={j.code}>{j.code} — {j.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Libellé</label>
              <input className="form-input" value={state.label} onChange={e => setState(p => ({ ...p, label: e.target.value }))} placeholder="ex. Facture client — Orange" />
            </div>
          </div>

          {/* ── Row 2: Date + Pièce ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22 }}>
            <div>
              <label className="form-label">Date</label>
              <input className="form-input" type="date" value={state.date} onChange={e => setState(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Référence pièce</label>
              <input className="form-input" value={state.piece} onChange={e => setState(p => ({ ...p, piece: e.target.value }))} placeholder="ex. FACT-001" />
            </div>
          </div>

          {/* ── Lines section ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Lignes</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 32px', gap: 6, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', width: '100%', paddingLeft: 12 }}>
              <span>Compte</span>
              <span style={{ textAlign: 'right' }}>Débit</span>
              <span style={{ textAlign: 'right' }}>Crédit</span>
              <span />
            </div>
          </div>

          <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', marginBottom: 10 }}>
            {state.lines.map((line, i) => {
              const label = acctLabel(line.acct);
              return (
                <div
                  key={i}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 32px', gap: 0, borderTop: i > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none', alignItems: 'stretch' }}
                >
                  {/* Account cell */}
                  <div style={{ borderRight: '0.5px solid var(--color-border-tertiary)', padding: '6px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
                    <select
                      className="form-input"
                      style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', border: 'none', background: 'transparent', padding: '0', height: 'auto', color: line.acct ? 'var(--brand)' : 'var(--color-text-tertiary)' }}
                      value={line.acct}
                      onChange={e => setLine(i, 'acct', e.target.value)}
                    >
                      <option value="">Compte…</option>
                      {accounts.map(a => (
                        <option key={a.num} value={a.num}>{a.num} — {a.label}</option>
                      ))}
                    </select>
                    {label && (
                      <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                    )}
                  </div>

                  {/* Debit */}
                  <div style={{ borderRight: '0.5px solid var(--color-border-tertiary)' }}>
                    <input
                      className="form-input"
                      type="number" min="0"
                      style={{ border: 'none', borderRadius: 0, textAlign: 'right', fontSize: 12.5, fontWeight: 600, height: '100%', background: 'transparent' }}
                      value={line.debit}
                      onChange={e => setLine(i, 'debit', e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  {/* Credit */}
                  <div style={{ borderRight: '0.5px solid var(--color-border-tertiary)' }}>
                    <input
                      className="form-input"
                      type="number" min="0"
                      style={{ border: 'none', borderRadius: 0, textAlign: 'right', fontSize: 12.5, fontWeight: 600, height: '100%', background: 'transparent' }}
                      value={line.credit}
                      onChange={e => setLine(i, 'credit', e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => removeLine(i)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = '#A32D2D'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            onClick={addLine}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--brand)', cursor: 'pointer', padding: '6px 2px', background: 'none', border: 'none', fontFamily: 'inherit' }}
          >
            <Icon name="plus" size={14} />Ajouter une ligne
          </button>

          {/* ── Balance banner ── */}
          <div
            style={{
              marginTop: 16,
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '11px 14px', borderRadius: 'var(--border-radius-md)', fontSize: 12.5, fontWeight: 600,
              ...(balanceStatus === 'ok'
                ? { background: '#E7F3E2', color: '#276C2B', border: '0.5px solid #A5D6A7' }
                : balanceStatus === 'err'
                ? { background: '#FEF2F2', color: '#A32D2D', border: '0.5px solid #FCCDD4' }
                : { background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-tertiary)' }),
            }}
          >
            <Icon name={balanceStatus === 'ok' ? 'circle-check' : balanceStatus === 'err' ? 'alert-triangle' : 'calculator'} size={16} />
            <span className="mono">Débit {fmt(debitTotal)}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span className="mono">Crédit {fmt(creditTotal)}</span>
            {balanced && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700 }}>Équilibré ✓</span>}
          </div>
          {amountWithoutAccount && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#A32D2D' }}>Choisissez un compte pour chaque ligne qui a un montant.</div>
          )}
        </fieldset>

        {saveError && (
          <div role="alert" style={{ margin: '0 24px 12px', padding: '10px 12px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icon name="alert-triangle" size={15} />{saveError}
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ padding: '14px 24px', borderTop: '0.5px solid var(--color-border-tertiary)', display: 'flex', gap: 10 }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            style={{ flex: 2, justifyContent: 'center' }}
            disabled={!balanced || amountWithoutAccount || !state.label.trim() || saving}
            onClick={save}
          >
            <Icon name="check" size={15} />{saving ? 'Enregistrement…' : 'Enregistrer l\'écriture'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function JournalsPage() {
  const { writable } = usePermissions();
  const { data, loading, postEntry, saveEntry } = useJournalsData(true);
  const [activeJournal, setActiveJournal] = useState('all');
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const [showComposer, setShowComposer] = useState(false);

  const entries  = data?.entries  ?? [];
  const journals = data?.journals ?? {};

  const filtered = useMemo(() =>
    entries.filter(e => activeJournal === 'all' || e.journal === activeJournal),
    [entries, activeJournal]);

  const postedCount = entries.filter(e => e.posted).length;
  const draftCount  = entries.filter(e => !e.posted).length;
  const totalMvt    = entries.filter(e => e.posted).reduce((s, e) => s + entryTotal(e), 0);
  const allBalanced = entries.length > 0 && entries.every(isBalanced);

  const jCounts: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    entries.forEach(e => { m[e.journal] = (m[e.journal] || 0) + 1; });
    return m;
  }, [entries]);

  if (loading) return <PageSkeleton title="Journaux comptables" variant="accounting" rows={6} />;

  return (
    <div className="main" style={{ position: 'relative' }}>
      <div className="topbar">
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', letterSpacing: 0.3, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <Icon name="notebook" size={13} /> Accounting
          </div>
          <div className="page-title">Journaux comptables</div>
          <div className="page-sub">Saisie et consultation des écritures</div>
        </div>
        <div className="topbar-actions">
          <span className="period-pill"><span className="dot" />Exercice {exerciseYear()} · ouvert</span>
          <button className="btn"><Icon name="download" />Exporter</button>
          {writable && <button className="btn btn-primary" onClick={() => setShowComposer(true)}><Icon name="plus" />Nouvelle écriture</button>}
        </div>
      </div>

      <div className="content">
        <KPIStrip items={[
          { icon: 'notebook', iconBg: 'var(--brand-tint)', iconColor: 'var(--brand)', label: 'Écritures', value: entries.length, sub: `${postedCount} comptabilisées` },
          { icon: 'trending-up', iconBg: '#E7F3E2', iconColor: '#276C2B', label: 'Mouvement total', value: fmtCompact(totalMvt), unit: 'F CFA', sub: 'Débit total comptabilisé' },
          { icon: 'edit', iconBg: '#FAEEDA', iconColor: '#8A5207', label: 'Brouillons', value: draftCount, sub: 'En attente de comptabilisation' },
          { icon: allBalanced ? 'circle-check' : 'alert-triangle', iconBg: allBalanced ? '#E7F3E2' : '#FCEBEB', iconColor: allBalanced ? '#276C2B' : '#A32D2D', label: 'Contrôle', value: allBalanced ? 'OK' : 'Erreur', sub: 'Équilibre des écritures' },
        ]} />

        <div className="acc-toolbar">
          <div className="chips">
            <button className={`chip-f${activeJournal === 'all' ? ' active' : ''}`} onClick={() => setActiveJournal('all')}>
              Tous <span className="cnt">{entries.length}</span>
            </button>
            {Object.values(journals).map(j => jCounts[j.code] ? (
              <button key={j.code} className={`chip-f${activeJournal === j.code ? ' active' : ''}`} onClick={() => setActiveJournal(j.code)}>
                <JournalBadge journal={j} /> {j.name} <span className="cnt">{jCounts[j.code]}</span>
              </button>
            ) : null)}
          </div>
        </div>

        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 70px 1fr 130px 110px 36px', gap: 14, padding: '10px 18px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            {['Date', 'Journal', 'Libellé', 'Montant', 'Statut', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>

          {filtered.length === 0
            ? <EmptyState
                illustration={<JournalsEmptyIllustration />}
                title="Aucune écriture trouvée"
                description="Aucune écriture ne correspond au journal ou filtre sélectionné."
              />
            : filtered.map((e, i) => {
              const j = journals[e.journal];
              const total = entryTotal(e);
              const status = entryStatus(e);
              return (
                <div
                  key={e.id}
                  onClick={() => setSelected(e)}
                  style={{ display: 'grid', gridTemplateColumns: '90px 70px 1fr 130px 110px 36px', gap: 14, padding: '12px 18px', borderTop: i > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none', cursor: 'pointer', alignItems: 'center', transition: 'background .1s' }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--color-background-secondary)')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = '')}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{e.date.slice(5)}<div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>{e.date.slice(0, 4)}</div></div>
                  {j ? <JournalBadge journal={j} /> : <span>{e.journal}</span>}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1 }}>{e.piece}</div>
                  </div>
                  <div className="mono" style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{fmt(total)}</div>
                  <div style={{ textAlign: 'right' }}><StatusPill status={status} /></div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--color-text-tertiary)' }}><Icon name="chevron-right" size={16} /></div>
                </div>
              );
            })}
        </div>
      </div>

      {selected  && <EntryDrawer entry={selected} journals={journals} onClose={() => setSelected(null)} onPost={postEntry} />}
      {showComposer && <Composer journals={journals} accounts={data?.accounts ?? []} onClose={() => setShowComposer(false)} onSave={saveEntry} />}
    </div>
  );
}
