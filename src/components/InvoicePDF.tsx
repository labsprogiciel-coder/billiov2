import { invoiceRef } from '@/lib/invoice-number';
import { duplicateMention } from '@/lib/invoice-copy';
import { documentTaxes } from '@/lib/document-amounts';
import { taxSummary, vatRows } from '@/lib/tax-groups';
import { cashStampMention, invoiceTotalMention } from '@/lib/amount-in-words';
import { cadastralRequired, formatCadastralRef } from '@/lib/cadastral';
import type { ReactNode } from 'react';
import { Document, Page, View, Text, Link, StyleSheet, Svg, Rect } from '@react-pdf/renderer';
import { cleanRichText, type RichBlock, type RichDoc, type RichInline, type RichMark, type TextAlign } from '@/lib/rich-text';
import { calculateServiceWithholding, SERVICE_WITHHOLDING_RATE_LABEL } from '@/lib/tax-bf';
import { clientTypeDef, clientTypeOf } from '@/lib/client-type';
import { getFiscalIdLabel } from '@/lib/ohada';
import type { Invoice, LineItem, ServiceWithholdingScenario } from '@/lib/schemas';
import type { BizInfo, PaperConfig } from '@/components/InvoicePaper';
import type { PaymentMethodLine } from '@/lib/payment-methods';
import { chargesVat, documentHasVat } from '@/lib/vat';
import { DEFAULT_CONFIG, accentDark, accentTint, densityScale, normalizeConfig, paperBands, paymentQrTarget, pdfFont } from '@/lib/invoice-template';
import { registerPdfFonts } from '@/lib/pdf-fonts';
import { qrMatrix, qrRuns, type InvoiceCertification } from '@/lib/certification';

/** A react-pdf style (the package doesn't export the type itself). */
type Style = ReturnType<typeof StyleSheet.create>[string];

// Notes and conditions (PRO-167): the editor's rich text, drawn with the same
// formats the screen allows (bold, italic, underline, strike, links, lists, alignment)
function pdfMarkStyle(marks: RichMark[] | undefined) {
  const has = (t: RichMark['type']) => marks?.some(m => m.type === t) ?? false;
  const deco = [has('underline') && 'underline', has('strike') && 'line-through'].filter(Boolean).join(' ');
  return {
    ...(has('bold') ? { fontWeight: 700 as const } : {}),
    ...(has('italic') ? { fontStyle: 'italic' as const } : {}),
    ...(deco ? { textDecoration: deco as 'underline' } : {}),
  };
}

function pdfInline(content: RichInline[] | undefined, linkColor: string): ReactNode[] {
  return (content ?? []).map((n, i) => {
    if (n.type === 'hardBreak') return '\n';
    const link = n.marks?.find(m => m.type === 'link');
    const text = <Text key={i} style={pdfMarkStyle(n.marks)}>{n.text}</Text>;
    return link && link.type === 'link'
      ? <Link key={i} src={link.attrs.href} style={{ color: linkColor }}>{text}</Link>
      : text;
  });
}

function PdfRichBlocks({ blocks, style, linkColor }: { blocks: RichBlock[]; style: Style; linkColor: string }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'bulletList' || b.type === 'orderedList') {
          return (
            <View key={i}>
              {b.content.map((item, j) => (
                <View key={j} style={{ flexDirection: 'row' }}>
                  <Text style={[style, { width: 10 }]}>{b.type === 'orderedList' ? `${j + 1}.` : '•'}</Text>
                  <View style={{ flex: 1 }}><PdfRichBlocks blocks={item.content} style={style} linkColor={linkColor} /></View>
                </View>
              ))}
            </View>
          );
        }
        const textBlock = b as { attrs?: { textAlign?: TextAlign }; content?: RichInline[] };
        const align = textBlock.attrs?.textAlign ? { textAlign: textBlock.attrs.textAlign } : {};
        const heading = b.type === 'heading' ? { fontWeight: 700 as const, fontSize: 9.5 } : {};
        return <Text key={i} style={[style, align, heading]}>{pdfInline(textBlock.content, linkColor)}</Text>;
      })}
    </>
  );
}

export function PdfRichText({ doc, style, linkColor = '#1F5FBF' }: { doc: RichDoc; style: Style; linkColor?: string }) {
  return <View><PdfRichBlocks blocks={doc.content} style={style} linkColor={linkColor} /></View>;
}

// toLocaleString is unreliable in the react-pdf renderer environment
const pdfFmt = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const pdfFmtDate = (iso: string): string => {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return iso;
  }
};

type ClientInfo = {
  name: string;
  city: string;
  country?: string;
  contact?: string;
  email?: string;
  phone?: string;
  ifu?: string;
  rccm?: string;
  taxRegime?: string;
  fiscalDivision?: string;
  withholdingScenario?: string;
  /** DGI client type (CC / PM / PP / PC), printed under the name */
  clientType?: string;
};

export interface InvoicePDFProps {
  invoice: Invoice;
  lines: LineItem[];
  client: ClientInfo;
  biz: BizInfo;
  /** The organisation's invoice template (Modèles); the standard one when omitted. */
  template?: PaperConfig;
  title?: string;
  /** Which wording the total in words uses; from the title when omitted */
  documentKind?: 'facture' | 'devis' | 'avoir';
  /**
   * A credit note (« FACTURE D'AVOIR », PRO-168): its nature, the invoice it
   * credits and its reason replace the due date, terms and payment methods.
   * `invoice` then carries the credit note (number, dates, issuer, lines' discount).
   */
  creditNote?: {
    nature: string; originalRef: string; originalIssued: string; reason: string;
    /** The invoice whose balance it reduces, when the original reference is not that invoice (RRR) */
    creditedRef?: string;
    /** The stored total: printed as is, the rounding left in the discount or the VAT */
    storedTotal?: number;
  };
  clientLabel?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  /** From the organisation's payment settings; see paymentMethodLines(). */
  paymentMethods?: PaymentMethodLine[];
  /** SECeF elements of a certified invoice (PRO-137); printed in a fixed area of every layout. */
  certification?: InvoiceCertification;
  /**
   * The invoice's payment page, for the « Scanner pour payer » QR code; it
   * shows what is left to pay when scanned. See paymentQrTarget: none is
   * printed without one (PRO-187).
   */
  paymentUrl?: string | null;
  /**
   * A copy of an issued invoice (PRO-144): « DUPLICATA » across every page and under the title,
   * with the original's number and date. The original is the first PDF of the issued invoice.
   */
  duplicate?: boolean;
}

// Page frame in points (1 mm ≈ 2.83 pt). 15 mm sides; content starts 18 mm down
// so the header of later pages (10 mm from the top) never meets it; 24 mm kept
// at the bottom for the footer, whose text sits about 10.5 mm above the edge,
// clear of the strip many office printers can't reach.
const PAD = 42;
const PAGE_TOP = 50;
const PAGE_BOTTOM = 68;
const HEADER_TOP = 28;
const FOOTER_BOTTOM = 30;
const SIDEBAR_W = 150;
const RECEIPT_W = 300;
const A4_W = 595.28;

const RATE_LABEL: Record<string, string> = SERVICE_WITHHOLDING_RATE_LABEL;

/**
 * Template choices change only how the invoice looks: layout, colour, font,
 * spacing and table/total styles. Every layout prints the same content, so
 * no template can drop a mention the invoice needs (seller and client IDs,
 * quantities, VAT, payment details). The preview's quantity, VAT and
 * payment-block toggles don't apply to the PDF.
 */
function makeStyles(t: PaperConfig) {
  const acc = t.color;
  const dark = accentDark(acc);
  const tint = accentTint(acc);
  const k = densityScale(t.density);
  const font = pdfFont(t.fontFamily);
  const sp = (n: number) => Math.round(n * k * 10) / 10;
  const isSidebar = t.layout === 'sidebar';
  const isReceipt = t.layout === 'receipt';
  const left  = isSidebar ? SIDEBAR_W + 28 : isReceipt ? (A4_W - RECEIPT_W) / 2 : PAD;
  const right = isReceipt ? (A4_W - RECEIPT_W) / 2 : PAD;
  const bold = { fontWeight: 700 as const };

  const tableHead = t.tableStyle === 'band-h'
    ? { backgroundColor: acc, borderRadius: 3 }
    : t.tableStyle === 'tinted'
      ? { backgroundColor: tint, borderRadius: 3 }
      : { borderBottomWidth: 1.5, borderBottomColor: '#1C2733' };
  const thColor = t.tableStyle === 'band-h' ? '#ffffff' : t.tableStyle === 'tinted' ? dark : '#555555';

  const grand = t.totalStyle === 'filled'
    ? { backgroundColor: tint, borderRadius: 4, paddingHorizontal: 8 }
    : t.totalStyle === 'ruled'
      ? { borderTopWidth: 2, borderTopColor: '#1C2733' }
      : { borderTopWidth: 1, borderTopColor: '#e5e7eb' };
  const grandColor = t.totalStyle === 'filled' ? dark : '#1a1a1a';

  const band = paperBands(t);
  return {
    left, right, acc, dark, tint, band,
    s: StyleSheet.create({
      page: {
        fontFamily: font, fontSize: 9, color: '#1a1a1a', backgroundColor: '#ffffff',
        paddingLeft: left, paddingRight: right, paddingTop: PAGE_TOP, paddingBottom: PAGE_BOTTOM,
      },
      // Header (classic)
      header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: sp(20) },
      bizName: { fontSize: 14, ...bold, marginBottom: 4, color: acc },
      bizMeta: { fontSize: 8, color: '#555', lineHeight: 1.5 },
      docTitle: { fontSize: 24, ...bold, textAlign: 'right', color: acc },
      docNum: { fontSize: 11, textAlign: 'right', color: '#444', marginTop: 2 },
      strip: {
        flexDirection: 'row', justifyContent: 'space-between', backgroundColor: tint, borderRadius: 4,
        paddingVertical: sp(6), paddingHorizontal: 10, marginBottom: sp(18),
      },
      stripText: { fontSize: 7.5, ...bold, color: dark, textTransform: 'uppercase', letterSpacing: 0.5 },
      // Band
      band: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        marginLeft: -left, marginRight: -right, marginTop: -PAGE_TOP, paddingHorizontal: PAD, paddingTop: sp(24) + 10, paddingBottom: sp(24),
        backgroundColor: acc, marginBottom: sp(20),
      },
      bandName: { fontSize: 15, ...bold, color: '#ffffff' },
      bandMeta: { fontSize: 8, color: '#ffffff', opacity: 0.85, marginTop: 2, lineHeight: 1.5, maxWidth: 330 },
      bandTitle: { fontSize: 22, ...bold, color: '#ffffff', textAlign: 'right', letterSpacing: 2, textTransform: 'uppercase' },
      bandNum: { fontSize: 10.5, color: '#ffffff', opacity: 0.85, textAlign: 'right', marginTop: 2 },
      // Minimal
      minTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
      minTitle: { fontSize: 22, ...bold, color: acc, letterSpacing: 3, textTransform: 'uppercase' },
      minNum: { fontSize: 10, color: '#555' },
      minRule: { height: 1, backgroundColor: '#1C2733', marginTop: sp(12), marginBottom: sp(18) },
      // Sidebar
      aside: { position: 'absolute', top: 0, left: 0, bottom: 0, width: SIDEBAR_W, backgroundColor: acc, paddingHorizontal: 16, paddingTop: 40 },
      asideName: { fontSize: 13, ...bold, color: '#ffffff' },
      asideMeta: { fontSize: 7.5, color: '#ffffff', opacity: 0.85, lineHeight: 1.6, marginTop: 6 },
      asideSep: { height: 1, backgroundColor: '#ffffff', opacity: 0.25, marginVertical: 16 },
      asideLabel: { fontSize: 7, ...bold, color: '#ffffff', opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
      asideTotal: { fontSize: 15, ...bold, color: '#ffffff' },
      asideDue: { fontSize: 7.5, color: '#ffffff', opacity: 0.85, marginTop: 3 },
      // Receipt
      rcptHead: { alignItems: 'center', marginBottom: sp(10) },
      rcptName: { fontSize: 13, ...bold, color: acc, textAlign: 'center' },
      rcptMeta: { fontSize: 7.5, color: '#555', textAlign: 'center', lineHeight: 1.5, marginTop: 3 },
      rcptRule: { borderBottomWidth: 1, borderBottomColor: '#1C2733', marginVertical: sp(8) },
      rcptDash: { borderBottomWidth: 1, borderBottomColor: '#9aa3ad', borderStyle: 'dashed', marginVertical: sp(8) },
      rcptRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
      rcptItem: { marginBottom: sp(5) },
      // Shared blocks
      divider: { borderBottomWidth: 1, borderBottomColor: '#e5e7eb', marginBottom: sp(16) },
      parties: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: sp(18) },
      partiesLeft: { flex: 1, paddingRight: 16 },
      partiesRight: { width: isSidebar ? 170 : 210 },
      blockLabel: { fontSize: 7, ...bold, color: '#666', letterSpacing: 0.5, marginBottom: 5, textTransform: 'uppercase' },
      clientName: { fontSize: 11, ...bold, marginBottom: 2 },
      smallText: { fontSize: 8, color: '#555', lineHeight: 1.4 },
      metaRow: { flexDirection: 'row', marginBottom: 2 },
      metaKey: { fontSize: 8, color: '#666', width: 62 },
      metaVal: { fontSize: 8, color: '#1a1a1a', flex: 1 },
      subjectRow: { flexDirection: 'row', marginBottom: sp(10) },
      tableHead: { flexDirection: 'row', paddingVertical: sp(6), paddingHorizontal: 8, marginBottom: 2, ...tableHead },
      tableRow: { flexDirection: 'row', paddingVertical: sp(6), paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
      thDesc: { flex: 1, fontSize: 7, ...bold, color: thColor, textTransform: 'uppercase', letterSpacing: 0.4 },
      thRight: { width: isSidebar ? 52 : 64, fontSize: 7, ...bold, color: thColor, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 0.4 },
      tdDesc: { flex: 1, fontSize: 8.5 },
      tdRight: { width: isSidebar ? 52 : 64, fontSize: 8.5, textAlign: 'right', color: '#333' },
      totals: { alignItems: isReceipt ? 'stretch' : 'flex-end', marginTop: 4, marginBottom: sp(18) },
      totInner: { width: isReceipt ? '100%' : 220 },
      totRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp(3), borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
      totLabel: { fontSize: 8.5, color: '#666', flex: 1, paddingRight: 6 },
      totVal: { fontSize: 8.5, color: '#1a1a1a' },
      grandRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp(7), marginTop: 4, ...grand },
      grandLabel: { fontSize: 9.5, ...bold, color: grandColor },
      grandVal: { fontSize: 10.5, ...bold, color: grandColor },
      paySection: {
        flexDirection: isReceipt ? 'column' : 'row', gap: isReceipt ? 8 : 16,
        padding: 10, backgroundColor: '#f8fafc', borderRadius: 4, marginBottom: sp(16),
      },
      payCol: isReceipt ? {} : { flex: 1 },
      payMethod: { fontSize: 8, color: '#444', marginBottom: 2 },
      payQr: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: isReceipt ? 'flex-start' : 'center' },
      payQrCaption: { fontSize: 6.5, color: '#666', width: 34, lineHeight: 1.3 },
      notesText: { fontSize: 8, color: '#666', lineHeight: 1.5 },
      totalWords: { fontSize: 8, color: '#444', marginTop: -sp(10), marginBottom: sp(14), textAlign: isReceipt ? 'left' : 'right' },
      certBox: {
        flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, marginBottom: sp(16),
        borderWidth: 1, borderColor: '#1C2733', borderRadius: 4,
      },
      certTitle: { fontSize: 8.5, ...bold, marginBottom: 3 },
      certLine: { fontSize: 8, color: '#1a1a1a', lineHeight: 1.45 },
      sign: { marginTop: sp(18), width: 180, alignSelf: 'flex-end', alignItems: 'center' },
      signLine: { borderTopWidth: 1, borderTopColor: '#B7C0CC', width: '100%', marginBottom: 5 },
      signLabel: { fontSize: 8, color: '#606C7E', ...bold },
      fixedHeader: { position: 'absolute', top: HEADER_TOP, left, right },
      fixedHeaderRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 6,
      },
      fixedHeaderBiz: { fontSize: 7, ...bold, color: '#555' },
      fixedHeaderRef: { fontSize: 7, color: '#666' },
      footer: {
        position: 'absolute', bottom: FOOTER_BOTTOM, left, right,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 6, gap: 8,
      },
      // Bands (Classique, Minimal): the header on the first page and the footer
      // on every page sit in a light tint across the full width
      headBand: {
        marginTop: -PAGE_TOP, marginLeft: -left, marginRight: -right, marginBottom: sp(18),
        paddingTop: 38, paddingBottom: sp(16), paddingLeft: left, paddingRight: right,
        backgroundColor: band ?? '#ffffff', borderBottomWidth: 1, borderBottomColor: '#E2E5EA',
      },
      headerInBand: { marginBottom: sp(14) },
      footBand: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        paddingTop: 10, paddingBottom: FOOTER_BOTTOM, paddingLeft: left, paddingRight: right,
        backgroundColor: band ?? '#ffffff', borderTopWidth: 1, borderTopColor: '#E2E5EA',
      },
      footerSide:   { fontSize: 7, color: '#767676' },
      footerCenter: { fontSize: 7, color: '#767676', flex: 1, textAlign: 'center' },
    }),
  };
}

/** QR code drawn as vector rectangles (scannable at any zoom, a few KB). */
function PdfQr({ text, size }: { text: string; size: number }) {
  const m = qrMatrix(text);
  const quiet = 2;
  const n = m.size + quiet * 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
      <Rect x={0} y={0} width={n} height={n} fill="#ffffff" />
      {qrRuns(m).map(r => <Rect key={`${r.x}-${r.y}`} x={r.x + quiet} y={r.y + quiet} width={r.w} height={1} fill="#000000" />)}
    </Svg>
  );
}

const pdfFmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Burkina Faso time (UTC, no daylight saving), whatever the device's zone
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Ouagadougou' });
};

export function InvoicePDFDocument({
  invoice, lines, client, biz, template, title = 'Facture', documentKind, clientLabel = 'Facturé à',
  paymentTerms = 'Net 14 jours', deliveryTerms = 'À convenir', paymentMethods = [], certification, creditNote, paymentUrl, duplicate = false,
}: InvoicePDFProps) {
  registerPdfFonts();
  const t = normalizeConfig(template ?? DEFAULT_CONFIG);
  const { s, band } = makeStyles(t);
  // Cleaned again here: the PDF only draws the formats it knows
  const notes = cleanRichText(invoice.notes);

  const subtotal      = lines.reduce((sum, li) => sum + li.qty * li.price, 0);
  const discountPct   = invoice.discountPct ?? 0;
  // VAT as issued: the stored total says whether it was charged, so a later
  // change of tax regime doesn't rewrite old invoices
  const withVat       = taxSummary(lines, discountPct, true);
  const showVat       = documentHasVat(invoice.amount, withVat.net, chargesVat(biz.taxRegime), withVat.total);
  const { discountAmt, discountedSub, total, groups } = documentTaxes(lines, discountPct, showVat, creditNote?.storedTotal);
  // Several tax groups: each line says its group, and the totals give the VAT of each (DGI spec, 3 n–q)
  const groupOf = (li: LineItem) => showVat && groups.length > 1 ? ` (${li.taxGroup ?? 'B'})` : '';
  const isPaid = invoice.status === 'paid';

  // A credit note gives back what was invoiced: no withholding of its own
  const svcWithholding = client.withholdingScenario && !creditNote
    ? calculateServiceWithholding(discountedSub, client.withholdingScenario as ServiceWithholdingScenario)
    : null;
  const netAPayer = svcWithholding !== null ? total - svcWithholding : null;
  const amountDue = isPaid ? 0 : (netAPayer ?? total);

  const bizName = biz.name || 'Mon entreprise';
  const bizAddr = [biz.address, biz.city, biz.country].filter(Boolean).join(', ');
  const bizContact = [biz.email, biz.phone].filter(Boolean).join(' · ');
  const bizFiscalLabel    = getFiscalIdLabel(biz.country);
  const clientFiscalLabel = getFiscalIdLabel(client.country);

  const bizCompliance = [
    biz.ifu && `${bizFiscalLabel} ${biz.ifu}`,
    biz.rccm && `RCCM ${biz.rccm}`,
    biz.taxRegime,
    biz.divisionFiscale,
    biz.cadastralRef && `Réf. cadastrale ${formatCadastralRef(biz.cadastralRef)}`,
  ].filter(Boolean).join(' · ');

  const clientCompliance = [
    client.ifu && `${clientFiscalLabel} ${client.ifu}`,
    client.rccm && `RCCM ${client.rccm}`,
    client.taxRegime,
    client.fiscalDivision,
  ].filter(Boolean).join(' · ');

  // ── Shared blocks: every layout prints all of them ──
  const sellerBlock = (
    <>
      <Text style={s.bizName}>{bizName}</Text>
      {bizAddr       ? <Text style={s.bizMeta}>{bizAddr}</Text> : null}
      {bizContact    ? <Text style={s.bizMeta}>{bizContact}</Text> : null}
      {bizCompliance ? <Text style={s.bizMeta}>{bizCompliance}</Text> : null}
    </>
  );

  const clientBlock = (
    <>
      <Text style={s.blockLabel}>{clientLabel}</Text>
      <Text style={s.clientName}>{client.name}</Text>
      <Text style={s.smallText}>{clientTypeDef(clientTypeOf(client)).mention}</Text>
      {client.city    ? <Text style={s.smallText}>{client.city}</Text> : null}
      {client.contact ? <Text style={[s.smallText, { marginTop: 2 }]}>Contact : {client.contact}</Text> : null}
      {client.phone   ? <Text style={s.smallText}>Tél : {client.phone}</Text> : null}
      {client.email   ? <Text style={s.smallText}>Email : {client.email}</Text> : null}
      {clientCompliance ? <Text style={[s.smallText, { marginTop: 2 }]}>{clientCompliance}</Text> : null}
    </>
  );

  const detailsBlock = (
    <>
      <Text style={s.blockLabel}>Détails</Text>
      {(creditNote ? [
        ['Date', pdfFmtDate(invoice.issued)],
        ...(invoice.firstIssuedAt ? [['Émission', pdfFmtDateTime(invoice.firstIssuedAt)] as const] : []),
        ...(invoice.issuedByName ? [['Émis par', invoice.issuedByName] as const] : []),
        ['Nature', creditNote.nature],
        ['Facture d’origine', creditNote.originalRef === 'RRR' ? 'RRR' : `${creditNote.originalRef} du ${pdfFmtDate(creditNote.originalIssued)}`],
      ] as const : [
        ['Émis le', pdfFmtDate(invoice.issued)],
        // DGI mentions w and y: when the invoice was issued, and by whom
        ...(invoice.firstIssuedAt ? [['Émission', pdfFmtDateTime(invoice.firstIssuedAt)] as const] : []),
        ...(invoice.issuedByName ? [['Émise par', invoice.issuedByName] as const] : []),
        ['Échéance', pdfFmtDate(invoice.due)],
        ['Paiement', paymentTerms],
        ['Livraison', deliveryTerms],
      ] as const).map(([k, v]) => (
        <View key={k} style={s.metaRow}>
          <Text style={s.metaKey}>{k}</Text>
          <Text style={s.metaVal}>{v}</Text>
        </View>
      ))}
    </>
  );

  const parties = (
    <View style={s.parties}>
      <View style={s.partiesLeft}>{clientBlock}</View>
      <View style={s.partiesRight}>{detailsBlock}</View>
    </View>
  );

  const subjectText = creditNote ? creditNote.reason : invoice.subject;
  const subject = subjectText ? (
    <View style={s.subjectRow}>
      <Text style={{ fontSize: 9, fontWeight: 700, marginRight: 4 }}>{creditNote ? 'Motif :' : 'Objet :'}</Text>
      <Text style={{ fontSize: 9, color: '#1a1a1a', flex: 1 }}>{subjectText}</Text>
    </View>
  ) : null;

  const table = t.layout === 'receipt' ? (
    <View>
      {lines.length === 0
        ? <Text style={[s.smallText, { color: '#767676' }]}>Aucune ligne</Text>
        : lines.map(li => (
          <View key={li.id} style={s.rcptItem} wrap={false}>
            <View style={s.rcptRow}>
              <Text style={[s.tdDesc, { fontWeight: 700 }]}>{li.desc}{groupOf(li)}</Text>
              <Text style={s.tdRight}>{pdfFmt(li.qty * li.price)}</Text>
            </View>
            <Text style={s.smallText}>Qté {li.qty} × P.U. {pdfFmt(li.price)} F CFA</Text>
          </View>
        ))}
    </View>
  ) : (
    <View>
      <View style={s.tableHead}>
        <Text style={s.thDesc}>Description</Text>
        <Text style={s.thRight}>Qté</Text>
        <Text style={s.thRight}>P.U.</Text>
        <Text style={s.thRight}>Montant</Text>
      </View>
      {lines.length === 0 ? (
        <View style={s.tableRow}>
          <Text style={[s.tdDesc, { color: '#767676' }]}>Aucune ligne</Text>
        </View>
      ) : lines.map(li => (
        <View key={li.id} style={s.tableRow} wrap={false}>
          <Text style={s.tdDesc}>{li.desc}{groupOf(li)}</Text>
          <Text style={s.tdRight}>{li.qty}</Text>
          <Text style={s.tdRight}>{pdfFmt(li.price)}</Text>
          <Text style={s.tdRight}>{pdfFmt(li.qty * li.price)}</Text>
        </View>
      ))}
    </View>
  );

  const totals = (
    <View style={s.totals} wrap={false}>
      <View style={s.totInner}>
        <View style={s.totRow}>
          <Text style={s.totLabel}>Sous-total HT</Text>
          <Text style={s.totVal}>{pdfFmt(subtotal)} F CFA</Text>
        </View>
        {discountPct > 0 && (
          <View style={s.totRow}>
            <Text style={s.totLabel}>Remise ({discountPct}%)</Text>
            <Text style={[s.totVal, { color: '#666' }]}>{'-'}{pdfFmt(discountAmt)} F CFA</Text>
          </View>
        )}
        {showVat && vatRows(groups).map(r => (
          <View key={r.key} style={s.totRow}>
            <Text style={s.totLabel}>{r.label}</Text>
            <Text style={s.totVal}>{pdfFmt(r.amount)} F CFA</Text>
          </View>
        ))}
        {showVat && (
          <View style={s.totRow}>
            <Text style={s.totLabel}>Total TTC</Text>
            <Text style={s.totVal}>{pdfFmt(total)} F CFA</Text>
          </View>
        )}
        {svcWithholding !== null && !isPaid && (
          <View style={s.totRow}>
            <Text style={s.totLabel}>
              {'Retenue à la source ('}{RATE_LABEL[client.withholdingScenario!]}{') — Art.207/212'}
            </Text>
            <Text style={[s.totVal, { color: '#8A5207' }]}>{'−'}{pdfFmt(svcWithholding)} F CFA</Text>
          </View>
        )}
        {isPaid ? (
          <View style={s.totRow}>
            <Text style={s.totLabel}>Montant payé</Text>
            <Text style={[s.totVal, { color: '#1A7A47' }]}>{'−'}{pdfFmt(total)} F CFA</Text>
          </View>
        ) : null}
        <View style={s.grandRow}>
          <Text style={s.grandLabel}>{creditNote ? 'Total de l’avoir' : netAPayer !== null && !isPaid ? 'Net à payer' : 'Total dû'}</Text>
          <Text style={s.grandVal}>{pdfFmt(amountDue)} F CFA</Text>
        </View>
      </View>
    </View>
  );

  const kind = documentKind ?? (creditNote ? 'avoir' : title === 'Devis' ? 'devis' : 'facture');
  // DGI mention t: the total in words, in every layout
  // DGI mention s: the receipt stamp if paid in cash (Burkina Faso, CGI art. 519), on invoices
  const stamp = kind === 'facture' && cadastralRequired(biz.country) ? cashStampMention(total) : null;
  const totalInWords = (
    <>
      <Text style={stamp ? { ...s.totalWords, marginBottom: 2 } : s.totalWords}>{invoiceTotalMention(total, kind)}</Text>
      {stamp && <Text style={s.totalWords}>{stamp}</Text>}
    </>
  );

  // Compact, beside the payment methods: about as tall as three of their lines
  const payQrUrl = paymentQrTarget({ config: t, kind, amountDue, paymentUrl });
  const payQr = payQrUrl ? (
    <View style={s.payQr}>
      <PdfQr text={payQrUrl} size={40} />
      <Text style={s.payQrCaption}>Scanner pour payer</Text>
    </View>
  ) : null;

  // Kept on one page, unless notes make it too long for one: then it may continue
  const payment = creditNote ? (
    <View style={s.paySection} wrap={false}>
      <View style={s.payCol}>
        <Text style={s.blockLabel}>R{'è'}glement</Text>
        <Text style={s.notesText}>Le montant de cet avoir est d{'é'}duit du reste d{'û'} sur la facture {creditNote.creditedRef ?? creditNote.originalRef}.</Text>
      </View>
    </View>
  ) : (
    <View style={s.paySection} wrap={!!notes}>
      <View style={s.payCol}>
        <Text style={s.blockLabel}>Modes de paiement</Text>
        {paymentMethods.length > 0
          ? paymentMethods.map(m => <Text key={m.label} style={s.payMethod}>{m.label} {'—'} {m.value}</Text>)
          : <Text style={s.payMethod}>Contactez-nous pour les modalit{'é'}s de paiement.</Text>}
      </View>
      {payQr}
      <View style={s.payCol}>
        <Text style={s.blockLabel}>{notes ? 'Notes et conditions' : 'Notes'}</Text>
        {notes
          ? <PdfRichText doc={notes} style={s.notesText} />
          : <Text style={s.notesText}>Merci pour votre confiance. Conditions de paiement : {paymentTerms}.</Text>}
      </View>
    </View>
  );

  // Certified invoice (SECeF): same fixed block in every layout, not styled by the template
  const certified = certification ? (
    <View style={s.certBox} wrap={false}>
      <PdfQr text={certification.qrPayload} size={t.layout === 'receipt' ? 72 : 80} />
      <View style={{ flex: 1 }}>
        <Text style={s.certTitle}>Facture certifiée — SECeF</Text>
        <Text style={s.certLine}>N° SECeF : {certification.secefId}</Text>
        <Text style={s.certLine}>Code : {certification.transactionCode}</Text>
        {certification.counter ? <Text style={s.certLine}>Compteur : {certification.counter}</Text> : null}
        {certification.certifiedAt ? <Text style={s.certLine}>Certifiée le {pdfFmtDateTime(certification.certifiedAt)}</Text> : null}
      </View>
    </View>
  ) : null;

  const signature = t.showSignature ? (
    <View style={s.sign} wrap={false}>
      <View style={s.signLine} />
      <Text style={s.signLabel}>Signature autorisée</Text>
    </View>
  ) : null;

  // ── Layout-specific top of the first page ──
  let top: ReactNode;
  switch (t.layout) {
    case 'band':
      top = (
        <>
          <View style={s.band}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={s.bandName}>{bizName}</Text>
              {[bizAddr, bizContact, bizCompliance].filter(Boolean).map(l => <Text key={l} style={s.bandMeta}>{l}</Text>)}
            </View>
            <View>
              <Text style={s.bandTitle}>{title}</Text>
              <Text style={s.bandNum}>#{invoiceRef(invoice)}</Text>
            </View>
          </View>
          {parties}
        </>
      );
      break;
    case 'minimal':
      top = (
        <>
          {band ? (
            <View style={[s.headBand, s.minTop]}>
              <Text style={s.minTitle}>{title}</Text>
              <Text style={s.minNum}>#{invoiceRef(invoice)}</Text>
            </View>
          ) : (<>
            <View style={s.minTop}>
              <Text style={s.minTitle}>{title}</Text>
              <Text style={s.minNum}>#{invoiceRef(invoice)}</Text>
            </View>
            <View style={s.minRule} />
          </>)}
          <View style={s.parties}>
            <View style={s.partiesLeft}>{sellerBlock}</View>
            <View style={s.partiesLeft}>{clientBlock}</View>
          </View>
          <View style={[s.parties, { marginTop: -6 }]}>
            <View style={s.partiesLeft} />
            <View style={s.partiesLeft}>{detailsBlock}</View>
          </View>
        </>
      );
      break;
    case 'sidebar':
      top = (
        <>
          <View style={[s.header, { alignItems: 'flex-end' }]}>
            <Text style={[s.docTitle, { textAlign: 'left' }]}>{title}</Text>
            <Text style={s.docNum}>#{invoiceRef(invoice)}</Text>
          </View>
          {parties}
        </>
      );
      break;
    case 'receipt':
      top = (
        <>
          <View style={s.rcptHead}>
            <Text style={s.rcptName}>{bizName}</Text>
            {[bizAddr, bizContact, bizCompliance].filter(Boolean).map(l => <Text key={l} style={s.rcptMeta}>{l}</Text>)}
          </View>
          <View style={s.rcptRule} />
          <View style={s.rcptRow}>
            <Text style={{ fontSize: 9, fontWeight: 700 }}>{title} #{invoiceRef(invoice)}</Text>
          </View>
          <View style={{ marginTop: 6 }}>{clientBlock}</View>
          <View style={{ marginTop: 8 }}>{detailsBlock}</View>
          <View style={s.rcptDash} />
        </>
      );
      break;
    default:
      top = (
        <>
          <View style={band ? [s.headBand, s.header, s.headerInBand] : s.header}>
            <View style={{ flex: 1, paddingRight: 16 }}>{sellerBlock}</View>
            <View>
              <Text style={s.docTitle}>{title}</Text>
              <Text style={s.docNum}>#{invoiceRef(invoice)}</Text>
            </View>
          </View>
          <View style={s.strip}>
            <Text style={s.stripText}>Émis le : {pdfFmtDate(invoice.issued)}</Text>
            {creditNote ? <>
              <Text style={s.stripText}>Sur la facture : {creditNote.creditedRef ?? creditNote.originalRef}</Text>
              <Text style={s.stripText}>Nature : {creditNote.nature.split(' ·')[0]}</Text>
            </> : <>
              <Text style={s.stripText}>Échéance : {pdfFmtDate(invoice.due)}</Text>
              <Text style={s.stripText}>{paymentTerms}</Text>
            </>}
          </View>
          {parties}
        </>
      );
  }

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Sidebar: coloured column on every page; seller and amount due on the first */}
        {t.layout === 'sidebar' && (
          <View fixed style={s.aside} render={({ pageNumber }) => pageNumber !== 1 ? null : (
            <>
              <Text style={s.asideName}>{bizName}</Text>
              {[bizAddr, bizContact, bizCompliance].filter(Boolean).map(l => <Text key={l} style={s.asideMeta}>{l}</Text>)}
              <View style={s.asideSep} />
              <Text style={s.asideLabel}>{creditNote ? 'Total de l’avoir' : netAPayer !== null && !isPaid ? 'Net à payer' : 'Total dû'}</Text>
              <Text style={s.asideTotal}>{pdfFmt(amountDue)} F CFA</Text>
              <Text style={s.asideDue}>{creditNote ? `Sur ${creditNote.creditedRef ?? creditNote.originalRef}` : `Éch. ${pdfFmtDate(invoice.due)}`}</Text>
            </>
          )} />
        )}

        {/* A copy (PRO-144): faint across every page, and plainly under the header */}
        {duplicate && (
          <Text fixed style={{ position: 'absolute', top: 360, left: 40, right: 40, textAlign: 'center', fontSize: 84, fontWeight: 700, color: '#B42318', opacity: 0.08, transform: 'rotate(-30deg)' }}>
            DUPLICATA
          </Text>
        )}
        {top}
        {duplicate && (
          <View style={{ marginTop: 8, marginBottom: 6, borderWidth: 1.2, borderColor: '#B42318', borderRadius: 3, paddingVertical: 5, paddingHorizontal: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: 700, color: '#B42318', letterSpacing: 2 }}>DUPLICATA</Text>
            <Text style={{ fontSize: 8, color: '#B42318' }}>{duplicateMention(invoiceRef(invoice), pdfFmtDate(invoice.issued))}</Text>
          </View>
        )}
        {subject}
        {table}
        {totals}
        {totalInWords}
        {certified}
        {payment}
        {signature}

        {/* ── Fixed header — repeats on pages 2+ ── */}
        <View fixed style={s.fixedHeader} render={({ pageNumber }) =>
          pageNumber === 1 ? null : (
            <View style={s.fixedHeaderRow}>
              <Text style={s.fixedHeaderBiz}>{bizName}</Text>
              <Text style={s.fixedHeaderRef}>{title} #{invoiceRef(invoice)}{duplicate ? ` — DUPLICATA émise le ${pdfFmtDate(invoice.issued)}` : ''}</Text>
            </View>
          )
        } />

        {/* ── Fixed footer — repeats on every page ── */}
        <View fixed style={band ? s.footBand : s.footer}>
          <Text style={s.footerSide}>{bizName}</Text>
          <Text style={s.footerCenter}>{t.footer.trim() || 'Facture générée via Billio'}</Text>
          <Text style={s.footerSide} render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} / ${totalPages}`
          } />
        </View>
      </Page>
    </Document>
  );
}
