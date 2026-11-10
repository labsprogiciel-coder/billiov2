import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { DEFAULT_CONFIG, FONT_FAMILIES, PRESETS, accentDark, accentTint, mixHex, normalizeConfig, pdfFont } from '@/lib/invoice-template';
import { registerPdfFonts } from '@/lib/pdf-fonts';
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
    invoice: { id: 'FACT-12-26', subject: 'Audit', client: 'TK', issued: '2026-11-10', due: '2026-11-24', amount: 118000, status: 'pending', discountPct: 0 },
    lines: Array.from({ length: 40 }, (_, i) => ({ id: String(i), desc: `Prestation ${i + 1}`, unit: 'u', qty: 1, price: 2950 })),
    client: { name: 'TechKonsult', city: 'Ouagadougou', ifu: '00067890C', rccm: 'BF-OUA-2020-B-5678' },
    biz: { name: 'Studio Wend', address: 'Av. Kwame Nkrumah', city: 'Ouagadougou', country: 'Burkina Faso', email: 'a@b.bf', phone: '70', ifu: '00012345B', rccm: 'BF-OUA-2021-B-1234', taxRegime: 'RNI', divisionFiscale: 'DME Centre' },
    paymentMethods: [{ label: 'Virement bancaire', value: 'BF00 0000' }],
  };

  // Every preset (each layout, font, table and total style) renders, over several pages
  it.each(PRESETS.map(p => [p.key, p.config] as const))('renders the %s template', async (_key, template) => {
    const buf = await renderToBuffer(createElement(InvoicePDFDocument, { ...props, template }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5000);
  }, 30000);
});
