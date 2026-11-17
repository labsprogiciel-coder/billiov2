/* ==========================================================================
   Burkina Faso — CGI 2020 / LF 2021 tax calculation engine
   All monetary values in FCFA (integer). Rates from Arts. 85–115, 227–242,
   317, 532–538.
   ========================================================================== */

// ─── Shared types ────────────────────────────────────────────────────────────

export type TaxYear = 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026;

/**
 * Five DGI regimes.
 *
 * RNI  — Réel Normal d'Imposition          CA ≥ 50 000 000 F; monthly declarations; TVA-eligible.
 * RSI  — Réel Simplifié d'Imposition       15 000 000 ≤ CA < 50 000 000 F; quarterly; no TVA.
 * CME-declaratif — individuals 5M≤CA<15M or any legal entity CA<15M; no TVA.
 * CME-forfait    — individuals CA < 5 000 000 F; forfait tariff; no TVA.
 * CSE  — Contribution du Secteur Élevage   livestock/fishing/aquaculture sales.
 * RND  — Régime Non Déterminé             NGOs, public entities, employees, occasional sellers.
 *
 * Stickiness: RNI→RSI or RSI→CME only after 3 consecutive years below the threshold.
 * TVA: only RNI taxpayers may invoice TVA (Art. RNI §1).
 * CME exclusions: professions libérales (any legal form) and CSE taxpayers.
 * Threshold breach during year → caducité; taxpayer must notify DGI within 30 days.
 */
export type Regime =
  | 'RNI'
  | 'RSI'
  | 'CME-declaratif'
  | 'CME-forfait'
  | 'CSE'
  | 'RND';

export type CmeZone = 'A' | 'B' | 'C' | 'D';

// ─── IUTS — Impôt Unique sur les Traitements et Salaires (Art.105-115) ───────

export interface IutsInput {
  monthlySalaireBase:   number;
  indemnitesLogement:   number;
  indemniteFonction:    number;
  indemniteTransport:   number;
  autresIndemnites:     number;
  avantagesNature:      number;
  pensionContribution:  number;
  /** Category P/A/B or grade 6/1/2 → 20 % abattement; else 25 % */
  isHighAbattement:     boolean;
  /** Eligible dependents: spouse (max 1) + children (minor/disabled/<25 in school) */
  dependents:           number;
}

export interface IutsResult {
  grossSalary:      number;
  exemptLogement:   number;
  exemptFonction:   number;
  exemptTransport:  number;
  taxableGross:     number;
  pensionDeduction: number;
  abattement:       number;
  netTaxable:       number;
  grossTax:         number;
  familyReduction:  number;
  netTax:           number;
}

const IUTS_BRACKETS: [number, number, number][] = [
  [0,      30_000,  0.0000],
  [30_000, 50_000,  0.1210],
  [50_000, 80_000,  0.1390],
  [80_000, 120_000, 0.1570],
  [120_000, 170_000, 0.1840],
  [170_000, 250_000, 0.2170],
  [250_000, Infinity, 0.2500],
];

const FAMILY_REDUCTION: Record<number, number> = { 0: 0, 1: 0.08, 2: 0.10, 3: 0.12, 4: 0.14 };

export function calculateIUTS(input: IutsInput): IutsResult {
  const {
    monthlySalaireBase, indemnitesLogement, indemniteFonction,
    indemniteTransport, autresIndemnites, avantagesNature,
    pensionContribution, isHighAbattement, dependents,
  } = input;

  const grossSalary = monthlySalaireBase + indemnitesLogement + indemniteFonction
    + indemniteTransport + autresIndemnites + avantagesNature;

  // Art.106: "salaire brut … diminué des retenues pour cotisation sociale"
  const grossSalaryForCaps = grossSalary - pensionContribution;
  const exemptLogement  = Math.min(indemnitesLogement,  0.20 * grossSalaryForCaps, 75_000);
  const exemptFonction  = Math.min(indemniteFonction,   0.05 * grossSalaryForCaps, 50_000);
  const exemptTransport = Math.min(indemniteTransport,  0.05 * grossSalaryForCaps, 30_000);

  const taxableGross = grossSalary - exemptLogement - exemptFonction - exemptTransport;

  // Art.111 deductions
  const pensionDeduction = Math.min(pensionContribution, 0.08 * monthlySalaireBase);
  const abattementRate   = isHighAbattement ? 0.20 : 0.25;
  const abattement       = abattementRate * monthlySalaireBase;

  const netTaxable = Math.max(0, taxableGross - pensionDeduction - abattement);

  // Progressive bracket computation — continuous bands (DGI practice, no 100 F gaps)
  let grossTax = 0;
  for (const [low, high, rate] of IUTS_BRACKETS) {
    if (netTaxable <= low) break;
    grossTax += (Math.min(netTaxable, high) - low) * rate;
  }

  // Art.113 family charge reduction
  const clampedDeps   = Math.min(dependents, 4);
  const familyReduction = grossTax * (FAMILY_REDUCTION[clampedDeps] ?? 0);
  const netTax          = Math.round(grossTax - familyReduction);

  return {
    grossSalary, exemptLogement, exemptFonction, exemptTransport,
    taxableGross, pensionDeduction, abattement, netTaxable,
    grossTax: Math.round(grossTax), familyReduction: Math.round(familyReduction), netTax,
  };
}

// ─── TPA — Taxe Patronale et d'Apprentissage (Art.227-233) ───────────────────

/**
 * Base is the same gross used for IUTS (including avantages en nature).
 * Adhérents of a CGA receive a 20 % abatement on the base.
 */
export function calculateTPA(grossPayrollBase: number, isAdherentCGA = false): number {
  const base = isAdherentCGA ? grossPayrollBase * 0.80 : grossPayrollBase;
  return Math.round(base * 0.03);
}

// ─── Creation-date utilities ──────────────────────────────────────────────────

/**
 * Returns how many days are left in `taxYear` from `startDate` (inclusive),
 * expressed as a fraction of the full year (365 days).
 * Used to prorate RNI/RSI turnover thresholds for businesses that started
 * during the year (Art. I §2 and Art. II §2).
 */
export function yearFractionFromStart(startDate: string, taxYear: number): number {
  const start = new Date(startDate);
  if (start.getFullYear() !== taxYear) return 1; // full year — no prorating needed
  const yearEnd  = new Date(taxYear, 11, 31); // Dec 31
  const msInYear = 365 * 24 * 60 * 60 * 1000;
  return Math.max(0, (yearEnd.getTime() - start.getTime()) / msInYear);
}

/**
 * Returns the effective RNI/RSI threshold after prorating for new businesses.
 * `creationDate` is an ISO date string (YYYY-MM-DD); pass '' / undefined to skip prorating.
 */
export function effectiveThreshold(base: number, creationDate: string | undefined, taxYear: number): number {
  if (!creationDate) return base;
  const fraction = yearFractionFromStart(creationDate, taxYear);
  return Math.round(base * fraction);
}

/**
 * True when `taxYear` is the first fiscal year of the business (year of creation).
 * Determines eligibility for the IS minimum forfaitaire exemption (Art.88-90).
 */
export function isFirstFiscalYear(creationDate: string | undefined, taxYear: number): boolean {
  if (!creationDate) return false;
  return new Date(creationDate).getFullYear() === taxYear;
}

// ─── IS — Impôt sur les Sociétés (Art.85-91) ─────────────────────────────────

export interface IsInput {
  taxableProfit:   number;   // résultat fiscal (can be negative)
  regime:          'RNI' | 'RSI';
  /** ISO date of business creation — used to derive first-year exemption automatically */
  creationDate?:   string;
  /** Override: if you already know whether it's the first year */
  isFirstYear?:    boolean;
  isAdherentCGA:   boolean;
  taxYear?:        number;
  /** Annual turnover HT — required for the 0.5% CA component of the minimum forfaitaire (Art.89) */
  annualTurnoverHT?: number;
}

export function calculateIS(input: IsInput): number {
  const { taxableProfit, regime, creationDate, isAdherentCGA, annualTurnoverHT } = input;
  const taxYear    = input.taxYear ?? new Date().getFullYear();
  const firstYear  = input.isFirstYear ?? isFirstFiscalYear(creationDate, taxYear);

  let iSDue = 0;
  if (taxableProfit > 0) {
    const adjusted = Math.floor(taxableProfit / 1_000) * 1_000;
    iSDue = Math.round(adjusted * 0.275);
  }

  if (firstYear) return iSDue;

  // Art.89: minimum = max(0.5% × CA rounded to 100,000 F, fixed floor)
  const caRounded = Math.floor((annualTurnoverHT ?? 0) / 100_000) * 100_000;
  const caMin     = Math.round(caRounded * 0.005);
  const fixedFloor = regime === 'RNI' ? 1_000_000 : 300_000;
  let minimum = Math.max(caMin, fixedFloor);
  if (isAdherentCGA) minimum = Math.round(minimum * 0.50);

  return Math.max(iSDue, minimum);
}

// ─── Retenue à la source sur prestations de services (Arts. 206–214) ────────

/**
 * Withholding applied by the CLIENT on service invoices and remitted to DGI
 * by the 15th of the following month (Art.208 / 214).
 * Returns null when the invoice is below the 50,000 F threshold (Art.208.3).
 */
export type ServiceWithholdingScenario =
  | 'resident-with-ifu'      // 5%  — Art.207
  | 'resident-without-ifu'   // 25% — Art.207
  | 'construction'           // 1%  — Art.207 (travaux, BTP)
  | 'non-resident';          // 20% — Art.212

export const SERVICE_WITHHOLDING_THRESHOLD = 50_000; // Art.208.3

/** The rate of each scenario, as printed next to « Retenue à la source » */
export const SERVICE_WITHHOLDING_RATE_LABEL: Record<ServiceWithholdingScenario, string> = {
  'resident-with-ifu':    '5 %',
  'resident-without-ifu': '25 %',
  'construction':         '1 %',
  'non-resident':         '20 %',
};

export function calculateServiceWithholding(
  amountHT: number,
  scenario: ServiceWithholdingScenario,
): number | null {
  if (amountHT < SERVICE_WITHHOLDING_THRESHOLD) return null;
  const rates: Record<ServiceWithholdingScenario, number> = {
    'resident-with-ifu':    0.05,
    'resident-without-ifu': 0.25,
    'construction':         0.01,
    'non-resident':         0.20,
  };
  return Math.round(amountHT * rates[scenario]);
}

// ─── Soutien Patriotique (1% sur salaires nets — mesure exceptionnelle) ──────

/** 1% levy on net salary withheld by employer alongside IUTS. */
export function calculateSoutienPatriotique(netSalary: number): number {
  return Math.round(netSalary * 0.01);
}

// ─── TVA (Art.317) ────────────────────────────────────────────────────────────

/** Returns TVA amount only. Rounded down to nearest franc (Art.317). */
export function calculateTVA(amountHT: number, isHotelOrRestaurant = false): number {
  const rate = isHotelOrRestaurant ? 0.10 : 0.18;
  return Math.floor(amountHT * rate);
}

export function calculateTVANet(
  collectedHT: number,
  deductibleHT: number,
  isHotelOrRestaurant = false,
): number {
  return calculateTVA(collectedHT, isHotelOrRestaurant) - calculateTVA(deductibleHT);
}

// ─── CME — Contribution des Micro-Entreprises (Art.532-538) ──────────────────

export type CmeTransportMode = 'vehicle' | 'motorTwoThreeWheel' | 'bicycle' | 'other' | 'foot';

export interface CmeInput {
  annualCA:      number;
  taxpayerType:  'individual' | 'entity';
  zone:          CmeZone;
  isAmbulant:    boolean;
  transportMode?: CmeTransportMode;
}

// Art.536 — class lookup based on annual CA
const CME_CLASS_TABLE: [number, number, number][] = [
  [0,          1_500_000, 8],
  [1_500_001,  3_000_000, 7],
  [3_000_001,  5_000_000, 6],
  [5_000_001,  7_000_000, 5],
  [7_000_001,  9_000_000, 4],
  [9_000_001, 11_000_000, 3],
  [11_000_001,13_000_000, 2],
  [13_000_001,14_999_999, 1],
];

// Art.536 tariff matrix [zone][class]
const CME_TARIFF: Record<CmeZone, Record<number, number>> = {
  A: { 1: 200_000, 2: 160_000, 3: 120_000, 4: 80_000, 5: 60_000, 6: 30_000, 7: 20_000, 8: 10_000 },
  B: { 1: 160_000, 2: 120_000, 3:  80_000, 4: 60_000, 5: 42_000, 6: 20_000, 7: 12_000, 8:  6_000 },
  C: { 1: 120_000, 2:  80_000, 3:  54_000, 4: 42_000, 5: 30_000, 6: 12_000, 7:  9_000, 8:  2_500 },
  D: { 1:  80_000, 2:  48_000, 3:  30_000, 4: 18_000, 5: 14_000, 6:  6_000, 7:  3_500, 8:  2_000 },
};

// Art.538 ambulant tariffs (annual)
const CME_AMBULANT: Record<CmeTransportMode, number> = {
  vehicle:           40_000,
  motorTwoThreeWheel: 12_000,
  bicycle:            9_000,
  other:              6_000,
  foot:               4_000,
};

export function calculateCME(input: CmeInput): number | null {
  const { annualCA, taxpayerType, zone, isAmbulant, transportMode } = input;

  if (annualCA >= 15_000_000) return null; // not eligible

  if (isAmbulant) {
    return CME_AMBULANT[transportMode ?? 'other'];
  }

  const row = CME_CLASS_TABLE.find(([lo, hi]) => annualCA >= lo && annualCA <= hi);
  if (!row) return null;
  const cmeClass = row[2];

  // forfait vs déclaratif distinction affects declaration procedure but same tariff table
  void taxpayerType; // kept for caller documentation; tariff is identical
  return CME_TARIFF[zone][cmeClass];
}

// ─── Patente (Art.234-242) ────────────────────────────────────────────────────

export type PatenteTable = 'A' | 'B' | 'C';

// Tableau A — general case (turnover → droit fixe)
const PATENTE_A: [number, number][] = [
  [5_000_000, 10_000],   [7_000_000, 15_000],  [10_000_000, 25_000],
  [15_000_000, 40_000],  [20_000_000, 60_000],  [30_000_000, 85_000],
  [50_000_000, 125_000], [75_000_000, 175_000], [100_000_000, 250_000],
  [150_000_000, 325_000],[200_000_000, 400_000],
];

// Tableau B — professions libérales
const PATENTE_B: [number, number][] = [
  [1_000_000, 25_000],  [3_000_000, 35_000],  [5_000_000, 50_000],
  [10_000_000, 100_000],[15_000_000, 150_000], [20_000_000, 200_000],
  [25_000_000, 250_000],[30_000_000, 300_000], [40_000_000, 350_000],
  [50_000_000, 400_000],
];

// Tableau C — wholesale local-beverage / gas station / prepaid recharge
const PATENTE_C: [number, number][] = [
  [5_000_000,  5_000],  [10_000_000, 10_000], [20_000_000, 20_000],
  [30_000_000, 30_000], [50_000_000, 70_000], [100_000_000, 120_000],
  [200_000_000, 170_000],[300_000_000, 220_000],
];

function lookupDroitFixe(ca: number, table: PatenteTable): number {
  const rows = table === 'A' ? PATENTE_A : table === 'B' ? PATENTE_B : PATENTE_C;

  // Find highest bracket whose threshold does not exceed the CA
  let droitFixe = rows[0][1];
  for (const [threshold, amount] of rows) {
    if (ca >= threshold) droitFixe = amount;
  }

  if (table === 'A' && ca > 200_000_000) {
    // +100 000 per additional 100M or fraction
    const extra = Math.ceil((ca - 200_000_000) / 100_000_000);
    droitFixe = 400_000 + extra * 100_000;
  }
  if (table === 'B' && ca > 50_000_000) {
    const extra = Math.ceil((ca - 50_000_000) / 10_000_000);
    droitFixe = 400_000 + extra * 50_000;
  }
  if (table === 'C' && ca > 300_000_000) {
    const extra = Math.ceil((ca - 300_000_000) / 100_000_000);
    droitFixe = 220_000 + extra * 50_000;
  }

  return droitFixe;
}

export interface PatenteInput {
  priorYearTurnoverHT: number;
  table:               PatenteTable;
  /** Annual rental value of business premises */
  valeurLocative:      number;
}

export interface PatenteResult {
  droitFixe:           number;
  droitProportionnel:  number;
  total:               number;
}

export function calculatePatente(input: PatenteInput): PatenteResult {
  const { priorYearTurnoverHT, table, valeurLocative } = input;
  const droitFixe           = lookupDroitFixe(priorYearTurnoverHT, table);
  const dpRaw               = valeurLocative * 0.08;
  const droitProportionnel  = Math.max(dpRaw, droitFixe / 5);
  return { droitFixe, droitProportionnel: Math.round(droitProportionnel), total: droitFixe + Math.round(droitProportionnel) };
}

// ─── Regime routing ───────────────────────────────────────────────────────────

export interface RegimeInput {
  annualTurnoverHT:     number;
  legalForm:            'individual' | 'entity';
  /** Livestock / fishing / aquaculture seller → CSE */
  isElevage:            boolean;
  /** NGO, association, public body, employee, occasional seller → RND */
  isRND:                boolean;
  /** Professions libérales (lawyers, doctors, architects …) are excluded from CME */
  isProfessionLiberale: boolean;
  /** ISO date string — when provided, RNI/RSI thresholds are prorated for the year of creation */
  creationDate?:        string;
  taxYear?:             number;
}

export interface RegimeResult {
  regime:        Regime;
  /** Only RNI taxpayers may invoice TVA */
  canInvoiceTVA: boolean;
  /**
   * Months below the upper threshold before the taxpayer can downgrade.
   * RNI → RSI and RSI → CME require 3 consecutive years under the threshold.
   */
  yearsToDowngrade: 3 | null;
}

export function determineRegime(input: RegimeInput): RegimeResult {
  const { annualTurnoverHT, legalForm, isElevage, isRND, isProfessionLiberale, creationDate } = input;
  const taxYear = input.taxYear ?? new Date().getFullYear();

  if (isRND)    return { regime: 'RND', canInvoiceTVA: false, yearsToDowngrade: null };
  if (isElevage) return { regime: 'CSE', canInvoiceTVA: false, yearsToDowngrade: null };

  // Prorate thresholds when the business started mid-year
  const rniThreshold = effectiveThreshold(50_000_000, creationDate, taxYear);
  const rsiThreshold = effectiveThreshold(15_000_000, creationDate, taxYear);
  const cmeThreshold = effectiveThreshold( 5_000_000, creationDate, taxYear);

  if (annualTurnoverHT >= rniThreshold) {
    return { regime: 'RNI', canInvoiceTVA: true, yearsToDowngrade: 3 };
  }

  if (annualTurnoverHT >= rsiThreshold) {
    return { regime: 'RSI', canInvoiceTVA: false, yearsToDowngrade: 3 };
  }

  // Below prorated 15M — CME territory unless excluded
  if (isProfessionLiberale) {
    return { regime: 'RSI', canInvoiceTVA: false, yearsToDowngrade: null };
  }

  if (legalForm === 'individual' && annualTurnoverHT < cmeThreshold) {
    return { regime: 'CME-forfait', canInvoiceTVA: false, yearsToDowngrade: null };
  }

  return { regime: 'CME-declaratif', canInvoiceTVA: false, yearsToDowngrade: null };
}

/**
 * True when YTD CA exceeds the current regime ceiling (caducité — DGI must be
 * notified within 30 days). Ceilings are prorated when the business started
 * mid-year in its first fiscal year.
 */
export function isRegimeCaducite(
  regime:               Regime,
  currentYTDTurnoverHT: number,
  creationDate?:        string,
  taxYear?:             number,
): boolean {
  const year = taxYear ?? new Date().getFullYear();
  switch (regime) {
    case 'CME-forfait':    return currentYTDTurnoverHT >= effectiveThreshold( 5_000_000, creationDate, year);
    case 'CME-declaratif': return currentYTDTurnoverHT >= effectiveThreshold(15_000_000, creationDate, year);
    case 'RSI':            return currentYTDTurnoverHT >= effectiveThreshold(50_000_000, creationDate, year);
    default:               return false;
  }
}

// ─── Timbre quittance (CGI art. 519–520) ─────────────────────────────────────

/**
 * Stamp duty on a receipt paid in cash, by the CGI's scale (art. 519): 30 F from 1 000 to 5 000 F, 50 F up to
 * 10 000 F, 100 F up to 50 000 F, then 50 F more per started block of 50 000 F. None below 1 000 F, and none
 * when paid by cheque or bank transfer (art. 520), so an invoice states it « en cas de règlement en espèces ».
 */
export function cashReceiptStamp(amount: number): number {
  const a = Math.round(amount);
  if (a < 1000) return 0;
  if (a <= 5000) return 30;
  if (a <= 10000) return 50;
  if (a <= 50000) return 100;
  return 100 + 50 * Math.ceil((a - 50000) / 50000);
}
