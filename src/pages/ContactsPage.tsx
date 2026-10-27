import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '@/components/Icon';
import ConfirmModal from '@/components/ConfirmModal';
import PageTabs from '@/components/PageTabs';
import { tabPanelId, tabId } from '@/lib/tab-ids';
import { EmptyState, EmptyInline } from '@/components/EmptyState';
import { ClientsEmptyIllustration } from '@/components/PageEmptyIllustrations';
import { SuppliersEmptyIllustration } from '@/components/accounting/EmptyIllustrations';
import { PageSkeleton } from '@/components/SkeletonLoader';
import DrawerPanel from '@/components/accounting/DrawerPanel';
import StatusPill from '@/components/accounting/StatusPill';
import { useApp } from '@/context/AppContext';
import FiscalDivisionSelect, { fiscalDivisionLabel } from '@/components/FiscalDivisionSelect';
import { createClient, updateClient, removeClient } from '@/lib/api/clients';
import { fmt, fmtCompact, clientInitials } from '@/data';
import { getFiscalIdLabel, OHADA_COUNTRY_NAMES } from '@/lib/ohada';
import type { ClientStatus, ClientRecord, InvoiceStatus, NewClientForm } from '@/lib/schemas';
import type { SupplierBill, PaymentMethod } from '@/lib/accounting-data';
import { useSupplierBills } from '@/lib/accounting-hooks';

// ─── Shared helpers ───────────────────────────────────────────────────────────

type Tab = 'clients' | 'suppliers';

const AV_COLORS = [
  { bg: '#B5D4F4', color: '#0C447C' },
  { bg: '#9FE1CB', color: '#085041' },
  { bg: '#F5C4B3', color: '#712B13' },
  { bg: '#C0DD97', color: '#27500A' },
  { bg: '#F4C0D1', color: '#72243E' },
];

function supplierAvColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % AV_COLORS.length;
  return AV_COLORS[hash];
}
function supplierInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
const TODAY = new Date('2026-06-12');
function daysDue(dueDate: string) {
  return Math.round((new Date(dueDate).getTime() - TODAY.getTime()) / 86400000);
}
function ageBucket(b: SupplierBill): 'cur' | 'd30' | 'd60' | 'd90' | null {
  if (b.status === 'paid') return null;
  const d = daysDue(b.dueDate);
  if (d >= 0) return 'cur';
  if (d >= -30) return 'd30';
  if (d >= -60) return 'd60';
  return 'd90';
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso: string) {
  const p = iso.split('-');
  return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1];
}

// ─── Aging strip ──────────────────────────────────────────────────────────────

const AGING_SEGS = [
  { key: 'cur' as const, label: 'Not due',    color: '#2E7D32' },
  { key: 'd30' as const, label: '1–30 days',  color: '#B26A09' },
  { key: 'd60' as const, label: '31–60 days', color: '#C2570B' },
  { key: 'd90' as const, label: '60+ days',   color: '#A32D2D' },
];

function AgingStrip({ bills }: { bills: SupplierBill[] }) {
  const tot: Record<string, number> = {};
  bills.forEach(b => {
    const k = ageBucket(b);
    if (k) tot[k] = (tot[k] || 0) + b.htAmount + b.tvaAmount;
  });
  const max = Math.max(1, ...Object.values(tot));
  return (
    <div className="aging-strip">
      {AGING_SEGS.map(s => {
        const v = tot[s.key] || 0;
        return (
          <div key={s.key} className="aging-seg">
            <div className="aging-top">
              <span className="aging-dot" style={{ background: s.color }} />
              <span className="aging-lbl">{s.label}</span>
            </div>
            <div className="aging-amt mono" style={{ color: v ? s.color : 'var(--color-text-tertiary)' }}>
              {v ? fmtCompact(v) : '—'}
              {v ? <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-tertiary)', marginLeft: 3 }}>F CFA</span> : null}
            </div>
            <div className="aging-bar">
              <div style={{ width: `${Math.round((v / max) * 100)}%`, background: s.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Clients sub-components ───────────────────────────────────────────────────

type ClientFilterKey = 'all' | 'active' | 'lead' | 'balance';
type MiniInv = { id: string; sub: string; amt: number; status: InvoiceStatus };

const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = { active: 'Actif', lead: 'Prospect', inactive: 'Inactif' };
const INV_STATUS_LABEL: Record<MiniInv['status'], string> = { paid: 'Payée', pending: 'En attente', overdue: 'En retard', draft: 'Brouillon' };
const EMPTY_FORM: NewClientForm = { name: '', contact: '', email: '', phone: '', city: '', country: 'Burkina Faso', status: 'active', ifu: '', rccm: '', taxRegime: '', fiscalDivision: '' };
const CLIENT_FILTERS: { key: ClientFilterKey; label: string }[] = [
  { key: 'all', label: 'Tous' }, { key: 'active', label: 'Actifs' }, { key: 'lead', label: 'Prospects' }, { key: 'balance', label: 'Avec solde' },
];

// ─── Supplier sub-components ──────────────────────────────────────────────────

type SupplierFilterKey = 'all' | 'open' | 'overdue' | 'settled';
const SUPPLIER_FILTERS: { key: SupplierFilterKey; label: string }[] = [
  { key: 'all', label: 'Tous' }, { key: 'open', label: 'En cours' }, { key: 'overdue', label: 'En retard' }, { key: 'settled', label: 'Soldés' },
];

interface SupplierContact {
  name: string;
  city: string;
  bills: SupplierBill[];
  totalTTC: number;
  totalPayable: number;
  overdueCount: number;
}

interface BillForm { supplier: string; city: string; piece: string; date: string; dueDate: string; htAmount: string; paymentMethod: PaymentMethod; ifu: string; rccm: string; taxRegime: string; fiscalDivision: string }
const EMPTY_BILL_FORM: BillForm = { supplier: '', city: '', piece: '', date: new Date().toISOString().slice(0, 10), dueDate: '', htAmount: '', paymentMethod: 'wire', ifu: '', rccm: '', taxRegime: '', fiscalDivision: '' };

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  wire:   'Virement',
  cash:   'Espèces',
  mobile: 'Mobile money',
};
const PAYMENT_METHOD_ICONS: Record<PaymentMethod, string> = {
  wire:   'building-bank',
  cash:   'cash',
  mobile: 'device-mobile',
};
const TVA_RATE = 0.18;

function JournalLines({ lines }: { lines: SupplierBill['acctLines'] }) {
  return (
    <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 90px 90px', gap: 8, padding: '8px 14px', background: 'var(--color-background-secondary)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-secondary)' }}>
        <span>Cpte</span><span>Libellé</span><span style={{ textAlign: 'right' }}>Débit</span><span style={{ textAlign: 'right' }}>Crédit</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 90px 90px', gap: 8, padding: '9px 14px', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: 12.5, alignItems: 'center' }}>
          <span className="mono" style={{ fontWeight: 700, color: 'var(--brand)' }}>{l.acct}</span>
          <span style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
          <span className="mono" style={{ textAlign: 'right', fontWeight: l.side === 'D' ? 600 : 400, color: l.side === 'D' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{l.side === 'D' ? fmt(l.amount) : '—'}</span>
          <span className="mono" style={{ textAlign: 'right', fontWeight: l.side === 'C' ? 600 : 400, color: l.side === 'C' ? '#A32D2D' : 'var(--color-text-tertiary)' }}>{l.side === 'C' ? fmt(l.amount) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

function BillDrawer({ bill, onMarkPaid, onClose }: { bill: SupplierBill; onMarkPaid: (id: string) => void; onClose: () => void }) {
  const av = supplierAvColor(bill.supplier);
  return (
    <DrawerPanel open onClose={onClose} title={
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: av.bg, color: av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
          {supplierInitials(bill.supplier)}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{bill.supplier}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{bill.city} · {bill.piece}</div>
        </div>
      </div>
    }>
      {/* Meta grid: date, due, status, payment method */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {([
          { label: 'Date facture', value: bill.date },
          { label: 'Échéance', value: bill.dueDate },
          { label: 'Statut', value: <StatusPill status={bill.status} /> },
          { label: 'Mode de règlement', value: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name={PAYMENT_METHOD_ICONS[bill.paymentMethod]} size={14} />
              {PAYMENT_METHOD_LABELS[bill.paymentMethod]}
            </span>
          )},
        ] as { label: string; value: React.ReactNode }[]).map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '11px 13px', border: '0.5px solid var(--color-border-tertiary)' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-tertiary)' }}>{label}</div>
            <div style={{ marginTop: 5, fontSize: 13.5, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Amount breakdown */}
      <div className="dsec-label"><Icon name="receipt" size={13} />Détail montant</div>
      <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', marginBottom: 20 }}>
        {[
          { label: 'Montant HT', value: bill.htAmount },
          { label: 'TVA (18%)', value: bill.tvaAmount },
          { label: 'Total TTC', value: bill.htAmount + bill.tvaAmount, bold: true, highlight: true },
        ].map(({ label, value, bold, highlight }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', background: highlight ? 'var(--brand-tint)' : 'transparent', fontWeight: bold ? 700 : 400, fontSize: 13 }}>
            <span style={{ color: highlight ? 'var(--brand-dark)' : 'var(--color-text-secondary)' }}>{label}</span>
            <span className="mono">{fmt(value)} F CFA</span>
          </div>
        ))}
      </div>

      {/* Purchase journal entry */}
      <div className="dsec-label"><Icon name="book-2" size={13} />Écriture d'achat (AC)</div>
      <JournalLines lines={bill.acctLines} />

      {/* Payment journal entry — shown when paid */}
      {bill.status === 'paid' && (() => {
        const total = bill.htAmount + bill.tvaAmount;
        const creditAcct = bill.paymentMethod === 'cash' ? '571' : '521';
        const creditLabel = bill.paymentMethod === 'cash' ? 'Caisse' : 'Banque';
        const journalLabel = bill.paymentMethod === 'cash' ? 'Écriture de règlement (CA)' : 'Écriture de règlement (BQ)';
        return (
          <>
            <div className="dsec-label" style={{ marginTop: 4 }}><Icon name="book-2" size={13} />{journalLabel}</div>
            <JournalLines lines={[
              { acct: '401', label: 'Fournisseurs',  amount: total, side: 'D' },
              { acct: creditAcct, label: creditLabel, amount: total, side: 'C' },
            ]} />
          </>
        );
      })()}

      {bill.status !== 'paid' && (
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { onMarkPaid(bill.id); onClose(); }}>
          <Icon name="check" />Marquer comme payé · <span style={{ opacity: 0.8, fontSize: 12 }}>{PAYMENT_METHOD_LABELS[bill.paymentMethod]}</span>
        </button>
      )}
    </DrawerPanel>
  );
}

const TAX_REGIME_OPTIONS = [
  { value: '', label: 'Sélectionner…' },
  { value: 'reel', label: 'Réel normal' },
  { value: 'simplifie', label: 'Réel simplifié' },
  { value: 'micro', label: 'Micro-entreprise' },
  { value: 'forfait', label: 'Forfait' },
  { value: 'exonere', label: 'Exonéré' },
];

function NewBillDrawer({ onSave, onClose, initialSupplier = '' }: { onSave: (f: BillForm) => Promise<void>; onClose: () => void; initialSupplier?: string }) {
  const [form, setForm] = useState<BillForm>({ ...EMPTY_BILL_FORM, supplier: initialSupplier });
  const [amountMode, setAmountMode] = useState<'ht' | 'ttc'>('ht');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof BillForm, v: string) => setForm(p => ({ ...p, [k]: v }));
  const raw = parseFloat(form.htAmount) || 0;
  const ht  = amountMode === 'ht' ? raw : Math.round(raw / (1 + TVA_RATE));
  const tva = Math.round(ht * TVA_RATE);
  const ttc = ht + tva;
  const valid = form.supplier.trim() && form.piece.trim() && form.dueDate && raw > 0;
  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try { await onSave({ ...form, htAmount: String(ht) }); onClose(); } finally { setSaving(false); }
  };
  return (
    <DrawerPanel open onClose={onClose} title="Nouvelle facture fournisseur" subtitle="Enregistrement d'une dette">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="form-label">Fournisseur *</label>
          <input className="form-input" value={form.supplier} onChange={e => set('supplier', e.target.value)} placeholder="Nom du fournisseur" />
        </div>
        <div>
          <label className="form-label">Ville</label>
          <input className="form-input" value={form.city} onChange={e => set('city', e.target.value)} placeholder="Ouagadougou" />
        </div>
        <div>
          <label className="form-label">Référence pièce *</label>
          <input className="form-input" value={form.piece} onChange={e => set('piece', e.target.value)} placeholder="FACT-2026-001" />
        </div>
        <div>
          <label className="form-label">Date facture</label>
          <input className="form-input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Date d'échéance *</label>
          <input className="form-input" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="form-label">Saisie du montant</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['ht', 'ttc'] as const).map(m => (
              <button key={m} type="button" onClick={() => setAmountMode(m)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 10px', borderRadius: 'var(--border-radius-md)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all .1s',
                  border: amountMode === m ? '1.5px solid var(--brand)' : '0.5px solid var(--color-border-secondary)',
                  background: amountMode === m ? 'var(--brand-tint)' : 'var(--color-background-primary)',
                  color: amountMode === m ? 'var(--brand)' : 'var(--color-text-secondary)',
                }}>
                {m === 'ht' ? 'Montant HT (hors taxe)' : 'Montant TTC (taxe incluse)'}
              </button>
            ))}
          </div>
          <input className="form-input" type="number" min="0" value={form.htAmount}
            onChange={e => set('htAmount', e.target.value)}
            placeholder={amountMode === 'ht' ? 'Montant hors taxe' : 'Montant toutes taxes comprises'} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="form-label">Mode de règlement</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['wire', 'cash', 'mobile'] as PaymentMethod[]).map(m => (
              <button key={m} type="button"
                onClick={() => set('paymentMethod', m)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 10px', borderRadius: 'var(--border-radius-md)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all .1s',
                  border: form.paymentMethod === m ? '1.5px solid var(--brand)' : '0.5px solid var(--color-border-secondary)',
                  background: form.paymentMethod === m ? 'var(--brand-tint)' : 'var(--color-background-primary)',
                  color: form.paymentMethod === m ? 'var(--brand)' : 'var(--color-text-secondary)',
                }}>
                <Icon name={PAYMENT_METHOD_ICONS[m]} size={14} />
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {raw > 0 && (
        <div style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', padding: '11px 14px', marginBottom: 16 }}>
          {[{ label: 'Montant HT', value: ht }, { label: 'TVA (18%)', value: tva }, { label: 'Total TTC', value: ttc }].map(({ label, value }, i) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: i > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none', fontWeight: i === 2 ? 700 : 400, fontSize: 12.5 }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
              <span className="mono">{fmt(value)} F CFA</span>
            </div>
          ))}
        </div>
      )}

      <div className="dsec-label" style={{ marginTop: 4 }}><Icon name="id-badge-2" size={13} />Informations fiscales fournisseur</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="form-label">IFU</label>
          <input className="form-input" value={form.ifu} onChange={e => set('ifu', e.target.value)} placeholder="Identifiant fiscal unique" />
        </div>
        <div>
          <label className="form-label">RCCM</label>
          <input className="form-input" value={form.rccm} onChange={e => set('rccm', e.target.value)} placeholder="Registre de commerce" />
        </div>
        <div>
          <label className="form-label">Régime fiscal</label>
          <select className="form-input" value={form.taxRegime} onChange={e => set('taxRegime', e.target.value)}>
            {TAX_REGIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Division fiscale</label>
          <FiscalDivisionSelect value={form.fiscalDivision} onChange={v => set('fiscalDivision', v)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 9 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!valid || saving} onClick={handleSave}>
          <Icon name="check" size={15} />{saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </DrawerPanel>
  );
}

const BILL_STATUS_FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'open', label: 'En cours' },
  { key: 'overdue', label: 'En retard' },
  { key: 'paid', label: 'Payées' },
];

function SupplierDetailDrawer({ supplier, onClose, onMarkPaid, onNewBill }: {
  supplier: SupplierContact;
  onClose: () => void;
  onMarkPaid: (id: string) => void;
  onNewBill: (name: string) => void;
}) {
  const [localBill, setLocalBill] = useState<SupplierBill | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const av = supplierAvColor(supplier.name);

  if (localBill) {
    return <BillDrawer bill={localBill} onMarkPaid={onMarkPaid} onClose={() => setLocalBill(null)} />;
  }

  const visibleBills = statusFilter === 'all' ? supplier.bills : supplier.bills.filter(b => b.status === statusFilter);
  const statusCounts: Record<string, number> = { all: supplier.bills.length };
  supplier.bills.forEach(b => { statusCounts[b.status] = (statusCounts[b.status] || 0) + 1; });

  // Per-supplier aging bar
  const ageTot: Record<string, number> = {};
  supplier.bills.forEach(b => {
    const k = ageBucket(b);
    if (k) ageTot[k] = (ageTot[k] || 0) + b.htAmount + b.tvaAmount;
  });
  const ageCols: Record<string, string> = { cur: '#2E7D32', d30: '#B26A09', d60: '#C2570B', d90: '#A32D2D' };
  const ageTotal = Object.values(ageTot).reduce((a, v) => a + v, 0) || 1;

  return (
    <DrawerPanel open onClose={onClose} title={
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: av.bg, color: av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
          {supplierInitials(supplier.name)}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{supplier.name}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="map-pin" size={12} />{supplier.city}
          </div>
        </div>
      </div>
    }>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '11px 13px', border: '0.5px solid var(--color-border-tertiary)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-tertiary)' }}>Total TTC</div>
          <div className="mono" style={{ marginTop: 5, fontSize: 17, fontWeight: 700, letterSpacing: -0.4 }}>{fmtCompact(supplier.totalTTC)}<span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-tertiary)', marginLeft: 3 }}>F CFA</span></div>
        </div>
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '11px 13px', border: '0.5px solid var(--color-border-tertiary)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-tertiary)' }}>À payer</div>
          <div className="mono" style={{ marginTop: 5, fontSize: 17, fontWeight: 700, letterSpacing: -0.4, color: supplier.totalPayable > 0 ? '#A32D2D' : 'var(--color-text-primary)' }}>
            {fmtCompact(supplier.totalPayable)}<span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-tertiary)', marginLeft: 3 }}>F CFA</span>
          </div>
          {/* Aging mini-bar */}
          {supplier.totalPayable > 0 && (
            <div style={{ height: 5, display: 'flex', gap: 2, marginTop: 9, borderRadius: 3, overflow: 'hidden' }}>
              {(['cur', 'd30', 'd60', 'd90'] as const).map(k => ageTot[k] ? (
                <div key={k} style={{ height: '100%', borderRadius: 3, background: ageCols[k], flex: ageTot[k] / ageTotal }} />
              ) : null)}
            </div>
          )}
        </div>
      </div>

      {/* Bill status filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {BILL_STATUS_FILTERS.map(({ key, label }) => (
          <button key={key} onClick={() => setStatusFilter(key)}
            style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 20, border: '0.5px solid var(--color-border-secondary)', cursor: 'pointer', transition: 'all .1s',
              background: statusFilter === key ? 'var(--brand)' : 'var(--color-background-secondary)',
              color: statusFilter === key ? '#fff' : 'var(--color-text-secondary)' }}>
            {label} {statusCounts[key] ?? 0}
          </button>
        ))}
      </div>

      {/* Bills list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {visibleBills.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-tertiary)', fontSize: 13 }}>Aucune facture dans ce filtre</div>
        ) : visibleBills.map(bill => {
          const d = daysDue(bill.dueDate);
          const ttc = bill.htAmount + bill.tvaAmount;
          return (
            <div key={bill.id} onClick={() => setLocalBill(bill)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', borderRadius: 'var(--border-radius-md)', cursor: 'pointer', transition: 'background .1s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <div style={{ minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--brand)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bill.piece}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {bill.status === 'paid' ? 'Réglé' : bill.status === 'overdue'
                    ? <span style={{ color: '#A32D2D', fontWeight: 700 }}>{Math.abs(d)} j. de retard</span>
                    : `échéance ${fmtDate(bill.dueDate)}`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 12 }}>
                <div className="mono" style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 700 }}>
                  {fmt(ttc)} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)' }}>F CFA</span>
                </div>
                <StatusPill status={bill.status} />
                <Icon name="chevron-right" size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => {}}>
          <Icon name="download" size={15} />Relevé
        </button>
        <button className="btn btn-primary" style={{ flex: 1.4, justifyContent: 'center' }} onClick={() => { onClose(); onNewBill(supplier.name); }}>
          <Icon name="plus" size={15} />Nouvelle facture
        </button>
      </div>
    </DrawerPanel>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    searchParams.get('tab') === 'suppliers' ? 'suppliers' : 'clients'
  );

  useEffect(() => {
    setSearchParams(tab === 'suppliers' ? { tab: 'suppliers' } : {}, { replace: true });
  }, [tab]);

  // Clients data
  const { clients, setClients, invoices, quotes, payments, orgId, showToast, loading: clientsLoading } = useApp();
  const [clientFilter, setClientFilter] = useState<ClientFilterKey>('all');
  const [clientSearch, setClientSearch] = useState('');
  const [clientPanel, setClientPanel] = useState<null | { kind: 'detail'; code: string } | { kind: 'new' }>(null);
  const [form, setForm] = useState<NewClientForm>(EMPTY_FORM);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<NewClientForm>(EMPTY_FORM);
  const [deleteClient, setDeleteClient] = useState<ClientRecord | null>(null);

  // Suppliers data
  const { data: bills, loading: suppLoading, markPaid, createBill } = useSupplierBills();
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierContact | null>(null);
  const [showBillForm, setShowBillForm] = useState(false);
  const [billInitialSupplier, setBillInitialSupplier] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState<SupplierFilterKey>('all');

  // ── useMemo calls must be unconditional (before any early return) ─────────

  // Compute invoice counts and amounts from the live invoices array — the stored
  // invoices_count/billed/balance columns on clients are never updated after creation.
  const clientStatsMap = useMemo(() => {
    const map = new Map<string, { count: number; billed: number; balance: number }>();
    for (const inv of invoices) {
      if (inv.status === 'draft') continue;
      const s = map.get(inv.client) ?? { count: 0, billed: 0, balance: 0 };
      s.count  += 1;
      s.billed += inv.amount;
      if (inv.status === 'pending' || inv.status === 'overdue') s.balance += inv.amount;
      map.set(inv.client, s);
    }
    return map;
  }, [invoices]);

  const filteredClients = useMemo(() => {
    let list = clients;
    if (clientFilter === 'active')  list = list.filter(c => c.status === 'active');
    if (clientFilter === 'lead')    list = list.filter(c => c.status === 'lead');
    if (clientFilter === 'balance') list = list.filter(c => (clientStatsMap.get(c.code)?.balance ?? 0) > 0);
    if (clientSearch.trim()) {
      const q = clientSearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.contact.toLowerCase().includes(q) || c.city.toLowerCase().includes(q));
    }
    return list;
  }, [clients, clientFilter, clientSearch, clientStatsMap]);

  const supplierBillsAll = bills ?? [];
  const supplierContacts = useMemo((): SupplierContact[] => {
    const map = new Map<string, SupplierContact>();
    supplierBillsAll.forEach(b => {
      const ttc = b.htAmount + b.tvaAmount;
      const ex = map.get(b.supplier);
      if (ex) {
        ex.bills.push(b);
        ex.totalTTC += ttc;
        if (b.status !== 'paid') ex.totalPayable += ttc;
        if (b.status === 'overdue') ex.overdueCount++;
      } else {
        map.set(b.supplier, { name: b.supplier, city: b.city, bills: [b], totalTTC: ttc, totalPayable: b.status !== 'paid' ? ttc : 0, overdueCount: b.status === 'overdue' ? 1 : 0 });
      }
    });
    return Array.from(map.values());
  }, [supplierBillsAll]);

  const filteredSuppliers = useMemo(() => {
    let list = supplierContacts;
    if (supplierFilter === 'overdue') list = list.filter(s => s.overdueCount > 0);
    else if (supplierFilter === 'open') list = list.filter(s => s.totalPayable > 0);
    else if (supplierFilter === 'settled') list = list.filter(s => s.totalPayable === 0);
    if (supplierSearch.trim()) {
      const q = supplierSearch.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q));
    }
    return list;
  }, [supplierContacts, supplierFilter, supplierSearch]);

  const loading = tab === 'clients' ? clientsLoading : suppLoading;
  if (loading) return <PageSkeleton title="Contacts" variant="accounting" rows={6} />;

  // ── Clients computed ──────────────────────────────────────────────────────
  const totalBilled  = Array.from(clientStatsMap.values()).reduce((s, v) => s + v.billed, 0);
  const outstanding  = Array.from(clientStatsMap.values()).reduce((s, v) => s + v.balance, 0);
  const activeCount  = clients.filter(c => c.status === 'active').length;
  const withBalance  = clients.filter(c => (clientStatsMap.get(c.code)?.balance ?? 0) > 0).length;
  const leadCount    = clients.filter(c => c.status === 'lead').length;
  const clientCounts = { all: clients.length, active: activeCount, lead: leadCount, balance: withBalance };

  const detailClient = clientPanel?.kind === 'detail' ? clients.find(c => c.code === clientPanel.code) ?? null : null;

  function closeClientPanel() { setClientPanel(null); setEditMode(false); }
  function openDetailEdit(cl: ClientRecord | null) {
    if (!cl) return;
    setEditForm({ name: cl.name, contact: cl.contact === '—' ? '' : cl.contact, email: cl.email === '—' ? '' : cl.email, phone: cl.phone === '—' ? '' : cl.phone, city: cl.city === '—' ? '' : cl.city, country: cl.country ?? 'Burkina Faso', status: cl.status, ifu: cl.ifu ?? '', rccm: cl.rccm ?? '', taxRegime: cl.taxRegime ?? '', fiscalDivision: cl.fiscalDivision ?? '' });
    setEditMode(true);
  }
  async function handleSaveEdit(cl: ClientRecord | null) {
    if (!cl) return;
    const patch = { name: editForm.name, contact: editForm.contact || '—', email: editForm.email || '—', phone: editForm.phone || '—', city: editForm.city || '—', country: editForm.country || 'Burkina Faso', status: editForm.status, ifu: editForm.ifu, rccm: editForm.rccm, taxRegime: editForm.taxRegime, fiscalDivision: editForm.fiscalDivision };
    const previous = clients.find(c => c.code === cl.code);
    setClients(prev => prev.map(c => c.code === cl.code ? { ...c, ...patch } : c));
    try {
      await updateClient(orgId, cl.code, patch);
      setEditMode(false);
      showToast('Client mis à jour');
    } catch (err) {
      if (previous) setClients(prev => prev.map(c => c.code === cl.code ? previous : c));
      showToast('Erreur lors de la mise à jour. Veuillez réessayer.', true);
      console.error('[updateClient]', err);
    }
  }
  function handleDeleteClient(cl: ClientRecord | null) {
    if (!cl) return;
    setDeleteClient(cl);
  }

  // Invoices, quotes and payments reference clients by code; deleting a client
  // that has any would leave those documents without a client.
  function documentCount(code: string) {
    return invoices.filter(i => i.client === code).length
      + quotes.filter(q => q.client === code).length
      + payments.filter(p => p.client === code).length;
  }

  async function archiveClient(cl: ClientRecord) {
    setDeleteClient(null);
    try {
      await updateClient(orgId, cl.code, { status: 'inactive' });
      setClients(prev => prev.map(c => c.code === cl.code ? { ...c, status: 'inactive' } : c));
      showToast(`"${cl.name}" est maintenant inactif`);
    } catch (err) {
      console.error('[archiveClient]', err);
      showToast('Erreur lors de la mise à jour. Veuillez réessayer.', true);
    }
  }

  async function confirmDeleteClient() {
    const cl = deleteClient;
    if (!cl) return;
    if (documentCount(cl.code) > 0) { await archiveClient(cl); return; }
    setDeleteClient(null);
    setClients(prev => prev.filter(c => c.code !== cl.code));
    try {
      await removeClient(orgId, cl.code);
      closeClientPanel();
      showToast(`"${cl.name}" supprimé`);
    } catch (err) {
      setClients(prev => [cl, ...prev]);
      showToast('Erreur lors de la suppression. Veuillez réessayer.', true);
      console.error('[removeClient]', err);
    }
  }
  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!orgId) { showToast('Impossible de sauvegarder : organisation introuvable.', true); return; }
    const avs = ['av-a','av-b','av-c','av-d','av-e','av-f','av-g','av-h'];
    const payload = { av: avs[clients.length % avs.length], name: form.name, contact: form.contact || '—', email: form.email || '—', phone: form.phone || '—', city: form.city || '—', country: form.country || 'Burkina Faso', ifu: form.ifu, rccm: form.rccm, taxRegime: form.taxRegime, fiscalDivision: form.fiscalDivision, status: form.status };
    try {
      // The code comes from the server sequence, so the client is added once it exists
      const created = await createClient(orgId, payload);
      setClients(prev => prev.some(c => c.code === created.code) ? prev : [created, ...prev]);
      setForm(EMPTY_FORM);
      closeClientPanel();
      showToast(`"${created.name}" ajouté`);
    } catch (err) {
      showToast('Erreur lors de l\'enregistrement du client. Veuillez réessayer.', true);
      console.error('[createClient]', err);
    }
  }

  // ── Suppliers computed ────────────────────────────────────────────────────
  const supplierBills = supplierBillsAll;
  const totalPayable  = supplierBills.filter(b => b.status !== 'paid').reduce((s, b) => s + b.htAmount + b.tvaAmount, 0);
  const dueSoon       = supplierBills.filter(b => b.status === 'open' && daysDue(b.dueDate) >= 0 && daysDue(b.dueDate) <= 7).reduce((s, b) => s + b.htAmount + b.tvaAmount, 0);
  const overdueTTC    = supplierBills.filter(b => b.status === 'overdue').reduce((s, b) => s + b.htAmount + b.tvaAmount, 0);
  const suppCount     = supplierContacts.length;
  const supplierCounts: Record<SupplierFilterKey, number> = {
    all: suppCount,
    overdue: supplierContacts.filter(s => s.overdueCount > 0).length,
    open: supplierContacts.filter(s => s.totalPayable > 0).length,
    settled: supplierContacts.filter(s => s.totalPayable === 0).length,
  };

  async function handleCreateBill(billForm: BillForm) {
    const ht = parseFloat(billForm.htAmount);
    await createBill({ supplier: billForm.supplier, city: billForm.city, piece: billForm.piece, date: billForm.date, dueDate: billForm.dueDate, htAmount: ht, tvaAmount: Math.round(ht * TVA_RATE), status: 'open', paymentMethod: billForm.paymentMethod, ifu: billForm.ifu || undefined, rccm: billForm.rccm || undefined, taxRegime: billForm.taxRegime || undefined, fiscalDivision: billForm.fiscalDivision || undefined });
  }

  // ── Contextual KPIs ───────────────────────────────────────────────────────
  const kpis = tab === 'clients' ? [
    { icon: 'users',        iconBg: 'var(--brand-tint)', iconColor: 'var(--brand)',  label: 'Clients',          value: clients.length,         sub: `${activeCount} actifs · ${leadCount} prospect${leadCount !== 1 ? 's' : ''}` },
    { icon: 'user-check',   iconBg: '#EAF3DE',           iconColor: '#3B6D11',       label: 'Actifs',           value: activeCount,             sub: 'relations de facturation' },
    { icon: 'report-money', iconBg: '#ECE9FB',            iconColor: '#5B45C7',       label: 'Total facturé',    value: fmtCompact(totalBilled), unit: 'F CFA', sub: 'revenu cumulé' },
    { icon: 'clock-pause',  iconBg: '#FAEEDA',            iconColor: '#B26A09',       label: 'Solde impayé (411)', value: fmtCompact(outstanding), unit: 'F CFA', sub: `${withBalance} client${withBalance !== 1 ? 's' : ''} avec solde` },
  ] : [
    { icon: 'truck-delivery', iconBg: 'var(--brand-tint)', iconColor: 'var(--brand)', label: 'À payer (401)',    value: fmtCompact(totalPayable), unit: 'F CFA', sub: `${supplierBills.filter(b => b.status !== 'paid').length} factures ouvertes` },
    { icon: 'clock',          iconBg: '#FAEEDA',            iconColor: '#B26A09',      label: 'Échéance ≤ 7 j.', value: fmtCompact(dueSoon),      unit: 'F CFA', sub: 'à planifier' },
    { icon: 'alert-triangle', iconBg: '#FCEBEB',            iconColor: '#A32D2D',      label: 'En retard',       value: fmtCompact(overdueTTC),   unit: 'F CFA', sub: `${supplierBills.filter(b => b.status === 'overdue').length} facture${supplierBills.filter(b => b.status === 'overdue').length !== 1 ? 's' : ''} échues` },
    { icon: 'briefcase',      iconBg: '#E7F3E2',            iconColor: '#2E7D32',      label: 'Fournisseurs',    value: suppCount,                sub: 'avec activité' },
  ];

  const tabSwitcher = (
    <PageTabs<Tab>
      tabs={[
        { key: 'clients',   label: 'Clients',      icon: 'users',          count: clients.length },
        { key: 'suppliers', label: 'Fournisseurs', icon: 'truck-delivery', count: suppCount },
      ]}
      active={tab}
      onChange={setTab}
      idPrefix="contacts"
    />
  );

  return (
    <>
      <div className="main" style={{ position: 'relative' }}>
        <div className="topbar">
          <div>
            <div className="page-title">Contacts</div>
            <div className="page-sub">Clients &amp; fournisseurs</div>
          </div>
          <div className="topbar-actions">
            <button className="btn"><Icon name="download" size={15} />Exporter</button>
            {tab === 'clients'
              ? <button className="btn btn-primary" onClick={() => setClientPanel({ kind: 'new' })}><Icon name="user-plus" size={15} />Nouveau client</button>
              : <button className="btn btn-primary" onClick={() => setShowBillForm(true)}><Icon name="plus" size={15} />Nouvelle facture</button>
            }
          </div>
        </div>

        <div className="content">
          {/* ── Contextual KPI strip ──────────────────────────────────────── */}
          <div className="metrics" style={{ marginBottom: 20 }}>
            {kpis.map(k => (
              <div key={k.label} className="metric-card">
                <div className="metric-top">
                  <div className="metric-ico" style={{ background: k.iconBg, color: k.iconColor }}><Icon name={k.icon} size={15} /></div>
                  <div className="metric-label">{k.label}</div>
                </div>
                <div className="metric-value mono">{k.value}{k.unit ? <span className="metric-unit">{k.unit}</span> : null}</div>
                <div className="metric-change neutral">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Clients tab ──────────────────────────────────────────────── */}
          {tab === 'clients' && (
            <>
              <div className="section-header">
                {tabSwitcher}
                <div className="list-controls">
                  <div className="search-box">
                    <Icon name="search" size={15} />
                    <input type="text" placeholder="Rechercher un client…" value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
                  </div>
                  <div className="filters">
                    {CLIENT_FILTERS.map(f => (
                      <button key={f.key} className={'filter-chip' + (clientFilter === f.key ? ' active' : '')} onClick={() => setClientFilter(f.key)}>
                        {f.label}<span className="cnt">{clientCounts[f.key]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="client-table" role="tabpanel" id={tabPanelId('contacts')} aria-labelledby={tabId('contacts', tab)}>
                <div className="table-head client-grid-cols">
                  <div className="th">Client</div>
                  <div className="th">Localisation</div>
                  <div className="th">Factures</div>
                  <div className="th right">Total facturé</div>
                  <div className="th">Statut</div>
                  <div className="th" />
                </div>
                {filteredClients.length === 0 ? (
                  <EmptyState illustration={<ClientsEmptyIllustration />} title="Aucun client trouvé" description="Aucun client ne correspond à votre recherche. Essayez d'autres termes." />
                ) : filteredClients.map(cl => {
                    const stats = clientStatsMap.get(cl.code) ?? { count: 0, billed: 0, balance: 0 };
                    return (
                      <div key={cl.code} className="client-row client-grid-cols" onClick={() => setClientPanel({ kind: 'detail', code: cl.code })}>
                        <div className="name-cell">
                          <div className={`cl-av ${cl.av}`}>{clientInitials(cl.name)}</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="cl-name">{cl.name}</div>
                            <div className="cl-contact">{cl.contact}</div>
                          </div>
                        </div>
                        <div className="loc-cell"><Icon name="map-pin" size={14} /><span>{cl.city}</span></div>
                        <div className="inv-count tnum">{stats.count} <span>facture{stats.count !== 1 ? 's' : ''}</span></div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="billed tnum">{fmt(stats.billed)}<span className="cur">F CFA</span></div>
                          {stats.balance > 0
                            ? <div className="billed-sub bal">{fmt(stats.balance)} F CFA dû</div>
                            : stats.billed > 0
                              ? <div className="billed-sub clear">Tout réglé</div>
                              : <div className="billed-sub" style={{ color: 'var(--color-text-tertiary)' }}>Aucune facture</div>
                          }
                        </div>
                        <div><span className={`status-pill s-${cl.status}`}>{CLIENT_STATUS_LABEL[cl.status]}</span></div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--color-text-tertiary)' }}>
                          <Icon name="chevron-right" size={16} />
                        </div>
                      </div>
                    );
                  })}
                {/* Table footer */}
                {filteredClients.length > 0 && (
                  <div className="dir-foot">
                    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                      {filteredClients.length} sur {clients.length} client{clients.length !== 1 ? 's' : ''}
                    </span>
                    <div className="dir-foot-r">
                      <span>Facturé<b>{fmt(filteredClients.reduce((a, c) => a + (clientStatsMap.get(c.code)?.billed ?? 0), 0))} F CFA</b></span>
                      <span>Solde impayé<b className={filteredClients.reduce((a, c) => a + (clientStatsMap.get(c.code)?.balance ?? 0), 0) > 0 ? 'due' : ''}>{fmt(filteredClients.reduce((a, c) => a + (clientStatsMap.get(c.code)?.balance ?? 0), 0))} F CFA</b></span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Suppliers tab ─────────────────────────────────────────────── */}
          {tab === 'suppliers' && (
            <>
              {/* AP Aging strip */}
              <AgingStrip bills={supplierBillsAll} />

              {/* Tabs + search + filter chips */}
              <div className="section-header">
                {tabSwitcher}
                <div className="list-controls">
                  <div className="search-box">
                    <Icon name="search" size={15} />
                    <input type="text" placeholder="Rechercher un fournisseur…" value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} />
                  </div>
                  <div className="filters">
                    {SUPPLIER_FILTERS.map(f => (
                      <button key={f.key} className={'filter-chip' + (supplierFilter === f.key ? ' active' : '')} onClick={() => setSupplierFilter(f.key)}>
                        {f.label}<span className="cnt">{supplierCounts[f.key]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="client-table" role="tabpanel" id={tabPanelId('contacts')} aria-labelledby={tabId('contacts', tab)}>
                <div className="table-head supplier-grid-cols" style={{ padding: '10px 18px' }}>
                  <div className="th">Fournisseur</div>
                  <div className="th">Factures</div>
                  <div className="th right">Total TTC</div>
                  <div className="th">Règlement</div>
                  <div className="th" />
                </div>
                {filteredSuppliers.length === 0 ? (
                  <EmptyState illustration={<SuppliersEmptyIllustration />} title="Aucun fournisseur" description="Aucun fournisseur trouvé pour ce filtre." />
                ) : filteredSuppliers.map(s => {
                  const av = supplierAvColor(s.name);
                  const pill = s.overdueCount > 0
                    ? <span className="status-pill s-overdue">{s.overdueCount} en retard</span>
                    : s.totalPayable > 0
                      ? <span className="status-pill s-ontrack">En cours</span>
                      : <span className="status-pill s-settled">Soldé</span>;
                  return (
                    <div key={s.name} className="supplier-row supplier-grid-cols" onClick={() => setSelectedSupplier(s)}>
                      <div className="name-cell">
                        <div style={{ width: 36, height: 36, borderRadius: 9, background: av.bg, color: av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11.5, flexShrink: 0 }}>
                          {supplierInitials(s.name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="cl-name">{s.name}</div>
                          <div className="cl-contact">{s.city}</div>
                        </div>
                      </div>
                      <div className="inv-count tnum">{s.bills.length} <span>facture{s.bills.length !== 1 ? 's' : ''}</span></div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="billed tnum">{fmt(s.totalTTC)}<span className="cur">F CFA</span></div>
                        {s.totalPayable > 0
                          ? <div className="billed-sub bal">{fmt(s.totalPayable)} F CFA à payer</div>
                          : <div className="billed-sub clear">Rien dû</div>
                        }
                      </div>
                      <div>{pill}</div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--color-text-tertiary)' }}>
                        <Icon name="chevron-right" size={16} />
                      </div>
                    </div>
                  );
                })}
                {/* Table footer */}
                {filteredSuppliers.length > 0 && (
                  <div className="dir-foot">
                    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                      {filteredSuppliers.length} sur {suppCount} fournisseur{suppCount !== 1 ? 's' : ''}
                    </span>
                    <div className="dir-foot-r">
                      <span>Total TTC<b>{fmt(filteredSuppliers.reduce((a, s) => a + s.totalTTC, 0))} F CFA</b></span>
                      <span>À payer<b className={filteredSuppliers.reduce((a, s) => a + s.totalPayable, 0) > 0 ? 'due' : ''}>{fmt(filteredSuppliers.reduce((a, s) => a + s.totalPayable, 0))} F CFA</b></span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Client panels ────────────────────────────────────────────────── */}
      <div className={'scrim' + (clientPanel ? ' open' : '')} onClick={closeClientPanel} />

      <div className={'new-inv-panel' + (clientPanel?.kind === 'detail' ? ' open' : '')}>
        {detailClient && (
          <>
            <div className="panel-slide-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className={`cl-av ${detailClient.av}`} style={{ width: 44, height: 44, borderRadius: 11, fontSize: 14 }}>{clientInitials(detailClient.name)}</div>
                <div>
                  <div className="panel-slide-title">{detailClient.name}</div>
                  <div className="panel-slide-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="map-pin" size={11} />{detailClient.city}
                    <span className={`status-pill s-${detailClient.status}`} style={{ marginLeft: 4 }}>{CLIENT_STATUS_LABEL[detailClient.status]}</span>
                  </div>
                </div>
              </div>
              <button className="icon-btn" onClick={closeClientPanel} aria-label="Fermer"><Icon name="x" size={18} /></button>
            </div>
            <div className="panel-body">
              <div className="stat-row">
                <div className="stat-box">
                  <div className="stat-label">Total facturé</div>
                  <div className="stat-val tnum">{fmtCompact(clientStatsMap.get(detailClient.code)?.billed ?? 0)}<span className="cur">F CFA</span></div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Solde impayé</div>
                  <div className={'stat-val tnum' + ((clientStatsMap.get(detailClient.code)?.balance ?? 0) > 0 ? ' bal' : '')}>{fmtCompact(clientStatsMap.get(detailClient.code)?.balance ?? 0)}<span className="cur">F CFA</span></div>
                </div>
              </div>
              <div className="detail-block">
                <div className="detail-block-title">Contact</div>
                {editMode ? (
                  <>
                    {[
                      { label: 'Raison sociale', key: 'name' as const, type: 'text' },
                      { label: 'Contact principal', key: 'contact' as const, type: 'text' },
                      { label: 'Email', key: 'email' as const, type: 'email' },
                      { label: 'Téléphone', key: 'phone' as const, type: 'text' },
                      { label: 'Ville', key: 'city' as const, type: 'text' },
                    ].map(({ label, key, type }) => (
                      <div key={key} className="form-group" style={{ marginBottom: 8 }}>
                        <label className="form-label">{label}</label>
                        <input className="form-input" type={type} value={editForm[key] as string} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} />
                      </div>
                    ))}
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Statut</label>
                      <select className="form-input" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as ClientStatus }))}>
                        <option value="active">Actif</option>
                        <option value="lead">Prospect</option>
                        <option value="inactive">Inactif</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Pays</label>
                      <select className="form-input" value={editForm.country} onChange={e => setEditForm(f => ({ ...f, country: e.target.value }))}>
                        {OHADA_COUNTRY_NAMES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">{getFiscalIdLabel(editForm.country)} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
                      <input className="form-input" type="text" placeholder="00012345 B" value={editForm.ifu} onChange={e => setEditForm(f => ({ ...f, ifu: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">RCCM <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
                      <input className="form-input" type="text" placeholder="BF-OUA-2021-B-1234" value={editForm.rccm} onChange={e => setEditForm(f => ({ ...f, rccm: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Régime fiscal <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
                      <input className="form-input" type="text" placeholder="RNI, RSI…" value={editForm.taxRegime} onChange={e => setEditForm(f => ({ ...f, taxRegime: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Division fiscale <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
                      <FiscalDivisionSelect value={editForm.fiscalDivision} onChange={v => setEditForm(f => ({ ...f, fiscalDivision: v }))} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="contact-line"><Icon name="mail" size={16} /><span>{detailClient.email}</span></div>
                    <div className="contact-line"><Icon name="phone" size={16} /><span>{detailClient.phone}</span></div>
                    <div className="contact-line"><Icon name="map-pin" size={16} /><span>{detailClient.city}</span></div>
                  </>
                )}
              </div>
              {(detailClient.ifu || detailClient.rccm || detailClient.taxRegime || detailClient.fiscalDivision) && (
                <div className="detail-block">
                  <div className="detail-block-title">Identifiants fiscaux</div>
                  {detailClient.ifu && <div className="contact-line"><Icon name="file-text" size={16} /><span>{getFiscalIdLabel(detailClient.country)}&nbsp;<strong>{detailClient.ifu}</strong></span></div>}
                  {detailClient.rccm && <div className="contact-line"><Icon name="building" size={16} /><span>RCCM&nbsp;<strong>{detailClient.rccm}</strong></span></div>}
                  {detailClient.taxRegime && <div className="contact-line"><Icon name="tag" size={16} /><span>Régime&nbsp;<strong>{detailClient.taxRegime}</strong></span></div>}
                  {detailClient.fiscalDivision && <div className="contact-line"><Icon name="sitemap" size={16} /><span>Division fiscale&nbsp;<strong>{fiscalDivisionLabel(detailClient.fiscalDivision)}</strong></span></div>}
                </div>
              )}
              <div className="detail-block">
                <div className="detail-block-title">Factures récentes</div>
                {(() => {
                  const recentInvs: MiniInv[] = invoices.filter(i => i.client === detailClient.code).slice(0, 5).map(i => ({ id: i.id, sub: i.subject, amt: i.amount, status: i.status }));
                  return recentInvs.length === 0 ? (
                    <EmptyInline message="Aucune facture pour ce client." />
                  ) : recentInvs.map(inv => (
                    <div key={inv.id} className="mini-inv">
                      <div><div className="mini-id">#{inv.id}</div><div className="mini-sub">{inv.sub}</div></div>
                      <div className="mini-amt">{fmt(inv.amt)} F CFA</div>
                      <span className={`mini-status st-${inv.status}`}>{INV_STATUS_LABEL[inv.status]}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
            <div className="panel-footer" style={{ flexDirection: 'column', gap: 8 }}>
              {editMode ? (
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditMode(false)}>Annuler</button>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleSaveEdit(detailClient)}><Icon name="check" size={15} /> Enregistrer</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => openDetailEdit(detailClient)}><Icon name="edit" size={15} /> Modifier</button>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}><Icon name="plus" size={15} /> Nouvelle facture</button>
                </div>
              )}
              <button className="btn" style={{ width: '100%', justifyContent: 'center', color: '#A32D2D' }} onClick={() => handleDeleteClient(detailClient)}><Icon name="trash" size={15} /> Supprimer ce client</button>
            </div>
          </>
        )}
      </div>

      <div className={'new-inv-panel' + (clientPanel?.kind === 'new' ? ' open' : '')}>
        <div className="panel-slide-head">
          <div>
            <div className="panel-slide-title">Nouveau client</div>
            <div className="panel-slide-sub">Ajouter une entreprise que vous facturez</div>
          </div>
          <button className="icon-btn" onClick={closeClientPanel} aria-label="Fermer"><Icon name="x" size={18} /></button>
        </div>
        <form id="new-client-form" className="panel-body" onSubmit={handleAddClient}>
          <div className="form-group">
            <label className="form-label">Raison sociale</label>
            <input className="form-input" placeholder="ex. Faso Energy" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Contact principal</label>
            <input className="form-input" placeholder="ex. Awa Bamba" value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="contact@entreprise.bf" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Téléphone</label>
              <input className="form-input" type="tel" placeholder="70 00 00 00" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Ville</label>
              <input className="form-input" placeholder="Ouagadougou" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Pays</label>
              <select className="form-input" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}>
                {OHADA_COUNTRY_NAMES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Statut</label>
            <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ClientStatus }))}>
              <option value="active">Actif</option>
              <option value="lead">Prospect</option>
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{getFiscalIdLabel(form.country)} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
              <input className="form-input" placeholder={form.country === 'Sénégal' ? '0123456789123' : form.country === 'Cameroun' ? 'M012345678901R' : '00012345 B'} value={form.ifu} onChange={e => setForm(f => ({ ...f, ifu: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">RCCM <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
              <input className="form-input" placeholder="BF-OUA-2021-B-1234" value={form.rccm} onChange={e => setForm(f => ({ ...f, rccm: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Régime fiscal <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
            <select className="form-input" value={form.taxRegime} onChange={e => setForm(f => ({ ...f, taxRegime: e.target.value }))}>
              <option value="">— Sélectionner —</option>
              <option value="RNI">RNI — Régime normal d'imposition (CA ≥ 50M F CFA)</option>
              <option value="RSI">RSI — Régime simplifié d'imposition (CA 15–50M F CFA)</option>
              <option value="CME">CME — Contribution des micro-entreprises (CA &lt; 15M F CFA)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Division fiscale <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
            <FiscalDivisionSelect value={form.fiscalDivision} onChange={v => setForm(f => ({ ...f, fiscalDivision: v }))} />
          </div>
        </form>
        <div className="panel-footer">
          <button type="button" className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={closeClientPanel}>Annuler</button>
          <button type="submit" form="new-client-form" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}><Icon name="check" size={15} />Ajouter</button>
        </div>
      </div>

      {/* ── Supplier drawers ─────────────────────────────────────────────── */}
      {selectedSupplier && (
        <SupplierDetailDrawer
          supplier={selectedSupplier}
          onMarkPaid={markPaid}
          onNewBill={name => { setBillInitialSupplier(name); setSelectedSupplier(null); setShowBillForm(true); }}
          onClose={() => setSelectedSupplier(null)}
        />
      )}
      {showBillForm && <NewBillDrawer initialSupplier={billInitialSupplier} onSave={handleCreateBill} onClose={() => setShowBillForm(false)} />}
      {deleteClient && (documentCount(deleteClient.code) > 0 ? (
        <ConfirmModal
          title="Ce client ne peut pas être supprimé"
          body={`"${deleteClient.name}" a ${documentCount(deleteClient.code)} document(s) (factures, devis ou paiements). Pour le retirer de vos listes sans perdre l'historique, passez-le en Inactif.`}
          confirmLabel="Passer en Inactif"
          onConfirm={confirmDeleteClient}
          onClose={() => setDeleteClient(null)}
        />
      ) : (
        <ConfirmModal
          title="Supprimer le client"
          body={`Supprimer "${deleteClient.name}" ? Cette action est irréversible.`}
          confirmLabel="Supprimer le client"
          onConfirm={confirmDeleteClient}
          onClose={() => setDeleteClient(null)}
        />
      ))}
    </>
  );
}
