// The cash stamp mention on the invoice PDF (PRO-142, mention s of the DGI spec): the receipt stamp due if the
// invoice is paid in cash, by the CGI's scale (art. 519). The texts are read from the PDF's layout.
import { describe, expect, it } from 'vitest';
import { cloneElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { InvoicePDFDocument } from '@/components/InvoicePDF';
import { registerPdfFonts } from '@/lib/pdf-fonts';
import type { Invoice } from '@/lib/schemas';

const mod = (path: string) => decodeURIComponent(new URL(`../../../node_modules/${path}`, import.meta.url).pathname);
const file = (pkg: string, w: number, style = 'normal') => mod(`@fontsource/${pkg}/files/${pkg}-latin-${w}-${style}.woff`);
registerPdfFonts({
  Jakarta: [file('plus-jakarta-sans', 400), file('plus-jakarta-sans', 700), file('plus-jakarta-sans', 400, 'italic'), file('plus-jakarta-sans', 700, 'italic')],
  Grotesk: [file('space-grotesk', 400), file('space-grotesk', 700)],
  Lora:    [file('lora', 400), file('lora', 700), file('lora', 400, 'italic'), file('lora', 700, 'italic')],
  Plex:    [mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Regular.woff'), mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Bold.woff'),
            mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-Italic.woff'), mod('@ibm/plex-mono/fonts/complete/woff/IBMPlexMono-BoldItalic.woff')],
});

type Node = { lines?: { string?: string }[]; children?: Node[] };
const collect = (n: Node | undefined, out: string[]) => {
  for (const l of n?.lines ?? []) if (l.string) out.push(l.string.replace(/[\s  ]+/g, ' ').trim());
  for (const c of n?.children ?? []) collect(c, out);
};

async function printedTexts(props: Parameters<typeof InvoicePDFDocument>[0]): Promise<string[]> {
  let texts: string[] = [];
  const doc = InvoicePDFDocument(props) as Parameters<typeof cloneElement>[0];
  const onRender = (d: { _INTERNAL__LAYOUT__DATA_?: Node }) => { texts = []; collect(d._INTERNAL__LAYOUT__DATA_, texts); };
  await renderToBuffer(cloneElement(doc, { onRender } as never) as Parameters<typeof renderToBuffer>[0]);
  return texts;
}

const invoice: Invoice = { id: 'F-1', number: 'FACT-2026-0001', subject: 'Audit', client: 'TK', issued: '2026-11-10', due: '2026-11-24', amount: 118_000, status: 'pending', discountPct: 0 };
const base = {
  invoice,
  lines: [{ id: 'l1', desc: 'Audit', unit: 'forfait', qty: 1, price: 100_000 }],
  client: { name: 'TechKonsult', city: 'Ouagadougou' },
  biz: { name: 'Studio Wend', country: 'Burkina Faso', taxRegime: 'RNI' } as never,
  paymentMethods: [{ label: 'Orange Money', value: '70 00 00 00' }],
};

describe('cash stamp mention on the PDF (PRO-142, CGI art. 519)', () => {
  it('a Burkina Faso invoice of 118 000 F states the 200 F stamp due if paid in cash', async () => {
    const text = (await printedTexts(base)).join(' ');
    expect(text).toContain('Montant timbre quittance en cas de règlement en espèces : 200 F CFA.');
    expect(text).toContain('Arrêtée la présente facture');
  }, 30000);

  it('none outside Burkina Faso, nor on a quote', async () => {
    expect((await printedTexts({ ...base, biz: { name: 'X', country: 'Sénégal' } as never })).join(' ')).not.toContain('timbre quittance');
    expect((await printedTexts({ ...base, documentKind: 'devis', title: 'Devis' } as never)).join(' ')).not.toContain('timbre quittance');
  }, 30000);
});
