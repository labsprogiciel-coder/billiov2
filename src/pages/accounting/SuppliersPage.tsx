import { useState, useMemo } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import KPIStrip from '@/components/accounting/KPIStrip';
import DrawerPanel from '@/components/accounting/DrawerPanel';
import StatusPill from '@/components/accounting/StatusPill';
import { EmptyState } from '@/components/EmptyState';
import type { SupplierBill } from '@/lib/accounting-data';
import { fmt, fmtCompact } from '@/lib/accounting-data';
import { useSupplierBills } from '@/lib/accounting-hooks';
import { SuppliersEmptyIllustration } from '@/components/accounting/EmptyIllustrations';
import { VAT_LABEL, VAT_RATE } from '@/lib/vat';
import { exerciseYear } from '@/lib/period';
import { todayISO } from '@/lib/invoice-status';
import Page from '@/components/Page';

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

// Whole calendar days between today and the due date (both at UTC midnight)
function daysDue(dueDate: string): number {
  return Math.round((Date.parse(dueDate + 'T00:00:00Z') - Date.parse(todayISO() + 'T00:00:00Z')) / 86400000);
}

function BillDrawer({ bill, onMarkPaid, onClose }: { bill: SupplierBill; onMarkPaid: (id: string) => void; onClose: () => void }) {
  const { writable } = usePermissions();
  const av = supplierAvColor(bill.supplier);
  const days = daysDue(bill.dueDate);
  return (
    <DrawerPanel
      open
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: av.bg, color: av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
            {supplierInitials(bill.supplier)}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{bill.supplier}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{bill.city} · {bill.piece}</div>
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Date facture', value: bill.date },
          { label: 'Échéance', value: bill.dueDate },
          { label: 'Statut', value: <StatusPill status={bill.status} /> },
          { label: days > 0 ? 'Jours restants' : 'Jours retard', value: `${Math.abs(days)} j.` },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '11px 13px', border: '0.5px solid var(--color-border-tertiary)' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-tertiary)' }}>{label}</div>
            <div style={{ marginTop: 5, fontSize: 13.5, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="dsec-label"><Icon name="receipt" size={13} />Détail montant</div>
      <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', marginBottom: 20 }}>
        {[
          { label: 'Montant HT', value: bill.htAmount },
          { label: VAT_LABEL, value: bill.tvaAmount },
          { label: 'Total TTC', value: bill.htAmount + bill.tvaAmount, bold: true, highlight: true },
        ].map(({ label, value, bold, highlight }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', background: highlight ? 'var(--brand-tint)' : 'transparent', fontWeight: bold ? 700 : 400, fontSize: 13 }}>
            <span style={{ color: highlight ? 'var(--brand-dark)' : 'var(--color-text-secondary)' }}>{label}</span>
            <span className="mono">{fmt(value)} F CFA</span>
          </div>
        ))}
      </div>

      <div className="dsec-label"><Icon name="book-2" size={13} />Simulation comptable</div>
      <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 100px 100px', gap: 8, padding: '8px 14px', background: 'var(--color-background-secondary)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-secondary)' }}>
          <span>Compte</span><span>Libellé</span><span style={{ textAlign: 'right' }}>Débit</span><span style={{ textAlign: 'right' }}>Crédit</span>
        </div>
        {bill.acctLines.map((l, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 100px 100px', gap: 8, padding: '10px 14px', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: 12.5, alignItems: 'center' }}>
            <span className="mono" style={{ fontWeight: 700, color: 'var(--brand)' }}>{l.acct}</span>
            <span style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
            <span className="mono" style={{ textAlign: 'right', fontWeight: l.side === 'D' ? 600 : 400, color: l.side === 'D' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{l.side === 'D' ? fmt(l.amount) : '—'}</span>
            <span className="mono" style={{ textAlign: 'right', fontWeight: l.side === 'C' ? 600 : 400, color: l.side === 'C' ? '#A32D2D' : 'var(--color-text-tertiary)' }}>{l.side === 'C' ? fmt(l.amount) : '—'}</span>
          </div>
        ))}
      </div>

      {writable && bill.status !== 'paid' && (
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { onMarkPaid(bill.id); onClose(); }}>
          <Icon name="check" />Marquer comme payé
        </button>
      )}
    </DrawerPanel>
  );
}

interface BillForm { supplier: string; city: string; piece: string; date: string; dueDate: string; htAmount: string; ifu: string; rccm: string; taxRegime: string }
const EMPTY_BILL_FORM: BillForm = { supplier: '', city: '', piece: '', date: new Date().toISOString().slice(0, 10), dueDate: '', htAmount: '', ifu: '', rccm: '', taxRegime: '' };

const TAX_REGIME_OPTIONS = [
  { value: '', label: 'Sélectionner…' },
  { value: 'reel', label: 'Réel normal' },
  { value: 'simplifie', label: 'Réel simplifié' },
  { value: 'micro', label: 'Micro-entreprise' },
  { value: 'forfait', label: 'Forfait' },
  { value: 'exonere', label: 'Exonéré' },
];

function NewBillDrawer({ onSave, onClose }: { onSave: (f: BillForm, htAmount: number) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState<BillForm>(EMPTY_BILL_FORM);
  const [amountMode, setAmountMode] = useState<'ht' | 'ttc'>('ht');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof BillForm, v: string) => setForm(p => ({ ...p, [k]: v }));
  const raw = parseFloat(form.htAmount) || 0;
  const ht  = amountMode === 'ht' ? raw : Math.round(raw / (1 + VAT_RATE));
  const tva = Math.round(ht * VAT_RATE);
  const ttc = ht + tva;
  const valid = form.supplier.trim() && form.piece.trim() && form.dueDate && raw > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try { await onSave(form, ht); onClose(); } finally { setSaving(false); }
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
      </div>

      {raw > 0 && (
        <div style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', padding: '11px 14px', marginBottom: 16 }}>
          {[{ label: 'Montant HT', value: ht }, { label: VAT_LABEL, value: tva }, { label: 'Total TTC', value: ttc }].map(({ label, value }, i) => (
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
        <div style={{ gridColumn: '1/-1' }}>
          <label className="form-label">Régime fiscal</label>
          <select className="form-input" value={form.taxRegime} onChange={e => set('taxRegime', e.target.value)}>
            {TAX_REGIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
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

export default function SuppliersPage() {
  const { writable } = usePermissions();
  const { data: bills, loading, markPaid, createBill } = useSupplierBills();
  const [activeStatus, setActiveStatus] = useState('all');
  const [selected, setSelected] = useState<SupplierBill | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleCreate = async (form: BillForm, ht: number) => {
    await createBill({
      supplier:      form.supplier,
      city:          form.city,
      piece:         form.piece,
      date:          form.date,
      dueDate:       form.dueDate,
      htAmount:      ht,
      tvaAmount:     Math.round(ht * VAT_RATE),
      status:        'open',
      paymentMethod: 'wire',
      ifu:           form.ifu || undefined,
      rccm:          form.rccm || undefined,
      taxRegime:     form.taxRegime || undefined,
    });
  };

  const supplierBills = bills ?? [];

  const filtered = useMemo(() =>
    supplierBills.filter(b => activeStatus === 'all' || b.status === activeStatus),
    [supplierBills, activeStatus]);

  const totalPayable = supplierBills.filter(b => b.status !== 'paid').reduce((s, b) => s + b.htAmount + b.tvaAmount, 0);
  const dueSoon      = supplierBills.filter(b => b.status === 'open' && daysDue(b.dueDate) <= 7).reduce((s, b) => s + b.htAmount + b.tvaAmount, 0);
  const overdue      = supplierBills.filter(b => b.status === 'overdue').reduce((s, b) => s + b.htAmount + b.tvaAmount, 0);
  const suppCount    = new Set(supplierBills.map(b => b.supplier)).size;

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = { all: supplierBills.length };
    supplierBills.forEach(b => { m[b.status] = (m[b.status] || 0) + 1; });
    return m;
  }, [supplierBills]);

  if (loading) return <PageSkeleton section={{ icon: 'truck-delivery', label: 'Comptabilité' }} title="Fournisseurs" variant="accounting" rows={6} />;

  return (
    <Page
      section={{ icon: 'truck-delivery', label: 'Comptabilité' }}
      title="Fournisseurs"
      subtitle="Gestion des dettes fournisseurs et factures d'achat"
      actions={<>
        <span className="period-pill"><span className="dot" />Exercice {exerciseYear()} · ouvert</span>
        {writable && <button className="btn btn-primary" onClick={() => setShowForm(true)}><Icon name="plus" />Nouvelle facture</button>}
      </>}
      mainStyle={{ position: 'relative' }}
      after={<>

        {selected && <BillDrawer bill={selected} onMarkPaid={markPaid} onClose={() => setSelected(null)} />}
        {showForm && <NewBillDrawer onSave={handleCreate} onClose={() => setShowForm(false)} />}
      </>}
    >
        <KPIStrip items={[
          { icon: 'truck-delivery', iconBg: '#FCEFE0', iconColor: '#8A5207', label: 'Total à payer', value: fmtCompact(totalPayable), unit: 'F CFA', sub: `${supplierBills.filter(b => b.status !== 'paid').length} factures ouvertes` },
          { icon: 'clock-pause', iconBg: '#FAEEDA', iconColor: '#8A5207', label: 'Échéances ≤ 7j', value: fmtCompact(dueSoon), unit: 'F CFA', sub: 'Règlements urgents' },
          { icon: 'alert-triangle', iconBg: '#FCEBEB', iconColor: '#A32D2D', label: 'En retard', value: fmtCompact(overdue), unit: 'F CFA', sub: 'Dépassement d\'échéance' },
          { icon: 'users', iconBg: 'var(--brand-tint)', iconColor: 'var(--brand)', label: 'Fournisseurs actifs', value: suppCount, sub: 'Fournisseurs uniques' },
        ]} />

        <div className="acc-toolbar">
          <div className="chips">
            {[
              { key: 'all', label: 'Tous' },
              { key: 'open', label: 'En cours' },
              { key: 'overdue', label: 'En retard' },
              { key: 'paid', label: 'Payés' },
            ].map(({ key, label }) => (
              <button key={key} className={`chip-f${activeStatus === key ? ' active' : ''}`} onClick={() => setActiveStatus(key)}>
                {label} <span className="cnt">{statusCounts[key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 130px 120px 110px 36px', gap: 14, padding: '10px 18px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            {['Fournisseur', 'Échéance', 'Montant TTC', 'Statut', 'Retard', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, textAlign: i >= 2 && i <= 4 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>

          {filtered.length === 0
            ? <EmptyState
                illustration={<SuppliersEmptyIllustration />}
                title="Aucune facture"
                description="Aucune facture fournisseur ne correspond au statut sélectionné."
              />
            : filtered.map((bill, i) => {
              const av = supplierAvColor(bill.supplier);
              const days = daysDue(bill.dueDate);
              const ttc = bill.htAmount + bill.tvaAmount;
              return (
                <div
                  key={bill.id}
                  onClick={() => setSelected(bill)}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 110px 130px 120px 110px 36px', gap: 14, padding: '13px 18px', borderTop: i > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none', cursor: 'pointer', alignItems: 'center', transition: 'background .1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background-secondary)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: av.bg, color: av.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                      {supplierInitials(bill.supplier)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bill.supplier}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1 }}>{bill.piece}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, textAlign: 'right' }}>
                    <div style={{ fontWeight: 500 }}>{bill.dueDate}</div>
                  </div>
                  <div className="mono" style={{ textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(ttc)} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)' }}>F CFA</span></div>
                  <div style={{ textAlign: 'right' }}><StatusPill status={bill.status} /></div>
                  <div style={{ textAlign: 'right' }}>
                    {bill.status === 'overdue' && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#A32D2D' }}>{Math.abs(days)} j.</span>}
                    {bill.status === 'open' && days <= 7 && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#8A5207' }}>{days} j.</span>}
                    {bill.status === 'paid' && <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11.5 }}>—</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--color-text-tertiary)' }}><Icon name="chevron-right" size={16} /></div>
                </div>
              );
            })}
        </div>
    </Page>
  );
}
