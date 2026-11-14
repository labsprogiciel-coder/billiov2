import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import { useApp } from '@/context/AppContext';
import { adoptOpeningBalances } from '@/lib/api/accounting';
import Page from '@/components/Page';
import {
  ACCOUNTS, CLASSES, clsOf, acctOf, fmt,
} from '@/lib/accounting-data';

/* ─── types ──────────────────────────────────────────────────────────────── */
interface OBLine { id: number; acct: string; d: number; c: number }

const SEED: OBLine[] = [
  { id: 1,  acct: '101',  d: 0,       c: 5000000 },
  { id: 2,  acct: '106',  d: 0,       c: 1200000 },
  { id: 3,  acct: '162',  d: 0,       c: 8180000 },
  { id: 4,  acct: '211',  d: 1800000, c: 0 },
  { id: 5,  acct: '281',  d: 0,       c: 600000 },
  { id: 6,  acct: '2441', d: 2400000, c: 0 },
  { id: 7,  acct: '2451', d: 6500000, c: 0 },
  { id: 8,  acct: '2818', d: 0,       c: 2100000 },
  { id: 9,  acct: '311',  d: 1250000, c: 0 },
  { id: 10, acct: '401',  d: 0,       c: 1920000 },
  { id: 11, acct: '411',  d: 3420000, c: 0 },
  { id: 12, acct: '521',  d: 4180000, c: 0 },
  { id: 13, acct: '571',  d: 320000,  c: 0 },
];

const AUTO_BALANCE_ACCT = '110';
let nextId = 100;

function grp(n: number): string {
  return Math.round(Math.abs(n))
    .toLocaleString('fr-FR')
    .replace(/ /g, ' ')
    .replace(/ /g, ' ');
}

function parseAmt(s: string): number {
  const digits = s.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

/* ─── sub-components ─────────────────────────────────────────────────────── */

function StepIndicator({ step, adopted }: { step: 1 | 2 | 3; adopted: boolean }) {
  const steps = [
    { n: 1, label: 'Saisir les soldes' },
    { n: 2, label: 'Équilibrer' },
    { n: 3, label: 'Adopter' },
  ] as const;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {steps.map((s, i) => {
        const done   = adopted ? true : s.n < step;
        const active = !adopted && s.n === step;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 12px', borderRadius: 20,
              background: done ? 'var(--brand)' : 'var(--color-background-primary)',
              border: `0.5px solid ${active ? 'var(--brand)' : done ? 'var(--brand)' : 'var(--color-border-tertiary)'}`,
              color: done || active ? (done ? '#fff' : 'var(--brand)') : 'var(--color-text-secondary)',
              fontSize: 11.5, fontWeight: 600,
              boxShadow: active ? '0 0 0 3px color-mix(in srgb, var(--brand) 12%, transparent)' : 'none',
              transition: 'all .2s',
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10.5, fontWeight: 800,
                background: done ? 'rgba(255,255,255,0.25)' : active ? 'var(--brand-tint)' : 'var(--color-background-secondary)',
                color: done ? '#fff' : active ? 'var(--brand)' : 'var(--color-text-tertiary)',
              }}>{s.n}</span>
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <Icon name="chevron-right" size={13} style={{ color: 'var(--color-text-tertiary)' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountSelect({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        flex: 1, minWidth: 0, appearance: 'none',
        padding: '9px 28px 9px 11px',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--border-radius-md)',
        fontSize: 12.5, fontFamily: 'var(--font-sans)',
        background: `var(--color-background-primary) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%235C687A' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 9px center`,
        color: value ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
        cursor: 'pointer',
      }}
    >
      <option value="">Choisir un compte…</option>
      {ACCOUNTS.map(a => (
        <option key={a.num} value={a.num}>{a.num} — {a.label}</option>
      ))}
    </select>
  );
}

function AmtInput({
  value, onChange, highlight,
}: { value: number; onChange: (n: number) => void; highlight?: boolean }) {
  const [raw, setRaw] = useState(value ? grp(value) : '');

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="0"
      value={raw}
      onFocus={e => e.target.select()}
      onChange={e => {
        const s = e.target.value;
        setRaw(s);
        onChange(parseAmt(s));
      }}
      onBlur={() => {
        const n = parseAmt(raw);
        setRaw(n ? grp(n) : '');
      }}
      style={{
        width: '100%', padding: '9px 12px',
        border: `0.5px solid ${highlight ? 'color-mix(in srgb, var(--brand) 35%, var(--color-border-secondary))' : 'var(--color-border-secondary)'}`,
        borderRadius: 'var(--border-radius-md)',
        fontSize: 13, fontFamily: '"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
        fontVariantNumeric: 'tabular-nums', textAlign: 'right',
        background: 'var(--color-background-primary)', color: 'var(--color-text-primary)',
      }}
    />
  );
}

/* ─── preview panel ──────────────────────────────────────────────────────── */

function PreviewPanel({ lines, totD, totC }: { lines: OBLine[]; totD: number; totC: number }) {
  const byCls = useMemo(() => {
    const m: Record<number, number> = {};
    for (const l of lines) {
      if (!l.acct || (!l.d && !l.c)) continue;
      const k = clsOf(l.acct);
      m[k] = (m[k] ?? 0) + (l.d - l.c);
    }
    return m;
  }, [lines]);

  const keys = Object.keys(byCls).map(Number).sort((a, b) => a - b);

  return (
    <aside style={{
      background: 'var(--color-background-primary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderRadius: 'var(--border-radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
      position: 'sticky',
      top: 0,
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
          <Icon name="eye" size={13} style={{ color: 'var(--brand)' }} /> Aperçu en direct
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.3px', marginTop: 5 }}>À-nouveaux par classe</div>
        <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>au 1 juin 2026 · XOF</div>
      </div>

      <div style={{ padding: '6px 18px 4px' }}>
        {keys.length === 0 ? (
          <div style={{ padding: '26px 0', textAlign: 'center', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            Choisissez des comptes et des montants pour prévisualiser vos à-nouveaux.
          </div>
        ) : keys.map(k => {
          const cls = CLASSES[k];
          const v = byCls[k];
          const sd = v >= 0 ? 'D' : 'C';
          return (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <span style={{ background: cls?.color ?? '#ccc', width: 20, height: 20, borderRadius: 5, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, flexShrink: 0 }}>{k}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  Classe {k}
                  <small style={{ display: 'block', fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{cls?.short}</small>
                </span>
              </div>
              <div style={{ fontFamily: '"SFMono-Regular", ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {grp(v)}<span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--color-text-tertiary)', marginLeft: 3 }}>{sd}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, padding: '12px 18px', background: 'var(--color-background-secondary)', borderTop: '1px solid var(--color-border-secondary)', alignItems: 'baseline' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--color-text-tertiary)' }}>Total</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px', color: 'var(--color-text-tertiary)' }}>Débiteur</div>
          <div style={{ fontFamily: '"SFMono-Regular", ui-monospace, monospace', fontSize: 12.5, fontWeight: 800 }}>{grp(totD)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px', color: 'var(--color-text-tertiary)' }}>Créditeur</div>
          <div style={{ fontFamily: '"SFMono-Regular", ui-monospace, monospace', fontSize: 12.5, fontWeight: 800 }}>{grp(totC)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '12px 18px', fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.5, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        <Icon name="alert-triangle" size={15} style={{ color: 'var(--brand)', flexShrink: 0, marginTop: 1 }} />
        <div>Une fois adoptés, ces soldes constituent la ligne d'<b style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>à-nouveau</b> d'ouverture dans chaque grand livre et la première colonne de la balance générale.</div>
      </div>
    </aside>
  );
}

/* ─── success view ───────────────────────────────────────────────────────── */

function SuccessView({
  totD, totC, lineCount, bankAmt, piece,
  onEdit,
}: { totD: number; totC: number; lineCount: number; bankAmt: number; piece: string; onEdit: () => void }) {
  const navigate = useNavigate();
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', padding: '14px 0 22px' }}>
        <div style={{
          width: 68, height: 68, margin: '0 auto', borderRadius: 20,
          background: 'linear-gradient(155deg, #4FAE58, #276C2B)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 34, boxShadow: '0 12px 28px -10px rgba(46,125,50,0.55)',
          animation: 'ob-pop .5s cubic-bezier(.18,.89,.32,1.28)',
        }}>
          <Icon name="circle-check-filled" size={34} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.7px', marginTop: 16 }}>Position d'ouverture adoptée</div>
        <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginTop: 9, lineHeight: 1.55, maxWidth: '50ch', margin: '9px auto 0' }}>
          Vos à-nouveaux constituent désormais le point de départ de Billio pour l'exercice 2026. Chaque compte s'ouvre sur ces soldes — aucune ressaisie nécessaire.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          {[
            { icon: 'list', label: <><b style={{ fontWeight: 800, color: 'var(--color-text-primary)' }}>{lineCount}</b> comptes</> },
            { icon: 'arrows-exchange', label: <><b style={{ fontWeight: 800, color: 'var(--color-text-primary)' }}>{fmt(totD)}</b> F CFA</> },
            { icon: 'calendar', label: '1 juin 2026' },
            { icon: 'notebook', label: <span className="mono">OD · {piece || 'AN-2026-001'}</span> },
            { icon: 'lock', label: 'Verrouillée', iconStyle: { color: '#226B2A' } },
          ].map((pill, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 20, background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              <Icon name={pill.icon} size={14} style={{ color: 'var(--brand)', ...(pill.iconStyle ?? {}) }} />
              {pill.label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', margin: '26px 0 12px', textAlign: 'center' }}>
        Où apparaissent vos soldes d'ouverture
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          {
            icon: 'arrows-exchange', href: '/accounting/trial-balance',
            title: 'Balance générale', sub: "Alimente la colonne d’ouverture — débiteur = créditeur dès la première ligne.",
            rows: [{ l: 'À-nouveau débit', v: fmt(totD) }, { l: 'À-nouveau crédit', v: fmt(totC), dim: true }],
          },
          {
            icon: 'book-2', href: '/accounting/journals',
            title: 'Grand livre', sub: "Chaque compte s’ouvre sur une ligne « À-nouveau au 01/06 » avec solde courant.",
            rows: [{ l: 'Comptes ouverts', v: String(lineCount) }, { l: '521 Banques', v: fmt(bankAmt) + ' D' }],
          },
          {
            icon: 'report-money', href: '/accounting/financial-statements',
            title: "Bilan d’ouverture", sub: "Les actifs et les ressources s’équilibrent dans le bilan d’ouverture.",
            rows: [{ l: 'Total bilan', v: fmt(totD) }, { l: 'Équilibre', v: 'Actif = Passif ✓', green: true }],
          },
        ].map(card => (
          <a
            key={card.href}
            onClick={e => { e.preventDefault(); navigate(card.href); }}
            href={card.href}
            style={{
              display: 'block', textDecoration: 'none', color: 'inherit',
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 'var(--border-radius-lg)',
              boxShadow: 'var(--shadow-sm)',
              padding: 16,
              transition: 'border-color .14s, box-shadow .14s, transform .14s',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'; }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand-tint)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={card.icon} size={18} />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              {card.title}
              <Icon name="external-link" size={13} style={{ color: 'var(--color-text-tertiary)', marginLeft: 'auto' }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 5, lineHeight: 1.5 }}>{card.sub}</div>
            <div style={{ marginTop: 12, paddingTop: 11, borderTop: '0.5px dashed var(--color-border-secondary)', fontSize: 11 }}>
              {(card.rows as { l: string; v: string; dim?: boolean; green?: boolean }[]).map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{r.l}</span>
                  <span style={{ fontWeight: 700, fontFamily: '"SFMono-Regular", ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', color: r.green ? '#226B2A' : r.dim ? 'var(--color-text-secondary)' : undefined }}>{r.v}</span>
                </div>
              ))}
            </div>
          </a>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 26 }}>
        <a className="btn btn-primary btn-lg" onClick={e => { e.preventDefault(); navigate('/accounting/trial-balance'); }} href="/accounting/trial-balance" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <Icon name="arrows-exchange" /> Open trial balance
        </a>
        <a className="btn btn-lg" onClick={e => { e.preventDefault(); navigate('/accounting/journals'); }} href="/accounting/journals" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <Icon name="notebook" /> View the entry
        </a>
      </div>

      <div
        onClick={onEdit}
        style={{ display: 'block', textAlign: 'center', marginTop: 16, fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', cursor: 'pointer' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--brand)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
      >
        ← Edit the opening entry
      </div>

      <style>{`
        @keyframes ob-pop {
          0%   { transform: scale(.4); opacity: 0; }
          60%  { transform: scale(1.08); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────────────────────── */

export default function OpeningBalancesPage() {
  const { orgId, openingBalancesAdopted, setOpeningBalancesAdopted, showToast } = useApp();
  const navigate = useNavigate();

  const [lines, setLines]     = useState<OBLine[]>(SEED);
  const [label, setLabel]     = useState('Reprise des à-nouveaux — exercice 2026');
  const [piece, setPiece]     = useState('AN-2026-001');
  const [saving, setSaving]   = useState(false);

  /* ── derived totals ── */
  const { totD, totC, ecart, lineCount } = useMemo(() => {
    let d = 0, c = 0, n = 0;
    for (const l of lines) {
      d += l.d; c += l.c;
      if (l.acct && (l.d || l.c)) n++;
    }
    return { totD: d, totC: c, ecart: d - c, lineCount: n };
  }, [lines]);

  const balanced = Math.abs(ecart) < 0.5 && lineCount >= 2;
  const step: 1 | 2 | 3 = balanced ? 2 : 1;

  /* ── line mutations ── */
  const updateAcct = useCallback((id: number, acct: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, acct } : l));
  }, []);

  const updateAmt = useCallback((id: number, field: 'd' | 'c', n: number) => {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const opp = field === 'd' ? 'c' : 'd';
      return { ...l, [field]: n, [opp]: n ? 0 : l[opp] };
    }));
  }, []);

  const addLine = useCallback(() => {
    setLines(prev => [...prev, { id: nextId++, acct: '', d: 0, c: 0 }]);
  }, []);

  const delLine = useCallback((id: number) => {
    setLines(prev => {
      const next = prev.filter(l => l.id !== id);
      return next.length ? next : [{ id: nextId++, acct: '', d: 0, c: 0 }];
    });
  }, []);

  const autoBalance = useCallback(() => {
    if (Math.abs(ecart) < 0.5) return;
    const tgt = AUTO_BALANCE_ACCT;
    const amt = Math.abs(ecart);
    const side: 'd' | 'c' = ecart > 0 ? 'c' : 'd';
    const opp: 'd' | 'c'  = side === 'd' ? 'c' : 'd';
    setLines(prev => {
      const ex = prev.find(l => l.acct === tgt);
      if (ex) {
        return prev.map(l => l.acct === tgt ? { ...l, [side]: (l[side] || 0) + amt, [opp]: 0 } : l);
      }
      return [...prev, { id: nextId++, acct: tgt, d: side === 'd' ? amt : 0, c: side === 'c' ? amt : 0 }];
    });
    const a = acctOf(tgt);
    showToast(`Balancing line added — ${tgt}${a ? ' ' + a.label : ''}`);
  }, [ecart, showToast]);

  const handleAdopt = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await adoptOpeningBalances(orgId, {
        year:  new Date().getFullYear(),
        date:  '2026-06-01',
        piece,
        label,
        lines,
      });
      setOpeningBalancesAdopted(true);
      showToast('À-nouveaux adoptés — écriture verrouillée');
    } catch (err) {
      showToast('Erreur lors de l\'adoption des à-nouveaux', true);
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [saving, orgId, piece, label, lines, setOpeningBalancesAdopted, showToast]);

  /* ── bank amount for success card ── */
  const bankAmt = useMemo(() => {
    const l = lines.find(x => x.acct === '521');
    return l ? l.d - l.c : 0;
  }, [lines]);

  /* ── banner content ── */
  const banner = useMemo(() => {
    const side = ecart > 0 ? 'crédit' : 'débit';
    if (balanced) return {
      ok: true,
      text: <>Équilibrée — débit = crédit = <b>{grp(totD)} F CFA</b>. Prête à être adoptée comme position d'ouverture.</>,
    };
    return {
      ok: false,
      text: <>Écart de <b>{grp(ecart)} F CFA</b> — il manque {grp(ecart)} au <b>{side}</b> pour équilibrer.</>,
    };
  }, [balanced, ecart, totD]);

  if (openingBalancesAdopted) {
    return (
      <Page
        section={{ icon: 'arrows-exchange', label: 'Comptabilité' }}
        title="À-nouveaux"
        subtitle="Journal des à-nouveaux · reprise au 1 juin 2026"
        actions={<>
          <span className="period-pill"><span className="dot" /> Exercice 2026 · ouverture</span>
        </>}
      >
          <SuccessView
            totD={totD} totC={totC} lineCount={lineCount}
            bankAmt={bankAmt} piece={piece}
            onEdit={() => setOpeningBalancesAdopted(false)}
          />
      </Page>
    );
  }

  return (
    <Page
      section={{ icon: 'arrows-exchange', label: 'Comptabilité' }}
      title="Opening balances"
      subtitle="Journal des à-nouveaux · reprise au 1 juin 2026"
      actions={<>
        <span className="period-pill"><span className="dot" /> Exercice 2026 · ouverture</span>
      </>}
    >
        {/* ── intro banner ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 18, padding: '16px 20px',
          borderRadius: 'var(--border-radius-lg)', marginBottom: 16,
          background: 'linear-gradient(110deg, var(--brand-tint) 0%, #EEF4FB 52%, var(--color-background-primary) 100%)',
          border: '0.5px solid color-mix(in srgb, var(--brand) 22%, white)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{
            width: 44, height: 44, flexShrink: 0, borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
            background: 'linear-gradient(150deg, color-mix(in srgb, var(--brand) 80%, white), var(--brand-dark))',
            boxShadow: '0 4px 12px -3px rgba(12,68,124,0.45)',
          }}>
            <Icon name="arrows-exchange" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px' }}>Vous venez d'une autre plateforme ?</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 3, lineHeight: 1.5, maxWidth: '62ch' }}>
              Saisissez vos soldes de clôture en une écriture équilibrée datée au début de votre exercice. Billio l'enregistre dans le <b>journal OD</b> et l'adopte comme position d'ouverture — vos à-nouveaux alimentent directement la balance générale et le grand livre.
            </div>
          </div>
          <StepIndicator step={step} adopted={false} />
        </div>

        {/* ── grid: composer + preview ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 16, alignItems: 'start' }}>

          {/* ── composer card ── */}
          <div style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 'var(--border-radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}>
            {/* card header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <span className="jchip" style={{ background: 'var(--c2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="arrows-exchange" size={13} /> OD · Opérations diverses
                <span style={{ fontWeight: 600, opacity: 0.85, fontSize: 10 }}>
                  <Icon name="lock" size={11} />
                </span>
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-text-tertiary)', display: 'inline-block' }} />
                Brouillon — pas encore adopté
              </span>
            </div>

            {/* meta row */}
            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 150px', gap: 14, padding: '16px 20px', borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="calendar" size={12} /> Date
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--border-radius-md)', background: 'var(--color-background-primary)' }}>
                  <Icon name="calendar" size={16} style={{ color: 'var(--brand)' }} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>1 juin 2026</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase', color: 'var(--brand)', background: 'var(--brand-tint)', padding: '2px 7px', borderRadius: 5, marginLeft: 'auto' }}>FY start</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>Libellé</div>
                <input
                  className="ob-input"
                  type="text"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  style={{ width: '100%', padding: '9px 11px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--border-radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>Pièce</div>
                <input
                  type="text"
                  value={piece}
                  onChange={e => setPiece(e.target.value)}
                  style={{ width: '100%', padding: '9px 11px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--border-radius-md)', fontSize: 13, fontFamily: '"SFMono-Regular", ui-monospace, monospace', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)' }}
                />
              </div>
            </div>

            {/* lines header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px 34px', gap: 10, alignItems: 'center', padding: '12px 20px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
              <span>Compte</span>
              <span style={{ textAlign: 'right', paddingRight: 12 }}>Débit</span>
              <span style={{ textAlign: 'right', paddingRight: 12 }}>Crédit</span>
              <span />
            </div>

            {/* lines */}
            <div style={{ padding: '0 20px' }}>
              {lines.map(l => {
                const cls = l.acct ? clsOf(l.acct) : 0;
                const dotColor = cls ? CLASSES[cls]?.color : 'var(--color-border-secondary)';
                return (
                  <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px 34px', gap: 10, alignItems: 'center', padding: '5px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0, background: dotColor, transition: 'background .15s', display: 'inline-block' }} />
                      <AccountSelect value={l.acct} onChange={v => updateAcct(l.id, v)} />
                    </div>
                    <AmtInput value={l.d} highlight={!!l.d} onChange={n => updateAmt(l.id, 'd', n)} />
                    <AmtInput value={l.c} onChange={n => updateAmt(l.id, 'c', n)} />
                    <button
                      onClick={() => delLine(l.id)}
                      title="Remove"
                      style={{ width: 34, height: 36, border: 'none', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', borderRadius: 7, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FCEBEB'; (e.currentTarget as HTMLElement).style.color = '#A32D2D'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={addLine}
              style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 20px 4px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--brand-dark)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--brand)'; }}
            >
              <Icon name="plus" size={14} /> Add an account
            </button>

            {/* totals */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px 34px', gap: 10, alignItems: 'center', padding: '13px 20px', marginTop: 8, background: 'var(--color-background-secondary)', borderTop: '1px solid var(--color-border-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)' }}>
                Totaux
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                  background: Math.abs(ecart) < 0.5 ? '#E7F3E2' : '#FCEBEB',
                  color:      Math.abs(ecart) < 0.5 ? '#276C2B' : '#A32D2D',
                }}>
                  {Math.abs(ecart) < 0.5 ? 'Équilibrée ✓' : `Écart ${grp(ecart)}${ecart > 0 ? ' D' : ' C'}`}
                </span>
              </div>
              <div style={{ textAlign: 'right', paddingRight: 12, fontSize: 14, fontWeight: 800, fontFamily: '"SFMono-Regular", ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{grp(totD)}</div>
              <div style={{ textAlign: 'right', paddingRight: 12, fontSize: 14, fontWeight: 800, fontFamily: '"SFMono-Regular", ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{grp(totC)}</div>
              <div />
            </div>

            {/* balance banner */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '13px 20px',
              fontSize: 12.5, fontWeight: 600,
              background: banner.ok ? '#E7F3E2' : '#FCF3E8',
              color:      banner.ok ? '#226B2A' : '#8A5A12',
            }}>
              <Icon name={banner.ok ? 'circle-check-filled' : 'alert-triangle'} size={18} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{banner.text}</div>
              {!banner.ok && (
                <button
                  onClick={autoBalance}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 'var(--border-radius-md)', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: '#8A5207', color: '#fff', whiteSpace: 'nowrap', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#95590A'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#8A5207'; }}
                >
                  <Icon name="arrows-exchange" size={14} /> Auto-balance to 110
                </button>
              )}
            </div>

            {/* footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              {!balanced && (
                <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="alert-triangle" size={14} /> Écriture déséquilibrée — vous pouvez tout de même adopter
                </span>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={() => navigate('/accounting/journals')}>Annuler</button>
              <button
                className="btn btn-primary btn-lg"
                disabled={saving}
                onClick={handleAdopt}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 18px', fontSize: 13.5, fontWeight: 700, opacity: saving ? 0.5 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
              >
                <Icon name="check" /> {saving ? 'Enregistrement…' : 'Adopter comme position d\'ouverture'}
              </button>
            </div>
          </div>

          {/* ── live preview ── */}
          <PreviewPanel lines={lines} totD={totD} totC={totC} />
        </div>
    </Page>
  );
}
