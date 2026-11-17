// The rendered credit note PDF (PRO-168): an amount-only note of 10 000 TTC
// with VAT prints 10 000, in figures and in words, not 10 001 (HT 8 475 alone
// would give VAT 1 526). The texts are read from the PDF's layout, as laid
// out on the page.
import { describe, expect, it, vi } from 'vitest';

const printed = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock('@/lib/render-pdf', async () => {
  const [{ cloneElement }, { renderToBuffer }, { InvoicePDFDocument }] = await Promise.all([import('react'), import('@react-pdf/renderer'), import('@/components/InvoicePDF')]);
  type Node = { lines?: { string?: string }[]; children?: Node[] };
  const collect = (n: Node | undefined, out: string[]) => {
    for (const l of n?.lines ?? []) if (l.string) out.push(l.string.replace(/[\s\u00a0\u202f]+/g, ' ').trim());
    for (const c of n?.children ?? []) collect(c, out);
  };
  return {
    renderInvoicePdf: async (props: Parameters<typeof InvoicePDFDocument>[0]) => {
      // The <Document> the component returns, told to hand back its layout
      const doc = InvoicePDFDocument(props) as Parameters<typeof cloneElement>[0];
      const onRender = (d: { _INTERNAL__LAYOUT__DATA_?: Node }) => { printed.texts = []; collect(d._INTERNAL__LAYOUT__DATA_, printed.texts); };
      const buf = await renderToBuffer(cloneElement(doc, { onRender } as never) as Parameters<typeof renderToBuffer>[0]);
      return new Blob([new Uint8Array(buf)]);
    },
  };
});

import { registerPdfFonts } from '@/lib/pdf-fonts';
import { renderCreditNotePdf } from '@/lib/credit-note-pdf';
import type { CreditNote, Invoice } from '@/lib/schemas';

const mod = (path: string) => decodeURIComponent(new URL(`../../../node_modules/${path}`, import.meta.url).pathname);
const file = (pkg: string, w: number, style = 'normal') => mod(`@fontsource/${pkg}/files/${pkg}-latin-${w}-${style}.woff`);
registerPdfFonts({
  Jakarta: [file('plus-jakarta-sans', 400), file('plus-jakarta-sans', 700), file('plus-jakarta-sans', 400, 'italic'), file('plus-jakarta-sans', 700, 'italic')],
  Grotesk: [file('space-grotesk', 400), file('space-grotesk', 700)],
  Lora:    [file('lora', 400), file('lora', 700), file('lora', 400, 'italic'), file('lora', 700, 'italic')],
  Plex:    [mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff'), mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Bold.woff'),
            mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Italic.woff'), mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-BoldItalic.woff')],
});

describe('credit note PDF', () => {
  it('prints the stored 10 000 TTC of an amount-only note, in figures and in words', async () => {
    const invoice: Invoice = { id: 'F-1', number: 'FACT-2026-0001', subject: 'Audit', client: 'TK', issued: '2026-11-10', due: '2026-11-24', amount: 118_000, status: 'pending', discountPct: 0 };
    const cn: CreditNote = { id: 'AV-1', invoiceId: 'F-1', subject: 'Avoir sur FACT-2026-0001', client: 'TK', issued: '2026-11-20', amount: 10_000, reason: 'Erreur de prix', status: 'issued', nature: 'COR', lines: [], discountPct: 0, number: 'AV-2026-0001' };
    const blob = await renderCreditNotePdf({
      creditNote: cn, invoice, chargedVat: true,
      client: { name: 'TechKonsult', city: 'Ouagadougou' },
      biz: { name: 'Studio Wend', country: 'Burkina Faso', taxRegime: 'RNI' } as never,
      template: undefined,
    });
    expect(blob.size).toBeGreaterThan(1000);
    const t = printed.texts;
    // The total as printed, next to its label
    expect(t[t.indexOf('Total de l’avoir') + 1]).toBe('10 000 F CFA');
    // HT and VAT add up to it
    expect(t[t.indexOf('Sous-total HT') + 1]).toBe('8 475 F CFA');
    expect(t[t.indexOf('TVA (18 %)') + 1]).toBe('1 525 F CFA');
    // In words
    expect(t).toContain('Arrêté le présent avoir à la somme de dix mille francs CFA.');
    expect(t.join(' ')).not.toMatch(/10 001|dix mille un/);
    // DGI annex: the nature's printed mention, and the original invoice
    expect(t.join(' ')).toContain('COR · Correction');
    expect(t.join(' ')).toContain('FACT-2026-0001 du');
  }, 30000);

  it('prints the DGI mention of each nature, and « RRR » as the original reference of a discount (PRO-143)', async () => {
    const invoice: Invoice = { id: 'F-1', number: 'FACT-2026-0001', subject: 'Audit', client: 'TK', issued: '2026-11-10', due: '2026-11-24', amount: 118_000, status: 'pending', discountPct: 0 };
    const render = (nature: CreditNote['nature']) => renderCreditNotePdf({
      creditNote: { id: 'AV-2', invoiceId: 'F-1', subject: 'Remise', client: 'TK', issued: '2026-11-20', amount: 5_000, reason: 'Geste commercial', status: 'issued', nature, lines: [], discountPct: 0, number: 'AV-2026-0002' },
      invoice, chargedVat: false, client: { name: 'TechKonsult', city: 'Ouagadougou' },
      biz: { name: 'Studio Wend', country: 'Burkina Faso', taxRegime: 'RNI' } as never, template: undefined,
    }).then(() => printed.texts.join(' '));
    const ram = await render('RAM');
    expect(ram).toContain('RAM · Avoir suite reprise');
    const rrr = await render('RRR');
    expect(rrr).toMatch(/Facture d’origine RRR/);
    expect(rrr).not.toContain('FACT-2026-0001 du');
    // the balance is still reduced on the invoice it was given against
    expect(rrr).toContain('FACT-2026-0001');
  }, 60000);
});
