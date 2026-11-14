import { useState, useMemo, useEffect } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import KPIStrip from '@/components/accounting/KPIStrip';
import DrawerPanel from '@/components/accounting/DrawerPanel';
import type { Account, AccountClass, Journal, LedgerRow } from '@/lib/accounting-data';
import { fmt, fmtCompact, clsOf, openingOf } from '@/lib/accounting-data';
import { useChartOfAccounts, useBalanceFns } from '@/lib/accounting-hooks';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { EmptyState } from '@/components/EmptyState';
import { ChartOfAccountsEmptyIllustration } from '@/components/accounting/EmptyIllustrations';
import { exerciseYear } from '@/lib/period';
import Page from '@/components/Page';

function SideTag({ signed }: { signed: number }) {
  if (Math.abs(signed) < 0.5) return null;
  const isDebit = signed > 0;
  return (
    <span className="side" style={{
      fontSize: 10, fontWeight: 800, marginLeft: 4, padding: '1px 5px',
      borderRadius: 5, background: isDebit ? '#E9F0FA' : '#F1ECFB',
      color: isDebit ? 'var(--brand)' : '#5B45C7',
    }}>{isDebit ? 'D' : 'C'}</span>
  );
}

function AccountDrawer({ account, classes, journals, onClose, mvtOf, signedOf }: {
  account: Account;
  classes: Record<number, AccountClass>;
  journals: Record<string, Journal>;
  onClose: () => void;
  mvtOf: (num: string) => { debit: number; credit: number };
  signedOf: (num: string) => number;
}) {
  const { orgId } = useApp();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(true);

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

  const mvt = mvtOf(account.num);
  const opening = openingOf(account.num);
  const closing = signedOf(account.num);
  const cls = clsOf(account.num);
  const clsInfo = classes[cls];

  return (
    <DrawerPanel
      open
      onClose={onClose}
      title={
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', letterSpacing: 0.4 }}>{account.num}</div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.4, marginTop: 4, lineHeight: 1.2 }}>{account.label}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 7, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="cls-tag" style={{ background: clsInfo?.color, width: 18, height: 18, fontSize: 10 }}>{cls}</span>
            {clsInfo?.name} · {account.nature === 'D' ? 'Débit' : 'Crédit'}
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
        <div style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Solde ouverture</div>
          <div className="mono" style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.4, marginTop: 5 }}>{fmt(opening)}</div>
        </div>
        <div style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Mouvements</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 5 }}>
            <span style={{ color: 'var(--color-text-primary)' }}>D {fmt(mvt.debit)}</span>
            <span style={{ color: 'var(--color-text-tertiary)', margin: '0 5px' }}>/</span>
            <span>C {fmt(mvt.credit)}</span>
          </div>
        </div>
        <div style={{ gridColumn: '1/-1', background: 'var(--brand-tint)', borderRadius: 'var(--border-radius-md)', padding: '12px 14px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--brand-dark)' }}>Solde clôture</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4, marginTop: 5, color: 'var(--brand-dark)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {fmt(Math.abs(closing))}
            <SideTag signed={closing} />
          </div>
        </div>
      </div>

      <div className="dsec-label">
        <Icon name="list" size={13} />
        Mouvements ({loadingLedger ? '…' : ledger.length})
      </div>

      {loadingLedger ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '13px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
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
          illustration={<ChartOfAccountsEmptyIllustration />}
          title="Aucun mouvement trouvé"
          description="Ce compte n'a pas encore de mouvements comptabilisés."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {[...ledger].reverse().map((row, i) => {
            const jInfo = journals[row.entry.journal];
            const amount = row.d > 0 ? row.d : -row.c;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '11px 0', borderBottom: i < ledger.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.entry.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 7 }}>
                    {jInfo && <span className="jchip" style={{ background: jInfo.color }}>{jInfo.code}</span>}
                    {row.entry.piece} · {row.entry.date}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  <div className="mono" style={{ color: amount >= 0 ? 'var(--color-text-primary)' : '#A32D2D' }}>
                    {amount >= 0 ? '+' : ''}{fmt(amount)}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                    Solde {fmt(row.running)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DrawerPanel>
  );
}

function NewAccountModal({ classes, onSave, onClose }: { classes: Record<number, import('../../lib/accounting-data').AccountClass>; onSave: (a: Account) => Promise<void>; onClose: () => void }) {
  const [num, setNum] = useState('');
  const [label, setLabel] = useState('');
  const [nature, setNature] = useState<'D' | 'C'>('D');
  const [saving, setSaving] = useState(false);
  const valid = num.trim().length >= 3 && label.trim().length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try { await onSave({ num: num.trim(), label: label.trim(), nature }); onClose(); } finally { setSaving(false); }
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40 }} onClick={onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 420, background: 'var(--color-background-primary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-drawer)', zIndex: 41, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Nouveau compte</div>
          <button className="acc-drawer-close" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div>
              <label className="form-label">Numéro *</label>
              <input className="form-input" value={num} onChange={e => setNum(e.target.value)} placeholder="ex. 4118" />
            </div>
            <div>
              <label className="form-label">Nature</label>
              <select className="form-input" value={nature} onChange={e => setNature(e.target.value as 'D' | 'C')}>
                <option value="D">Débiteur (D)</option>
                <option value="C">Créditeur (C)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Libellé *</label>
            <input className="form-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="ex. Clients douteux" />
          </div>
          {num && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '8px 12px' }}>
              Classe {num[0]} · {classes[Number(num[0])]?.name ?? 'Inconnu'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!valid || saving} onClick={handleSave}>
            <Icon name="plus" size={15} />{saving ? 'Enregistrement…' : 'Créer le compte'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function ChartOfAccountsPage() {
  const { writable } = usePermissions();
  const { data, loading, addAccount } = useChartOfAccounts();
  const [activeClass, setActiveClass] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Account | null>(null);
  const [showNewAccount, setShowNewAccount] = useState(false);

  const accounts = data?.accounts ?? [];
  const classes  = data?.classes  ?? {};
  const journals = data?.journals ?? {};

  const { mvtOf, signedOf, openingOf: openOf } = useBalanceFns(data);

  const cash = signedOf('521') + signedOf('571');
  const recv = signedOf('411');
  const pay  = -signedOf('401');

  const usedClassCount = useMemo(() => {
    const s = new Set<number>();
    accounts.forEach(a => {
      const m = mvtOf(a.num);
      if (m.debit || m.credit || openOf(a.num)) s.add(clsOf(a.num));
    });
    return s.size;
  }, [data]);

  const filtered = useMemo(() => {
    return accounts.filter(a => {
      if (activeClass !== 'all' && String(clsOf(a.num)) !== activeClass) return false;
      if (query) {
        const q = query.toLowerCase();
        return a.num.startsWith(q) || a.label.toLowerCase().includes(q);
      }
      return true;
    });
  }, [accounts, activeClass, query]);

  const byClass = useMemo(() => {
    const map: Record<string, Account[]> = {};
    filtered.forEach(a => {
      const k = String(clsOf(a.num));
      if (!map[k]) map[k] = [];
      map[k].push(a);
    });
    return map;
  }, [filtered]);

  const classCounts = useMemo(() => {
    const counts: Record<string, number> = { all: accounts.length };
    accounts.forEach(a => {
      const k = String(clsOf(a.num));
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }, [accounts]);

  const toggleCollapse = (k: string) =>
    setCollapsed(prev => ({ ...prev, [k]: !prev[k] }));

  if (loading) return <PageSkeleton section={{ icon: 'book', label: 'Comptabilité' }} title="Plan comptable" variant="accounting" rows={8} />;

  return (
    <Page
      section={{ icon: 'book', label: 'Comptabilité' }}
      title="Plan comptable"
      subtitle="SYSCOHADA · Système Normal"
      actions={<>
        <span className="period-pill"><span className="dot" />Exercice {exerciseYear()} · ouvert</span>
        <button className="btn"><Icon name="download" />Importer</button>
        {writable && <button className="btn btn-primary" onClick={() => setShowNewAccount(true)}><Icon name="plus" />Nouveau compte</button>}
      </>}
      mainStyle={{ position: 'relative' }}
      after={<>

        {selected && <AccountDrawer account={selected} classes={classes} journals={journals} onClose={() => setSelected(null)} mvtOf={mvtOf} signedOf={signedOf} />}
        {showNewAccount && <NewAccountModal classes={classes} onSave={addAccount} onClose={() => setShowNewAccount(false)} />}
      </>}
    >
        <KPIStrip items={[
          { icon: 'book', iconBg: 'var(--brand-tint)', iconColor: 'var(--brand)', label: 'Comptes', value: accounts.length, sub: `${usedClassCount} classes utilisées` },
          { icon: 'building-bank', iconBg: '#E7F3E2', iconColor: '#276C2B', label: 'Trésorerie (5x)', value: fmtCompact(cash), unit: 'F CFA', sub: 'Banque + caisse' },
          { icon: 'receipt', iconBg: '#E9F0FA', iconColor: 'var(--brand)', label: 'Créances (411)', value: fmtCompact(recv), unit: 'F CFA', sub: 'Clients à encaisser' },
          { icon: 'truck-delivery', iconBg: '#FCEFE0', iconColor: '#8A5207', label: 'Dettes (401)', value: fmtCompact(pay), unit: 'F CFA', sub: 'Fournisseurs à payer' },
        ]} />

        <div className="acc-toolbar">
          <div className="acc-search">
            <Icon name="search" size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
            <input
              type="text" placeholder="Rechercher par numéro ou libellé…"
              value={query} onChange={e => setQuery(e.target.value)}
            />
          </div>
          <div className="chips">
            <button
              className={`chip-f${activeClass === 'all' ? ' active' : ''}`}
              onClick={() => setActiveClass('all')}
            >
              Tous <span className="cnt">{classCounts.all}</span>
            </button>
            {Object.entries(classes).map(([k, c]) =>
              classCounts[k] ? (
                <button
                  key={k}
                  className={`chip-f${activeClass === k ? ' active' : ''}`}
                  onClick={() => setActiveClass(k)}
                >
                  <span className="cls-tag" style={{ background: c.color, width: 18, height: 18, fontSize: 10 }}>{k}</span>
                  {c.short} <span className="cnt">{classCounts[k]}</span>
                </button>
              ) : null
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Comptes</div>
          </div>
          {Object.keys(byClass).length === 0 ? (
            <EmptyState
              illustration={<ChartOfAccountsEmptyIllustration />}
              title="Aucun compte trouvé"
              description="Aucun compte ne correspond à votre recherche ou au filtre sélectionné."
            />
          ) : (
            <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              {Object.keys(byClass).sort().map((k, gi) => {
                const cls = classes[Number(k)];
                const clsAccounts = byClass[k];
                const clsSigned = clsAccounts.reduce((s, a) => s + signedOf(a.num), 0);
                const isCollapsed = collapsed[k];
                return (
                  <div key={k} style={gi > 0 ? { borderTop: '0.5px solid var(--color-border-tertiary)' } : {}}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 18px', background: 'var(--color-background-secondary)', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => toggleCollapse(k)}
                    >
                      <span className="cls-tag" style={{ background: cls?.color }}>{k}</span>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: -0.2 }}>{cls?.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{clsAccounts.length} compte{clsAccounts.length > 1 ? 's' : ''}</div>
                      </div>
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                          {fmt(Math.abs(clsSigned))}
                          <SideTag signed={clsSigned} />
                        </div>
                        <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={16} style={{ color: 'var(--color-text-tertiary)' }} />
                      </div>
                    </div>

                    {!isCollapsed && clsAccounts.map((a) => {
                      const m = mvtOf(a.num);
                      const signed = signedOf(a.num);
                      return (
                        <div
                          key={a.num}
                          onClick={() => setSelected(a)}
                          style={{
                            display: 'grid', gridTemplateColumns: '92px 1fr 120px 150px 36px',
                            alignItems: 'center', gap: 14, padding: '11px 18px',
                            borderTop: '0.5px solid var(--color-border-tertiary)',
                            cursor: 'pointer', transition: 'background .1s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--brand-tint)')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}
                        >
                          <div className="mono" style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.3 }}>{a.num}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', marginTop: 2, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                              {a.nature === 'D' ? 'Débit' : 'Crédit'}
                            </div>
                          </div>
                          <div className="mono" style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'right' }}>
                            {(m.debit || m.credit)
                              ? <><span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{fmt(m.debit)}</span><span style={{ color: 'var(--color-text-tertiary)', margin: '0 5px' }}>/</span>{fmt(m.credit)}</>
                              : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                          </div>
                          <div className="mono" style={{ textAlign: 'right', fontSize: 13.5, fontWeight: Math.abs(signed) < 0.5 ? 500 : 700, color: Math.abs(signed) < 0.5 ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)' }}>
                            {Math.abs(signed) < 0.5 ? '0' : fmt(Math.abs(signed))}
                            {Math.abs(signed) >= 0.5 && <SideTag signed={signed} />}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--color-text-tertiary)' }}>
                            <Icon name="chevron-right" size={17} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </Page>
  );
}
