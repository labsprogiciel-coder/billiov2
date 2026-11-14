import { useState } from 'react';
import Icon from '@/components/Icon';
import { fmt } from '@/lib/accounting-data';
import { useFinancialStatements, useBalanceFns } from '@/lib/accounting-hooks';
import { exerciseYear } from '@/lib/period';
import Page from '@/components/Page';

type Tab = 'bilan' | 'cr' | 'flux' | 'notes';

interface SheetRow {
  label: string;
  value: number;
  indent?: number;
  bold?: boolean;
  highlight?: boolean;
}

type Fns = {
  signedOf: (num: string) => number;
  mvtOf: (num: string) => { debit: number; credit: number };
};

function SheetRowEl({ row }: { row: SheetRow }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: `${row.bold ? 10 : 7}px ${16 + (row.indent ?? 0) * 16}px 7px 16px`,
      borderBottom: '0.5px solid var(--color-border-tertiary)',
      background: row.highlight ? 'var(--brand-tint)' : 'transparent',
      fontWeight: row.bold ? 700 : 400,
      fontSize: row.bold ? 13 : 12.5,
    }}>
      <span style={{ color: row.bold ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>{row.label}</span>
      <span className="mono" style={{ color: row.value >= 0 ? 'var(--color-text-primary)' : '#A32D2D' }}>
        {fmt(Math.abs(row.value))}
      </span>
    </div>
  );
}

function BalanceSheet({ signedOf }: Pick<Fns, 'signedOf'>) {
  // Actif
  const software = signedOf('211') + signedOf('281');
  //const _equipment = signedOf('2441') + signedOf('2441') > 0 ? signedOf('2441') : 0;
  const transport = signedOf('2451');
  const amortMat = Math.abs(signedOf('2818'));
  const netImmo = Math.max(0, signedOf('211')) + Math.max(0, signedOf('2441')) + Math.max(0, signedOf('2451')) - amortMat;
  const stocks = signedOf('311');
  const clients = signedOf('411');
  const tvaRecup = signedOf('445');
  const banque = signedOf('521');
  const caisse = signedOf('571');
  const totalActif = netImmo + stocks + clients + tvaRecup + banque + caisse;

  // Passif
  const capital = Math.abs(signedOf('101'));
  const reserves = Math.abs(signedOf('106'));
  const reportAN = Math.abs(signedOf('110'));
  const emprunts = Math.abs(signedOf('162'));
  const fournisseurs = Math.abs(signedOf('401'));
  const personnel = Math.abs(signedOf('421'));
  const cnss = Math.abs(signedOf('4311') + signedOf('4312'));
  const fiscalPayables = Math.abs(signedOf('4421') + signedOf('4423'));
  const tvaFacturee = Math.abs(signedOf('443'));
  const totalPassif = capital + reserves + reportAN + emprunts + fournisseurs + personnel + cnss + fiscalPayables + tvaFacturee;

  const actifRows: SheetRow[] = [
    { label: 'ACTIF IMMOBILISÉ', value: netImmo, bold: true },
    { label: 'Logiciels et licences (net)', value: Math.max(0, software), indent: 1 },
    { label: 'Matériel de bureau (net)', value: Math.max(0, signedOf('2441') - amortMat * 0.3), indent: 1 },
    { label: 'Matériel de transport (net)', value: Math.max(0, transport), indent: 1 },
    { label: 'ACTIF CIRCULANT', value: stocks + clients + tvaRecup, bold: true },
    { label: 'Marchandises', value: stocks, indent: 1 },
    { label: 'Clients', value: clients, indent: 1 },
    { label: 'TVA récupérable', value: tvaRecup, indent: 1 },
    { label: 'TRÉSORERIE', value: banque + caisse, bold: true },
    { label: 'Banques', value: banque, indent: 1 },
    { label: 'Caisse', value: caisse, indent: 1 },
    { label: 'TOTAL ACTIF', value: totalActif, bold: true, highlight: true },
  ];

  const passifRows: SheetRow[] = [
    { label: 'CAPITAUX PROPRES', value: capital + reserves + reportAN, bold: true },
    { label: 'Capital social', value: capital, indent: 1 },
    { label: 'Réserves', value: reserves, indent: 1 },
    { label: 'Report à nouveau', value: reportAN, indent: 1 },
    { label: 'DETTES FINANCIÈRES', value: emprunts, bold: true },
    { label: 'Emprunts bancaires', value: emprunts, indent: 1 },
    { label: 'DETTES D\'EXPLOITATION', value: fournisseurs + personnel + cnss + fiscalPayables + tvaFacturee, bold: true },
    { label: 'Fournisseurs', value: fournisseurs, indent: 1 },
    { label: 'Personnel — rémunérations nettes', value: personnel, indent: 1 },
    { label: 'CNSS (part patronale + salariale)', value: cnss, indent: 1 },
    { label: 'Dettes fiscales (IRI, TMS, TVA)', value: fiscalPayables + tvaFacturee, indent: 1 },
    { label: 'TOTAL PASSIF', value: totalPassif, bold: true, highlight: true },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ padding: '12px 16px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-secondary)' }}>Actif</div>
        {actifRows.map((r, i) => <SheetRowEl key={i} row={r} />)}
      </div>
      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ padding: '12px 16px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-secondary)' }}>Passif</div>
        {passifRows.map((r, i) => <SheetRowEl key={i} row={r} />)}
      </div>
    </div>
  );
}

function IncomeStatement({ mvtOf }: Pick<Fns, 'mvtOf'>) {
  const sales701 = mvtOf('701').credit;
  const sales706 = mvtOf('706').credit;
  const totalRevenue = sales701 + sales706;
  const purchases = mvtOf('601').debit;
  const otherPurchases = mvtOf('605').debit;
  const bankFees = mvtOf('627').debit;
  const payroll = mvtOf('661').debit;
  const socialCharges = mvtOf('664').debit;
  const amort = mvtOf('681').debit;
  const interest = mvtOf('671').debit;
  const totalCharges = purchases + otherPurchases + bankFees + payroll + socialCharges + amort + interest;
  const operatingResult = totalRevenue - (purchases + otherPurchases + bankFees + payroll + socialCharges + amort);
  const netResult = totalRevenue - totalCharges;

  const rows: SheetRow[] = [
    { label: 'PRODUITS D\'EXPLOITATION', value: totalRevenue, bold: true },
    { label: 'Ventes de marchandises', value: sales701, indent: 1 },
    { label: 'Services vendus', value: sales706, indent: 1 },
    { label: 'CHARGES D\'EXPLOITATION', value: totalCharges - interest, bold: true },
    { label: 'Achats de marchandises', value: purchases, indent: 1 },
    { label: 'Autres achats & services', value: otherPurchases + bankFees, indent: 1 },
    { label: 'Charges de personnel', value: payroll + socialCharges, indent: 1 },
    { label: 'Dotations aux amortissements', value: amort, indent: 1 },
    { label: 'RÉSULTAT D\'EXPLOITATION', value: operatingResult, bold: true, highlight: true },
    { label: 'Charges financières', value: interest, indent: 1 },
    { label: 'RÉSULTAT NET', value: netResult, bold: true, highlight: true },
  ];

  const isProfit = netResult >= 0;

  return (
    <div>
      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-secondary)' }}>Compte de résultat · cumul à date</div>
        {rows.map((r, i) => <SheetRowEl key={i} row={r} />)}
      </div>
      <div style={{ padding: '20px 24px', borderRadius: 'var(--border-radius-lg)', background: isProfit ? 'linear-gradient(135deg,#276C2B,#1B5E20)' : 'linear-gradient(135deg,#A32D2D,#7B1111)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, letterSpacing: 0.8, textTransform: 'uppercase' }}>Résultat net à date</div>
          <div style={{ fontSize: 13.5, fontWeight: 500, opacity: 0.9, marginTop: 3 }}>{isProfit ? 'Bénéfice' : 'Perte'} · Exercice {exerciseYear()}</div>
        </div>
        <div className="mono" style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1 }}>{fmt(Math.abs(netResult))} <span style={{ fontSize: 14, opacity: 0.8 }}>F CFA</span></div>
      </div>
    </div>
  );
}

function CashFlow({ signedOf, mvtOf }: Fns) {
  const closing = signedOf('521') + signedOf('571');
  const receipts = mvtOf('521').debit + mvtOf('571').debit;
  const payments = mvtOf('521').credit + mvtOf('571').credit;
  const operFlow = receipts - payments;

  const rows = [
    { label: 'Trésorerie ouverture', value: 4180000 + 320000, bold: true },
    { label: 'FLUX OPÉRATIONNELS', value: operFlow, bold: true },
    { label: 'Encaissements clients', value: mvtOf('411').credit, indent: 1 },
    { label: 'Décaissements fournisseurs', value: -mvtOf('401').debit, indent: 1 },
    { label: 'Charges de personnel (cash)', value: -(mvtOf('421').credit + mvtOf('4311').credit + mvtOf('4312').credit), indent: 1 },
    { label: 'Charges bancaires', value: -mvtOf('627').debit, indent: 1 },
    { label: 'FLUX DE FINANCEMENT', value: 0, bold: true },
    { label: 'Remboursement emprunt', value: -mvtOf('162').debit, indent: 1 },
    { label: 'Intérêts payés', value: -mvtOf('671').debit, indent: 1 },
    { label: 'Trésorerie clôture', value: closing, bold: true, highlight: true },
  ];

  return (
    <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ padding: '12px 16px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-secondary)' }}>Tableau de flux de trésorerie · cumul à date</div>
      {rows.filter(r => r.value !== 0 || r.bold).map((r, i) => (
        <SheetRowEl key={i} row={r as SheetRow} />
      ))}
    </div>
  );
}

function Notes({ signedOf }: Pick<Fns, 'signedOf'>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ padding: '13px 17px', borderBottom: '0.5px solid var(--color-border-tertiary)', fontWeight: 700, fontSize: 13.5 }}>Méthodes comptables</div>
        <div style={{ padding: '14px 17px', fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
          <p>Les états financiers sont établis conformément au <b>SYSCOHADA révisé</b> (Système Normal). La méthode d'évaluation retenue est le <b>coût historique</b>.</p>
          <p style={{ marginTop: 8 }}>Les immobilisations sont amorties selon la méthode <b>linéaire</b> sur leur durée d'utilisation économique estimée (logiciels : 3 ans, matériels : 5 ans).</p>
          <p style={{ marginTop: 8 }}>La TVA est comptabilisée au taux de <b>18%</b> conformément à la réglementation en vigueur au Burkina Faso.</p>
        </div>
      </div>
      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ padding: '13px 17px', borderBottom: '0.5px solid var(--color-border-tertiary)', fontWeight: 700, fontSize: 13.5 }}>Tableau des immobilisations</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: 'var(--color-background-secondary)' }}>
              {['Immobilisation', 'Valeur brute', 'Amort. cumulé', 'Valeur nette'].map(h => (
                <th key={h} style={{ padding: '9px 14px', textAlign: h === 'Immobilisation' ? 'left' : 'right', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { name: 'Logiciels et licences', gross: 1800000, amort: Math.abs(signedOf('281')) },
              { name: 'Matériel de bureau', gross: 2400000, amort: Math.abs(signedOf('2818')) * 0.3 },
              { name: 'Matériel de transport', gross: 6500000, amort: Math.abs(signedOf('2818')) * 0.7 },
            ].map((row, i) => (
              <tr key={i} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 500 }}>{row.name}</td>
                <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>{fmt(row.gross)}</td>
                <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', color: '#A32D2D' }}>{fmt(row.amort)}</td>
                <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{fmt(row.gross - row.amort)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'bilan', label: 'Bilan', icon: 'book-2' },
  { id: 'cr', label: 'Compte de résultat', icon: 'chart-bar' },
  { id: 'flux', label: 'Flux de trésorerie', icon: 'trending-up' },
  { id: 'notes', label: 'Notes annexes', icon: 'file-text' },
];

export default function FinancialStatementsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('bilan');
  const { data } = useFinancialStatements();
  const { signedOf, mvtOf } = useBalanceFns(data);

  return (
    <Page
      section={{ icon: 'report-money', label: 'Comptabilité' }}
      title="États financiers"
      subtitle="Bilan · Compte de résultat · Flux · Notes · cumul à date"
      actions={<>
        <span className="period-pill"><span className="dot" />Exercice {exerciseYear()} · ouvert</span>
        <button className="btn"><Icon name="printer" />Imprimer</button>
        <button className="btn"><Icon name="download" />Exporter PDF</button>
      </>}
    >
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--color-background-secondary)', padding: 4, borderRadius: 'var(--border-radius-lg)', border: '0.5px solid var(--color-border-tertiary)', width: 'fit-content' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 'var(--border-radius-md)',
                border: 'none', background: activeTab === tab.id ? 'var(--color-background-primary)' : 'transparent',
                color: activeTab === tab.id ? 'var(--brand)' : 'var(--color-text-secondary)',
                fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 500,
                cursor: 'pointer', boxShadow: activeTab === tab.id ? 'var(--shadow-sm)' : 'none',
                transition: 'all .12s',
              }}
            >
              <Icon name={tab.icon} size={14} />{tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'bilan' && <BalanceSheet signedOf={signedOf} />}
        {activeTab === 'cr' && <IncomeStatement mvtOf={mvtOf} />}
        {activeTab === 'flux' && <CashFlow signedOf={signedOf} mvtOf={mvtOf} />}
        {activeTab === 'notes' && <Notes signedOf={signedOf} />}
    </Page>
  );
}
