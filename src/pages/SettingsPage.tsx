import { cadastralRequired, formatCadastralRef, parseCadastralRef } from '@/lib/cadastral';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Navigate, useBlocker, useSearchParams } from 'react-router-dom';
import { UI_V2 } from '@/lib/features';
import { SaveBarContext, useSaveBar, type SaveBarActions, type SaveBarApi, type SaveBarState } from '@/lib/use-save-bar';
import { FIELD_IDS, cadastralProblem, checklistMissing, complianceChecklist, ifuProblem, type ChecklistFix, type ChecklistRow } from '@/lib/settings-checks';
import { canManageOrg } from '@/lib/permissions';
import { usePermissions } from '@/lib/use-permissions';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import {
  PLANS, PLAN_LABELS, PLAN_ORDER, formatPrice, planPrice, type BillingPeriod,
  SOLO_INVOICE_LIMIT,
  type PlanStatus,
} from '@/lib/plans';
import {
  fetchPaymentSettings, upsertPaymentSettings,
  DEFAULT_PAYMENT_SETTINGS, type PaymentSettings,
} from '@/lib/api/payment-settings';
import { PISPI_COUNTRIES, aliasProblem, type PispiCountry } from '@/lib/online-payments';
import { getFiscalIdLabel } from '@/lib/ohada';
import { sellerIssues, type SellerInfo } from '@/lib/invoice-compliance';
import { issuedThisMonth } from '@/lib/invoice-limit';
import BillingPeriodSwitch from '@/components/BillingPeriodSwitch';
import Page from '@/components/Page';

type SettingsTab = 'profile' | 'business' | 'invoicing' | 'reminders' | 'payments' | 'notifications' | 'team' | 'plan';

const TABS: { key: SettingsTab; icon: string; label: string }[] = [
  { key: 'profile',       icon: 'user',           label: 'Profil'               },
  { key: 'business',      icon: 'building',        label: 'Entreprise'           },
  { key: 'invoicing',     icon: 'file-invoice',    label: 'Préférences facture'  },
  { key: 'reminders',     icon: 'bell',            label: 'Relances'             },
  { key: 'payments',      icon: 'credit-card',     label: 'Paiements'            },
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
    ...(cadastralRequired(seller.country) ? [{ key: 'seller-cadastre', label: 'Référence cadastrale' }] : []),
    { key: 'seller-bank', label: 'Coordonnées bancaires', hint: 'onglet Paiements' },
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

/** A section whose values couldn't be read: its fields stay disabled until a retry works. */
function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="s-load-failed">
      <span>Ces informations n’ont pas pu être chargées : impossible de les modifier pour l’instant.</span>
      <button type="button" className="btn btn-sm" onClick={onRetry}>Réessayer</button>
    </div>
  );
}

interface BizFields {
  name: string; ifu: string; rccm: string; taxRegime: string; divisionFiscale: string; cadastralRef: string;
  businessCreationDate: string; address: string; city: string; country: string; currency: string; email: string; phone: string;
}

/**
 * `onDraft`: the seller as typed, for the DGI checklist beside the form (new
 * interface); there the page's save bar replaces the card's button.
 */
function BusinessSection({ onDraft }: { onDraft?: (seller: SellerInfo) => void } = {}) {
  const { orgId, showToast, setOrgSettings } = useApp();
  const [snapshot, setSnapshot] = useState<BizFields | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [name,     setName]    = useState('');
  const [ifu,             setIfu]            = useState('');
  const [rccm,            setRccm]           = useState('');
  const [taxRegime,            setTaxRegime]           = useState('');
  const [divisionFiscale,      setDivisionFiscale]     = useState('');
  const [cadastralRef,         setCadastralRef]        = useState('');
  const [businessCreationDate, setBusinessCreationDate]= useState('');
  const [address,  setAddress] = useState('');
  const [city,     setCity]    = useState('');
  const [country,  setCountry] = useState('Burkina Faso');
  const [currency, setCurrency]= useState('F CFA');
  const [email,    setEmail]   = useState('');
  const [phone,    setPhone]   = useState('');
  const [loading,  setLoading] = useState(true);
  const [saving,   setSaving]  = useState(false);
  // Not loaded: the form stays disabled (edits couldn't be saved or tracked) until a retry works
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt,    setAttempt]    = useState(0);

  useEffect(() => {
    if (!orgId) return;
    supabase
      .from('organizations')
      .select('name, ifu, rccm, tax_regime, division_fiscale, cadastral_ref, business_creation_date, address, city, country, currency, email, phone')
      .eq('id', orgId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { console.warn('[settings] org fetch:', error?.message ?? 'no row'); setLoadFailed(true); return; }
        const loaded: BizFields = {
          name: data.name ?? '', ifu: data.ifu ?? '', rccm: data.rccm ?? '',
          taxRegime: data.tax_regime ?? '', divisionFiscale: data.division_fiscale ?? '',
          cadastralRef: formatCadastralRef(data.cadastral_ref), businessCreationDate: data.business_creation_date ?? '',
          address: data.address ?? '', city: data.city ?? '', country: data.country ?? 'Burkina Faso',
          currency: data.currency ?? 'F CFA', email: data.email ?? '', phone: data.phone ?? '',
        };
        apply(loaded);
        setSnapshot(loaded);
        setLoading(false);
      });
  }, [orgId, attempt]);

  function apply(f: BizFields) {
    setName(f.name); setIfu(f.ifu); setRccm(f.rccm); setTaxRegime(f.taxRegime); setDivisionFiscale(f.divisionFiscale);
    setCadastralRef(f.cadastralRef); setBusinessCreationDate(f.businessCreationDate); setAddress(f.address);
    setCity(f.city); setCountry(f.country); setCurrency(f.currency); setEmail(f.email); setPhone(f.phone);
  }

  const current: BizFields = { name, ifu, rccm, taxRegime, divisionFiscale, cadastralRef, businessCreationDate, address, city, country, currency, email, phone };
  const dirty = snapshot !== null && (Object.keys(current) as (keyof BizFields)[]).some(k => current[k] !== snapshot[k]);
  const ifuError = ifuProblem(country, ifu);
  const cadastralError = cadastralProblem(cadastralRef);
  // An error shows once the field is left, or straight away on a value already saved
  const showIfuError = !!ifuError && (touched.ifu || ifu === snapshot?.ifu);
  const showCadastralError = !!cadastralError && (touched.cadastre || cadastralRef === snapshot?.cadastralRef);

  async function handleSave(): Promise<boolean> {
    if (!orgId) return false;
    const cadastral = cadastralRef.trim() ? parseCadastralRef(cadastralRef) : '';
    if (cadastral === null) { showToast('Référence cadastrale : 11 chiffres (section, îlot, parcelle), ex. 0123 456 7890.', true); return false; }
    setSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({ name, ifu, rccm, tax_regime: taxRegime, division_fiscale: divisionFiscale, cadastral_ref: cadastral || null, business_creation_date: businessCreationDate || null, address, city, country, currency, email, phone })
      .eq('id', orgId);
    setSaving(false);
    if (error) { showToast(error.message, true); return false; }
    setOrgSettings(prev => ({ ...prev, name, ifu, rccm, taxRegime, divisionFiscale, cadastralRef: cadastral, businessCreationDate, address, city, country, email, phone }));
    const saved = { ...current, cadastralRef: formatCadastralRef(cadastral) };
    // Shown as « SSSS LLL PPPP », unless it was changed again while saving
    const submitted = cadastralRef;
    setCadastralRef(v => (v === submitted ? saved.cadastralRef : v));
    setSnapshot(saved);
    setTouched({});
    posthog.capture('settings_saved', { section: 'business' });
    showToast('Entreprise enregistrée');
    return true;
  }

  const inBar = useSaveBar(
    { dirty, problem: ifuError ?? cadastralError, saving },
    { save: handleSave, reset: () => { if (snapshot) { apply(snapshot); setTouched({}); } } },
  );
  useEffect(() => {
    if (!loading) onDraft?.({ name, address, city, country, ifu, rccm, taxRegime, divisionFiscale, cadastralRef });
  }, [onDraft, loading, name, address, city, country, ifu, rccm, taxRegime, divisionFiscale, cadastralRef]);

  return (
    <>
    {!loading && !inBar && (
      <ComplianceChecklist
        seller={{ name, address, city, country, ifu, rccm, taxRegime, divisionFiscale, cadastralRef }}
        orgId={orgId}
      />
    )}
    <div className="s-card">
      <div className="s-card-head">
        <div className="s-card-title">Informations entreprise</div>
        <div className="s-card-desc">Affichées sur chaque facture et devis que vous envoyez.</div>
      </div>
      <div className="s-card-body">
        {loadFailed && <LoadFailed onRetry={() => { setLoadFailed(false); setAttempt(a => a + 1); }} />}
        <div className="s-field">
          <label className="s-label" htmlFor={FIELD_IDS.name}>Raison sociale</label>
          <input id={FIELD_IDS.name} className="form-input" value={name} onChange={e => setName(e.target.value)} disabled={loading} />
        </div>
        <div className="s-field-row">
          <div className="s-field">
            <label className="s-label" htmlFor={FIELD_IDS.ifu}>{getFiscalIdLabel(country)}</label>
            <input id={FIELD_IDS.ifu} className="form-input" value={ifu} onChange={e => setIfu(e.target.value)} onBlur={() => setTouched(t => ({ ...t, ifu: true }))} disabled={loading} placeholder="00012345 B"
              aria-invalid={showIfuError || undefined} aria-describedby={showIfuError ? 'set-ifu-error' : undefined} />
            {showIfuError && <div id="set-ifu-error" className="s-field-error">{ifuError}</div>}
          </div>
          <div className="s-field">
            <label className="s-label" htmlFor={FIELD_IDS.rccm}>RCCM</label>
            <input id={FIELD_IDS.rccm} className="form-input" value={rccm} onChange={e => setRccm(e.target.value)} disabled={loading} placeholder="BF-OUA-2021-B-1234" />
          </div>
        </div>
        <div className="s-field-row">
          <div className="s-field">
            <label className="s-label" htmlFor={FIELD_IDS.regime}>Régime fiscal</label>
            <select id={FIELD_IDS.regime} className="form-input" value={taxRegime} onChange={e => setTaxRegime(e.target.value)} disabled={loading}>
              <option value="">— Sélectionner —</option>
              <option value="RNI">RNI — Régime normal d'imposition (CA ≥ 50M F CFA)</option>
              <option value="RSI">RSI — Régime simplifié d'imposition (CA 15–50M F CFA)</option>
              <option value="CME">CME — Contribution des micro-entreprises (CA &lt; 15M F CFA)</option>
            </select>
          </div>
          <div className="s-field">
            <label className="s-label" htmlFor={FIELD_IDS.division}>Division fiscale</label>
            <input id={FIELD_IDS.division} className="form-input" value={divisionFiscale} onChange={e => setDivisionFiscale(e.target.value)} disabled={loading} placeholder="ex. Ouagadougou I" />
          </div>
        </div>
        <div className="s-field">
          <label className="s-label" htmlFor={FIELD_IDS.cadastre}>Référence cadastrale du lieu de vente</label>
          <input id={FIELD_IDS.cadastre} className="form-input" value={cadastralRef} onChange={e => setCadastralRef(e.target.value)} onBlur={() => setTouched(t => ({ ...t, cadastre: true }))} disabled={loading} placeholder="Section, îlot, parcelle : 0123 456 7890" inputMode="numeric"
            aria-invalid={showCadastralError || undefined} aria-describedby={showCadastralError ? 'set-cadastre-error' : 'set-cadastre-hint'} />
          {showCadastralError
            ? <div id="set-cadastre-error" className="s-field-error">{cadastralError}</div>
            : <div id="set-cadastre-hint" style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                Mention obligatoire sur les factures, au format SSSS LLL PPPP (section 4 chiffres, îlot 3, parcelle 4).
              </div>}
        </div>
        <div className="s-field">
          <label className="s-label">Date de création de l'entreprise</label>
          <input className="form-input" type="date" value={businessCreationDate} onChange={e => setBusinessCreationDate(e.target.value)} disabled={loading} />
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Utilisée pour le calcul du prorata des seuils de régime et l'exonération du minimum forfaitaire IS (1ère année).
          </div>
        </div>
        <div className="s-field">
          <label className="s-label" htmlFor={FIELD_IDS.address}>Adresse</label>
          <input id={FIELD_IDS.address} className="form-input" value={address} onChange={e => setAddress(e.target.value)} disabled={loading} placeholder="Av. Kwame Nkrumah, Immeuble Baobab" />
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
      {!inBar && (
        <div className="s-card-foot">
          <button className="btn btn-primary" onClick={() => void handleSave()} disabled={saving || loading}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
    </>
  );
}

const TERMS_OPTIONS = ['À réception', 'Net 7 jours', 'Net 14 jours', 'Net 30 jours'];

/* ─── Invoicing ─────────────────────────────────────────────────── */
interface InvoicingFields { prefix: string; nextNum: string; terms: string; deliveryTerms: string; taxRate: number; footer: string }

function InvoicingSection() {
  const { orgId, showToast, setOrgSettings } = useApp();
  const [snapshot, setSnapshot] = useState<InvoicingFields | null>(null);

  const [prefix,        setPrefix]        = useState('INV-');
  const [nextNum,       setNextNum]        = useState('0001');
  const [terms,         setTerms]         = useState('Net 14 jours');
  const [deliveryTerms, setDeliveryTerms] = useState('À convenir');
  const [taxRate,       setTaxRate]       = useState(18);
  const [footer,        setFooter]        = useState('');
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [loadFailed,    setLoadFailed]    = useState(false);
  const [attempt,       setAttempt]       = useState(0);

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
        if (error || !data) { console.warn('[settings] invoicing fetch:', error?.message ?? 'no row'); setLoadFailed(true); return; }
        const loaded = {
          prefix: data.inv_prefix ?? 'INV-', nextNum: data.inv_next_number ?? '0001',
          terms: data.payment_terms ?? 'Net 14 jours', deliveryTerms: data.delivery_terms ?? 'À convenir',
          taxRate: Number(data.default_tax_rate ?? 18), footer: data.invoice_footer ?? '',
        };
        applyInvoicing(loaded);
        setSnapshot(loaded);
        setLoading(false);
      });
  }, [orgId, attempt]);

  function applyInvoicing(f: InvoicingFields) {
    setPrefix(f.prefix); setNextNum(f.nextNum); setTerms(f.terms); setDeliveryTerms(f.deliveryTerms); setTaxRate(f.taxRate); setFooter(f.footer);
  }
  const current: InvoicingFields = { prefix, nextNum, terms, deliveryTerms, taxRate, footer };
  const dirty = snapshot !== null && (Object.keys(current) as (keyof InvoicingFields)[]).some(k => current[k] !== snapshot[k]);

  async function handleSave(): Promise<boolean> {
    if (!orgId) return false;
    setSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({ inv_prefix: prefix, inv_next_number: nextNum, payment_terms: terms, delivery_terms: deliveryTerms, default_tax_rate: taxRate, invoice_footer: footer })
      .eq('id', orgId);
    setSaving(false);
    if (error) { showToast(error.message, true); return false; }
    setOrgSettings(prev => ({ ...prev, paymentTerms: terms, deliveryTerms }));
    setSnapshot(current);
    posthog.capture('settings_saved', { section: 'invoicing' });
    showToast('Paramètres de facturation enregistrés');
    return true;
  }

  const inBar = useSaveBar(
    { dirty, problem: null, saving },
    { save: handleSave, reset: () => { if (snapshot) applyInvoicing(snapshot); } },
  );

  return (
    <>
      <div className="s-card">
        <div className="s-card-head">
          <div className="s-card-title">Paramètres par défaut</div>
          <div className="s-card-desc">Pré-remplis sur chaque nouvelle facture. Vous pouvez les modifier par facture.</div>
        </div>
        <div className="s-card-body">
          {loadFailed && <LoadFailed onRetry={() => { setLoadFailed(false); setAttempt(a => a + 1); }} />}
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
        {!inBar && (
          <div className="s-card-foot">
            <button className="btn btn-primary" onClick={() => void handleSave()} disabled={saving || loading}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        )}
      </div>
      {/* New interface: in « Automatisation », where these settings will be saved */}
      {!inBar && <div className="s-card">
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
      </div>}
    </>
  );
}

/* ─── Payment Methods ───────────────────────────────────────────── */
// One place for how clients pay: PI-SPI online (a switch and the business's alias; how its payments are confirmed
// is Billio's decision, PRO-189), then the other ways printed on the invoice and recorded by hand.
function PaymentMethodsSection({ onSave }: { onSave: () => void }) {
  const { orgId, showToast } = useApp();
  const [settings, setSettings] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [touched,  setTouched]  = useState(false);

  useEffect(() => {
    if (!orgId) return;
    fetchPaymentSettings(orgId)
      .then(s => { setSettings(s); setLoading(false); })
      .catch(err => { console.error('[PaymentMethods] fetch:', err); setLoading(false); });
  }, [orgId]);

  function patch<K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  const online = settings.onlineMode !== 'off';
  const aliasError = online ? aliasProblem(settings.pispiAlias) : null;

  async function handleSave() {
    if (!orgId) return;
    setTouched(true);
    if (aliasError) { showToast(aliasError, true); return; }
    setSaving(true);
    try {
      await upsertPaymentSettings(orgId, { ...settings, pispiAlias: settings.pispiAlias.trim().toLowerCase() });
      posthog.capture('settings_saved', { section: 'payments' });
      showToast('Paiements enregistrés');
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
        <div className="s-card-title">Paiements</div>
        <div className="s-card-desc">Comment vos clients vous paient. Les moyens activés s’affichent sur la facture.</div>
      </div>
      <div className="s-card-body">
        <div className="s-row">
          <div className="s-row-ico"><Icon name="qrcode" size={17} /></div>
          <div className="s-row-main">
            <div className="s-row-title" id="online-toggle">PI-SPI · paiement en ligne</div>
            <div className="s-row-sub">Le client scanne le QR code de la facture et paie depuis son application.</div>
          </div>
          <div className="s-row-aside" aria-labelledby="online-toggle">
            <Toggle on={online} onChange={v => { patch('onlineMode', v ? 'alias' : 'off'); if (!v) setTouched(false); }} />
          </div>
        </div>
        {online && (
          <div className="s-row s-row-sub-item">
            <div className="s-row-ico" aria-hidden="true" />
            <div className="s-row-main">
              <label className="s-row-title" htmlFor="pispi-alias">Alias PI-SPI</label>
              <div className="s-row-sub">Identifiant de votre compte, fourni par votre banque.</div>
              {touched && aliasError && <div className="s-field-error" role="alert">{aliasError}</div>}
            </div>
            <div className="s-row-aside">
              <input id="pispi-alias" className="form-input" style={{ width: 300 }} placeholder="3497a720-ab11-4973-9619-534e04f263a1" spellCheck={false}
                value={settings.pispiAlias} disabled={loading} aria-invalid={touched && !!aliasError}
                onChange={e => patch('pispiAlias', e.target.value)} onBlur={() => setTouched(true)} />
              <select className="form-input" style={{ width: 150 }} aria-label="Pays du compte" value={settings.pispiCountry} disabled={loading}
                onChange={e => patch('pispiCountry', e.target.value as PispiCountry)}>
                {PISPI_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          </div>
        )}
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
  const [period, setPeriod] = useState<BillingPeriod>('monthly');

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
            <BillingPeriodSwitch value={period} onChange={setPeriod} className="s-period" />
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
                      <li key={perk} title={perk}><Icon name="check" size={12} className="s-upgrade-check" /><span>{perk}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="s-upgrade-right">
                  <div className="s-upgrade-price">
                    {p.price === null
                      ? <span className="s-upgrade-price-main">Sur devis</span>
                      : <>
                          <span className="s-upgrade-price-cur">{p.currency}</span>
                          <span className="s-upgrade-price-main">{formatPrice(planPrice(p, period).amount!)}</span>
                          <span className="s-upgrade-price-period">{planPrice(p, period).per}</span>
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
const ORG_TABS: SettingsTab[] = ['business', 'invoicing', 'payments'];

function LegacySettingsPage() {
  const { showToast } = useApp();
  const { managesOrg } = usePermissions();
  // ?tab= opens a section directly (e.g. links from the invoice compliance warning)
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<SettingsTab>(() => {
    const t = searchParams.get('tab');
    if (t === 'providers') return 'payments'; // « Paiements en ligne » is part of « Paiements » now
    return TABS.some(x => x.key === t) ? (t as SettingsTab) : 'profile';
  });
  const onSave = () => showToast('Paramètres enregistrés');

  return (
    <Page
      title="Paramètres"
      subtitle="Gérez vos préférences de workspace et de facturation"
      actions={<>
        <button className="btn btn-primary" onClick={onSave} disabled={ORG_TABS.includes(tab) && !managesOrg}>
          <Icon name="check" size={15} /> Enregistrer
        </button>
      </>}
    >
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
    </Page>
  );
}

export default function SettingsPage() {
  return UI_V2 ? <SettingsPageV2 /> : <LegacySettingsPage />;
}

/* ─── New interface (PRO-171) ───────────────────────────────────── */
type SectionV2 = 'business' | 'compliance' | 'invoicing' | 'payments' | 'team' | 'automation' | 'plan';

const SECTIONS_V2: { key: SectionV2; icon: string; label: string }[] = [
  { key: 'business',   icon: 'building',       label: 'Entreprise' },
  { key: 'compliance', icon: 'shield-check',   label: 'Conformité DGI' },
  { key: 'invoicing',  icon: 'file-invoice',   label: 'Facturation par défaut' },
  { key: 'payments',   icon: 'credit-card',    label: 'Paiements' },
  { key: 'team',       icon: 'users',          label: 'Équipe et accès' },
  { key: 'automation', icon: 'bell',           label: 'Automatisation' },
  { key: 'plan',       icon: 'sparkles',       label: 'Abonnement' },
];
/** Sections whose fields the DGI checklist reads: it sits beside them */
const WITH_CHECKLIST: SectionV2[] = ['business', 'invoicing', 'payments'];
const ORG_SECTIONS: SectionV2[] = ['business', 'invoicing', 'payments'];

/** Old ?tab= links (from the invoice editor and elsewhere) to the new sections. */
function sectionFromParam(t: string | null): SectionV2 | 'profile' {
  if (t === 'profile') return 'profile';
  if (t === 'reminders' || t === 'notifications') return 'automation';
  if (t === 'providers') return 'payments'; // « Paiements en ligne » is part of « Paiements » now
  return SECTIONS_V2.some(s => s.key === t) ? (t as SectionV2) : 'business';
}

function DgiChecklist({ rows, onFix, large = false }: { rows: ChecklistRow[]; onFix: (fix: ChecklistFix) => void; large?: boolean }) {
  const required = rows.filter(r => r.state !== 'auto' && r.state !== 'info');
  const done = required.filter(r => r.state === 'ok').length;
  const missing = checklistMissing(rows);
  return (
    <section className={`s2-check${large ? ' large' : ''}`} aria-labelledby="s2-check-title">
      <div className="s2-check-head">
        <h2 id="s2-check-title">Conformité DGI</h2>
        <span className={`s2-count${missing ? ' warn' : ''}`}>{done} / {required.length}</span>
      </div>
      <p className="s2-check-intro">
        {missing === 0
          ? 'Vos factures portent toutes les mentions obligatoires de l’entreprise.'
          : 'Il manque des mentions obligatoires : sans elles, vos clients professionnels risquent de ne pas pouvoir déduire la TVA.'}
      </p>
      <ul className="s2-check-list">
        {rows.map(r => (
          <li key={r.key} className={`s2-row ${r.state}`}>
            <Icon name={r.state === 'ok' || r.state === 'auto' ? 'circle-check' : r.state === 'missing' ? 'alert-triangle' : 'dots'} size={16} ariaHidden />
            <span className="s2-row-main">
              {r.label}
              <span className="sr-only">{r.state === 'ok' ? ' : renseigné' : r.state === 'auto' ? ' : automatique' : r.state === 'missing' ? ' : manquant' : ' : non vérifié'}</span>
              {r.state === 'auto' && <small>Automatique</small>}
              {r.state !== 'ok' && r.state !== 'auto' && r.hint && <small>{r.hint}</small>}
            </span>
            {(r.state === 'missing' || r.state === 'unknown') && r.fix && (
              <button type="button" className="s2-fix" onClick={() => onFix(r.fix!)}>Corriger<span className="sr-only"> : {r.label}</span></button>
            )}
          </li>
        ))}
      </ul>
      <div className="s2-secef">
        <Icon name="shield-check" size={16} ariaHidden />
        <span className="s2-row-main">
          Facturation certifiée SECeF
          <small>Pas encore active. Une fois vos factures certifiées, chacune portera le code et le QR SECeF. N’empêche pas d’émettre.</small>
        </span>
      </div>
    </section>
  );
}

function SettingsPageV2() {
  const { orgId, orgSettings, showToast } = useApp();
  const { managesOrg } = usePermissions();
  const [searchParams] = useSearchParams();
  const initial = sectionFromParam(searchParams.get('tab'));
  const [section, setSection] = useState<SectionV2>(initial === 'profile' ? 'business' : initial);
  const [draft, setDraft] = useState<SellerInfo | null>(null);
  const [payments, setPayments] = useState<PaymentSettings | null | undefined>(undefined);
  const [bar, setBar] = useState<SaveBarState | null>(null);
  const actionsRef = useRef<SaveBarActions | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);

  const loadPayments = useCallback(() => {
    if (!orgId) return;
    fetchPaymentSettings(orgId).then(setPayments, () => setPayments(null));
  }, [orgId]);
  useEffect(() => { loadPayments(); }, [loadPayments]);

  const api = useMemo<SaveBarApi>(() => ({
    report: (state, actions) => {
      actionsRef.current = actions;
      setBar(prev => (prev === null && state === null) || (prev && state && prev.dirty === state.dirty && prev.problem === state.problem && prev.saving === state.saving) ? prev : state);
    },
  }), []);
  const dirty = !!bar?.dirty;

  // Leaving with unsaved changes asks first, as in the invoice editor
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Des modifications ne sont pas enregistrées. Quitter sans enregistrer ?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  // The field a « Corriger » link points to, once its section is on screen
  // (the section may still be loading, its fields disabled: tried again until they can take it)
  useEffect(() => {
    if (!focusField) return;
    let tries = 0;
    const tryFocus = () => {
      const el = document.getElementById(focusField) as HTMLInputElement | null;
      if (el && !el.disabled) {
        el.scrollIntoView({ block: 'center' });
        el.focus();
        setFocusField(null);
        return true;
      }
      return false;
    };
    if (tryFocus()) return;
    const timer = window.setInterval(() => {
      // Given up after 10 s (the section couldn't load)
      if (tryFocus() || ++tries >= 100) { window.clearInterval(timer); if (tries >= 100) setFocusField(null); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [focusField, section]);

  function go(next: SectionV2): boolean {
    if (next === section) return true;
    if (dirty) {
      if (!window.confirm('Des modifications ne sont pas enregistrées. Les abandonner ?')) return false;
      actionsRef.current?.reset();
    }
    setDraft(null);
    setSection(next);
    return true;
  }

  function fix(f: ChecklistFix) {
    if (!go(f.tab)) return;
    if (f.field) setFocusField(f.field);
  }

  async function save() {
    if (!actionsRef.current || !bar || bar.problem) return;
    await actionsRef.current.save();
  }

  const onPaymentsSaved = () => { showToast('Paiements enregistrés'); loadPayments(); };
  const seller: SellerInfo = draft ?? {
    name: orgSettings.name, address: orgSettings.address, city: orgSettings.city, country: orgSettings.country,
    ifu: orgSettings.ifu, rccm: orgSettings.rccm, taxRegime: orgSettings.taxRegime, divisionFiscale: orgSettings.divisionFiscale,
    cadastralRef: orgSettings.cadastralRef,
  };
  const rows = payments === undefined ? null : complianceChecklist(seller, payments);
  const missingBusiness = rows ? rows.filter(r => r.state === 'missing' && r.fix?.tab === 'business').length : 0;
  const missingPayments = rows ? rows.filter(r => r.state === 'missing' && r.fix?.tab === 'payments').length : 0;
  const withChecklist = WITH_CHECKLIST.includes(section);

  if (initial === 'profile') return <Navigate to="/profile" replace />;

  return (
    <Page title="Paramètres" subtitle={managesOrg ? 'Les informations de l’entreprise imprimées sur vos factures, et le fonctionnement de Billio.' : 'Seuls les administrateurs peuvent modifier ces paramètres.'}>
      <SaveBarContext.Provider value={api}>
        <div className={`s2-grid${withChecklist ? '' : ' no-aside'}`}>
          <nav className="s2-nav" aria-label="Sections des paramètres">
            {SECTIONS_V2.map(s => {
              const n = s.key === 'business' || s.key === 'compliance' ? missingBusiness + (s.key === 'compliance' ? missingPayments : 0)
                : s.key === 'payments' ? missingPayments : 0;
              return (
                <button key={s.key} type="button" className={`s2-nav-item${section === s.key ? ' active' : ''}`} aria-current={section === s.key ? 'page' : undefined} onClick={() => go(s.key)}>
                  <Icon name={s.icon} size={16} ariaHidden />
                  <span>{s.label}</span>
                  {n > 0 && <span className="s2-nav-count" aria-label={`${n} à corriger`}>{n}</span>}
                </button>
              );
            })}
            <p className="s2-nav-note">Votre profil : depuis le menu du compte.</p>
          </nav>

          <div className="s2-main">
            {ORG_SECTIONS.includes(section) && !managesOrg && (
              <div className="s-card">
                <div className="s-card-body" style={{ color: 'var(--color-text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon name="lock" size={16} ariaHidden />
                  Seuls les administrateurs peuvent modifier ces paramètres.
                </div>
              </div>
            )}
            <fieldset disabled={!managesOrg} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'contents' }}>
              {section === 'business'  && <BusinessSection onDraft={setDraft} />}
              {section === 'invoicing' && <InvoicingSection />}
              {section === 'payments'  && <PaymentMethodsSection onSave={onPaymentsSaved} />}
            </fieldset>
            {section === 'compliance' && (rows
              ? <DgiChecklist rows={rows} onFix={fix} large />
              : <div className="s-card"><div className="s-card-body">Chargement…</div></div>)}
            {section === 'team' && <TeamSection />}
            {section === 'plan' && <PlanSection />}
            {section === 'automation' && (
              <div className="s-card">
                <div className="s-card-head">
                  <div className="s-card-title">Automatisation</div>
                  <div className="s-card-desc">Relances automatiques, PDF joint aux e-mails, pénalités de retard, notifications.</div>
                </div>
                <div className="s-card-body" style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ fontWeight: 600 }}>Bientôt disponible</div>
                </div>
              </div>
            )}
          </div>

          {withChecklist && (
            <aside className="s2-aside" aria-label="Conformité DGI">
              {rows ? <DgiChecklist rows={rows} onFix={fix} /> : <div className="s2-check">Chargement…</div>}
            </aside>
          )}
        </div>

        {dirty && (
          <div className="s2-savebar" role="region" aria-label="Modifications non enregistrées">
            <span className="s2-savebar-dot" aria-hidden="true" />
            <span className="s2-savebar-text">{bar?.problem ?? 'Modifications non enregistrées'}</span>
            <button type="button" className="btn" onClick={() => actionsRef.current?.reset()} disabled={bar?.saving}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={bar?.saving || !!bar?.problem}>
              {bar?.saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        )}
      </SaveBarContext.Provider>
    </Page>
  );
}

/** « Mon profil », from the account menu (new interface): every member's own details. */
export function ProfilePage() {
  return (
    <Page title="Mon profil" subtitle="Vos informations personnelles, pour votre compte et le journal d’activité.">
      <div style={{ maxWidth: 720 }}>
        <ProfileSection />
      </div>
    </Page>
  );
}
