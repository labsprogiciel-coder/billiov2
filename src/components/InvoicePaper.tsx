import { formatCadastralRef } from '@/lib/cadastral';
import { createContext, useContext } from 'react';
import { fmt } from '@/data';
import { getFiscalIdLabel } from '@/lib/ohada';
import { VAT_LABEL, chargesVat, vatOn } from '@/lib/vat';
import type { PaymentMethodLine } from '@/lib/payment-methods';

export type PaperLayout   = 'classic' | 'band' | 'minimal' | 'sidebar' | 'receipt';
export type PaperDensity  = 'compact' | 'cozy' | 'spacious';
export type TableStyle    = 'plain' | 'tinted' | 'band-h';
export type TotalStyle    = 'plain' | 'filled' | 'ruled';

export interface PaperConfig {
  layout:        PaperLayout;
  color:         string;
  fontFamily:    string;
  density:       PaperDensity;
  tableStyle:    TableStyle;
  totalStyle:    TotalStyle;
  /** Kept for saved templates; the invoice always shows quantities (mandatory). */
  showQty:       boolean;
  /** Kept for saved templates; VAT follows the tax regime. */
  showTax:       boolean;
  /** Kept for saved templates; a discount line appears when the invoice has one. */
  showDiscount:  boolean;
  showSignature: boolean;
  /** Kept for saved templates; the invoice always shows payment details. */
  showPayment:   boolean;
  footer:        string;
}

export interface BizInfo {
  name:            string;
  address:         string;
  city:            string;
  country:         string;
  email:           string;
  phone:           string;
  ifu:             string;
  rccm:            string;
  taxRegime?:      string;
  divisionFiscale?: string;
  /** Cadastral reference of the place of sale (11 digits) */
  cadastralRef?:   string;
}

// ---------------------------------------------------------------------------
// Preview data. The seller and payment methods are the organisation's own;
// the client and lines are an example (a template has no invoice).
// ---------------------------------------------------------------------------
const MOCK_BIZ: BizInfo = {
  name:            'Studio Wend SARL',
  address:         'Av. Kwame Nkrumah',
  city:            'Ouagadougou',
  country:         'Burkina Faso',
  email:           'contact@studiowend.bf',
  phone:           '+226 70 12 34 56',
  ifu:             '00012345 B',
  rccm:            'BF-OUA-2021-B-1234',
  taxRegime:       'RNI',
  divisionFiscale: 'Ouagadougou I',
  cadastralRef:    '01234567890',
};
const MOCK_PAYMENT: PaymentMethodLine[] = [
  { label: 'Orange Money', value: '70 00 00 00' },
  { label: 'Virement bancaire', value: 'BF00 0000 0000 0000' },
];

const CLI = { name: 'Client exemple SARL', city: 'Ouagadougou, Burkina Faso', ifu: '00067890 C', rccm: 'BF-OUA-2020-B-5678', taxRegime: 'RSI', fiscalDivision: 'DCI Ouaga III' };
const CLI_IDS = [`IFU ${CLI.ifu}`, `RCCM ${CLI.rccm}`, CLI.taxRegime, CLI.fiscalDivision];

const longDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
function sampleInvoice() {
  const issued = new Date();
  const due = new Date(issued);
  due.setDate(due.getDate() + 14);
  return { id: `FACT-${issued.getFullYear()}-0041`, issued: longDate(issued), due: longDate(due), subject: 'Refonte web — phase 2' };
}
const LINES = [
  { desc: 'UI/UX design — phase 2', note: 'Wireframes, hi-fi screens', qty: 1, price: 300_000 },
  { desc: 'Développement front-end', note: 'Build responsive, composants', qty: 8, price: 35_000 },
  { desc: 'AQ & livraison', note: 'Tests, déploiement', qty: 1, price: 80_000 },
];
const SUB = LINES.reduce((s, l) => s + l.qty * l.price, 0);

interface PaperData { biz: BizInfo; showVat: boolean; tax: number; total: number; payLines: PaymentMethodLine[]; paymentTerms: string }
const PaperCtx = createContext<PaperData | null>(null);
const usePaper = () => useContext(PaperCtx)!;

function bizInitials(name: string) {
  const words = name.trim().split(/\s+/);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '??';
}

function bizLines(biz: BizInfo) {
  const fiscalLabel = getFiscalIdLabel(biz.country);
  return {
    addr: [biz.address, biz.city, biz.country].filter(Boolean).join(', '),
    contact: [biz.email, biz.phone].filter(Boolean).join(' · '),
    compliance: [biz.ifu && `${fiscalLabel} ${biz.ifu}`, biz.rccm && `RCCM ${biz.rccm}`, biz.taxRegime, biz.divisionFiscale,
      biz.cadastralRef && `Réf. cadastrale ${formatCadastralRef(biz.cadastralRef)}`]
      .filter(Boolean).join(' · '),
  };
}

function BizMeta({ biz }: { biz: BizInfo }) {
  const { addr, contact, compliance } = bizLines(biz);
  return (
    <>
      {addr && <>{addr}<br /></>}
      {contact && <>{contact}<br /></>}
      {compliance && <span className="tp-compliance-ids-inline">{compliance}</span>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-sections: every layout shows all of them, like the PDF
// ---------------------------------------------------------------------------
function ClientIds() {
  return <div className="tp-compliance-ids">{CLI_IDS.map(id => <span key={id}>{id}</span>)}</div>;
}

function ClientBlock() {
  return (
    <>
      <div className="tp-block-label">Facturé à</div>
      <div className="tp-client-name">{CLI.name}</div>
      <div className="tp-client-meta">[PM] Personne morale</div>
      <div className="tp-client-meta">{CLI.city}</div>
      <ClientIds />
    </>
  );
}

function DetailsGrid() {
  const { paymentTerms } = usePaper();
  return (
    <div className="tp-meta-grid">
      <div className="k">Émis le</div><div className="v">{sampleInvoice().issued}</div>
      <div className="k">Échéance</div><div className="v due">{sampleInvoice().due}</div>
      <div className="k">Paiement</div><div className="v">{paymentTerms}</div>
    </div>
  );
}

function Parties() {
  return (
    <div className="tp-parties">
      <div><ClientBlock /></div>
      <div>
        <div className="tp-block-label">Détails</div>
        <DetailsGrid />
      </div>
    </div>
  );
}

function Subject() {
  return <div className="tp-client-meta" style={{ margin: '0 0 10px' }}><b>Objet :</b> {sampleInvoice().subject}</div>;
}

function InvoiceTable({ cfg }: { cfg: PaperConfig }) {
  return (
    <table className={`tp-table ${cfg.tableStyle}`}>
      <thead>
        <tr>
          <th>Description</th>
          <th className="r">Qté</th>
          <th className="r">P.U.</th>
          <th className="r">Montant</th>
        </tr>
      </thead>
      <tbody>
        {LINES.map((l, i) => (
          <tr key={i}>
            <td>
              <div className="tp-li-desc">{l.desc}</div>
              <div className="tp-li-note">{l.note}</div>
            </td>
            <td className="r">{l.qty}</td>
            <td className="r">{fmt(l.price)}</td>
            <td className="r tp-li-amt">{fmt(l.qty * l.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ cfg }: { cfg: PaperConfig }) {
  const { showVat, tax, total } = usePaper();
  return (
    <div className="tp-totals">
      <div className="tp-tot-inner">
        <div className="tp-tot-row"><span>Sous-total HT</span><span>{fmt(SUB)} F CFA</span></div>
        {showVat && <div className="tp-tot-row"><span>{VAT_LABEL}</span><span>{fmt(tax)} F CFA</span></div>}
        {showVat && <div className="tp-tot-row"><span>Total TTC</span><span>{fmt(total)} F CFA</span></div>}
        <div className={`tp-tot-grand ${cfg.totalStyle}`}>
          <span>Total dû</span><span>{fmt(total)} F CFA</span>
        </div>
      </div>
    </div>
  );
}

function PayNotes() {
  const { payLines, paymentTerms } = usePaper();
  return (
    <div className="tp-pay-row">
      <div>
        <div className="tp-block-label">Modes de paiement</div>
        <div className="tp-pm-list">
          {payLines.length > 0
            ? payLines.map(m => <div key={m.label} className="tp-pm">{m.label} — {m.value}</div>)
            : <div className="tp-pm">Contactez-nous pour les modalités de paiement.</div>}
        </div>
      </div>
      <div>
        <div className="tp-block-label">Notes</div>
        <div className="tp-notes">Merci pour votre confiance. Conditions de paiement : {paymentTerms}.</div>
      </div>
    </div>
  );
}

function Signature({ cfg }: { cfg: PaperConfig }) {
  if (!cfg.showSignature) return null;
  return (
    <div className="tp-sign">
      <div className="tp-sign-line" />
      <div className="tp-sign-label">Signature autorisée</div>
    </div>
  );
}

function Footer({ cfg }: { cfg: PaperConfig }) {
  return <div className="tp-foot">{cfg.footer.trim() || 'Facture générée via Billio'}</div>;
}

/**
 * Where a certified invoice (SECeF) prints its QR code, SECeF number and
 * transaction code. Shown here as a reserved area; the PDF prints the real
 * elements once the invoice is certified (PRO-137).
 */
function CertArea() {
  return (
    <div className="tp-cert" aria-label="Zone réservée à la certification SECeF">
      <div className="tp-cert-qr" aria-hidden="true">QR</div>
      <div>
        <div className="tp-cert-title">Facture certifiée — SECeF</div>
        <div className="tp-cert-sub">Zone réservée : QR code, n° SECeF et code de la facture, ajoutés à la certification.</div>
      </div>
    </div>
  );
}

function Rest({ cfg }: { cfg: PaperConfig }) {
  return (
    <>
      <Subject />
      <InvoiceTable cfg={cfg} />
      <Totals cfg={cfg} />
      <CertArea />
      <PayNotes />
      <Signature cfg={cfg} />
      <Footer cfg={cfg} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Layout-specific bodies
// ---------------------------------------------------------------------------
function ClassicBody({ cfg }: { cfg: PaperConfig }) {
  const { biz, paymentTerms } = usePaper();
  return (
    <>
      <div className="tp-top">
        <div className="tp-biz">
          <div className="tp-logo">{bizInitials(biz.name)}</div>
          <div>
            <div className="tp-biz-name">{biz.name}</div>
            <div className="tp-biz-meta"><BizMeta biz={biz} /></div>
          </div>
        </div>
        <div className="tp-doc">
          <div className="tp-doc-title">Facture</div>
          <div className="tp-doc-num">#{sampleInvoice().id}</div>
        </div>
      </div>
      <div className="tp-strip">
        <span>Émis le: {sampleInvoice().issued}</span>
        <span>Échéance: {sampleInvoice().due}</span>
        <span>{paymentTerms}</span>
      </div>
      <Parties />
      <Rest cfg={cfg} />
    </>
  );
}

function BandBody({ cfg }: { cfg: PaperConfig }) {
  const { biz } = usePaper();
  const { addr, contact, compliance } = bizLines(biz);
  return (
    <>
      <div className="tp-band">
        <div className="tp-band-left">
          <div className="tp-band-logo">{bizInitials(biz.name)}</div>
          <div>
            <div className="tp-band-name">{biz.name}</div>
            <div className="tp-band-tag">
              {[addr, contact, compliance].filter(Boolean).map(l => <div key={l}>{l}</div>)}
            </div>
          </div>
        </div>
        <div className="tp-band-right">
          <div className="tp-band-title">Facture</div>
          <div className="tp-band-num">#{sampleInvoice().id}</div>
        </div>
      </div>
      <div className="tp-band-body">
        <Parties />
        <Rest cfg={cfg} />
      </div>
    </>
  );
}

function MinimalBody({ cfg }: { cfg: PaperConfig }) {
  const { biz } = usePaper();
  return (
    <>
      <div className="tp-min-top">
        <div className="tp-doc-title tp-min">FACTURE</div>
        <div className="tp-min-num">#{sampleInvoice().id}</div>
      </div>
      <div className="tp-min-rule" />
      <div className="tp-min-head">
        <div>
          <div className="tp-block-label">{biz.name}</div>
          <div className="tp-client-meta"><BizMeta biz={biz} /></div>
        </div>
        <div>
          <ClientBlock />
          <div style={{ marginTop: 10 }}><DetailsGrid /></div>
        </div>
      </div>
      <Rest cfg={cfg} />
    </>
  );
}

function SidebarBody({ cfg }: { cfg: PaperConfig }) {
  const { biz, total } = usePaper();
  return (
    <div className="tp-side-wrap">
      <div className="tp-aside">
        <div className="tp-aside-logo">{bizInitials(biz.name)}</div>
        <div className="tp-aside-name">{biz.name}</div>
        <div className="tp-aside-meta"><BizMeta biz={biz} /></div>
        <div className="tp-aside-sep" />
        <div className="tp-aside-label">Total dû</div>
        <div className="tp-aside-total">{fmt(total)}<span>F CFA</span></div>
        <div className="tp-aside-due">Éch. {sampleInvoice().due}</div>
      </div>
      <div className="tp-side-main">
        <div className="tp-side-head">
          <div>
            <div className="tp-doc-title" style={{ fontSize: 22 }}>Facture</div>
            <div className="tp-doc-num">#{sampleInvoice().id}</div>
          </div>
        </div>
        <Parties />
        <Rest cfg={cfg} />
      </div>
    </div>
  );
}

function ReceiptBody({ cfg }: { cfg: PaperConfig }) {
  const { biz, showVat, tax, total } = usePaper();
  const { addr, contact, compliance } = bizLines(biz);
  return (
    <div className="tp-rcpt">
      <div className="tp-rcpt-head">
        <div className="tp-rcpt-logo">{bizInitials(biz.name)}</div>
        <div className="tp-rcpt-name">{biz.name}</div>
        <div className="tp-rcpt-meta">
          {[addr, contact, compliance].filter(Boolean).map(l => <div key={l} className="tp-compliance-ids-inline">{l}</div>)}
        </div>
      </div>
      <div className="tp-rcpt-divider" />
      <div className="tp-rcpt-row">
        <span className="tp-rcpt-doc">Facture #{sampleInvoice().id}</span>
        <span>{sampleInvoice().issued}</span>
      </div>
      <div style={{ margin: '6px 0' }}><ClientBlock /></div>
      <DetailsGrid />
      <div className="tp-rcpt-divider dashed" />
      {LINES.map((l, i) => (
        <div key={i} className="tp-rcpt-item">
          <div className="tp-rcpt-item-name">{l.desc}</div>
          <div className="tp-rcpt-item-amt">{fmt(l.qty * l.price)} F CFA</div>
          <div className="tp-rcpt-item-sub">Qté {l.qty} × P.U. {fmt(l.price)} F CFA</div>
        </div>
      ))}
      <div className="tp-rcpt-divider" />
      <div className="tp-rcpt-row"><span>Sous-total HT</span><span>{fmt(SUB)} F CFA</span></div>
      {showVat && <div className="tp-rcpt-row"><span>{VAT_LABEL}</span><span>{fmt(tax)} F CFA</span></div>}
      <div className="tp-rcpt-total">
        <span>Total dû</span><span>{fmt(total)} F CFA</span>
      </div>
      <div className="tp-rcpt-divider dashed" />
      <CertArea />
      <PayNotes />
      <Signature cfg={cfg} />
      <div className="tp-rcpt-foot">{cfg.footer.trim() || 'Facture générée via Billio'}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default function InvoicePaper({ config, biz, paymentMethods, paymentTerms }: {
  config: PaperConfig;
  /** The organisation's details; an example business when it has no name yet. */
  biz?: BizInfo;
  /** The organisation's payment methods (Paramètres → Paiements). */
  paymentMethods?: PaymentMethodLine[];
  paymentTerms?: string;
}) {
  const resolved = biz?.name ? biz : MOCK_BIZ;
  const showVat = chargesVat(resolved.taxRegime);
  const tax = vatOn(SUB, showVat);
  const data: PaperData = {
    biz: resolved, showVat, tax, total: SUB + tax,
    payLines: paymentMethods ?? (biz?.name ? [] : MOCK_PAYMENT),
    paymentTerms: paymentTerms || 'Net 14 jours',
  };
  const paperStyle: React.CSSProperties = {
    '--acc': config.color,
    fontFamily: config.fontFamily,
  } as React.CSSProperties;

  return (
    <PaperCtx.Provider value={data}>
      <div
        className="tp-paper"
        data-layout={config.layout}
        data-density={config.density}
        style={paperStyle}
      >
        {config.layout === 'classic'  && <ClassicBody  cfg={config} />}
        {config.layout === 'band'     && <BandBody     cfg={config} />}
        {config.layout === 'minimal'  && <MinimalBody  cfg={config} />}
        {config.layout === 'sidebar'  && <SidebarBody  cfg={config} />}
        {config.layout === 'receipt'  && <ReceiptBody  cfg={config} />}
      </div>
    </PaperCtx.Provider>
  );
}
