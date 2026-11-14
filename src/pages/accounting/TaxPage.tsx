import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import KPIStrip from '@/components/accounting/KPIStrip';
import JournalBadge from '@/components/accounting/JournalBadge';
import type { JournalEntry } from '@/lib/accounting-data';
import { fmt, fmtCompact } from '@/lib/accounting-data';
import { useTaxData } from '@/lib/accounting-hooks';
import { useApp } from '@/context/AppContext';
import { calculateTVA, calculateIS, isRegimeCaducite, isFirstFiscalYear } from '@/lib/tax-bf';
import type { Regime } from '@/lib/tax-bf';
import { exerciseYear, monthLabel } from '@/lib/period';
import Page from '@/components/Page';

// ─── Regime metadata ─────────────────────────────────────────────────────────

interface RegimeMeta {
  label:         string;
  canInvoiceTVA: boolean;
  /** 'monthly' | 'quarterly' | null */
  declarations:  'monthly' | 'quarterly' | null;
  isColor:       string;
  isBg:          string;
}

function orgRegimeToMeta(raw: string): { regime: Regime; meta: RegimeMeta } {
  switch (raw) {
    case 'RNI': return {
      regime: 'RNI',
      meta: { label: 'RNI', canInvoiceTVA: true, declarations: 'monthly', isColor: 'var(--brand)', isBg: 'var(--brand-tint)' },
    };
    case 'RSI': return {
      regime: 'RSI',
      meta: { label: 'RSI', canInvoiceTVA: false, declarations: 'quarterly', isColor: '#8A5207', isBg: '#FAEEDA' },
    };
    case 'CME': return {
      regime: 'CME-declaratif',
      meta: { label: 'CME', canInvoiceTVA: false, declarations: null, isColor: '#5C4033', isBg: '#EFE6DF' },
    };
    case 'CSE': return {
      regime: 'CSE',
      meta: { label: 'CSE', canInvoiceTVA: false, declarations: null, isColor: '#276C2B', isBg: '#E7F3E2' },
    };
    default: return {
      regime: 'RND',
      meta: { label: raw || 'RND', canInvoiceTVA: false, declarations: null, isColor: 'var(--color-text-secondary)', isBg: 'var(--color-background-secondary)' },
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sumPostedCredit(entries: JournalEntry[], acct: string): number {
  return entries
    .filter(e => e.posted)
    .flatMap(e => e.lines)
    .filter(l => l.acct === acct)
    .reduce((s, l) => s + l.c, 0);
}

function sumPostedDebitPrefix(entries: JournalEntry[], prefix: string): number {
  return entries
    .filter(e => e.posted)
    .flatMap(e => e.lines)
    .filter(l => l.acct.startsWith(prefix))
    .reduce((s, l) => s + l.d, 0);
}

function sumPostedCreditPrefix(entries: JournalEntry[], prefix: string): number {
  return entries
    .filter(e => e.posted)
    .flatMap(e => e.lines)
    .filter(l => l.acct.startsWith(prefix))
    .reduce((s, l) => s + l.c, 0);
}

function sumPostedDebit(entries: JournalEntry[], acct: string): number {
  return entries
    .filter(e => e.posted)
    .flatMap(e => e.lines)
    .filter(l => l.acct === acct)
    .reduce((s, l) => s + l.d, 0);
}

interface TaxLine {
  entryId: string;
  journal: string;
  label:   string;
  piece:   string;
  date:    string;
  htBase:  number;
  tvaAmount: number;
  tvaRate:   number;
  type: 'collected' | 'deductible';
}

function buildTaxLines(entries: JournalEntry[]): TaxLine[] {
  const lines: TaxLine[] = [];
  for (const e of entries) {
    if (!e.posted) continue;
    for (const l of e.lines) {
      if (l.acct === '443' && l.c > 0) {
        // Determine rate: 10% for hotel/restaurant entries (not common in mock, default 18%)
        const rate = 0.18;
        lines.push({
          entryId: e.id, journal: e.journal, label: e.label, piece: e.piece, date: e.date,
          htBase: Math.round(l.c / rate),
          tvaAmount: l.c,
          tvaRate: rate,
          type: 'collected',
        });
      }
      if (l.acct === '445' && l.d > 0) {
        const rate = 0.18;
        lines.push({
          entryId: e.id, journal: e.journal, label: e.label, piece: e.piece, date: e.date,
          htBase: Math.round(l.d / rate),
          tvaAmount: l.d,
          tvaRate: rate,
          type: 'deductible',
        });
      }
    }
  }
  return lines.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaxPage() {
  const { data, loading } = useTaxData();
  const { orgSettings }  = useApp();

  if (loading) return <PageSkeleton section={{ icon: 'percentage', label: 'Comptabilité' }} title="Fiscalité" variant="accounting" rows={6} />;

  const allEntries = data?.entries ?? [];
  const journals = data?.journals ?? {};

  const { regime, meta } = orgRegimeToMeta(orgSettings.taxRegime);
  const creationDate = orgSettings.businessCreationDate || undefined;
  const EXERCISE_YEAR = exerciseYear();
  // Totals cover this exercise only; earlier years' entries stay out of them
  const entriesOf = (y: number) => allEntries.filter(e => e.date.startsWith(`${y}-`));
  const entries   = entriesOf(EXERCISE_YEAR);
  const firstYear    = isFirstFiscalYear(creationDate, EXERCISE_YEAR);
  const { canInvoiceTVA, declarations } = meta;

  // ── TVA ──────────────────────────────────────────────────────────────────
  const taxLines   = buildTaxLines(entries);
  const collected  = taxLines.filter(l => l.type === 'collected').reduce((s, l) => s + l.tvaAmount, 0);
  const deductible = taxLines.filter(l => l.type === 'deductible').reduce((s, l) => s + l.tvaAmount, 0);
  // 4449 = TVA retenue par clients assujettis (already remitted to DGI by the client)
  const alreadyWithheld = sumPostedDebit(entries, '4449');
  const netDue     = collected - deductible - alreadyWithheld;
  const collectedLines  = taxLines.filter(l => l.type === 'collected');
  const deductibleLines = taxLines.filter(l => l.type === 'deductible');

  // Sanity check: verify collectée amount matches calculateTVA on its declared HT base
  const tvaCheck = collectedLines.every(l =>
    Math.abs(calculateTVA(l.htBase, l.tvaRate === 0.10) - l.tvaAmount) <= 1
  );

  // ── IUTS / TPA / Soutien Patriotique from payroll journal entries ────────
  const iutsAmount = sumPostedCredit(entries, '4421');
  const tpaAmount  = sumPostedCredit(entries, '4423');
  // 4422 = Soutien Patriotique (1% sur salaires nets)
  const spAmount   = sumPostedCredit(entries, '4422');
  // 4091 = Retenue services opérée par le client (20-25% sur prestations)
  const retServices = sumPostedDebit(entries, '4091');

  // ── IS estimate from period P&L ───────────────────────────────────────────
  const periodRevenue  = sumPostedCreditPrefix(entries, '7');
  const periodExpenses = sumPostedDebitPrefix(entries, '6');
  const taxableProfit  = periodRevenue - periodExpenses;

  const isEstimateFor = (profit: number, y: number) => calculateIS({
    taxableProfit: profit,
    regime:        regime === 'RNI' ? 'RNI' : 'RSI',
    creationDate,
    isAdherentCGA: false,
    taxYear:       y,
  });
  const isEstimate = isEstimateFor(taxableProfit, EXERCISE_YEAR);

  // ── Caducité watch ────────────────────────────────────────────────────────
  const ytdCA         = periodRevenue; // rough proxy: period revenue credits
  const caduciteAlert = isRegimeCaducite(regime, ytdCA, creationDate, EXERCISE_YEAR);

  // ── Fiscal calendar helpers ───────────────────────────────────────────────
  const isMonthly   = declarations === 'monthly';
  const isQuarterly = declarations === 'quarterly';

  const MONTH_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const todayISO  = new Date().toISOString().slice(0, 10);

  const isoDate = (year: number, month: number, day: number) =>
    `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  const dlStatus = (date: string): 'overdue' | 'pending' | 'upcoming' => {
    if (date < todayISO) return 'overdue';
    return (new Date(date).getTime() - Date.now()) / 86_400_000 <= 45 ? 'pending' : 'upcoming';
  };

  // Per-month TVA net (collected − deductible) derived from journal entries
  const netTVAFor = (lines: typeof taxLines, y: number) => Array.from({ length: 12 }, (_, i) => {
    const prefix = `${y}-${String(i + 1).padStart(2, '0')}`;
    const c = lines.filter(l => l.type === 'collected'  && l.date.startsWith(prefix)).reduce((s, l) => s + l.tvaAmount, 0);
    const d = lines.filter(l => l.type === 'deductible' && l.date.startsWith(prefix)).reduce((s, l) => s + l.tvaAmount, 0);
    return c - d;
  });

  type Deadline = { label: string; date: string; amount: number; status: 'overdue' | 'pending' | 'upcoming'; category: string };
  const dl = (label: string, date: string, amount: number, category: string): Deadline =>
    ({ label, date, amount, status: dlStatus(date), category });

  // Deadlines of exercise Y (some fall due early in Y + 1)
  const deadlinesFor = (Y: number, monthlyNetTVA: number[], isEst: number): Deadline[] => [
    // ── Annual fixed (early year) ──────────────────────────────────────────
    dl(`TVM — Taxe sur la Valeur Marginale ${Y}`,   isoDate(Y, 3, 31), 0, 'Annuelle'),
    ...(regime === 'CME-declaratif' ? [
      dl(`CME — Déclaration annuelle ${Y}`,         isoDate(Y, 3, 31), 0, 'Annuelle'),
    ] : []),

    // ── 1ᵉʳ acompte IS (25 %) — juin ──────────────────────────────────────
    ...(isMonthly || isQuarterly ? [
      dl(`1ᵉʳ acompte provisionnel IS (25 %) — juin ${Y}`, isoDate(Y, 6, 15), Math.round(isEst * 0.25), 'Acomptes IS'),
    ] : []),

    // ── Monthly TVA CA3 — one entry per month (RNI only) ──────────────────
    ...(canInvoiceTVA && isMonthly ? Array.from({ length: 12 }, (_, i) => {
      const ref      = i + 1;
      const dueYear  = ref === 12 ? Y + 1 : Y;
      const dueMonth = ref === 12 ? 1 : ref + 1;
      return dl(`TVA CA3 — ${MONTH_FR[i]} ${Y}`, isoDate(dueYear, dueMonth, 15), Math.max(0, monthlyNetTVA[i]), 'Mensuelle TVA');
    }) : []),

    // ── IUTS + TPA monthly (RNI) ───────────────────────────────────────────
    ...(isMonthly ? Array.from({ length: 12 }, (_, i) => {
      const ref      = i + 1;
      const dueYear  = ref === 12 ? Y + 1 : Y;
      const dueMonth = ref === 12 ? 1 : ref + 1;
      return dl(`IUTS + TPA — ${MONTH_FR[i]} ${Y}`, isoDate(dueYear, dueMonth, 15), 0, 'Mensuelle');
    }) : []),

    // ── IUTS + TPA quarterly (RSI) ─────────────────────────────────────────
    ...(!isMonthly && isQuarterly ? [
      dl(`IUTS + TPA — T1 ${Y} (jan–mar)`, isoDate(Y,      4, 15), 0, 'Trimestrielle'),
      dl(`IUTS + TPA — T2 ${Y} (avr–jun)`, isoDate(Y,      7, 15), 0, 'Trimestrielle'),
      dl(`IUTS + TPA — T3 ${Y} (jul–sep)`, isoDate(Y,     10, 15), 0, 'Trimestrielle'),
      dl(`IUTS + TPA — T4 ${Y} (oct–déc)`, isoDate(Y + 1,  1, 15), 0, 'Trimestrielle'),
    ] : []),

    // ── Annual fixed (later in year) ───────────────────────────────────────
    dl(`Droit de licence des Étrangers ${Y}`, isoDate(Y, 10, 20), 0, 'Annuelle'),
    dl(`Taxe sur Actions ${Y}`,               isoDate(Y, 10, 20), 0, 'Annuelle'),
    dl(`Autres Droits de Licence ${Y}`,       isoDate(Y, 10, 30), 0, 'Annuelle'),
    dl(`2ᵉ acompte provisionnel IS (25 %) — nov. ${Y}`, isoDate(Y, 11, 15), Math.round(isEst * 0.25), 'Acomptes IS'),
    dl(`Patente ${Y}`,                        isoDate(Y, 12, 15), 0, 'Annuelle'),
    dl(`3ᵉ acompte provisionnel IS (25 %) — déc. ${Y}`, isoDate(Y, 12, 15), Math.round(isEst * 0.25), 'Acomptes IS'),
    dl(`IS / IBICA — Déclaration annuelle ${Y}`, isoDate(Y + 1, 2, 28), isEst, 'Annuelle IS'),
  ];

  // Last exercise's December/T4 returns and annual IS are still due early this year
  const prevYear     = EXERCISE_YEAR - 1;
  const prevEntries  = entriesOf(prevYear);
  const prevDeadlines = deadlinesFor(
    prevYear,
    netTVAFor(buildTaxLines(prevEntries), prevYear),
    isEstimateFor(sumPostedCreditPrefix(prevEntries, '7') - sumPostedDebitPrefix(prevEntries, '6'), prevYear),
  ).filter(d => d.date >= isoDate(EXERCISE_YEAR, 1, 1));

  const deadlines: Deadline[] = [
    ...prevDeadlines,
    ...deadlinesFor(EXERCISE_YEAR, netTVAFor(taxLines, EXERCISE_YEAR), isEstimate),
  ].sort((a, b) => a.date < b.date ? -1 : 1);

  // ── Risk KPI ──────────────────────────────────────────────────────────────
  const overdueCount  = deadlines.filter(d => d.status === 'overdue').length;
  const pendingItems  = deadlines.filter(d => d.status === 'pending');
  const riskKpi = overdueCount > 0
    ? { icon: 'alert-triangle' as const, iconBg: '#FCEBEB', iconColor: '#A32D2D',
        label: 'Échéances en retard', value: String(overdueCount),
        unit: overdueCount === 1 ? 'déclaration' : 'déclarations',
        sub: 'Risque pénalité 25 % – 200 %' }
    : pendingItems.length > 0
    ? { icon: 'clock' as const, iconBg: '#FAEEDA', iconColor: '#8A5207',
        label: 'Prochaine échéance', value: pendingItems[0].date,
        unit: '',
        sub: pendingItems[0].label.length > 32 ? pendingItems[0].label.slice(0, 31) + '…' : pendingItems[0].label }
    : { icon: 'check' as const, iconBg: '#E7F3E2', iconColor: '#276C2B',
        label: 'Situation fiscale', value: 'À jour', unit: '',
        sub: deadlines.find(d => d.status === 'upcoming')?.date
          ? `Prochain : ${deadlines.find(d => d.status === 'upcoming')!.date}` : 'Aucune échéance imminente' };

  return (
    <Page
      section={{ icon: 'percentage', label: 'Comptabilité' }}
      title={<>
        Fiscalité
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: meta.isBg, color: meta.isColor, letterSpacing: 0.3 }}>
          {meta.label}
        </span>
        {caduciteAlert && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: '#FCEBEB', color: '#A32D2D' }}>
            ⚠ Seuil dépassé — notifier la DGI sous 30 j
          </span>
        )}
      </>}
      documentTitle="Fiscalité"
      titleStyle={{ display: 'flex', alignItems: 'center', gap: 10 }}
      subtitle={<>
        Obligations fiscales · {monthLabel()}
        {declarations && <> · Déclarations <strong>{declarations === 'monthly' ? 'mensuelles' : 'trimestrielles'}</strong></>}
      </>}
      actions={<>
        <span className="period-pill"><span className="dot" />Exercice {exerciseYear()} · ouvert</span>
        <button className="btn"><Icon name="download" />Exporter déclaration</button>
      </>}
    >

        {/* KPI strip — adapts to regime */}
        <KPIStrip items={[
          ...(canInvoiceTVA ? [
            { icon: 'receipt', iconBg: '#E7F3E2', iconColor: '#276C2B', label: '443 — TVA collectée', value: fmtCompact(collected), unit: 'F CFA', sub: `${collectedLines.length} écriture${collectedLines.length !== 1 ? 's' : ''}` },
            { icon: 'receipt', iconBg: '#FAEEDA', iconColor: '#8A5207', label: '445 — TVA déductible', value: fmtCompact(deductible), unit: 'F CFA', sub: `${deductibleLines.length} écriture${deductibleLines.length !== 1 ? 's' : ''}` },
            { icon: 'percentage', iconBg: netDue >= 0 ? '#E9F0FA' : '#FCEBEB', iconColor: netDue >= 0 ? 'var(--brand)' : '#A32D2D', label: '4441 — TVA nette due', value: fmtCompact(Math.abs(netDue)), unit: 'F CFA', sub: netDue >= 0 ? 'À verser à l\'État' : 'Crédit de TVA' },
          ] as const : [
            { icon: 'receipt', iconBg: '#FAEEDA', iconColor: '#8A5207', label: 'CA période HT (estimé)', value: fmtCompact(periodRevenue), unit: 'F CFA', sub: 'Crédits comptes 7xx' },
          ] as const),
          { icon: 'building-bank', iconBg: '#E9F0FA', iconColor: 'var(--brand)', label: 'IS estimé (27,5%)', value: fmtCompact(isEstimate), unit: 'F CFA', sub: taxableProfit >= 0 ? `Bénéfice estimé ${fmtCompact(taxableProfit)} F` : `Déficit — minimum forfaitaire` },
          { icon: 'users', iconBg: '#F3E8FF', iconColor: '#6B21A8', label: 'IUTS + TPA + SP dus', value: fmtCompact(iutsAmount + tpaAmount + spAmount), unit: 'F CFA', sub: `IUTS ${fmtCompact(iutsAmount)} · TPA ${fmtCompact(tpaAmount)}${spAmount > 0 ? ` · SP ${fmtCompact(spAmount)}` : ''}` },
          riskKpi,
        ]} />

        {/* TVA section — only for RNI */}
        {canInvoiceTVA ? (
          <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '13px 18px', borderBottom: '0.5px solid var(--color-border-tertiary)', fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="receipt" size={15} />Détail TVA · Exercice {EXERCISE_YEAR}
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: '#E9F0FA', color: 'var(--brand)' }}>
                  Formulaire CA3 · eSINTAX
                </span>
                {!tvaCheck && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: '#FAEEDA', color: '#8A5207' }}>
                    Incohérence taux détectée
                  </span>
                )}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 70px 1fr 100px 110px 60px 110px', gap: 12, padding: '9px 18px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              {['Date', 'Journal', 'Libellé', 'Taux', 'Base HT', 'TVA', 'Type'].map((h, i) => (
                <div key={i} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>

            {taxLines.map((l, i) => {
              const j = journals[l.journal];
              const isCollected = l.type === 'collected';
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 70px 1fr 100px 110px 60px 110px', gap: 12, padding: '11px 18px', borderTop: '0.5px solid var(--color-border-tertiary)', alignItems: 'center', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{l.date.slice(5)}</span>
                  {j ? <JournalBadge journal={j} /> : <span>{l.journal}</span>}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
                  <span className="mono" style={{ textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: 11.5 }}>{(l.tvaRate * 100).toFixed(0)}%</span>
                  <span className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(l.htBase)}</span>
                  <span className="mono" style={{ textAlign: 'right', fontWeight: 700, color: isCollected ? '#276C2B' : '#8A5207' }}>
                    {isCollected ? '+' : '−'}{fmt(l.tvaAmount)}
                  </span>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: isCollected ? '#E7F3E2' : '#FAEEDA', color: isCollected ? '#276C2B' : '#8A5207' }}>
                      {isCollected ? 'Collectée' : 'Déductible'}
                    </span>
                  </div>
                </div>
              );
            })}

            {alreadyWithheld > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '80px 70px 1fr 100px 110px 60px 110px', gap: 12, padding: '11px 18px', borderTop: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', alignItems: 'center', fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                <span /><span />
                <span>4449 — Ret. TVA versée par clients</span>
                <span /><span />
                <span className="mono" style={{ textAlign: 'right', color: '#276C2B' }}>−{fmt(alreadyWithheld)}</span>
                <span style={{ textAlign: 'right' }}><span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#E7F3E2', color: '#276C2B' }}>Déjà versé</span></span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '80px 70px 1fr 100px 110px 60px 110px', gap: 12, padding: '11px 18px', borderTop: '1px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', fontWeight: 700, alignItems: 'center', fontSize: 12.5 }}>
              <span /><span />
              <span>TVA nette à verser (CA3)</span>
              <span /><span />
              <span className="mono" style={{ textAlign: 'right', fontSize: 13, color: netDue >= 0 ? '#276C2B' : '#A32D2D' }}>{netDue >= 0 ? '+' : ''}{fmt(netDue)}</span>
              <span />
            </div>
          </div>
        ) : (
          <div style={{ background: '#FAEEDA', border: '0.5px solid #F0C070', borderRadius: 'var(--border-radius-lg)', padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
            <Icon name="info-circle" size={18} />
            <div>
              <span style={{ fontWeight: 700, color: '#8A5207' }}>Régime {meta.label} — TVA non applicable.</span>
              {' '}Seuls les contribuables RNI (CA ≥ 50 M F CFA) sont habilités à facturer la TVA. Votre régime en est dispensé.
            </div>
          </div>
        )}

        {/* IS estimate */}
        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '13px 18px', borderBottom: '0.5px solid var(--color-border-tertiary)', fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="building-bank" size={15} />IS / IBICA — Estimation période (27,5%)
          </div>
          {[
            { label: 'Produits (comptes 7xx)', value: periodRevenue,  sign: '+', color: '#276C2B' },
            { label: 'Charges (comptes 6xx)',  value: periodExpenses, sign: '−', color: '#A32D2D' },
            { label: 'Résultat fiscal estimé', value: taxableProfit,  sign: taxableProfit >= 0 ? '+' : '−', color: taxableProfit >= 0 ? '#276C2B' : '#A32D2D', bold: true },
          ].map((row, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: 12.5, fontWeight: row.bold ? 700 : 400 }}>
              <span style={{ flex: 1 }}>{row.label}</span>
              <span className="mono" style={{ color: row.color, fontWeight: row.bold ? 700 : 600 }}>
                {row.sign}{fmt(Math.abs(row.value))} F
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderTop: '1px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', fontSize: 12.5, fontWeight: 700 }}>
            <span style={{ flex: 1 }}>IS dû (taux 27,5% · minimum forfaitaire {regime === 'RNI' ? '1 000 000' : '300 000'} F)</span>
            <span className="mono" style={{ color: 'var(--brand)', fontSize: 13 }}>{fmt(isEstimate)} F</span>
          </div>
          {retServices > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: 12.5 }}>
              <span style={{ flex: 1 }}>4091 — Retenues services subies (20–25%)</span>
              <span className="mono" style={{ color: '#8A5207', fontWeight: 700 }}>−{fmt(retServices)} F</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#FAEEDA', color: '#8A5207' }}>Imputable IS</span>
            </div>
          )}
          <div style={{ padding: '9px 18px', background: firstYear ? '#E7F3E2' : 'var(--color-background-secondary)', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: 11, color: firstYear ? '#276C2B' : 'var(--color-text-tertiary)', fontWeight: firstYear ? 600 : 400 }}>
            {firstYear
              ? '1ère année d\'exploitation — exonération du minimum forfaitaire IS applicable (Art.88-90 CGI).'
              : 'Estimation sur la base des écritures comptabilisées. Le résultat fiscal définitif inclut les réintégrations et déductions extra-comptables.'}
          </div>
        </div>

        {/* Tax calendar */}
        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <div style={{ padding: '13px 18px', borderBottom: '0.5px solid var(--color-border-tertiary)', fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="calendar" size={15} />Calendrier fiscal · {meta.label}
          </div>
          {deadlines.map((d, i) => {
            const iconBg    = d.status === 'overdue' ? '#FCEBEB' : d.status === 'pending' ? '#FAEEDA' : 'var(--brand-tint)';
            const iconColor = d.status === 'overdue' ? '#A32D2D' : d.status === 'pending' ? '#8A5207' : 'var(--brand)';
            const badgeBg   = d.status === 'overdue' ? '#FCEBEB' : d.status === 'pending' ? '#FAEEDA' : 'var(--color-background-secondary)';
            const badgeColor = d.status === 'overdue' ? '#A32D2D' : d.status === 'pending' ? '#8A5207' : 'var(--color-text-tertiary)';
            const badgeLabel = d.status === 'overdue' ? 'En retard' : d.status === 'pending' ? 'À déclarer' : 'À venir';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderTop: i > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                <div style={{ width: 38, height: 38, borderRadius: 9, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="calendar" size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                    {d.label}
                    <span style={{ fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 12, background: 'var(--color-background-secondary)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0 }}>{d.category}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>Échéance : {d.date}</div>
                </div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 13.5, textAlign: 'right', flexShrink: 0 }}>
                  {fmt(d.amount)} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)' }}>F CFA</span>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: badgeBg, color: badgeColor, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {badgeLabel}
                </span>
              </div>
            );
          })}
        </div>

    </Page>
  );
}
