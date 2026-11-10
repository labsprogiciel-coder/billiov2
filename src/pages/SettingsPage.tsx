import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { canManageOrg } from '@/lib/permissions';
import { usePermissions } from '@/lib/use-permissions';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import {
  PLANS, PLAN_LABELS, PLAN_ORDER, formatPrice,
  SOLO_INVOICE_LIMIT,
  type PlanStatus,
} from '@/lib/plans';
import {
  fetchPaymentSettings, upsertPaymentSettings,
  DEFAULT_PAYMENT_SETTINGS, type PaymentSettings,
} from '@/lib/api/payment-settings';
import { getFiscalIdLabel } from '@/lib/ohada';
import { sellerIssues, type SellerInfo } from '@/lib/invoice-compliance';
import { issuedThisMonth } from '@/lib/invoice-limit';

type SettingsTab = 'profile' | 'business' | 'invoicing' | 'reminders' | 'payments' | 'providers' | 'notifications' | 'team' | 'plan';

const TABS: { key: SettingsTab; icon: string; label: string }[] = [
  { key: 'profile',       icon: 'user',           label: 'Profil'               },
  { key: 'business',      icon: 'building',        label: 'Entreprise'           },
  { key: 'invoicing',     icon: 'file-invoice',    label: 'Préférences facture'  },
  { key: 'reminders',     icon: 'bell',            label: 'Relances'             },
  { key: 'payments',      icon: 'credit-card',     label: 'Moyens de paiement'   },
  { key: 'providers',     icon: 'plug-connected',  label: 'Prestataires'         },
  { key: 'notifications', icon: 'bell',            label: 'Notifications'        },
  { key: 'team',          icon: 'users',           label: 'Équipe'               },
  { key: 'plan',          icon: 'sparkles',        label: 'Plan & facturation'   },
];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={'s-toggle' + (on ? ' on' : '')}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    />
  );
}

/* ─── Profile ──────────────────────────────────────────────────── */
function ProfileSection() {
  const { userInitials, showToast } = useApp();

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [title,     setTitle]     = useState('');
  const [email,     setEmail]     = useState('');
  const [phone,     setPhone]     = useState('');
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [dirty,     setDirty]     = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (error) { console.error('[ProfileSection] getUser:', error.message); setLoading(false); return; }
      if (!user) { setLoading(false); return; }
      const m = (user.user_metadata ?? {}) as Record<string, string>;
      setFirstName(m.first_name ?? '');
      setLastName(m.last_name  ?? '');
      setTitle(m.title         ?? '');
      setEmail(user.email      ?? '');
      setPhone(m.phone         ?? '');
      setLoading(false);
    });
  }, []);

  function field<T>(setter: (v: T) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value as T);
      setDirty(true);
    };
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      email,
      data: { first_name: firstName, last_name: lastName, title, phone },
    });
    setSaving(false);
    if (error) { showToast(error.message, true); return; }
    setDirty(false);
    posthog.capture('settings_saved', { section: 'profile' });
    showToast('Profil enregistré');
  }

  function handleCancel() {
    setLoading(true);
    setDirty(false);
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (error) { console.error('[ProfileSection] getUser:', error.message); setLoading(false); return; }
      if (!user) { setLoading(false); return; }
      const m = (user.user_metadata ?? {}) as Record<string, string>;
      setFirstName(m.first_name ?? '');
      setLastName(m.last_name  ?? '');
      setTitle(m.title         ?? '');
      setEmail(user.email      ?? '');
      setPhone(m.phone         ?? '');
      setLoading(false);
    });
  }

  return (
    <div className="s-card">
      <div className="s-card-head">
        <div className="s-card-title">Profil</div>
        <div className="s-card-desc">Ces informations apparaissent sur votre compte et dans les journaux d'activité.</div>
      </div>
      <div className="s-card-body">
        <div className="s-field">
          <label className="s-label">Photo de profil</label>
          <div className="s-avatar-row">
            <div className="s-avatar-lg">{userInitials}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" disabled><Icon name="edit" size={14} /> Modifier</button>
            </div>
          </div>
        </div>
        <div className="s-field-row">
          <div className="s-field">
            <label className="s-label">Prénom</label>
            <input className="form-input" value={firstName} onChange={field(setFirstName)} disabled={loading} />
          </div>
          <div className="s-field">
            <label className="s-label">Nom</label>
            <input className="form-input" value={lastName} onChange={field(setLastName)} disabled={loading} />
          </div>
        </div>
        <div className="s-field-row">
          <div className="s-field">
            <label className="s-label">Titre</label>
            <input className="form-input" value={title} onChange={field(setTitle)} disabled={loading} placeholder="ex. Fondateur" />
          </div>
          <div className="s-field">
            <label className="s-label">Téléphone</label>
            <div className="input-affix">
              <span className="prefix">+226</span>
              <input value={phone} onChange={field(setPhone)} type="tel" disabled={loading} />
            </div>
          </div>
        </div>
        <div className="s-field">
          <label className="s-label">Adresse e-mail</label>
          <input className="form-input" type="email" value={email} onChange={field(setEmail)} disabled={loading} />
          {dirty && email !== '' && <div className="s-hint">Un e-mail de confirmation sera envoyé à la nouvelle adresse.</div>}
        </div>
      </div>
      <div className="s-card-foot">
        <button className="btn" onClick={handleCancel} disabled={saving || !dirty}>Annuler</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

const COUNTRIES = ['Bénin', 'Burkina Faso', 'Cameroun', 'Centrafrique', 'Comores', 'Congo', "Côte d'Ivoire", 'Gabon', 'Guinée', 'Guinée-Bissau', 'Guinée équatoriale', 'Mali', 'Niger', 'République démocratique du Congo', 'Sénégal', 'Tchad', 'Togo', 'Ghana', 'Nigeria'];
const CURRENCIES = [
  { value: 'F CFA', label: 'F CFA — Franc CFA' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'USD', label: 'USD — Dollar' },
  { value: 'GHS', label: 'GHS — Cedi' },
  { value: 'NGN', label: 'NGN — Naira' },
];

/* ─── Business ─────────────────────────────────────────────────── */
/* ─── DGI compliance checklist (PRO-133) ─────────────────────────── */
// The seller mentions every invoice must carry, from the values in the form
// below and the payment settings. Missing ones trigger a warning when an
// invoice is issued.
function ComplianceChecklist({ seller, orgId }: { seller: SellerInfo; orgId: string }) {
  const [payments, setPayments] = useState<PaymentSettings | null | undefined>(undefined);
  useEffect(() => {
    if (!orgId) return;
    fetchPaymentSettings(orgId).then(setPayments, () => setPayments(null));
  }, [orgId]);

  const missing = new Set(sellerIssues(seller, payments ?? null).map(i => i.key));
  const id = getFiscalIdLabel(seller.country);
  const rows: { key: string; label: string; hint?: string }[] = [
    { key: 'seller-name', label: 'Raison sociale' },
    { key: 'seller-address', label: 'Adresse' },
    { key: 'seller-ifu', label: id },
    { key: 'seller-rccm', label: 'RCCM' },
    { key: 'seller-regime', label: 'Régime fiscal' },
    { key: 'seller-division', label: 'Division fiscale' },
    { key: 'seller-bank', label: 'Coordonnées bancaires', hint: 'onglet Moyens de paiement' },
  ];
  const count = rows.filter(r => missing.has(r.key)).length;

  return (
    <div className="s-card" style={{ marginBottom: 16 }}>
      <div className="s-card-head">
        <div className="s-card-title">Conformité DGI</div>
        <div className="s-card-desc">
          {count === 0
            ? 'Vos factures portent toutes les mentions obligatoires de l\'entreprise.'
            : `${count} mention${count > 1 ? 's' : ''} obligatoire${count > 1 ? 's' : ''} manquante${count > 1 ? 's' : ''} : sans elles, vos clients professionnels risquent de ne pas pouvoir déduire la TVA.`}
        </div>
      </div>
      <div className="s-card-body">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {rows.map(r => {
            const ok = !missing.has(r.key);
            const unknown = r.key === 'seller-bank' && payments === null;
            return (
              <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, color: ok ? 'var(--color-text-secondary)' : 'var(--color-text-primary, #1C2733)' }}>
                <Icon name={unknown ? 'dots' : ok ? 'circle-check' : 'alert-triangle'} size={16} ariaHidden
                  style={{ color: unknown ? 'var(--color-text-tertiary)' : ok ? '#276C2B' : '#8A5207', flexShrink: 0 }} />
                <span>
                  {r.label}
                  <span className="sr-only">{unknown ? ' : non vérifié' : ok ? ' : renseigné' : ' : manquant'}</span>
                  {!ok && r.hint && <small style={{ display: 'block', color: 'var(--color-text-tertiary)' }}>{r.hint}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function BusinessSection() {
  const { orgId, showToast, setOrgSettings } = useApp();

  const [name,     setName]    = useState('');
  const [ifu,             setIfu]            = useState('');
  const [rccm,            setRccm]           = useState('');
  const [taxRegime,            setTaxRegime]           = useState('');
  const [divisionFiscale,      setDivisionFiscale]     = useState('');
  const [businessCreationDate, setBusinessCreationDate]= useState('');
  const [address,  setAddress] = useState('');
  const [city,     setCity]    = useState('');
  const [country,  setCountry] = useState('Burkina Faso');
  const [currency, setCurrency]= useState('F CFA');
  const [email,    setEmail]   = useState('');
  const [phone,    setPhone]   = useState('');
  const [loading,  setLoading] = useState(true);
  const [saving,   setSaving]  = useState(false);

  useEffect(() => {
    if (!orgId) return;
    supabase
      .from('organizations')
      .select('name, ifu, rccm, tax_regime, division_fiscale, business_creation_date, address, city, country, currency, email, phone')
      .eq('id', orgId)
      .single()
      .then(({ data, error }) => {
        if (error) { console.warn('[settings] org fetch:', error.message); setLoading(false); return; }
        if (!data) return;
        setName(data.name     ?? '');
        setIfu(data.ifu               ?? '');
        setRccm(data.rccm             ?? '');
        setTaxRegime(data.tax_regime             ?? '');
        setDivisionFiscale(data.division_fiscale ?? '');
        setBusinessCreationDate(data.business_creation_date ?? '');
        setAddress(data.address ?? '');
        setCity(data.city     ?? '');
        setCountry(data.country  ?? 'Burkina Faso');
        setCurrency(data.currency ?? 'F CFA');
        setEmail(data.email   ?? '');
        setPhone(data.phone   ?? '');
        setLoading(false);
      });
  }, [orgId]);

  async function handleSave() {
    if (!orgId) return;
    setSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({ name, ifu, rccm, tax_regime: taxRegime, division_fiscale: divisionFiscale, business_creation_date: businessCreationDate || null, address, city, country, currency, email, phone })
      .eq('id', orgId);
    setSaving(false);
    if (error) { showToast(error.message, true); return; }
    setOrgSettings(prev => ({ ...prev, name, ifu, rccm, taxRegime, divisionFiscale, businessCreationDate, address, city, country, email, phone }));
    posthog.capture('settings_saved', { section: 'business' });
    showToast('Entreprise enregistrée');
  }

  return (
    <>
    {!loading && (
      <ComplianceChecklist
        seller={{ name, address, city, country, ifu, rccm, taxRegime, divisionFiscale }}
        orgId={orgId}
      />
    )}
    <div className="s-card">
      <div className="s-card-head">
        <div className="s-card-title">Informations entreprise</div>
        <div className="s-card-desc">Affichées sur chaque facture et devis que vous envoyez.</div>
      </div>
      <div className="s-card-body">
        <div className="s-field">
          <label className="s-label">Raison sociale</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} disabled={loading} />
        </div>
        <div className="s-field-row">
          <div className="s-field">
            <label className="s-label">{getFiscalIdLabel(country)}</label>
            <input className="form-input" value={ifu} onChange={e => setIfu(e.target.value)} disabled={loading} placeholder="00012345 B" />
          </div>
          <div className="s-field">
            <label className="s-label">RCCM</label>
            <input className="form-input" value={rccm} onChange={e => setRccm(e.target.value)} disabled={loading} placeholder="BF-OUA-2021-B-1234" />
          </div>
        </div>
        <div className="s-field-row">
          <div className="s-field">
            <label className="s-label">Régime fiscal</label>
            <select className="form-input" value={taxRegime} onChange={e => setTaxRegime(e.target.value)} disabled={loading}>
              <option value="">— Sélectionner —</option>
              <option value="RNI">RNI — Régime normal d'imposition (CA ≥ 50M F CFA)</option>
              <option value="RSI">RSI — Régime simplifié d'imposition (CA 15–50M F CFA)</option>
              <option value="CME">CME — Contribution des micro-entreprises (CA &lt; 15M F CFA)</option>
            </select>
          </div>
          <div className="s-field">
            <label className="s-label">Division fiscale</label>
            <input className="form-input" value={divisionFiscale} onChange={e => setDivisionFiscale(e.target.value)} disabled={loading} placeholder="ex. Ouagadougou I" />
          </div>
        </div>
        <div className="s-field">
          <label className="s-label">Date de création de l'entreprise</label>
          <input className="form-input" type="date" value={businessCreationDate} onChange={e => setBusinessCreationDate(e.target.value)} disabled={loading} />
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Utilisée pour le calcul du prorata des seuils de régime et l'exonération du minimum forfaitaire IS (1ère année).
          </div>
        </div>
        <div className="s-field">
          <label className="s-label">Adresse</label>
          <input className="form-input" value={address} onChange={e => setAddress(e.target.value)} disabled={loading} placeholder="Av. Kwame Nkrumah, Immeuble Baobab" />
        </div>
        <div className="s-field-row">
          <div className="s-field">
            <label className="s-label">Email de contact</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} placeholder="contact@entreprise.bf" />
          </div>
          <div className="s-field">
            <label className="s-label">Téléphone</label>
            <input className="form-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} disabled={loading} placeholder="+226 70 00 00 00" />
          </div>
        </div>
        <div className="s-field-row-3">
          <div className="s-field">
            <label className="s-label">Ville</label>
            <input className="form-input" value={city} onChange={e => setCity(e.target.value)} disabled={loading} placeholder="Ouagadougou" />
          </div>
          <div className="s-field">
            <label className="s-label">Pays</label>
            <select className="form-input" value={country} onChange={e => setCountry(e.target.value)} disabled={loading}>
              {COUNTRIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="s-field">
            <label className="s-label">Devise</label>
            <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)} disabled={loading}>
              {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="s-card-foot">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
    </>
  );
}

const TERMS_OPTIONS = ['À réception', 'Net 7 jours', 'Net 14 jours', 'Net 30 jours'];

/* ─── Invoicing ─────────────────────────────────────────────────── */
function InvoicingSection() {
  const { orgId, showToast, setOrgSettings } = useApp();

  const [prefix,        setPrefix]        = useState('INV-');
  const [nextNum,       setNextNum]        = useState('0001');
  const [terms,         setTerms]         = useState('Net 14 jours');
  const [deliveryTerms, setDeliveryTerms] = useState('À convenir');
  const [taxRate,       setTaxRate]       = useState(18);
  const [footer,        setFooter]        = useState('');
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);

  const [autoReminders, setAutoReminders] = useState(true);
  const [attachPdf,     setAttachPdf]     = useState(true);
  const [lateFees,      setLateFees]      = useState(false);

  useEffect(() => {
    if (!orgId) return;
    supabase
      .from('organizations')
      .select('inv_prefix, inv_next_number, payment_terms, delivery_terms, default_tax_rate, invoice_footer')
      .eq('id', orgId)
      .single()
      .then(({ data, error }) => {
        if (error) { console.warn('[settings] invoicing fetch:', error.message); setLoading(false); return; }
        if (!data) return;
        setPrefix(data.inv_prefix          ?? 'INV-');
        setNextNum(data.inv_next_number    ?? '0001');
        setTerms(data.payment_terms        ?? 'Net 14 jours');
        setDeliveryTerms(data.delivery_terms ?? 'À convenir');
        setTaxRate(Number(data.default_tax_rate ?? 18));
        setFooter(data.invoice_footer      ?? '');
        setLoading(false);
      });
  }, [orgId]);

  async function handleSave() {
    if (!orgId) return;
    setSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({ inv_prefix: prefix, inv_next_number: nextNum, payment_terms: terms, delivery_terms: deliveryTerms, default_tax_rate: taxRate, invoice_footer: footer })
      .eq('id', orgId);
    setSaving(false);
    if (error) { showToast(error.message, true); return; }
    setOrgSettings(prev => ({ ...prev, paymentTerms: terms, deliveryTerms }));
    posthog.capture('settings_saved', { section: 'invoicing' });
    showToast('Paramètres de facturation enregistrés');
  }

  return (
    <>
      <div className="s-card">
        <div className="s-card-head">
          <div className="s-card-title">Paramètres par défaut</div>
          <div className="s-card-desc">Pré-remplis sur chaque nouvelle facture. Vous pouvez les modifier par facture.</div>
        </div>
        <div className="s-card-body">
          <div className="s-field-row">
            <div className="s-field">
              <label className="s-label">Préfixe numéro</label>
              <input className="form-input" value={prefix} onChange={e => setPrefix(e.target.value)} disabled={loading} />
              <div className="s-hint">Prochain numéro : <b>#{prefix}{nextNum}</b></div>
            </div>
            <div className="s-field">
              <label className="s-label">Prochain numéro</label>
              <input className="form-input tnum" value={nextNum} onChange={e => setNextNum(e.target.value)} disabled={loading} />
            </div>
          </div>
          <div className="s-field-row">
            <div className="s-field">
              <label className="s-label">Conditions de paiement</label>
              <select className="form-input" value={terms} onChange={e => setTerms(e.target.value)} disabled={loading}>
                {TERMS_OPTIONS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="s-field">
              <label className="s-label">Conditions de livraison</label>
              <input className="form-input" value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)} disabled={loading} placeholder="ex. Ex Works, DAP, À convenir" />
            </div>
          </div>
          <div className="s-field-row">
            <div className="s-field">
              <label className="s-label">TVA par défaut</label>
              <div className="input-affix">
                <input value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} type="number" min={0} max={100} disabled={loading} />
                <span className="suffix">%</span>
              </div>
            </div>
          </div>
          <div className="s-field">
            <label className="s-label">Pied de page facture</label>
            <textarea className="form-input" rows={2} value={footer} onChange={e => setFooter(e.target.value)} disabled={loading} />
          </div>
        </div>
        <div className="s-card-foot">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
      <div className="s-card">
        <div className="s-card-head"><div className="s-card-title">Automatisation</div></div>
        <div className="s-card-body">
          <div className="s-row">
            <div className="s-row-ico"><Icon name="bell" size={17} /></div>
            <div className="s-row-main">
              <div className="s-row-title">Relances automatiques</div>
              <div className="s-row-sub">Suivis automatiques selon un calendrier configuré.</div>
            </div>
            <div className="s-row-aside">
              <button className="btn btn-sm">Configurer</button>
              <Toggle on={autoReminders} onChange={setAutoReminders} />
            </div>
          </div>
          <div className="s-row">
            <div className="s-row-ico"><Icon name="file-text" size={17} /></div>
            <div className="s-row-main">
              <div className="s-row-title">Joindre un PDF</div>
              <div className="s-row-sub">Inclure la facture en pièce jointe dans l'e-mail client.</div>
            </div>
            <div className="s-row-aside"><Toggle on={attachPdf} onChange={setAttachPdf} /></div>
          </div>
          <div className="s-row">
            <div className="s-row-ico"><Icon name="shield-check" size={17} /></div>
            <div className="s-row-main">
              <div className="s-row-title">Pénalités de retard</div>
              <div className="s-row-sub">Appliquer 2 % de pénalité mensuelle aux factures impayées.</div>
            </div>
            <div className="s-row-aside"><Toggle on={lateFees} onChange={setLateFees} /></div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Payment Methods ───────────────────────────────────────────── */
function PaymentMethodsSection({ onSave }: { onSave: () => void }) {
  const { orgId, showToast } = useApp();
  const [settings, setSettings] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (!orgId) return;
    fetchPaymentSettings(orgId)
      .then(s => { setSettings(s); setLoading(false); })
      .catch(err => { console.error('[PaymentMethods] fetch:', err); setLoading(false); });
  }, [orgId]);

  function patch<K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!orgId) return;
    setSaving(true);
    try {
      await upsertPaymentSettings(orgId, settings);
      posthog.capture('settings_saved', { section: 'payments' });
      showToast('Moyens de paiement enregistrés');
      onSave();
    } catch (err) {
      console.error('[PaymentMethods] save:', err);
      showToast('Erreur lors de l\'enregistrement', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="s-card">
      <div className="s-card-head">
        <div className="s-card-title">Moyens de paiement</div>
        <div className="s-card-desc">Les méthodes activées s'affichent sur la facture envoyée au client.</div>
      </div>
      <div className="s-card-body">
        <div className="s-row">
          <div className="s-row-ico"><Icon name="device-mobile" size={17} /></div>
          <div className="s-row-main"><div className="s-row-title">Mobile Money — MTN</div><div className="s-row-sub">Recevez les paiements sur votre compte MTN MoMo.</div></div>
          <div className="s-row-aside">
            <input className="form-input" style={{ width: 160 }} type="tel" placeholder="70 12 34 56"
              value={settings.methodMtnPhone} disabled={loading}
              onChange={e => patch('methodMtnPhone', e.target.value)} />
            <Toggle on={settings.methodMtnEnabled} onChange={v => patch('methodMtnEnabled', v)} />
          </div>
        </div>
        <div className="s-row">
          <div className="s-row-ico"><Icon name="device-mobile" size={17} /></div>
          <div className="s-row-main"><div className="s-row-title">Mobile Money — Orange</div><div className="s-row-sub">Recevez les paiements sur votre compte Orange Money.</div></div>
          <div className="s-row-aside">
            <input className="form-input" style={{ width: 160 }} type="tel" placeholder="76 98 76 54"
              value={settings.methodOrangePhone} disabled={loading}
              onChange={e => patch('methodOrangePhone', e.target.value)} />
            <Toggle on={settings.methodOrangeEnabled} onChange={v => patch('methodOrangeEnabled', v)} />
          </div>
        </div>
        <div className="s-row">
          <div className="s-row-ico"><Icon name="wave" size={17} /></div>
          <div className="s-row-main"><div className="s-row-title">Wave</div><div className="s-row-sub">Acceptez les paiements par QR Wave et lien.</div></div>
          <div className="s-row-aside">
            <input className="form-input" style={{ width: 160 }} type="tel" placeholder="Numéro Wave"
              value={settings.methodWavePhone} disabled={loading}
              onChange={e => patch('methodWavePhone', e.target.value)} />
            <Toggle on={settings.methodWaveEnabled} onChange={v => patch('methodWaveEnabled', v)} />
          </div>
        </div>
        <div className="s-row">
          <div className="s-row-ico"><Icon name="building-bank" size={17} /></div>
          <div className="s-row-main"><div className="s-row-title">Virement bancaire</div>
            <div className="s-row-sub">{settings.methodBankIban || 'IBAN non configuré'}</div>
          </div>
          <div className="s-row-aside">
            <input className="form-input" style={{ width: 220 }} placeholder="BF76 0001 2345 6789"
              value={settings.methodBankIban} disabled={loading}
              onChange={e => patch('methodBankIban', e.target.value)} />
            <Toggle on={settings.methodBankEnabled} onChange={v => patch('methodBankEnabled', v)} />
          </div>
        </div>
        <div className="s-row">
          <div className="s-row-ico"><Icon name="cash" size={17} /></div>
          <div className="s-row-main"><div className="s-row-title">Espèces</div><div className="s-row-sub">Marquer les factures comme payées en espèces manuellement.</div></div>
          <div className="s-row-aside"><Toggle on={settings.methodCashEnabled} onChange={v => patch('methodCashEnabled', v)} /></div>
        </div>
      </div>
      <div className="s-card-foot">
        <button className="btn btn-primary" onClick={handleSave} disabled={loading || saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

/* ─── Providers ─────────────────────────────────────────────────── */

type ConnectTarget = 'paystack' | 'pawapay' | null;

// BF-centric bank list for Paystack settlement
const BF_BANKS = [
  { code: 'ecobank',  label: 'Ecobank Burkina'           },
  { code: 'biciab',   label: 'BICIAB'                    },
  { code: 'boa',      label: 'Bank of Africa (BOA)'      },
  { code: 'coris',    label: 'Coris Bank International'  },
  { code: 'sgbf',     label: 'Société Générale BF'       },
  { code: 'uba',      label: 'UBA Burkina'               },
  { code: 'bsic',     label: 'BSIC Burkina'              },
];

const PAWAPAY_CORRESPONDENTS: Record<string, { label: string; country: string }[]> = {
  BFA: [
    { label: 'MTN MoMo',    country: 'MTN_MOMO_BFA'    },
    { label: 'Orange Money', country: 'ORANGE_MONEY_BFA'},
    { label: 'Moov Money',  country: 'MOOV_MONEY_BFA'  },
  ],
  CIV: [
    { label: 'MTN MoMo',    country: 'MTN_MOMO_CIV'    },
    { label: 'Orange Money', country: 'ORANGE_MONEY_CIV'},
    { label: 'Wave',         country: 'WAVE_MONEY_CIV'  },
  ],
  SEN: [
    { label: 'Orange Money', country: 'ORANGE_MONEY_SEN'},
    { label: 'Wave',         country: 'WAVE_MONEY_SEN'  },
    { label: 'Free Money',   country: 'FREE_MONEY_SEN'  },
  ],
  GHA: [
    { label: 'MTN MoMo',    country: 'MTN_MOMO_GHA'    },
    { label: 'AirtelTigo',  country: 'AIRTELTIGO_MONEY_GHA' },
  ],
};

const CHECKOUT_METHODS: { label: string; icon: string; cls: string; sub: string; feePaystack: string; feePawapay: string | null; key: keyof PaymentSettings }[] = [
  { label: 'Mobile Money', icon: 'device-mobile', cls: 'pv-mi-momo', sub: 'MTN · Orange · Moov',    feePaystack: '1,5 %',       feePawapay: '1,0 %',  key: 'checkoutMomoEnabled' },
  { label: 'Wave',         icon: 'wave',          cls: 'pv-mi-wave', sub: 'QR & lien deep-link',     feePaystack: '1,0 %',       feePawapay: '0,8 %',  key: 'checkoutWaveEnabled' },
  { label: 'Carte',        icon: 'credit-card',   cls: 'pv-mi-card', sub: 'Visa · Mastercard · 3DS', feePaystack: '2,9 % + 100', feePawapay: null,      key: 'checkoutCardEnabled' },
  { label: 'Virement',     icon: 'building-bank', cls: 'pv-mi-bank', sub: 'Pay-with-transfer',       feePaystack: '0,5 %',       feePawapay: null,      key: 'checkoutBankEnabled' },
];

const STATUS_BADGE: Record<string, { label: string; icon: string; cls: string }> = {
  pending:   { label: 'Vérification en cours', icon: 'clock-pause',   cls: 'pv-badge-pending'  },
  active:    { label: 'Actif',                  icon: 'circle-check',  cls: 'pv-badge-active'   },
  suspended: { label: 'Suspendu',               icon: 'alert-triangle',cls: 'pv-badge-suspended'},
};

function ProvidersSection({ onSave }: { onSave: () => void }) {
  const { orgId, showToast } = useApp();
  const [settings,      setSettings]      = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [connectTarget, setConnectTarget] = useState<ConnectTarget>(null);

  // Paystack settlement form
  const [psBusinessName,   setPsBusinessName]   = useState('');
  const [psBank,           setPsBank]           = useState('');
  const [psAccountNumber,  setPsAccountNumber]  = useState('');

  // PawaPay settlement form
  const [ppCountry,        setPpCountry]        = useState('BFA');
  const [ppCorrespondent,  setPpCorrespondent]  = useState('');
  const [ppPhone,          setPpPhone]          = useState('');

  useEffect(() => {
    if (!orgId) return;
    fetchPaymentSettings(orgId)
      .then(s => { setSettings(s); setLoading(false); })
      .catch(err => { console.error('[Providers] fetch:', err); setLoading(false); });
  }, [orgId]);

  function patchLocal<K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function persist(patch: Partial<PaymentSettings>) {
    if (!orgId) return;
    setSaving(true);
    try {
      await upsertPaymentSettings(orgId, patch);
      setSettings(prev => ({ ...prev, ...patch }));
      onSave();
    } catch (err) {
      console.error('[Providers] save:', err);
      showToast('Erreur lors de l\'enregistrement', true);
    } finally {
      setSaving(false);
    }
  }

  function openConnect(target: 'paystack' | 'pawapay') {
    // Pre-fill from existing settings if already set
    if (target === 'paystack') {
      setPsBusinessName(settings.paystackBusinessName);
      setPsBank(settings.paystackSettlementBank);
      setPsAccountNumber(settings.paystackAccountNumber);
    } else {
      setPpCountry(settings.pawapayCountry || 'BFA');
      setPpCorrespondent(settings.pawapayCorrespondent);
      setPpPhone(settings.pawapayPhone);
    }
    setConnectTarget(target);
  }

  async function handleSubmitConnect() {
    if (!connectTarget) return;
    if (connectTarget === 'paystack') {
      if (!psBusinessName.trim() || !psBank || !psAccountNumber.trim()) {
        showToast('Remplissez tous les champs de règlement', true); return;
      }
      await persist({
        activeProvider:         'paystack',
        providerStatus:         'pending',
        paystackBusinessName:   psBusinessName.trim(),
        paystackSettlementBank: psBank,
        paystackAccountNumber:  psAccountNumber.trim(),
      });
    } else {
      if (!ppCountry || !ppCorrespondent || !ppPhone.trim()) {
        showToast('Remplissez tous les champs de règlement', true); return;
      }
      await persist({
        activeProvider:      'pawapay',
        providerStatus:      'pending',
        pawapayCountry:      ppCountry,
        pawapayCorrespondent: ppCorrespondent,
        pawapayPhone:        ppPhone.trim(),
      });
    }
    showToast('Demande envoyée — activation sous 24 h');
    setConnectTarget(null);
  }

  async function handleDisconnect() {
    await persist({ activeProvider: null, providerStatus: 'pending' });
    showToast('Prestataire déconnecté');
  }

  async function handleSaveMethods() {
    await persist({
      checkoutMomoEnabled: settings.checkoutMomoEnabled,
      checkoutWaveEnabled: settings.checkoutWaveEnabled,
      checkoutCardEnabled: settings.checkoutCardEnabled,
      checkoutBankEnabled: settings.checkoutBankEnabled,
    });
    showToast('Méthodes enregistrées');
  }

  async function handleToggleReconcile(value: boolean) {
    patchLocal('autoReconcile', value);
    await persist({ autoReconcile: value });
  }

  const provider      = settings.activeProvider;
  const isPaystack    = provider === 'paystack';
  const providerLabel = isPaystack ? 'Paystack' : 'PawaPay';
  const statusMeta    = STATUS_BADGE[settings.providerStatus] ?? STATUS_BADGE.pending;
  const visibleMethods = CHECKOUT_METHODS.filter(m => isPaystack || m.feePawapay !== null);

  // Sub-account summary line shown in the connected card
  const connectedMeta = provider
    ? isPaystack
      ? `${settings.paystackBusinessName || '—'} · ${(BF_BANKS.find(b => b.code === settings.paystackSettlementBank)?.label ?? settings.paystackSettlementBank) || '—'} ••${settings.paystackAccountNumber.slice(-3) || '?'}`
      : `${settings.pawapayPhone || '—'} · ${settings.pawapayCorrespondent || '—'} · ${settings.pawapayCountry || '—'}`
    : '';

  return (
    <>
      {/* ── Status card (when a provider is set) ── */}
      {provider && !connectTarget && (
        <div className="s-card">
          <div className="s-card-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div className="s-card-title">Prestataire de paiement</div>
              <div className="s-card-desc">Billio collecte les paiements via votre sous-compte — aucune clé API à gérer.</div>
            </div>
            <div className="pv-mode">
              <button className={'pv-mode-opt' + (settings.providerMode === 'test' ? ' active' : '')}
                onClick={() => persist({ providerMode: 'test' })}>Test</button>
              <button className={'pv-mode-opt' + (settings.providerMode === 'live' ? ' active' : '')}
                onClick={() => persist({ providerMode: 'live' })}>Live</button>
            </div>
          </div>
          <div className="s-card-body">
            <div className="pv-connected-head">
              <div className={`pv-logo ${isPaystack ? 'pv-paystack' : 'pv-pawapay'}`}>
                {isPaystack ? 'P' : 'PP'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pv-conn-name">
                  {providerLabel}
                  <span className={`pv-conn-badge ${statusMeta.cls}`}>
                    <Icon name={statusMeta.icon} size={12} /> {statusMeta.label}
                  </span>
                </div>
                <div className="pv-conn-meta">{connectedMeta}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={() => openConnect(provider)} disabled={saving}>
                  Modifier
                </button>
                <button className="btn btn-sm" onClick={handleDisconnect} disabled={saving}>
                  Déconnecter
                </button>
              </div>
            </div>

            {settings.providerStatus === 'pending' && (
              <div className="pv-notice pv-notice-pending">
                <Icon name="clock-pause" size={15} />
                <span>Votre sous-compte est en cours de vérification. Vous recevrez un email sous 24 h à l'activation.</span>
              </div>
            )}
            {settings.providerStatus === 'suspended' && (
              <div className="pv-notice pv-notice-suspended">
                <Icon name="alert-triangle" size={15} />
                <span>Ce sous-compte a été suspendu. Contactez le support pour rétablir l'accès.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── No provider — show picker ── */}
      {!provider && !connectTarget && (
        <div className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">Prestataires de paiement</div>
            <div className="s-card-desc">Billio crée un sous-compte en votre nom — vos règlements arrivent directement sur votre compte bancaire ou mobile.</div>
          </div>
          <div className="s-card-body">
            {loading ? (
              <div style={{ color: 'var(--color-text-tertiary)', padding: '8px 0' }}>Chargement…</div>
            ) : (
              <div className="pv-avail-grid">
                <div className="pv-avail-card pv-avail-card--featured">
                  <div className="pv-logo pv-paystack">P</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pv-avail-name">Paystack</div>
                    <div className="pv-avail-sub">MoMo · Wave · carte · virement — règlement J+1</div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => openConnect('paystack')}>Activer</button>
                </div>
                <div className="pv-avail-card">
                  <div className="pv-logo pv-pawapay">PP</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pv-avail-name">PawaPay</div>
                    <div className="pv-avail-sub">MoMo · Wave — agrégateur Afrique subsaharienne</div>
                  </div>
                  <button className="btn btn-sm" onClick={() => openConnect('pawapay')}>Activer</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Connect / edit form ── */}
      {connectTarget && (
        <div className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">
              {provider === connectTarget ? 'Modifier le compte de règlement' : `Activer ${connectTarget === 'paystack' ? 'Paystack' : 'PawaPay'}`}
            </div>
            <div className="s-card-desc">
              {connectTarget === 'paystack'
                ? 'Billio crée un sous-compte Paystack lié à votre banque. Vos règlements arrivent directement sur ce compte sous 24 h.'
                : 'Billio enregistre votre numéro de règlement auprès de PawaPay. Les fonds sont versés sur ce mobile money après chaque transaction.'}
            </div>
          </div>
          <div className="s-card-body">
            {connectTarget === 'paystack' ? (
              <>
                <div className="form-group">
                  <label className="form-label">Nom de l'entreprise</label>
                  <input className="form-input" placeholder="Studio Wend SARL"
                    value={psBusinessName} onChange={e => setPsBusinessName(e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Banque de règlement</label>
                    <select className="form-input" value={psBank} onChange={e => setPsBank(e.target.value)}>
                      <option value="">Sélectionner…</option>
                      {BF_BANKS.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Numéro de compte</label>
                    <input className="form-input" placeholder="BF76 0001 2345 6789"
                      value={psAccountNumber} onChange={e => setPsAccountNumber(e.target.value)} />
                  </div>
                </div>
                <div className="pv-notice pv-notice-info">
                  <Icon name="info-circle" size={15} />
                  <span>Paystack vérifie le titulaire du compte automatiquement. Aucune clé API ne vous sera demandée.</span>
                </div>
              </>
            ) : (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Pays</label>
                    <select className="form-input" value={ppCountry}
                      onChange={e => { setPpCountry(e.target.value); setPpCorrespondent(''); }}>
                      <option value="BFA">Burkina Faso</option>
                      <option value="CIV">Côte d'Ivoire</option>
                      <option value="SEN">Sénégal</option>
                      <option value="GHA">Ghana</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Opérateur mobile</label>
                    <select className="form-input" value={ppCorrespondent} onChange={e => setPpCorrespondent(e.target.value)}>
                      <option value="">Sélectionner…</option>
                      {(PAWAPAY_CORRESPONDENTS[ppCountry] ?? []).map(c => (
                        <option key={c.country} value={c.country}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Numéro de règlement</label>
                  <input className="form-input" type="tel" placeholder="70 12 34 56"
                    value={ppPhone} onChange={e => setPpPhone(e.target.value)} />
                </div>
                <div className="pv-notice pv-notice-info">
                  <Icon name="info-circle" size={15} />
                  <span>PawaPay versera les règlements sur ce numéro après chaque paiement client réussi.</span>
                </div>
              </>
            )}
          </div>
          <div className="s-card-foot" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setConnectTarget(null)} disabled={saving}>Annuler</button>
            <button className="btn btn-primary" onClick={handleSubmitConnect} disabled={saving}>
              {saving ? 'Envoi…' : 'Envoyer la demande'}
            </button>
          </div>
        </div>
      )}

      {/* ── Checkout methods (only when active) ── */}
      {provider && settings.providerStatus === 'active' && (
        <div className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">Méthodes de paiement en ligne</div>
            <div className="s-card-desc">Les méthodes activées s'affichent sur votre lien de paiement billio.app/pay. Les frais sont prélevés par {providerLabel}.</div>
          </div>
          <div className="s-card-body">
            {visibleMethods.map(m => (
              <div key={m.key} className="pv-method-row">
                <div className={`pv-m-ico ${m.cls}`}><Icon name={m.icon} size={18} /></div>
                <div className="pv-m-main">
                  <div className="pv-m-title">{m.label}</div>
                  <div className="pv-m-sub">{m.sub}</div>
                </div>
                <div className="pv-m-fee">{isPaystack ? m.feePaystack : m.feePawapay}</div>
                <Toggle on={Boolean(settings[m.key])} onChange={v => patchLocal(m.key, v as PaymentSettings[typeof m.key])} />
              </div>
            ))}
          </div>
          <div className="s-card-foot">
            <button className="btn btn-primary" onClick={handleSaveMethods} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* ── Auto-reconciliation (only when active) ── */}
      {provider && settings.providerStatus === 'active' && (
        <div className="s-card">
          <div className="s-card-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div className="s-card-title">Rapprochement automatique</div>
              <div className="s-card-desc">À chaque webhook de paiement reçu, Billio marque la facture correspondante comme payée.</div>
            </div>
            <Toggle on={settings.autoReconcile} onChange={handleToggleReconcile} />
          </div>
          <div className="s-card-body">
            <div className="pv-flow">
              <div className="pv-flow-step"><span className="pv-fs-ico"><Icon name="device-mobile" size={14} /></span>Client paie</div>
              <Icon name="arrow-right" size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              <div className="pv-flow-step"><span className="pv-fs-ico"><Icon name="bolt" size={14} /></span>Webhook</div>
              <Icon name="arrow-right" size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              <div className="pv-flow-step"><span className="pv-fs-ico"><Icon name="link" size={14} /></span>Correspondance</div>
              <Icon name="arrow-right" size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              <div className="pv-flow-step pv-flow-paid"><span className="pv-fs-ico"><Icon name="check" size={14} /></span>Payée</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Switch provider (only when one is already connected) ── */}
      {provider && !connectTarget && (
        <div className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">Changer de prestataire</div>
            <div className="s-card-desc">Un seul prestataire actif à la fois. L'ancien sous-compte sera désactivé.</div>
          </div>
          <div className="s-card-body">
            <div className="pv-avail-grid">
              {([
                { id: 'paystack' as const, name: 'Paystack', cls: 'pv-paystack', letter: 'P',  sub: 'MoMo · Wave · carte · virement' },
                { id: 'pawapay' as const, name: 'PawaPay',  cls: 'pv-pawapay',  letter: 'PP', sub: 'MoMo · Wave — agrégateur Afrique' },
              ] as const).map(p => (
                <div key={p.id} className="pv-avail-card">
                  <div className={`pv-logo ${p.cls}`}>{p.letter}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pv-avail-name">{p.name}</div>
                    <div className="pv-avail-sub">{p.sub}</div>
                  </div>
                  {provider === p.id
                    ? <span className="pv-conn-badge pv-badge-active"><Icon name="circle-check" size={12} /> Actif</span>
                    : <button className="btn btn-sm" onClick={() => openConnect(p.id)}>Passer à {p.name}</button>
                  }
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const AV_CLASSES = ['av-a', 'av-b', 'av-c', 'av-d', 'av-e', 'av-f'] as const;

const ROLE_LABELS: Record<string, string> = {
  owner:      'Propriétaire',
  admin:      'Administrateur',
  member:     'Membre',
  accountant: 'Comptable',
  observer:   'Observateur',
};

interface TeamMember {
  user_id:    string;
  role:       string;
  email:      string;
  first_name: string;
  last_name:  string;
  joined_at:  string;
}

interface PendingInvite {
  id:         string;
  token:      string;
  email:      string;
  role:       string;
  expires_at: string;
}

function memberInitials(m: TeamMember) {
  if (m.first_name || m.last_name)
    return `${m.first_name[0] ?? ''}${m.last_name[0] ?? ''}`.toUpperCase() || '?';
  return m.email.slice(0, 2).toUpperCase();
}

function memberName(m: TeamMember) {
  if (m.first_name || m.last_name) return `${m.first_name} ${m.last_name}`.trim();
  return m.email.split('@')[0];
}

const INVITE_ROLES = [
  { value: 'admin',      label: 'Administrateur' },
  { value: 'member',     label: 'Membre'         },
  { value: 'accountant', label: 'Comptable'      },
  { value: 'observer',   label: 'Observateur'    },
];

/* ─── Invite Modal ──────────────────────────────────────────────── */
interface InviteModalProps {
  orgId:   string;
  userId:  string;
  onClose: () => void;
  onDone:  (invite: PendingInvite) => void;
}

function InviteModal({ orgId, userId, onClose, onDone }: InviteModalProps) {
  const { showToast } = useApp();
  const [email,    setEmail]    = useState('');
  const [role,     setRole]     = useState('member');
  const [emailErr, setEmailErr] = useState(false);
  const [saving,   setSaving]   = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!/.+@.+\..+/.test(email.trim())) { setEmailErr(true); return; }
    setSaving(true);

    const token = crypto.randomUUID();
    const id    = crypto.randomUUID();

    const { error } = await supabase.from('pending_invitations').upsert(
      { id, token, org_id: orgId, email: email.toLowerCase().trim(), role, invited_by: userId || undefined },
      { onConflict: 'org_id,email', ignoreDuplicates: false }
    );

    setSaving(false);
    if (error) { showToast(error.message, true); return; }

    const invite: PendingInvite = {
      id,
      token,
      email: email.toLowerCase().trim(),
      role,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
    onDone(invite);
    showToast('Invitation créée');
  }

  // Close on Escape
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="inv-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal" role="dialog" aria-modal="true" aria-label="Inviter un membre">
        <div className="inv-modal-head">
          <div className="inv-modal-title">
            <Icon name="user-plus" size={17} />
            Inviter un membre
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="inv-modal-body">
            <div className="s-field">
              <label className="s-label">Adresse e-mail</label>
              <div className="input-wrap" style={{ position: 'relative' }}>
                <Icon name="mail" className="lead" size={15} ariaHidden />
                <input
                  className={`form-input${emailErr ? ' err' : ''}`}
                  style={{ paddingLeft: 34 }}
                  type="email"
                  placeholder="nom@entreprise.com"
                  value={email}
                  autoFocus
                  onChange={e => { setEmail(e.target.value); setEmailErr(false); }}
                />
              </div>
              {emailErr && <div className="s-hint" style={{ color: 'var(--color-danger)' }}>Adresse e-mail invalide.</div>}
            </div>

            <div className="s-field" style={{ marginBottom: 0 }}>
              <label className="s-label">Rôle</label>
              <select className="form-input" value={role} onChange={e => setRole(e.target.value)}>
                {INVITE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <div className="s-hint" style={{ marginTop: 6 }}>
                {role === 'admin'      && 'Peut gérer les factures, les clients et inviter des membres.'}
                {role === 'member'     && 'Peut créer et envoyer des factures, sans suppression.'}
                {role === 'accountant' && 'Peut saisir les paiements et la comptabilité, sans suppression.'}
                {role === 'observer'   && 'Accès en lecture seule à tout le workspace.'}
              </div>
            </div>
          </div>

          <div className="inv-modal-foot">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? 'Envoi…'
                : <><Icon name="send" size={14} /> Créer l'invitation</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Invite Link Row ───────────────────────────────────────────── */
interface InviteLinkRowProps {
  invite:    PendingInvite;
  index:     number;
  /** Omitted for users who can't manage the team: no revoke button */
  onRevoke?: (id: string) => void;
}

function InviteLinkRow({ invite, index, onRevoke }: InviteLinkRowProps) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/invite/${invite.token}`;

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="s-team-row inv-link-row">
      <div className={`s-team-av ${AV_CLASSES[index % AV_CLASSES.length]}`} style={{ opacity: 0.45 }}>
        {invite.email[0]?.toUpperCase() ?? '?'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="s-team-name">{invite.email}</div>
        <div className="inv-link-url" onClick={copy} title="Cliquer pour copier">{url}</div>
      </div>
      <span className="s-role-badge">{ROLE_LABELS[invite.role] ?? invite.role}</span>
      <button className={`btn btn-sm${copied ? ' btn-copied' : ''}`} onClick={copy}>
        {copied ? <><Icon name="check" size={13} /> Copié</> : <><Icon name="link" size={13} /> Copier</>}
      </button>
      {onRevoke && (
        <button className="icon-btn" title="Révoquer l'invitation" onClick={() => onRevoke(invite.id)}>
          <Icon name="trash" size={15} />
        </button>
      )}
    </div>
  );
}

/* ─── Member dialog (change role / remove) ─────────────────────── */
const MEMBER_ROLES = [
  { value: 'admin',      label: 'Administrateur', hint: 'Accès complet, y compris l\'équipe et la facturation Billio.' },
  { value: 'accountant', label: 'Comptable',      hint: 'Factures, paiements et comptabilité.' },
  { value: 'member',     label: 'Membre',         hint: 'Factures, devis et clients. Pas de suppression.' },
  { value: 'observer',   label: 'Observateur',    hint: 'Consultation seule, sans modification.' },
];

function MemberDialog({ orgId, member, onClose, onUpdated, onRemoved }: {
  orgId:     string;
  member:    TeamMember;
  onClose:   () => void;
  onUpdated: (role: string) => void;
  onRemoved: () => void;
}) {
  const { showToast } = useApp();
  const [role, setRole]           = useState(member.role);
  const [busy, setBusy]           = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = memberName(member);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Modal focus: start on the selected role, keep Tab inside, give focus back on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input:checked, button:not([disabled])')?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
      )).filter(el => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked));
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose, busy]);

  async function saveRole() {
    if (role === member.role) { onClose(); return; }
    setBusy(true);
    const { error } = await supabase.rpc('update_org_member_role', { p_org_id: orgId, p_user_id: member.user_id, p_role: role });
    setBusy(false);
    if (error) {
      console.error('[update_org_member_role]', error);
      showToast('Impossible de modifier le rôle. Veuillez réessayer.', true);
      return;
    }
    showToast(`${name} est maintenant ${(ROLE_LABELS[role] ?? role).toLowerCase()}`);
    onUpdated(role);
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase.rpc('remove_org_member', { p_org_id: orgId, p_user_id: member.user_id });
    setBusy(false);
    if (error) {
      console.error('[remove_org_member]', error);
      showToast('Impossible de retirer ce membre. Veuillez réessayer.', true);
      return;
    }
    showToast(`${name} a été retiré de l'équipe`);
    onRemoved();
  }

  return (
    <div className="inv-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div ref={dialogRef} className="inv-modal" role="dialog" aria-modal="true" aria-label={`Gérer ${name}`} onClick={e => e.stopPropagation()}>
        <div className="inv-modal-head">
          <div className="inv-modal-title"><Icon name="user" size={16} ariaHidden /> {name}</div>
          <button className="btn btn-icon" onClick={onClose} disabled={busy} aria-label="Fermer">
            <Icon name="x" size={16} ariaHidden />
          </button>
        </div>
        <div className="inv-modal-body">
          {confirmRemove ? (
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              {name} ({member.email}) n'aura plus accès à ce workspace. Les factures et documents qu'il ou elle a créés restent en place.
            </p>
          ) : (
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <legend className="form-label" style={{ marginBottom: 6 }}>Rôle</legend>
              {MEMBER_ROLES.map(r => (
                <label key={r.value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input type="radio" name="member-role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} style={{ marginTop: 3 }} />
                  <span>
                    <b style={{ fontSize: 13 }}>{r.label}</b>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-secondary)' }}>{r.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <div className="inv-modal-foot" style={{ justifyContent: 'space-between' }}>
          {confirmRemove ? (
            <>
              <button className="btn" onClick={() => setConfirmRemove(false)} disabled={busy}>Annuler</button>
              <button className="btn btn-danger" onClick={remove} disabled={busy}>
                <Icon name="trash" size={14} ariaHidden /> {busy ? 'Retrait…' : 'Retirer de l\'équipe'}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-danger" onClick={() => setConfirmRemove(true)} disabled={busy}>
                <Icon name="trash" size={14} ariaHidden /> Retirer
              </button>
              <button className="btn btn-primary" onClick={saveRole} disabled={busy}>
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Team ──────────────────────────────────────────────────────── */
function TeamSection() {
  const { orgId, userId, userRole, showToast } = useApp();
  // Owners are 'admin' in the app; the database re-checks on every change
  const canManage = canManageOrg(userRole);
  const [managing, setManaging] = useState<TeamMember | null>(null);

  const [members,     setMembers]     = useState<TeamMember[]>([]);
  const [pending,     setPending]     = useState<PendingInvite[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showInvite,  setShowInvite]  = useState(false);

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      supabase.rpc('get_org_team', { p_org_id: orgId }),
      supabase
        .from('pending_invitations')
        .select('id, token, email, role, expires_at')
        .eq('org_id', orgId)
        .eq('status', 'pending'),
    ]).then(([teamRes, invRes]) => {
      if (teamRes.error) console.warn('[settings] team fetch:', teamRes.error.message);
      else setMembers((teamRes.data as TeamMember[]) ?? []);
      if (invRes.error) console.warn('[settings] invites fetch:', invRes.error.message);
      else setPending((invRes.data as PendingInvite[]) ?? []);
      setLoading(false);
    });
  }, [orgId]);

  async function revokeInvite(id: string) {
    const { error } = await supabase.from('pending_invitations').delete().eq('id', id);
    if (error) { showToast(error.message, true); return; }
    setPending(prev => prev.filter(p => p.id !== id));
    showToast('Invitation révoquée');
  }

  return (
    <>
      {managing && orgId && (
        <MemberDialog
          orgId={orgId}
          member={managing}
          onClose={() => setManaging(null)}
          onUpdated={role => { setMembers(prev => prev.map(m => m.user_id === managing.user_id ? { ...m, role } : m)); setManaging(null); }}
          onRemoved={() => { setMembers(prev => prev.filter(m => m.user_id !== managing.user_id)); setManaging(null); }}
        />
      )}
      {showInvite && orgId && (
        <InviteModal
          orgId={orgId}
          userId={userId}
          onClose={() => setShowInvite(false)}
          onDone={invite => { setPending(prev => [...prev, invite]); setShowInvite(false); }}
        />
      )}

      <div className="s-card">
        <div className="s-card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="s-card-title">Membres de l'équipe</div>
            <div className="s-card-desc">Personnes ayant accès à ce workspace Billio.</div>
          </div>
          {canManage && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowInvite(true)}>
              <Icon name="user-plus" size={14} /> Inviter
            </button>
          )}
        </div>
        <div className="s-card-body">
          {loading && <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13, padding: '8px 0' }}>Chargement…</div>}
          {members.map((m, i) => {
            const isMe = m.user_id === userId;
            return (
              <div key={m.user_id} className="s-team-row">
                <div className={`s-team-av ${AV_CLASSES[i % AV_CLASSES.length]}`}>{memberInitials(m)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="s-team-name">
                    {memberName(m)}
                    {isMe && <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}> (vous)</span>}
                  </div>
                  <div className="s-team-email">{m.email}</div>
                </div>
                <span className={'s-role-badge' + (m.role === 'owner' ? ' owner' : '')}>
                  {ROLE_LABELS[m.role] ?? m.role}
                </span>
                {canManage && !isMe && m.role !== 'owner' && (
                  <button className="icon-btn" aria-label={`Gérer ${memberName(m)}`} title="Modifier le rôle ou retirer" onClick={() => setManaging(m)}>
                    <Icon name="dots" size={15} ariaHidden />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="s-card">
        <div className="s-card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="s-card-title">Invitations en attente</div>
            <div className="s-card-desc">Partagez le lien — votre collaborateur pourra créer son compte et rejoindre directement.</div>
          </div>
          {pending.length > 0 && (
            <span className="s-role-badge" style={{ fontVariantNumeric: 'tabular-nums' }}>{pending.length}</span>
          )}
        </div>
        <div className="s-card-body">
          {loading
            ? <div style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>Chargement…</div>
            : pending.length === 0
              ? (
                <div className="inv-empty">
                  <Icon name="user-plus" size={22} />
                  <div className="inv-empty-title">Aucune invitation en attente</div>
                  {canManage && <div className="inv-empty-sub">Cliquez sur <b>Inviter</b> pour générer un lien de rejoindre.</div>}
                </div>
              )
              : pending.map((p, i) => (
                <InviteLinkRow key={p.id} invite={p} index={i} onRevoke={canManage ? revokeInvite : undefined} />
              ))
          }
        </div>
      </div>
    </>
  );
}

/* ─── Plan ──────────────────────────────────────────────────────── */
const STATUS_LABEL: Record<PlanStatus, string> = {
  free:      'Gratuit',
  trialing:  'Essai gratuit',
  active:    'Actif',
  canceled:  'Annulé',
  past_due:  'Paiement en retard',
};

const STATUS_CLASS: Record<PlanStatus, string> = {
  free:     's-plan-status--gray',
  trialing: 's-plan-status--blue',
  active:   's-plan-status--green',
  canceled: 's-plan-status--orange',
  past_due: 's-plan-status--red',
};

function PlanStatusBadge({ status }: { status: PlanStatus }) {
  return (
    <span className={`s-plan-status ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function PlanSection() {
  const { plan, planStatus, planRenewsAt, trialEndsAt, invoices } = useApp();

  // Counted like the database enforces it: issued (not draft) this UTC month
  const monthlyCount = issuedThisMonth(invoices);
  const isSolo       = plan === 'solo';
  const usageLimit   = isSolo ? SOLO_INVOICE_LIMIT : null;
  const usagePct     = usageLimit ? Math.min(100, (monthlyCount / usageLimit) * 100) : Math.min(100, (monthlyCount / 100) * 30);
  const barWarning   = usageLimit && monthlyCount >= usageLimit * 0.8;

  const currentDef  = PLANS.find(p => p.id === plan)!;
  const currentIdx  = PLAN_ORDER.indexOf(plan);
  const upgradePlans = PLANS.filter(p => PLAN_ORDER.indexOf(p.id) > currentIdx);

  let renewalLine: string | null = null;
  if (planRenewsAt) renewalLine = `Renouvellement le ${fmtDate(planRenewsAt)}`;
  else if (trialEndsAt) renewalLine = `Essai gratuit jusqu'au ${fmtDate(trialEndsAt)}`;

  return (
    <>
      {/* ── Current subscription ── */}
      <div className="s-card">
        <div className="s-card-head">
          <div>
            <div className="s-card-title">Plan &amp; facturation</div>
            <div className="s-card-desc">Gérez votre abonnement et vos informations de paiement.</div>
          </div>
          <PlanStatusBadge status={planStatus} />
        </div>
        <div className="s-card-body">
          <div className="s-plan-card">
            <div className="s-plan-badge"><Icon name="sparkles" size={22} /></div>
            <div style={{ flex: 1 }}>
              <div className="s-plan-name">Plan {PLAN_LABELS[plan]}</div>
              <div className="s-plan-price">
                {currentDef.price === null
                  ? <><b>Sur devis</b> · contrat annuel</>
                  : currentDef.price === 0
                  ? <b>Gratuit</b>
                  : <><b>{formatPrice(currentDef.price)} XOF</b> / mois</>
                }
                {renewalLine && <> · {renewalLine}</>}
              </div>
            </div>
            {plan !== 'enterprise' && (
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {upgradePlans.length > 0 && (
                  <button className="btn btn-sm btn-primary">
                    <Icon name="sparkles" size={13} /> Mettre à niveau
                  </button>
                )}
                {plan !== 'solo' && (
                  <button className="btn btn-sm" style={{ color: '#A32D2D' }}>Annuler</button>
                )}
              </div>
            )}
          </div>

          {/* Usage bar */}
          <div className="s-usage">
            <div className="s-usage-top">
              <span>Factures ce mois</span>
              <span className="tnum" style={barWarning ? { color: '#B45309' } : undefined}>
                {monthlyCount}
                {usageLimit
                  ? <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}> / {usageLimit}</span>
                  : <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}> / illimité</span>
                }
              </span>
            </div>
            <div className="s-bar-track">
              <div
                className="s-bar-fill"
                style={{
                  width: `${usagePct}%`,
                  background: barWarning
                    ? 'linear-gradient(90deg,#D97706,#B45309)'
                    : undefined,
                }}
              />
            </div>
            {barWarning && usageLimit && (
              <div className="s-usage-warn">
                <Icon name="alert-triangle" size={12} />
                {monthlyCount >= usageLimit
                  ? 'Limite atteinte — passez au plan Business pour continuer à facturer.'
                  : `Plus que ${usageLimit - monthlyCount} facture${usageLimit - monthlyCount > 1 ? 's' : ''} disponible${usageLimit - monthlyCount > 1 ? 's' : ''} ce mois.`
                }
              </div>
            )}
          </div>
        </div>
        <div className="s-card-foot">
          <button className="btn"><Icon name="file-text" size={14} /> Historique de facturation</button>
        </div>
      </div>

      {/* ── Upgrade options ── */}
      {upgradePlans.length > 0 && (
        <div className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">Passer à un plan supérieur</div>
            <div className="s-card-desc">Débloquez plus de fonctionnalités pour votre entreprise.</div>
          </div>
          <div className="s-card-body" style={{ gap: 10 }}>
            {upgradePlans.map(p => (
              <div key={p.id} className={`s-upgrade-row${p.popular ? ' s-upgrade-row--popular' : ''}`}>
                <div style={{ flex: 1 }}>
                  <div className="s-upgrade-name">
                    {p.name}
                    {p.popular && <span className="s-upgrade-popular-badge">Populaire</span>}
                  </div>
                  <div className="s-upgrade-tagline">{p.tagline}</div>
                  <ul className="s-upgrade-perks">
                    {p.perks.map(perk => (
                      <li key={perk}><Icon name="check" size={12} className="s-upgrade-check" />{perk}</li>
                    ))}
                  </ul>
                </div>
                <div className="s-upgrade-right">
                  <div className="s-upgrade-price">
                    {p.price === null
                      ? <span className="s-upgrade-price-main">Sur devis</span>
                      : <>
                          <span className="s-upgrade-price-cur">{p.currency}</span>
                          <span className="s-upgrade-price-main">{formatPrice(p.price)}</span>
                          <span className="s-upgrade-price-period">/mois</span>
                        </>
                    }
                  </div>
                  <button className={`btn btn-sm${p.popular ? ' btn-primary' : ''}`}>
                    {p.ctaLabel}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Danger zone ── */}
      <div className="s-card s-danger-card">
        <div className="s-card-head">
          <div className="s-card-title" style={{ color: '#A32D2D' }}>Supprimer le workspace</div>
          <div className="s-card-desc">Supprime définitivement ce workspace et toutes les factures, clients et données associées.</div>
        </div>
        <div className="s-card-foot" style={{ justifyContent: 'flex-start', background: 'var(--color-background-primary)', borderTop: 'none', paddingTop: 0 }}>
          <button className="btn" style={{ color: '#A32D2D', borderColor: 'var(--color-border-secondary)' }}>
            <Icon name="trash" size={14} /> Supprimer le workspace
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Main component ────────────────────────────────────────────── */
const ORG_TABS: SettingsTab[] = ['business', 'invoicing', 'payments', 'providers'];

export default function SettingsPage() {
  const { showToast } = useApp();
  const { managesOrg } = usePermissions();
  // ?tab= opens a section directly (e.g. links from the invoice compliance warning)
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<SettingsTab>(() => {
    const t = searchParams.get('tab');
    return TABS.some(x => x.key === t) ? (t as SettingsTab) : 'profile';
  });
  const onSave = () => showToast('Paramètres enregistrés');

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <div className="page-title">Paramètres</div>
          <div className="page-sub">Gérez vos préférences de workspace et de facturation</div>
        </div>
        <button className="btn btn-primary" onClick={onSave} disabled={ORG_TABS.includes(tab) && !managesOrg}>
          <Icon name="check" size={15} /> Enregistrer
        </button>
      </div>

      <div className="content">
        <div className="s-grid">
          {/* Sub-nav */}
          <nav className="s-nav">
            {TABS.map(t => (
              <button
                key={t.key}
                className={'s-nav-item' + (tab === t.key ? ' active' : '')}
                onClick={() => setTab(t.key)}
              >
                <Icon name={t.icon} size={18} />
                {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="s-col">
            {tab === 'profile'       && <ProfileSection />}
            {ORG_TABS.includes(tab) && !managesOrg && (
              <div className="s-card">
                <div className="s-card-body" style={{ color: 'var(--color-text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon name="lock" size={16} ariaHidden />
                  Seuls les administrateurs peuvent modifier ces paramètres.
                </div>
              </div>
            )}
            {/* Read-only for non-admins: the database only lets owners and admins change the organisation */}
            <fieldset disabled={!managesOrg} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'contents' }}>
              {tab === 'business'      && <BusinessSection />}
              {tab === 'invoicing'     && <InvoicingSection />}
              {tab === 'payments'      && <PaymentMethodsSection onSave={onSave} />}
              {tab === 'providers'     && <ProvidersSection     onSave={onSave} />}
            </fieldset>
            {tab === 'team'          && <TeamSection />}
            {tab === 'plan'          && <PlanSection />}
            {(tab === 'reminders' || tab === 'notifications') && (
              <div className="s-card">
                <div className="s-card-body" style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: '48px 20px' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
                  <div style={{ fontWeight: 600 }}>Bientôt disponible</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
