import type { ReactNode } from 'react';
import { Document, Page, View, Text, StyleSheet, Svg, Rect } from '@react-pdf/renderer';
import { calculateServiceWithholding } from '@/lib/tax-bf';
import { clientTypeDef, clientTypeOf } from '@/lib/client-type';
import { getFiscalIdLabel } from '@/lib/ohada';
import type { Invoice, LineItem, ServiceWithholdingScenario } from '@/lib/schemas';
import type { BizInfo, PaperConfig } from '@/components/InvoicePaper';
import type { PaymentMethodLine } from '@/lib/payment-methods';
import { VAT_LABEL, chargesVat, documentHasVat, vatOn } from '@/lib/vat';
import { DEFAULT_CONFIG, accentDark, accentTint, densityScale, normalizeConfig, pdfFont } from '@/lib/invoice-template';
import { registerPdfFonts } from '@/lib/pdf-fonts';
import { qrMatrix, qrRuns, type InvoiceCertification } from '@/lib/certification';

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
  clientLabel?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  /** From the organisation's payment settings; see paymentMethodLines(). */
  paymentMethods?: PaymentMethodLine[];
  /** SECeF elements of a certified invoice (PRO-137); printed in a fixed area of every layout. */
  certification?: InvoiceCertification;
}

const PAD = 40;
const SIDEBAR_W = 150;
const RECEIPT_W = 300;
const A4_W = 595.28;

const RATE_LABEL: Record<string, string> = {
  'resident-with-ifu':    '5 %',
  'resident-without-ifu': '25 %',
  'construction':         '1 %',
  'non-resident':         '20 %',
};

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

  return {
    left, right, acc, dark, tint,
    s: StyleSheet.create({
      page: {
        fontFamily: font, fontSize: 9, color: '#1a1a1a', backgroundColor: '#ffffff',
        paddingLeft: left, paddingRight: right, paddingTop: 40, paddingBottom: 56,
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
        marginLeft: -left, marginRight: -right, marginTop: -40, paddingHorizontal: PAD, paddingVertical: sp(24),
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
      notesText: { fontSize: 8, color: '#666', lineHeight: 1.5 },
      certBox: {
        flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, marginBottom: sp(16),
        borderWidth: 1, borderColor: '#1C2733', borderRadius: 4,
      },
      certTitle: { fontSize: 8.5, ...bold, marginBottom: 3 },
      certLine: { fontSize: 8, color: '#1a1a1a', lineHeight: 1.45 },
      sign: { marginTop: sp(18), width: 180, alignSelf: 'flex-end', alignItems: 'center' },
      signLine: { borderTopWidth: 1, borderTopColor: '#B7C0CC', width: '100%', marginBottom: 5 },
      signLabel: { fontSize: 8, color: '#606C7E', ...bold },
      fixedHeader: { position: 'absolute', top: 16, left, right },
      fixedHeaderRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 6,
      },
      fixedHeaderBiz: { fontSize: 7, ...bold, color: '#555' },
      fixedHeaderRef: { fontSize: 7, color: '#666' },
      footer: {
        position: 'absolute', bottom: 20, left, right,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 6, gap: 8,
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
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function InvoicePDFDocument({
  invoice, lines, client, biz, template, title = 'Facture', clientLabel = 'Facturé à',
  paymentTerms = 'Net 14 jours', deliveryTerms = 'À convenir', paymentMethods = [], certification,
}: InvoicePDFProps) {
  registerPdfFonts();
  const t = normalizeConfig(template ?? DEFAULT_CONFIG);
  const { s } = makeStyles(t);

  const subtotal      = lines.reduce((sum, li) => sum + li.qty * li.price, 0);
  const discountPct   = invoice.discountPct ?? 0;
  const discountAmt   = Math.round(subtotal * (discountPct / 100));
  const discountedSub = subtotal - discountAmt;
  // VAT as issued: the stored total says whether it was charged, so a later
  // change of tax regime doesn't rewrite old invoices
  const showVat       = documentHasVat(invoice.amount, discountedSub, chargesVat(biz.taxRegime));
  const tax           = vatOn(discountedSub, showVat);
  const total         = discountedSub + tax;
  const isPaid = invoice.status === 'paid';

  const svcWithholding = client.withholdingScenario
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
      {([
        ['Émis le', pdfFmtDate(invoice.issued)],
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

  const subject = invoice.subject ? (
    <View style={s.subjectRow}>
      <Text style={{ fontSize: 9, fontWeight: 700, marginRight: 4 }}>Objet :</Text>
      <Text style={{ fontSize: 9, color: '#1a1a1a', flex: 1 }}>{invoice.subject}</Text>
    </View>
  ) : null;

  const table = t.layout === 'receipt' ? (
    <View>
      {lines.length === 0
        ? <Text style={[s.smallText, { color: '#767676' }]}>Aucune ligne</Text>
        : lines.map(li => (
          <View key={li.id} style={s.rcptItem} wrap={false}>
            <View style={s.rcptRow}>
              <Text style={[s.tdDesc, { fontWeight: 700 }]}>{li.desc}</Text>
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
          <Text style={s.tdDesc}>{li.desc}</Text>
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
        {showVat && (
          <View style={s.totRow}>
            <Text style={s.totLabel}>{VAT_LABEL}</Text>
            <Text style={s.totVal}>{pdfFmt(tax)} F CFA</Text>
          </View>
        )}
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
          <Text style={s.grandLabel}>{netAPayer !== null && !isPaid ? 'Net à payer' : 'Total dû'}</Text>
          <Text style={s.grandVal}>{pdfFmt(amountDue)} F CFA</Text>
        </View>
      </View>
    </View>
  );

  const payment = (
    <View style={s.paySection} wrap={false}>
      <View style={s.payCol}>
        <Text style={s.blockLabel}>Modes de paiement</Text>
        {paymentMethods.length > 0
          ? paymentMethods.map(m => <Text key={m.label} style={s.payMethod}>{m.label} {'—'} {m.value}</Text>)
          : <Text style={s.payMethod}>Contactez-nous pour les modalit{'é'}s de paiement.</Text>}
      </View>
      <View style={s.payCol}>
        <Text style={s.blockLabel}>Notes</Text>
        <Text style={s.notesText}>
          Merci pour votre confiance. Conditions de paiement : {paymentTerms}.
        </Text>
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
              <Text style={s.bandNum}>#{invoice.id}</Text>
            </View>
          </View>
          {parties}
        </>
      );
      break;
    case 'minimal':
      top = (
        <>
          <View style={s.minTop}>
            <Text style={s.minTitle}>{title}</Text>
            <Text style={s.minNum}>#{invoice.id}</Text>
          </View>
          <View style={s.minRule} />
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
            <Text style={s.docNum}>#{invoice.id}</Text>
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
            <Text style={{ fontSize: 9, fontWeight: 700 }}>{title} #{invoice.id}</Text>
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
          <View style={s.header}>
            <View style={{ flex: 1, paddingRight: 16 }}>{sellerBlock}</View>
            <View>
              <Text style={s.docTitle}>{title}</Text>
              <Text style={s.docNum}>#{invoice.id}</Text>
            </View>
          </View>
          <View style={s.strip}>
            <Text style={s.stripText}>Émis le : {pdfFmtDate(invoice.issued)}</Text>
            <Text style={s.stripText}>Échéance : {pdfFmtDate(invoice.due)}</Text>
            <Text style={s.stripText}>{paymentTerms}</Text>
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
              <Text style={s.asideLabel}>{netAPayer !== null && !isPaid ? 'Net à payer' : 'Total dû'}</Text>
              <Text style={s.asideTotal}>{pdfFmt(amountDue)} F CFA</Text>
              <Text style={s.asideDue}>Éch. {pdfFmtDate(invoice.due)}</Text>
            </>
          )} />
        )}

        {top}
        {subject}
        {table}
        {totals}
        {certified}
        {payment}
        {signature}

        {/* ── Fixed header — repeats on pages 2+ ── */}
        <View fixed style={s.fixedHeader} render={({ pageNumber }) =>
          pageNumber === 1 ? null : (
            <View style={s.fixedHeaderRow}>
              <Text style={s.fixedHeaderBiz}>{bizName}</Text>
              <Text style={s.fixedHeaderRef}>{title} #{invoice.id}</Text>
            </View>
          )
        } />

        {/* ── Fixed footer — repeats on every page ── */}
        <View fixed style={s.footer}>
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
