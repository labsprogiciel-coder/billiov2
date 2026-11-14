import { useState, useMemo } from 'react';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { fmt } from '@/lib/accounting-data';
import { usePeriodClosing, useBalanceFns } from '@/lib/accounting-hooks';
import { currentMonth, exerciseYear, monthEndLabel, monthLabel } from '@/lib/period';
import Page from '@/components/Page';

const MONTH_LABELS = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];

const INITIAL_CHECKS = [
  { t: 'Rapprochement bancaire', s: 'Solde 521 pointé avec le relevé de banque', tag: 'manual', done: true },
  { t: 'Lettrage clients & fournisseurs', s: 'Comptes 411 / 401 lettrés', tag: 'manual', done: true },
  { t: 'Dotations aux amortissements', s: 'Dotation de juin postée (681 → 28x)', tag: 'auto', done: true },
  { t: 'Régularisation de la TVA', s: 'Solder 443/445 vers 4441 — 1 brouillon à poster', tag: 'auto', done: false },
  { t: 'Écritures de régularisation (OD)', s: 'Charges & produits constatés d\'avance', tag: 'manual', done: true },
  { t: 'Validation de la balance', s: 'Débit = crédit · contrôlé automatiquement', tag: 'auto', done: true },
];

function PeriodCell({ m, status }: { m: string; status: string }) {
  const isClosed = status === 'closed';
  const isCurrent = status === 'current';
  return (
    <div style={{
      flex: 1, minWidth: 60, border: isCurrent ? '1.5px solid var(--brand)' : '0.5px solid var(--color-border-tertiary)',
      borderRadius: 'var(--border-radius-md)', padding: '11px 10px', textAlign: 'center' as const,
      background: isClosed ? 'var(--color-background-secondary)' : 'var(--color-background-primary)',
      boxShadow: isCurrent ? '0 0 0 3px color-mix(in srgb, var(--brand) 14%, transparent)' : 'var(--shadow-sm)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{m}</div>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' as const,
        marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 3,
        color: isClosed ? '#276C2B' : isCurrent ? 'var(--brand)' : 'var(--color-text-tertiary)',
      }}>
        {isClosed && <><Icon name="lock" size={10} />Clôturé</>}
        {isCurrent && <><Icon name="edit" size={10} />Ouvert</>}
        {status === 'future' && 'À venir'}
      </div>
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const R = 56;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - pct / 100);
  const color = pct === 100 ? '#276C2B' : 'var(--brand)';
  return (
    <div style={{ position: 'relative', width: 132, height: 132, margin: '8px auto 4px' }}>
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={R} fill="none" stroke="var(--color-background-secondary)" strokeWidth="13" />
        <circle
          cx="66" cy="66" r={R} fill="none" stroke={color} strokeWidth="13"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset}
          transform="rotate(-90 66 66)" style={{ transition: 'stroke-dashoffset .4s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, color }}>{pct}%</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-tertiary)', marginTop: 1 }}>Ready</div>
      </div>
    </div>
  );
}


export default function PeriodClosingPage() {
  // The month being closed: the current one, read each render so a tab left
  // open past month-end doesn't close the previous month
  const TARGET_MONTH = currentMonth();
  const { data, loading, closePeriod } = usePeriodClosing();
  const [checks, setChecks] = useState(INITIAL_CHECKS.map(c => ({ ...c })));
  const [closing, setClosing] = useState(false);
  // Optimistic closed flag: set on button click; also syncs from DB status
  const [justClosed, setJustClosed] = useState(false);

  const entries = data?.entries ?? [];
  const periods = data?.periods ?? [];
  const { signedOf } = useBalanceFns(data);

  // Closed = either DB says so (after reload) or user just clicked close (optimistic)
  const targetDbPeriod = periods.find(p => p.month === TARGET_MONTH);
  const closed = justClosed || targetDbPeriod?.status === 'closed';

  const displayPeriods = MONTH_LABELS.map((m, i) => {
    const month = i + 1;
    const dbPeriod = periods.find(p => p.month === month);
    const isTarget = month === TARGET_MONTH;
    const s = (dbPeriod?.status === 'closed' || (closed && isTarget)) ? 'closed'
      : isTarget && !closed ? 'current'
      : 'future';
    return { m, s, id: dbPeriod?.id ?? null };
  });

  const currentPeriod = !closed ? displayPeriods.find(p => p.s === 'current') : null;
  const doneCount = checks.filter(c => c.done).length;
  const pct       = Math.round((doneCount / checks.length) * 100);
  const drafts    = entries.filter(e => !e.posted).length;
  const allDone   = doneCount === checks.length;

  const toggleCheck = (i: number) => {
    setChecks(prev => prev.map((c, idx) => idx === i ? { ...c, done: !c.done } : c));
  };

  const result = useMemo(() => {
    const produits = -(signedOf('701') + signedOf('706'));
    const charges = signedOf('601') + signedOf('605') + signedOf('627') +
      signedOf('661') + signedOf('664') + signedOf('681') + signedOf('671');
    return produits - charges;
  }, [data]);

  if (loading) return <PageSkeleton section={{ icon: 'lock', label: 'Comptabilité' }} title="Clôture de période" variant="accounting" rows={5} />;

  const CARD = {
    background: 'var(--color-background-primary)',
    border: '0.5px solid var(--color-border-tertiary)',
    borderRadius: 'var(--border-radius-lg)',
    boxShadow: 'var(--shadow-sm)',
  };

  return (
    <Page
      section={{ icon: 'lock', label: 'Comptabilité' }}
      title="Clôture de période"
      subtitle={<>Clôture · exercice {exerciseYear()} · arrêté au {monthEndLabel()}</>}
      actions={<>
        <span className="period-pill">
          <span className="dot" style={closed ? { background: '#276C2B' } : {}} />
          {closed ? `Exercice ${exerciseYear()} · ${monthLabel().toLowerCase()} clôturé` : `Exercice ${exerciseYear()} · ouvert`}
        </span>
        <button
          className="btn"
          disabled={closed || !allDone || closing || !currentPeriod?.id}
          onClick={async () => {
            if (!currentPeriod?.id) return;
            setClosing(true);
            setJustClosed(true);
            try { await closePeriod(currentPeriod.id); } finally { setClosing(false); }
          }}
        >
          <Icon name="lock" />{closing ? 'Clôture…' : closed ? 'Clôturé' : `Clôturer ${currentPeriod?.m ?? ''}`}
        </button>
      </>}
    >
        {/* Period board */}
        <div style={{ ...CARD, marginBottom: 16 }}>
          <div style={{ padding: '16px 20px 13px', borderBottom: '0.5px solid var(--color-border-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Périodes · exercice {exerciseYear()}</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>Verrouillez une période pour figer ses écritures</div>
            </div>
          </div>
          <div style={{ padding: '8px 20px 18px' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {displayPeriods.map((p, i) => (
                <PeriodCell key={i} m={p.m} status={p.s} />
              ))}
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* Checklist */}
          <div style={CARD}>
            <div style={{ padding: '16px 20px 13px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Liste de contrôle — {monthLabel().toLowerCase()}</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>Complétez chaque étape avant de clôturer la période</div>
            </div>
            <div style={{ padding: '8px 20px 18px' }}>
              {checks.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 13, padding: '14px 0', borderBottom: i < checks.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                  <button
                    onClick={() => toggleCheck(i)}
                    style={{
                      width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: c.done ? '1.5px solid #276C2B' : '1.5px dashed var(--color-border-secondary)',
                      background: c.done ? '#276C2B' : 'var(--color-background-primary)',
                      color: c.done ? '#fff' : 'transparent', cursor: 'pointer', transition: 'all .14s', padding: 0,
                    }}
                  >
                    <Icon name="check" size={14} />
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: c.done ? 'var(--color-text-secondary)' : 'var(--color-text-primary)', textDecoration: c.done ? 'line-through' : 'none', textDecorationColor: 'var(--color-border-secondary)' }}>
                      {c.t}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.5 }}>{c.s}</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, flexShrink: 0, marginTop: 2,
                    background: c.tag === 'auto' ? 'var(--brand-tint)' : 'var(--color-background-secondary)',
                    color: c.tag === 'auto' ? 'var(--brand)' : 'var(--color-text-secondary)',
                  }}>
                    {c.tag === 'auto' ? 'Auto' : 'Manuel'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Readiness */}
            <div style={CARD}>
              <div style={{ padding: '16px 20px 13px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Prêt à clôturer</div>
              </div>
              <div style={{ padding: '8px 20px 18px' }}>
                <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
                  <ProgressRing pct={pct} />
                </div>

                {[
                  { label: 'Étapes complètes', value: `${doneCount} / ${checks.length}` },
                  { label: 'Écritures à poster', value: drafts ? `${drafts} brouillon` : 'Aucun' },
                  { label: 'Balance générale', value: 'Équilibrée ✓', color: '#276C2B' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                    <span style={{ fontWeight: 700, color: color || 'var(--color-text-primary)' }}>{value}</span>
                  </div>
                ))}

                <button
                  className={`btn${allDone ? ' btn-primary' : ''}`}
                  disabled={closed || !allDone || closing || !currentPeriod?.id}
                  onClick={async () => {
                    if (!currentPeriod?.id) return;
                    setClosing(true);
                    setJustClosed(true);
                    try { await closePeriod(currentPeriod.id); } finally { setClosing(false); }
                  }}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 16, opacity: allDone ? 1 : 0.5, cursor: allDone ? 'pointer' : 'not-allowed' }}
                >
                  <Icon name="lock" />{closing ? 'Clôture en cours…' : closed ? 'Clôturé ✓' : `Clôturer ${currentPeriod?.m ?? 'la période'} & reporter à-nouveaux`}
                </button>

                {!allDone && (
                  <div style={{ display: 'flex', gap: 11, padding: '13px 15px', background: '#FCF3E6', border: '0.5px solid #F0D9A8', borderRadius: 'var(--border-radius-md)', marginTop: 14 }}>
                    <div style={{ color: '#8A5207', flexShrink: 0, marginTop: 1 }}><Icon name="alert-triangle" size={17} /></div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#8C5207' }}>
                        {checks.length - doneCount} étape{checks.length - doneCount > 1 ? 's' : ''} incomplète{checks.length - doneCount > 1 ? 's' : ''}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#A26A1A', marginTop: 2, lineHeight: 1.5 }}>
                        Postez ou supprimez l'écriture TVA en brouillon dans les Journaux avant de clôturer.
                      </div>
                    </div>
                  </div>
                )}

                {closed && (
                  <div style={{ display: 'flex', gap: 11, padding: '13px 15px', background: '#E7F3E2', border: '0.5px solid #A5D6A7', borderRadius: 'var(--border-radius-md)', marginTop: 14 }}>
                    <div style={{ color: '#276C2B', flexShrink: 0, marginTop: 1 }}><Icon name="circle-check" size={17} /></div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1B5E20' }}>
                      {monthLabel()} clôturé · écritures figées · à-nouveaux reportés
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Result allocation */}
            <div style={CARD}>
              <div style={{ padding: '16px 20px 13px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Affectation du résultat</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>Au 31 décembre · affectation du résultat</div>
              </div>
              <div style={{ padding: '8px 20px 18px' }}>
                <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0 9px', fontWeight: 700, borderBottom: '0.5px solid var(--color-border-tertiary)', marginBottom: 3, fontSize: 12.5 }}>
                    <span>Résultat de l'exercice (à ce jour)</span>
                    <span className="mono" style={{ fontWeight: 700, color: result >= 0 ? '#276C2B' : '#A32D2D' }}>
                      {result >= 0 ? '+' : ''}{fmt(result)} F CFA
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>Report à nouveau d'ouverture</span>
                    <span className="mono" style={{ fontWeight: 700 }}>870 000 F CFA</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                    <Icon name="arrows-exchange" size={15} />
                    Vire le résultat vers{' '}
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--brand)', fontFamily: '"SFMono-Regular", ui-monospace, monospace' }}>110</span>
                    {' '}Report à nouveau à la clôture annuelle.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
    </Page>
  );
}
