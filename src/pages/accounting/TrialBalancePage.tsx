import { useState, useMemo, useEffect } from 'react';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import KPIStrip from '@/components/accounting/KPIStrip';
import DrawerPanel from '@/components/accounting/DrawerPanel';
import JournalBadge from '@/components/accounting/JournalBadge';
import { EmptyState } from '@/components/EmptyState';
import { AccountMovementsEmptyIllustration } from '@/components/accounting/EmptyIllustrations';
import type { Account, AccountClass, Journal, LedgerRow } from '@/lib/accounting-data';
import { fmt, fmtCompact, clsOf, openingOf } from '@/lib/accounting-data';
import { useTrialBalance, useBalanceFns } from '@/lib/accounting-hooks';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { exerciseYear, monthLabel } from '@/lib/period';
import Page from '@/components/Page';

function LedgerDrawer({
  account, classes, journals, onClose,
}: { account: Account; classes: Record<number, AccountClass>; journals: Record<string, Journal>; onClose: () => void }) {
  const { orgId } = useApp();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const opening = openingOf(account.num);

  useEffect(() => {
    if (!orgId) return;
    setLoadingLedger(true);
    supabase
      .from('journal_entries')
      .select('id, date, piece, label, posted, journals!inner(code), entry_lines!inner(account_num, debit, credit)')
      .eq('org_id', orgId)
      .eq('entry_lines.account_num', account.num)
      .eq('posted', true)
      .order('date', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        let running = openingOf(account.num);
        const rows: LedgerRow[] = [];
        for (const e of data as Array<Record<string, unknown>>) {
          const j = e.journals as Record<string, unknown>;
          const lines = (e.entry_lines as Array<Record<string, unknown>>) ?? [];
          for (const l of lines) {
            const d = Number(l.debit), c = Number(l.credit);
            running += d - c;
            rows.push({ entry: { id: String(e.id), date: String(e.date), piece: String(e.piece), label: String(e.label), journal: String(j?.code ?? ''), lines: [], posted: Boolean(e.posted) }, d, c, running });
          }
        }
        setLedger(rows);
      })
      .then(() => setLoadingLedger(false), () => setLoadingLedger(false));
  }, [orgId, account.num]);
  const cls = clsOf(account.num);
  const clsInfo = classes[cls];

  return (
    <DrawerPanel
      open
      onClose={onClose}
      title={
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', letterSpacing: 0.4 }}>{account.num}</div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.4, marginTop: 3 }}>{account.label}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="cls-tag" style={{ background: clsInfo?.color, width: 18, height: 18, fontSize: 10 }}>{cls}</span>
            {clsInfo?.short} · {account.nature === 'D' ? 'Débit' : 'Crédit'}
          </div>
        </div>
      }
    >
      {opening !== 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--color-border-tertiary)', marginBottom: 4 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)' }}>À-nouveau (01/06/2026)</div>
          <div className="mono" style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(opening)}</div>
        </div>
      )}

      {loadingLedger ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '13px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="skel" style={{ width: '65%', height: 12, borderRadius: 5 }} />
                <div className="skel" style={{ width: '40%', height: 10, borderRadius: 5 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <div className="skel" style={{ width: 72, height: 12, borderRadius: 5 }} />
                <div className="skel" style={{ width: 52, height: 10, borderRadius: 5 }} />
              </div>
            </div>
          ))}
        </div>
      ) : ledger.length === 0 ? (
        <EmptyState
          illustration={<AccountMovementsEmptyIllustration />}
          title="Aucun mouvement"
          description="Ce compte n'a pas encore de mouvements enregistrés."
        />
      ) : (
        <div>
          {ledger.map((row, i) => {
            const j = journals[row.entry.journal];
            const amt = row.d > 0 ? row.d : -row.c;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '11px 0', borderBottom: i < ledger.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.entry.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {j && <JournalBadge journal={j} />}
                    <span>{row.entry.piece}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                    <span>{row.entry.date}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: amt >= 0 ? 'var(--color-text-primary)' : '#A32D2D' }}>
                    {amt >= 0 ? '+' : ''}{fmt(amt)}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', marginTop: 2 }}>Solde {fmt(row.running)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DrawerPanel>
  );
}

export default function TrialBalancePage() {
  const { data, loading } = useTrialBalance();
  const [selected, setSelected] = useState<Account | null>(null);
  const [showDraft, setShowDraft] = useState(false);

  const accounts = data?.accounts ?? [];
  const classes  = data?.classes  ?? {};
  const journals = data?.journals ?? {};

  const { mvtOf, signedOf, openingOf: openOf } = useBalanceFns(data, showDraft);

  const activeAccounts = useMemo(() =>
    accounts.filter(a => {
      const m = mvtOf(a.num);
      return openOf(a.num) !== 0 || m.debit > 0 || m.credit > 0;
    }),
    [data, showDraft]);

  const byClass = useMemo(() => {
    const map: Record<string, Account[]> = {};
    activeAccounts.forEach(a => {
      const k = String(clsOf(a.num));
      if (!map[k]) map[k] = [];
      map[k].push(a);
    });
    return map;
  }, [activeAccounts]);

  const totalDebitMvt = activeAccounts.reduce((s, a) => s + mvtOf(a.num).debit, 0);
  const totalCreditMvt = activeAccounts.reduce((s, a) => s + mvtOf(a.num).credit, 0);
  const totalDebitClose = activeAccounts.reduce((s, a) => { const v = signedOf(a.num); return v > 0 ? s + v : s; }, 0);
  const totalCreditClose = activeAccounts.reduce((s, a) => { const v = signedOf(a.num); return v < 0 ? s - v : s; }, 0);
  const isTied = Math.abs(totalDebitClose - totalCreditClose) < 1;

  const result = totalCreditClose - totalDebitClose;

  if (loading) return <PageSkeleton section={{ icon: 'book-2', label: 'Comptabilité' }} title="Balance générale" variant="accounting" rows={8} />;

  return (
    <Page
      section={{ icon: 'book-2', label: 'Comptabilité' }}
      title="Balance générale"
      subtitle={<>Plan comptable SYSCOHADA · {monthLabel()}</>}
      actions={<>
        <span className="period-pill"><span className="dot" />Exercice {exerciseYear()} · ouvert</span>
        <button
          className={`btn${showDraft ? ' btn-primary' : ''}`}
          onClick={() => setShowDraft(p => !p)}
        >
          <Icon name="edit" />Inclure brouillons
        </button>
        <button className="btn"><Icon name="download" />Exporter</button>
      </>}
      mainStyle={{ position: 'relative' }}
      after={<>

        {selected && <LedgerDrawer account={selected} classes={classes} journals={journals} onClose={() => setSelected(null)} />}
      </>}
    >
        <KPIStrip items={[
          { icon: 'trending-up', iconBg: 'var(--brand-tint)', iconColor: 'var(--brand)', label: 'Mouvement total', value: fmtCompact(totalDebitMvt), unit: 'F CFA', sub: 'Débit = Crédit' },
          { icon: 'book-2', iconBg: '#E9F0FA', iconColor: 'var(--brand)', label: 'Comptes actifs', value: activeAccounts.length, sub: `${Object.keys(byClass).length} classes` },
          { icon: 'chart-bar', iconBg: result >= 0 ? '#E7F3E2' : '#FCEBEB', iconColor: result >= 0 ? '#276C2B' : '#A32D2D', label: 'Résultat', value: fmtCompact(Math.abs(result)), unit: 'F CFA', sub: result >= 0 ? 'Bénéfice net' : 'Perte nette' },
          { icon: isTied ? 'circle-check' : 'alert-triangle', iconBg: isTied ? '#E7F3E2' : '#FCEBEB', iconColor: isTied ? '#276C2B' : '#A32D2D', label: 'Équilibre', value: isTied ? 'Vérifié' : 'Erreur', sub: isTied ? 'Actif = Passif' : 'Déséquilibre détecté' },
        ]} />

        {isTied && (
          <div className="tie-banner">
            <Icon name="circle-check" size={16} />
            Balance équilibrée · Total actif {fmt(totalDebitClose)} F CFA = Total passif {fmt(totalCreditClose)} F CFA
          </div>
        )}

        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          {/* Sticky header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 200px 200px 36px', gap: 10, padding: '10px 18px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-secondary)' }}>
              <span>Compte</span>
              <span>Libellé</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, textAlign: 'center' }}>
                <span>Mvt Débit</span><span>Mvt Crédit</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, textAlign: 'center' }}>
                <span>Solde Débit</span><span>Solde Crédit</span>
              </div>
              <span />
            </div>
          </div>

          {Object.keys(byClass).sort().map(k => {
            const cls = classes[Number(k)];
            const acctRows = byClass[k];
            const clsDMvt = acctRows.reduce((s, a) => s + mvtOf(a.num).debit, 0);
            const clsCMvt = acctRows.reduce((s, a) => s + mvtOf(a.num).credit, 0);
            const clsDClose = acctRows.reduce((s, a) => { const v = signedOf(a.num); return v > 0 ? s + v : s; }, 0);
            const clsCClose = acctRows.reduce((s, a) => { const v = signedOf(a.num); return v < 0 ? s - v : s; }, 0);

            return (
              <div key={k}>
                {/* Class subtotal row */}
                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 200px 200px 36px', gap: 10, padding: '10px 18px', background: 'var(--color-background-tertiary)', borderTop: '0.5px solid var(--color-border-tertiary)', alignItems: 'center' }}>
                  <span className="cls-tag" style={{ background: cls?.color }}>{k}</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{cls?.name}</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'right' }}>{fmt(clsDMvt)}</span>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'right' }}>{fmt(clsCMvt)}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, textAlign: 'right' }}>{clsDClose > 0 ? fmt(clsDClose) : '—'}</span>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, textAlign: 'right' }}>{clsCClose > 0 ? fmt(clsCClose) : '—'}</span>
                  </div>
                  <span />
                </div>

                {acctRows.map((a) => {
                  const m = mvtOf(a.num);
                  const signed = signedOf(a.num);
                  return (
                    <div
                      key={a.num}
                      onClick={() => setSelected(a)}
                      style={{ display: 'grid', gridTemplateColumns: '90px 1fr 200px 200px 36px', gap: 10, padding: '10px 18px 10px 36px', borderTop: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer', alignItems: 'center', transition: 'background .1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background-secondary)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{a.num}</span>
                      <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        <span className="mono" style={{ fontSize: 12, textAlign: 'right', color: m.debit > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{m.debit > 0 ? fmt(m.debit) : '—'}</span>
                        <span className="mono" style={{ fontSize: 12, textAlign: 'right', color: m.credit > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{m.credit > 0 ? fmt(m.credit) : '—'}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, textAlign: 'right', color: signed > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{signed > 0 ? fmt(signed) : '—'}</span>
                        <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, textAlign: 'right', color: signed < 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{signed < 0 ? fmt(-signed) : '—'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--color-text-tertiary)' }}><Icon name="chevron-right" size={16} /></div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Grand total */}
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 200px 200px 36px', gap: 10, padding: '12px 18px', background: 'var(--color-background-secondary)', borderTop: '1px solid var(--color-border-secondary)', alignItems: 'center' }}>
            <span />
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Total général</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 800, textAlign: 'right' }}>{fmt(totalDebitMvt)}</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 800, textAlign: 'right' }}>{fmt(totalCreditMvt)}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 800, textAlign: 'right' }}>{fmt(totalDebitClose)}</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 800, textAlign: 'right' }}>{fmt(totalCreditClose)}</span>
            </div>
            <span />
          </div>
        </div>
    </Page>
  );
}
