// Invoice templates: the built-in presets, the shape saved in
// invoice_templates.config, and how a template maps onto the PDF.
//
// The Modèles page previews a template with InvoicePaper; the PDF is drawn by
// InvoicePDF from the same PaperConfig, so both read this file.

import type { PaperConfig, PaperLayout, PaperDensity, TableStyle, TotalStyle } from '@/components/InvoicePaper';

export const LAYOUTS: readonly PaperLayout[] = ['classic', 'band', 'minimal', 'sidebar', 'receipt'];
const DENSITIES: readonly PaperDensity[] = ['compact', 'cozy', 'spacious'];
const TABLE_STYLES: readonly TableStyle[] = ['plain', 'tinted', 'band-h'];
const TOTAL_STYLES: readonly TotalStyle[] = ['plain', 'filled', 'ruled'];

export const FONT_FAMILIES = {
  jakarta: '"Plus Jakarta Sans", sans-serif',
  grotesk: '"Space Grotesk", sans-serif',
  lora:    '"Lora", Georgia, serif',
  plex:    '"IBM Plex Mono", "Courier New", monospace',
} as const;

export const DEFAULT_CONFIG: PaperConfig = {
  layout: 'classic', color: '#185FA5',
  fontFamily: FONT_FAMILIES.jakarta,
  density: 'cozy', tableStyle: 'tinted', totalStyle: 'filled',
  showQty: true, showTax: true, showDiscount: false,
  showSignature: false, showPayment: true, footer: '',
};

export interface TemplatePreset {
  key:     string;
  name:    string;
  purpose: string;
  chips:   string[];
  config:  PaperConfig;
}

export const PRESETS: readonly TemplatePreset[] = [
  {
    key: 'classic-blue', name: 'Classique Billio', purpose: 'Facture standard tout usage',
    chips: ['Classique', 'Tout usage'],
    config: { ...DEFAULT_CONFIG, layout: 'classic', color: '#185FA5', tableStyle: 'tinted', totalStyle: 'filled' },
  },
  {
    key: 'band-green', name: 'Bandeau Vert', purpose: 'En-tête coloré percutant',
    chips: ['Bandeau', 'Moderne'],
    config: { ...DEFAULT_CONFIG, layout: 'band', color: '#1A7A47', fontFamily: FONT_FAMILIES.grotesk, tableStyle: 'band-h', totalStyle: 'ruled', showSignature: true },
  },
  {
    key: 'minimal-serif', name: 'Minimal Serif', purpose: 'Épuré, idéal pour agences créatives',
    chips: ['Minimal', 'Serif'],
    config: { ...DEFAULT_CONFIG, layout: 'minimal', color: '#334155', fontFamily: FONT_FAMILIES.lora, density: 'spacious', tableStyle: 'plain', totalStyle: 'ruled' },
  },
  {
    key: 'sidebar-violet', name: 'Colonne Violette', purpose: 'Mise en page en deux colonnes',
    chips: ['Colonne', 'Élégant'],
    config: { ...DEFAULT_CONFIG, layout: 'sidebar', color: '#5B2D8E', tableStyle: 'tinted', totalStyle: 'plain' },
  },
  {
    key: 'receipt-teal', name: 'Reçu Teal', purpose: 'Format reçu compact pour petites transactions',
    chips: ['Reçu', 'Compact'],
    config: { ...DEFAULT_CONFIG, layout: 'receipt', color: '#0D7B7B', fontFamily: FONT_FAMILIES.plex, density: 'compact', tableStyle: 'plain', totalStyle: 'plain' },
  },
  {
    key: 'band-orange', name: 'Orange Moderne', purpose: 'Bandeau audacieux pour prestataires',
    chips: ['Bandeau', 'Audacieux'],
    config: { ...DEFAULT_CONFIG, layout: 'band', color: '#C4540A', fontFamily: FONT_FAMILIES.grotesk, tableStyle: 'band-h', totalStyle: 'filled' },
  },
];

const pick = <T extends string>(allowed: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/**
 * A PaperConfig from whatever is stored in invoice_templates.config. Unknown
 * or malformed values fall back to the default, so an old or hand-edited row
 * can never break PDF generation.
 */
export function normalizeConfig(raw: unknown): PaperConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  const fonts = Object.values(FONT_FAMILIES) as string[];
  return {
    layout:        pick(LAYOUTS, r.layout, d.layout),
    color:         typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : d.color,
    fontFamily:    typeof r.fontFamily === 'string' && fonts.includes(r.fontFamily) ? r.fontFamily : d.fontFamily,
    density:       pick(DENSITIES, r.density, d.density),
    tableStyle:    pick(TABLE_STYLES, r.tableStyle, d.tableStyle),
    totalStyle:    pick(TOTAL_STYLES, r.totalStyle, d.totalStyle),
    showQty:       bool(r.showQty, d.showQty),
    showTax:       bool(r.showTax, d.showTax),
    showDiscount:  bool(r.showDiscount, d.showDiscount),
    showSignature: bool(r.showSignature, d.showSignature),
    showPayment:   bool(r.showPayment, d.showPayment),
    footer:        typeof r.footer === 'string' ? r.footer.slice(0, 200) : d.footer,
  };
}

/** Font registered for the PDF (see InvoicePDF), keyed by the CSS family. */
export type PdfFont = 'Jakarta' | 'Grotesk' | 'Lora' | 'Plex';
export function pdfFont(fontFamily: string): PdfFont {
  switch (fontFamily) {
    case FONT_FAMILIES.grotesk: return 'Grotesk';
    case FONT_FAMILIES.lora:    return 'Lora';
    case FONT_FAMILIES.plex:    return 'Plex';
    default:                    return 'Jakarta';
  }
}

/** Spacing multiplier for the PDF, matching the preview's density. */
export function densityScale(d: PaperDensity): number {
  return d === 'compact' ? 0.8 : d === 'spacious' ? 1.25 : 1;
}

/** `hex` mixed with `other` (both #rrggbb); weight is the share of `hex`, like CSS color-mix. */
export function mixHex(hex: string, other: string, weight: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map(i => Math.round(ch(hex, i) * weight + ch(other, i) * (1 - weight)));
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
}
/** The preview's --acc-tint and --acc-dark (src/index.css). */
export const accentTint = (hex: string) => mixHex(hex, '#ffffff', 0.11);
export const accentDark = (hex: string) => mixHex(hex, '#000000', 0.74);
