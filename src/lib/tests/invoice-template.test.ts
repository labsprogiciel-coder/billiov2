import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { DEFAULT_CONFIG, FONT_FAMILIES, PRESETS, accentDark, accentTint, mixHex, normalizeConfig, pdfFont } from '@/lib/invoice-template';
import { registerPdfFonts } from '@/lib/pdf-fonts';
import { qrMatrix, qrRuns } from '@/lib/certification';
import { InvoicePDFDocument, type InvoicePDFProps } from '@/components/InvoicePDF';

describe('normalizeConfig', () => {
  it('keeps a valid config as is', () => {
    for (const p of PRESETS) expect(normalizeConfig(p.config)).toEqual(p.config);
  });

  it('falls back to the default for missing or malformed values', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig('nope')).toEqual(DEFAULT_CONFIG);
    const c = normalizeConfig({ layout: 'poster', color: 'red', fontFamily: 'Comic Sans', density: 7, showSignature: 'yes', footer: 42 });
    expect(c).toEqual(DEFAULT_CONFIG);
  });

  it('keeps known values and caps the footer', () => {
    const c = normalizeConfig({ layout: 'sidebar', color: '#5B2D8E', fontFamily: FONT_FAMILIES.lora, footer: 'x'.repeat(500) });
    expect(c.layout).toBe('sidebar');
    expect(c.color).toBe('#5B2D8E');
    expect(pdfFont(c.fontFamily)).toBe('Lora');
    expect(c.footer).toHaveLength(200);
  });
});

describe('accent colours', () => {
  it('mixes like CSS color-mix', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(accentTint('#185FA5')).toBe('#e6edf5');
    expect(accentDark('#185FA5')).toBe('#12467a');
  });
});

describe('QR code', () => {
  it('encodes text as a square matrix with finder patterns', () => {
    const m = qrMatrix('https://example.invalid/verify?c=TX-1');
    expect(m.size).toBeGreaterThanOrEqual(21);
    // Top-left finder pattern: dark border, light ring, dark centre
    expect(m.dark(0, 0)).toBe(true);
    expect(m.dark(6, 6)).toBe(true);
    expect(m.dark(1, 1)).toBe(false);
    expect(m.dark(3, 3)).toBe(true);
  });

  it('draws exactly the dark modules as runs', () => {
    const m = qrMatrix('SECEF-BF-000123');
    const runs = qrRuns(m);
    let dark = 0;
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.dark(x, y)) dark++;
    expect(runs.reduce((n, r) => n + r.w, 0)).toBe(dark);
    expect(runs.every(r => r.w > 0 && r.x + r.w <= m.size)).toBe(true);
  });
});

describe('invoice PDF', () => {
  // The app loads the fonts by URL; under Node they are read from disk
  const mod = (path: string) => decodeURIComponent(new URL(`../../../node_modules/${path}`, import.meta.url).pathname);
  const file = (pkg: string, w: number) => mod(`@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff`);
  registerPdfFonts({
    Jakarta: [file('plus-jakarta-sans', 400), file('plus-jakarta-sans', 700)],
    Grotesk: [file('space-grotesk', 400), file('space-grotesk', 700)],
    Lora:    [file('lora', 400), file('lora', 700)],
    Plex:    [mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff'),
              mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Bold.woff')],
  });

  const props: InvoicePDFProps = {
    invoice: { id: 'BR-1A2B3C4D5E6F7A8B', number: 'FACT-2026-0012', subject: 'Audit', client: 'TK', issued: '2026-11-10', due: '2026-11-24', amount: 118000, status: 'pending', discountPct: 0, firstIssuedAt: '2026-11-10T09:30:00Z', issuedByName: 'Awa Ouédraogo' },
    lines: Array.from({ length: 40 }, (_, i) => ({ id: String(i), desc: `Prestation ${i + 1}`, unit: 'u', qty: 1, price: 2950 })),
    client: { name: 'TechKonsult', city: 'Ouagadougou', ifu: '00067890C', rccm: 'BF-OUA-2020-B-5678' },
    biz: { name: 'Studio Wend', address: 'Av. Kwame Nkrumah', city: 'Ouagadougou', country: 'Burkina Faso', email: 'a@b.bf', phone: '70', ifu: '00012345B', rccm: 'BF-OUA-2021-B-1234', taxRegime: 'RNI', divisionFiscale: 'DME Centre', cadastralRef: '01234567890' },
    paymentMethods: [{ label: 'Virement bancaire', value: 'BF00 0000' }],
  };

  // Every preset (each layout, font, table and total style) renders, over several pages
  it.each(PRESETS.map(p => [p.key, p.config] as const))('renders the %s template', async (_key, template) => {
    const buf = await renderToBuffer(createElement(InvoicePDFDocument, { ...props, template }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5000);
  }, 30000);

  // A certified invoice prints its SECeF block in every layout
  it.each(PRESETS.map(p => [p.key, p.config] as const))('prints the SECeF block in the %s template', async (_key, template) => {
    const certification = { secefId: 'SECEF-BF-000123', transactionCode: 'TX-9F2A-77C1', qrPayload: 'https://example.invalid/verify?c=TX-9F2A-77C1', certifiedAt: '2026-11-10T09:30:00Z' };
    const buf = await renderToBuffer(createElement(InvoicePDFDocument, { ...props, lines: props.lines.slice(0, 3), template, certification }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const plain = await renderToBuffer(createElement(InvoicePDFDocument, { ...props, lines: props.lines.slice(0, 3), template }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.length).toBeGreaterThan(plain.length);
  }, 30000);
});
