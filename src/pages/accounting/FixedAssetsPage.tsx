import { useState } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import KPIStrip from '@/components/accounting/KPIStrip';
import DrawerPanel from '@/components/accounting/DrawerPanel';
import { EmptyState } from '@/components/EmptyState';
import type { FixedAsset } from '@/lib/accounting-data';
import { fmt, fmtCompact, amortSchedule, netValueOf } from '@/lib/accounting-data';
import { useFixedAssets } from '@/lib/accounting-hooks';
import { FixedAssetsEmptyIllustration } from '@/components/accounting/EmptyIllustrations';
import { exerciseYear } from '@/lib/period';
import Page from '@/components/Page';

const ASSET_METHODS = ['Linéaire', 'Dégressif'];
const ASSET_ICONS = ['building-warehouse', 'device-laptop', 'car', 'tool', 'server', 'printer'] as const;

interface AssetForm { name: string; acct: string; acquisitionDate: string; usefulLife: string; grossValue: string; method: string; icon: string }
const EMPTY_ASSET_FORM: AssetForm = { name: '', acct: '241', acquisitionDate: new Date().toISOString().slice(0, 10), usefulLife: '5', grossValue: '', method: 'Linéaire', icon: 'building-warehouse' };

function AssetForm({ onSave, onClose }: { onSave: (f: AssetForm) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState<AssetForm>(EMPTY_ASSET_FORM);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof AssetForm, v: string) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.name.trim() && form.acct.trim() && parseFloat(form.grossValue) > 0 && parseInt(form.usefulLife) > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try { await onSave(form); onClose(); } finally { setSaving(false); }
  };

  return (
    <DrawerPanel open onClose={onClose} title="Nouvelle immobilisation" subtitle="Enregistrement d'un actif">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="form-label">Désignation *</label>
          <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder='ex. MacBook Pro 16"' />
        </div>
        <div>
          <label className="form-label">Compte immobilisation *</label>
          <input className="form-input" value={form.acct} onChange={e => set('acct', e.target.value)} placeholder="241" />
        </div>
        <div>
          <label className="form-label">Méthode</label>
          <select className="form-input" value={form.method} onChange={e => set('method', e.target.value)}>
            {ASSET_METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Date d'acquisition *</label>
          <input className="form-input" type="date" value={form.acquisitionDate} onChange={e => set('acquisitionDate', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Durée (années) *</label>
          <input className="form-input" type="number" min="1" max="50" value={form.usefulLife} onChange={e => set('usefulLife', e.target.value)} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="form-label">Valeur brute (F CFA) *</label>
          <input className="form-input" type="number" min="0" value={form.grossValue} onChange={e => set('grossValue', e.target.value)} placeholder="0" />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label className="form-label">Icône</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {ASSET_ICONS.map(ic => (
              <button key={ic} onClick={() => set('icon', ic)} style={{ width: 36, height: 36, borderRadius: 9, border: form.icon === ic ? '2px solid var(--brand)' : '1.5px solid var(--color-border-tertiary)', background: form.icon === ic ? 'var(--brand-tint)' : 'var(--color-background-secondary)', color: form.icon === ic ? 'var(--brand)' : 'var(--color-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ic} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {form.grossValue && parseInt(form.usefulLife) > 0 && (
        <div style={{ background: 'var(--brand-tint)', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--border-radius-md)', padding: '10px 14px', marginBottom: 16, fontSize: 12.5 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Dotation annuelle · </span>
          <span style={{ fontWeight: 700, color: 'var(--brand)' }}>{fmt(parseFloat(form.grossValue) / parseInt(form.usefulLife))} F CFA</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 9 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!valid || saving} onClick={handleSave}>
          <Icon name="check" size={15} />{saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </DrawerPanel>
  );
}

function DepreciationProgress({ pct }: { pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--color-background-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#7C3AED,#5B45C7)', borderRadius: 3, transition: 'width .4s ease' }} />
      </div>
      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--color-text-secondary)', flexShrink: 0 }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function AssetDrawer({ asset, onClose }: { asset: FixedAsset; onClose: () => void }) {
  const grossValue = asset.grossValue;
  const netValue = netValueOf(asset);
  const amortCumul = grossValue - netValue;
  const pct = grossValue > 0 ? (amortCumul / grossValue) * 100 : 0;
  const annualAmort = grossValue / asset.usefulLife;
  const schedule = amortSchedule(asset);
  const currentYear = exerciseYear();

  return (
    <DrawerPanel
      open
      onClose={onClose}
      title={
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', letterSpacing: 0.4 }}>{asset.id}</div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.4, marginTop: 3 }}>{asset.name}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>Compte {asset.acct} · {asset.method}</div>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
        {[
          { label: 'Date d\'acquisition', value: asset.acquisitionDate },
          { label: 'Durée d\'utilisation', value: `${asset.usefulLife} ans` },
          { label: 'Valeur brute', value: `${fmt(grossValue)} F CFA` },
          { label: 'Amort. annuel', value: `${fmt(annualAmort)} F CFA` },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', padding: '11px 13px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>{label}</div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 5 }}>{value}</div>
          </div>
        ))}
        <div style={{ gridColumn: '1/-1', background: 'var(--brand-tint)', borderRadius: 'var(--border-radius-md)', padding: '13px 14px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--brand-dark)', marginBottom: 8 }}>Valeur nette comptable</div>
          <DepreciationProgress pct={pct} />
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, marginTop: 8, color: 'var(--brand-dark)' }}>{fmt(netValue)} <span style={{ fontSize: 13, opacity: 0.7 }}>F CFA</span></div>
          <div style={{ fontSize: 11.5, color: 'var(--brand)', marginTop: 3 }}>Amort. cumulé {fmt(amortCumul)} F CFA</div>
        </div>
      </div>

      <div className="dsec-label"><Icon name="calendar" size={13} />Plan d'amortissement</div>
      <div style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: 8, padding: '8px 14px', background: 'var(--color-background-secondary)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-secondary)' }}>
          <span>Année</span><span style={{ textAlign: 'right' }}>Dotation</span><span style={{ textAlign: 'right' }}>Cumulé</span><span style={{ textAlign: 'right' }}>VNC</span>
        </div>
        {schedule.map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', gap: 8, padding: '10px 14px', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: 12.5, background: row.year === currentYear ? 'var(--brand-tint)' : 'transparent', fontWeight: row.year === currentYear ? 600 : 400 }}>
            <span style={{ color: row.year === currentYear ? 'var(--brand)' : 'var(--color-text-secondary)', fontWeight: 700 }}>{row.year}</span>
            <span className="mono" style={{ textAlign: 'right' }}>{fmt(row.annualDepreciation)}</span>
            <span className="mono" style={{ textAlign: 'right', color: '#A32D2D' }}>{fmt(row.cumulative)}</span>
            <span className="mono" style={{ textAlign: 'right', fontWeight: row.year === currentYear ? 700 : 500 }}>{fmt(row.netValue)}</span>
          </div>
        ))}
      </div>
    </DrawerPanel>
  );
}

export default function FixedAssetsPage() {
  const { writable } = usePermissions();
  const { data: assets, loading, createAsset } = useFixedAssets();
  const [selected, setSelected] = useState<FixedAsset | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleCreate = async (form: AssetForm) => {
    await createAsset({
      id: `IMM-${Date.now().toString(36).toUpperCase()}`,
      name: form.name,
      acct: form.acct,
      icon: form.icon,
      acquisitionDate: form.acquisitionDate,
      usefulLife: parseInt(form.usefulLife),
      method: form.method,
      grossValue: parseFloat(form.grossValue),
    });
  };

  const fixedAssets = assets ?? [];
  const totalGross  = fixedAssets.reduce((s, a) => s + a.grossValue, 0);
  const totalNet    = fixedAssets.reduce((s, a) => s + netValueOf(a), 0);
  const totalAmort  = totalGross - totalNet;
  const monthlyAmort = fixedAssets.reduce((s, a) => s + a.grossValue / a.usefulLife / 12, 0);

  if (loading) return <PageSkeleton section={{ icon: 'building-warehouse', label: 'Comptabilité' }} title="Immobilisations" variant="accounting" rows={6} />;

  return (
    <Page
      section={{ icon: 'building-warehouse', label: 'Comptabilité' }}
      title="Immobilisations"
      subtitle="Registre des actifs et plan d'amortissement"
      actions={<>
        <span className="period-pill"><span className="dot" />Exercice {exerciseYear()} · ouvert</span>
        {writable && <button className="btn btn-primary" onClick={() => setShowForm(true)}><Icon name="plus" />Nouvelle immobilisation</button>}
      </>}
      mainStyle={{ position: 'relative' }}
      after={<>

        {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}
        {showForm && <AssetForm onSave={handleCreate} onClose={() => setShowForm(false)} />}
      </>}
    >
        <KPIStrip items={[
          { icon: 'building-warehouse', iconBg: '#ECE9FB', iconColor: '#5B45C7', label: 'Valeur brute totale', value: fmtCompact(totalGross), unit: 'F CFA', sub: `${fixedAssets.length} immobilisations` },
          { icon: 'trending-down', iconBg: '#FCEBEB', iconColor: '#A32D2D', label: 'Amort. cumulé', value: fmtCompact(totalAmort), unit: 'F CFA', sub: 'Dépréciation totale' },
          { icon: 'chart-bar', iconBg: 'var(--brand-tint)', iconColor: 'var(--brand)', label: 'Valeur nette (VNC)', value: fmtCompact(totalNet), unit: 'F CFA', sub: 'Valeur résiduelle' },
          { icon: 'calendar', iconBg: '#FAEEDA', iconColor: '#8A5207', label: 'Dotation mensuelle', value: fmtCompact(monthlyAmort), unit: 'F CFA', sub: 'Amortissement du mois' },
        ]} />

        <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 120px 180px 36px', gap: 14, padding: '10px 18px', background: 'var(--color-background-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            {['Immobilisation', 'Compte', 'Valeur brute', 'VNC', 'Amortissement', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, textAlign: i >= 2 && i <= 4 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>

          {fixedAssets.length === 0
            ? <EmptyState
                illustration={<FixedAssetsEmptyIllustration />}
                title="Aucune immobilisation"
                description="Ajoutez votre première immobilisation pour suivre les amortissements."
              />
            : fixedAssets.map((asset, i) => {
            const net = netValueOf(asset);
            const pct = asset.grossValue > 0 ? ((asset.grossValue - net) / asset.grossValue) * 100 : 0;
            return (
              <div
                key={asset.id}
                onClick={() => setSelected(asset)}
                style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 120px 180px 36px', gap: 14, padding: '14px 18px', borderTop: i > 0 ? '0.5px solid var(--color-border-tertiary)' : 'none', cursor: 'pointer', alignItems: 'center', transition: 'background .1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: '#ECE9FB', color: '#5B45C7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name={asset.icon} size={17} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{asset.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 1 }}>{asset.id}</div>
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 12.5, color: 'var(--brand)', fontWeight: 700 }}>{asset.acct}</div>
                <div className="mono" style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{fmt(asset.grossValue)}</div>
                <div className="mono" style={{ textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(net)}</div>
                <div><DepreciationProgress pct={pct} /></div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--color-text-tertiary)' }}><Icon name="chevron-right" size={16} /></div>
              </div>
            );
          })}
        </div>
    </Page>
  );
}
