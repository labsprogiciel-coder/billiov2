import { useState, useRef, useCallback, useEffect } from 'react';
import posthog from 'posthog-js';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { nextClientCode, updateClient } from '@/lib/api/clients';
import { fetchPaymentSettings, upsertPaymentSettings } from '@/lib/api/payment-settings';
import { clientIssues, sellerIssues } from '@/lib/invoice-compliance';
import { CLIENT_TYPES, clientTypeDef, clientTypeOf, type ClientType } from '@/lib/client-type';
import { snoozeCompliance } from '@/lib/use-compliance-guard';
import { usePermissions } from '@/lib/use-permissions';
import FiscalDivisionSelect from '@/components/FiscalDivisionSelect';
import { safeReturn } from '@/lib/safe-return';
import './OnboardingPage.css';
import { fmtDateLong } from '@/data';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

/* ── types ── */
interface TeamInvite { id: string; email: string; role: string }
interface ClientDraft { name: string; email: string; av: string; type: ClientType }

const AV = ['av-a', 'av-b', 'av-c', 'av-d', 'av-e', 'av-f'] as const;
const TERMS_OPTIONS = ['À réception', 'Net 7 jours', 'Net 14 jours', 'Net 30 jours'];
const TERMS_DAYS: Record<string, number> = { 'À réception': 0, 'Net 7 jours': 7, 'Net 14 jours': 14, 'Net 30 jours': 30 };

/** Preview due date (YYYY-MM-DD) for the chosen payment terms, from today. */
function previewDue(terms: string): string {
  const d = new Date();
  d.setDate(d.getDate() + (TERMS_DAYS[terms] ?? 14));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
type StepKey = 'business' | 'invoicing' | 'team' | 'clients' | 'finish' | 'bank' | 'client';
const STEP_INFO: Record<StepKey, { label: string; skippable: boolean }> = {
  business:  { label: 'Informations entreprise', skippable: false },
  invoicing: { label: 'Paramètres factures',     skippable: false },
  team:      { label: 'Inviter l\'équipe',       skippable: true  },
  clients:   { label: 'Ajouter des clients',     skippable: true  },
  finish:    { label: 'Terminer',                skippable: false },
  bank:      { label: 'Coordonnées bancaires',   skippable: false },
  client:    { label: 'Informations du client',  skippable: false },
};
const ONBOARDING_STEPS: StepKey[] = ['business', 'invoicing', 'team', 'clients', 'finish'];

const TAX_REGIMES = [
  { value: 'RNI', label: "RNI — Régime normal d'imposition (CA ≥ 50M F CFA)" },
  { value: 'RSI', label: "RSI — Régime simplifié d'imposition (CA 15–50M F CFA)" },
  { value: 'CME', label: 'CME — Contribution des micro-entreprises (CA < 15M F CFA)' },
];


function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'B';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmt(n: number) {
  return Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ');
}

/* ── icons as React SVG elements (no dangerouslySetInnerHTML) ── */
type SvgProps = { s?: number };

const IcoBuilding      = (_: SvgProps) => <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>;
const IcoFileInvoice   = (_: SvgProps) => <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/><path d="M9 9h1"/></>;
const IcoUsers         = (_: SvgProps) => <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>;
const IcoBriefcase     = (_: SvgProps) => <><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>;
const IcoCircleCheck   = (_: SvgProps) => <><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></>;
const IcoArrowRight    = (_: SvgProps) => <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>;
const IcoArrowLeft     = (_: SvgProps) => <><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></>;
const IcoCamera        = (_: SvgProps) => <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></>;
const IcoUserPlus      = (_: SvgProps) => <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></>;
const IcoPlus          = (_: SvgProps) => <><path d="M5 12h14"/><path d="M12 5v14"/></>;
const IcoDownload      = (_: SvgProps) => <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></>;
const IcoTrash         = (_: SvgProps) => <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></>;
const IcoChevronRight  = (_: SvgProps) => <path d="m9 18 6-6-6-6"/>;
const IcoEye           = (_: SvgProps) => <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>;
const IcoBolt          = (_: SvgProps) => <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>;
const IcoShieldCheck   = (_: SvgProps) => <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></>;
const IcoInfoCircle    = (_: SvgProps) => <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>;
const IcoSparkles      = (_: SvgProps) => <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>;
const IcoCheck         = (_: SvgProps) => <path d="M20 6 9 17l-5-5"/>;
const IcoClock         = (_: SvgProps) => <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>;
const IcoDeviceMobile  = (_: SvgProps) => <><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></>;
const IcoBuildingBank  = (_: SvgProps) => <><path d="m3 10 2-2 7-5 7 5 2 2H3z"/><path d="M12 3v7"/><path d="M3 10v10h18V10"/><path d="M6 14v2"/><path d="M10 14v2"/><path d="M14 14v2"/><path d="M18 14v2"/></>;
const IcoLoader        = (_: SvgProps) => <path d="M21 12a9 9 0 1 1-6.219-8.56"/>;

type IcoName =
  | 'building' | 'file-invoice' | 'users' | 'briefcase' | 'circle-check'
  | 'arrow-right' | 'arrow-left' | 'camera' | 'user-plus' | 'plus'
  | 'download' | 'trash' | 'chevron-right' | 'eye' | 'bolt'
  | 'shield-check' | 'info-circle' | 'sparkles' | 'check' | 'clock'
  | 'device-mobile' | 'building-bank' | 'loader-2';

const ICON_MAP: Record<IcoName, () => React.ReactElement> = {
  'building':       () => <IcoBuilding />,
  'file-invoice':   () => <IcoFileInvoice />,
  'users':          () => <IcoUsers />,
  'briefcase':      () => <IcoBriefcase />,
  'circle-check':   () => <IcoCircleCheck />,
  'arrow-right':    () => <IcoArrowRight />,
  'arrow-left':     () => <IcoArrowLeft />,
  'camera':         () => <IcoCamera />,
  'user-plus':      () => <IcoUserPlus />,
  'plus':           () => <IcoPlus />,
  'download':       () => <IcoDownload />,
  'trash':          () => <IcoTrash />,
  'chevron-right':  () => <IcoChevronRight />,
  'eye':            () => <IcoEye />,
  'bolt':           () => <IcoBolt />,
  'shield-check':   () => <IcoShieldCheck />,
  'info-circle':    () => <IcoInfoCircle />,
  'sparkles':       () => <IcoSparkles />,
  'check':          () => <IcoCheck />,
  'clock':          () => <IcoClock />,
  'device-mobile':  () => <IcoDeviceMobile />,
  'building-bank':  () => <IcoBuildingBank />,
  'loader-2':       () => <IcoLoader />,
};

function Ico({ name, style }: { name: IcoName; style?: React.CSSProperties }) {
  const children = ICON_MAP[name]?.();
  return (
    <i className="ti" style={style}>
      <svg viewBox="0 0 24 24" width="1em" height="1em"
        fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </i>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const { orgId, userId, completeOnboarding, showToast, clients: orgClients, setClients: setOrgClients, orgSettings, setOrgSettings } = useApp();
  const { managesOrg, writable } = usePermissions();

  /*
   * Completion mode (/onboarding?complete=1&return=…&client=…): opened when an
   * invoice is about to be issued without its mandatory mentions. Shows only
   * the steps with missing details, prefilled, saves just those details and
   * goes back to the invoice.
   */
  const [searchParams] = useSearchParams();
  const complete = searchParams.get('complete') === '1';
  // Only same-app paths: never send the user to another site after the wizard
  const returnTo = safeReturn(searchParams.get('return'), window.location.origin);
  const targetClientCode = searchParams.get('client') ?? '';
  const targetClient = orgClients.find(c => c.code === targetClientCode);

  /* ── navigation ── */
  const [steps, setSteps] = useState<StepKey[]>(complete ? [] : ONBOARDING_STEPS);
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const cur: StepKey | undefined = steps[step];
  /** Mentions found missing when the completion wizard opened (invoice-compliance keys) */
  const [missing, setMissing] = useState<Set<string>>(new Set());

  /* ── step 1: business ── */
  const [bizName,  setBizName]  = useState('');
  const [taxId,    setTaxId]    = useState('');
  const [rccm,     setRccm]     = useState('');
  const [address,  setAddress]  = useState('');
  const [city,     setCity]     = useState('');
  const [country,  setCountry]  = useState('Burkina Faso');
  const [currency, setCurrency] = useState('F CFA');
  const [taxRegime, setTaxRegime] = useState('');
  const [divisionFiscale, setDivisionFiscale] = useState('');
  const [iban,     setIban]     = useState('');
  /* ── completion mode: the client being invoiced ── */
  const [cliName,  setCliName]  = useState('');
  const [cliCity,  setCliCity]  = useState('');
  const [cliIfu,   setCliIfu]   = useState('');
  const [cliRccm,  setCliRccm]  = useState('');
  const [cliType,  setCliType]  = useState<ClientType>('PP');
  const [fieldErr, setFieldErr] = useState<Set<string>>(new Set());
  const [logoType, setLogoType] = useState<'none' | 'mono' | 'img'>('none');
  const [logoUrl,  setLogoUrl]  = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  /* ── step 2: invoice defaults ── */
  const [prefix,    setPrefix]    = useState('INV-');
  const [nextNum,   setNextNum]   = useState('0001');
  const [terms,     setTerms]     = useState('Net 14 jours');
  const [taxRate,   setTaxRate]   = useState(18);
  const [payMethod, setPayMethod] = useState('Mobile Money (MTN / Orange / Wave)');
  const [footer,    setFooter]    = useState('Merci pour votre confiance. Paiement à régler sous 14 jours.');

  /* ── step 3: team ── */
  const [teamEmail,   setTeamEmail]   = useState('');
  const [teamRole,    setTeamRole]    = useState('Membre');
  const [teamInvites, setTeamInvites] = useState<TeamInvite[]>([]);
  const [teamEmailErr, setTeamEmailErr] = useState(false);

  /* ── step 4: clients ── */
  const [clientName,    setClientName]    = useState('');
  const [clientType,    setClientType]    = useState<ClientType>('PM');
  const [clientEmail,   setClientEmail]   = useState('');
  const [clients,       setClients]       = useState<ClientDraft[]>([]);
  const [clientNameErr, setClientNameErr] = useState(false);

  /* ── validation ── */
  const [bizNameErr,  setBizNameErr]  = useState(false);
  const [nextNumErr,  setNextNumErr]  = useState(false);

  /* ── saving ── */
  const [saving, setSaving] = useState(false);

  const startTimeRef = useRef(Date.now());
  useEffect(() => { posthog.capture('onboarding_started'); }, []);

  /* ── derived ── */
  const logoInitials = initials(bizName || 'B');
  const docNum = `#${prefix}${nextNum}`;
  const sub = 770000;
  const taxVal = sub * taxRate / 100;

  /* ── navigation helpers ── */
  const goTo = useCallback((i: number) => {
    const next = Math.max(0, Math.min(steps.length - 1, i));
    setStep(next);
    setMaxReached(prev => Math.max(prev, next));
  }, [steps.length]);

  function validateCurrentStep() {
    if (cur === 'business' && !bizName.trim()) { setBizNameErr(true); return false; }
    if (cur === 'invoicing' && !nextNum.trim())  { setNextNumErr(true); return false; }
    if (complete) {
      // The mentions that were missing must now be filled in
      const empty = (v: string) => !v.trim();
      const errs = new Set<string>();
      if (cur === 'business') {
        if (missing.has('seller-ifu') && empty(taxId)) errs.add('ifu');
        if (missing.has('seller-rccm') && empty(rccm)) errs.add('rccm');
        if (missing.has('seller-address') && empty(address) && empty(city)) errs.add('city');
        if (missing.has('seller-regime') && empty(taxRegime)) errs.add('regime');
        if (missing.has('seller-division') && empty(divisionFiscale)) errs.add('division');
      }
      if (cur === 'bank' && empty(iban)) errs.add('iban');
      if (cur === 'client') {
        // Re-check with the type chosen here: PM and PC need their IFU, PP and CC don't
        const left = clientIssues({ ...targetClient, name: cliName, ifu: cliIfu, clientType: cliType });
        if (left.some(i => i.key === 'client-name')) errs.add('cliName');
        if (left.some(i => i.key === 'client-ifu')) errs.add('cliIfu');
      }
      setFieldErr(errs);
      if (errs.size > 0) return false;
    }
    return true;
  }
  const errCls = (k: string) => (fieldErr.has(k) ? ' err' : '');

  /* ── completion mode: load what is saved and pick the steps ── */
  const [completeLoaded, setCompleteLoaded] = useState(false);
  useEffect(() => {
    if (!complete || !orgId || completeLoaded) return;
    if (targetClientCode && !targetClient && orgClients.length === 0) return; // clients still loading
    let cancelled = false;
    (async () => {
      const [orgRes, payments] = await Promise.all([
        // Demo mode has no database: start from what the app holds
        MOCK
          ? Promise.resolve({ error: null, data: {
              name: orgSettings.name, ifu: orgSettings.ifu, rccm: orgSettings.rccm, address: orgSettings.address,
              city: orgSettings.city, country: orgSettings.country, currency: 'F CFA',
              tax_regime: orgSettings.taxRegime, division_fiscale: orgSettings.divisionFiscale,
            } })
          : supabase.from('organizations')
              .select('name, ifu, rccm, address, city, country, currency, tax_regime, division_fiscale')
              .eq('id', orgId).single(),
        fetchPaymentSettings(orgId).catch(() => null),
      ]);
      if (cancelled) return;
      const org = orgRes.data;
      if (orgRes.error || !org) {
        showToast("Impossible de charger les informations de l'entreprise. Réessayez.", true);
        navigate(returnTo, { replace: true });
        return;
      }
      setBizName(org.name ?? ''); setTaxId(org.ifu ?? ''); setRccm(org.rccm ?? '');
      setAddress(org.address ?? ''); setCity(org.city ?? ''); setCountry(org.country || 'Burkina Faso');
      setCurrency(org.currency || 'F CFA'); setTaxRegime(org.tax_regime ?? ''); setDivisionFiscale(org.division_fiscale ?? '');
      setIban(payments?.methodBankIban ?? '');
      if (targetClient) {
        setCliName(targetClient.name);
        setCliCity(targetClient.city === '—' ? '' : targetClient.city);
        setCliIfu(targetClient.ifu ?? ''); setCliRccm(targetClient.rccm ?? '');
        setCliType(clientTypeOf(targetClient));
      }
      const seller = sellerIssues({
        name: org.name ?? '', address: org.address ?? '', city: org.city ?? '', country: org.country ?? '',
        ifu: org.ifu ?? '', rccm: org.rccm ?? '', taxRegime: org.tax_regime ?? '', divisionFiscale: org.division_fiscale ?? '',
      }, payments);
      const forClient = clientIssues(targetClient);
      const keys = new Set([...seller, ...forClient].map(i => i.key));
      const next: StepKey[] = [];
      if (managesOrg && seller.some(i => i.key !== 'seller-bank')) next.push('business');
      if (managesOrg && keys.has('seller-bank')) next.push('bank');
      if (writable && forClient.length > 0) next.push('client');
      setMissing(keys);
      setCompleteLoaded(true);
      if (next.length === 0) {
        navigate(returnTo, { replace: true });
        return;
      }
      setSteps(next);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, orgId, targetClientCode, targetClient, orgClients.length, completeLoaded]);

  async function handleCompleteSave() {
    if (saving || !validateCurrentStep()) return;
    setSaving(true);
    try {
      if (steps.includes('business')) {
        const patch = {
          name: bizName.trim(), ifu: taxId.trim(), rccm: rccm.trim(), address: address.trim(), city: city.trim(),
          country, tax_regime: taxRegime, division_fiscale: divisionFiscale,
        };
        if (!MOCK) {
          const { error } = await supabase.from('organizations').update(patch).eq('id', orgId);
          if (error) throw error;
        }
        setOrgSettings(prev => ({ ...prev, name: patch.name, ifu: patch.ifu, rccm: patch.rccm, address: patch.address,
          city: patch.city, country, taxRegime, divisionFiscale }));
      }
      if (steps.includes('bank') && !MOCK) {
        await upsertPaymentSettings(orgId, { methodBankEnabled: true, methodBankIban: iban.trim() });
      }
      // Demo payment settings aren't stored: don't send the user back here this session
      if (MOCK) snoozeCompliance();
      if (steps.includes('client') && targetClient) {
        const patch = { name: cliName.trim(), city: cliCity.trim() || '—', ifu: cliIfu.trim(), rccm: cliRccm.trim(), clientType: cliType };
        await updateClient(orgId, targetClient.code, patch);
        setOrgClients(prev => prev.map(c => c.code === targetClient.code ? { ...c, ...patch } : c));
      }
      posthog.capture('compliance_completed', { steps });
      showToast('Informations enregistrées. Vous pouvez émettre la facture.');
      navigate(returnTo);
    } catch (err) {
      console.error('[onboarding] completion save failed:', err);
      showToast("Les informations n'ont pas pu être enregistrées. Réessayez.", true);
      setSaving(false);
    }
  }

  function postpone() {
    snoozeCompliance();
    showToast('Vous pourrez compléter ces informations dans Paramètres → Entreprise.');
    navigate(returnTo);
  }

  function onNext() {
    if (!validateCurrentStep()) return;
    goTo(step + 1);
  }

  /* ── logo upload ── */
  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { setLogoType('img'); setLogoUrl(rd.result as string); };
    rd.readAsDataURL(file);
  }

  /* ── team ── */
  function addTeamMember() {
    if (!teamEmail || !/.+@.+\..+/.test(teamEmail)) { setTeamEmailErr(true); return; }
    setTeamInvites(prev => [...prev, { id: crypto.randomUUID(), email: teamEmail, role: teamRole }]);
    setTeamEmail('');
    setTeamEmailErr(false);
  }

  function inviteUrl(token: string) {
    return `${window.location.origin}/invite/${token}`;
  }

  const [copiedId, setCopiedId] = useState<string | null>(null);
  function copyLink(token: string) {
    navigator.clipboard.writeText(inviteUrl(token));
    setCopiedId(token);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function removeTeamMember(i: number) {
    setTeamInvites(prev => prev.filter((_, idx) => idx !== i));
  }

  /* ── clients ── */
  function addClient() {
    if (!clientName.trim()) { setClientNameErr(true); return; }
    setClients(prev => [...prev, { name: clientName.trim(), email: clientEmail.trim(), av: AV[prev.length % AV.length], type: clientType }]);
    setClientName(''); setClientEmail('');
    setClientNameErr(false);
  }

  function removeClient(i: number) {
    setClients(prev => prev.filter((_, idx) => idx !== i));
  }

  function seedDemoClients() {
    if (clients.some(c => c.name === 'Sahel Banque')) return;
    setClients(prev => [
      ...prev,
      { name: 'Sahel Banque',    email: 'finance@sahel.bf',        av: AV[prev.length     % AV.length], type: 'PM' },
      { name: 'Faso Textiles',   email: 'compta@fasotextiles.bf',  av: AV[(prev.length+1) % AV.length], type: 'PM' },
      { name: 'Ouaga Catering',  email: '',                         av: AV[(prev.length+2) % AV.length], type: 'PM' },
    ]);
  }

  /* ── finish: save to Supabase ── */
  async function handleFinish() {
    if (saving) return;
    setSaving(true);
    const orgName = bizName.trim() || 'Mon entreprise';
    try {
      // Users whose signup trigger didn't create an org have none yet —
      // bootstrap it (idempotent: returns the existing org if there is one).
      let targetOrgId = orgId;
      if (!targetOrgId) {
        const { data: newOrgId, error: createErr } = await supabase.rpc('create_initial_org', { p_name: orgName });
        if (createErr) throw createErr;
        targetOrgId = newOrgId as string;
      }

      // Step 1 + Step 2 — org details and invoice defaults
      const { error: orgErr } = await supabase
        .from('organizations')
        .update({
          name:                  orgName,
          ifu:                   taxId.trim(),
          rccm:                  rccm.trim(),
          tax_regime:            taxRegime,
          division_fiscale:      divisionFiscale,
          address:               address.trim(),
          city:                  city.trim(),
          country,
          currency,
          inv_prefix:            prefix,
          inv_next_number:       nextNum,
          payment_terms:         terms,
          default_tax_rate:      taxRate,
          default_pay_method:    payMethod,
          invoice_footer:        footer,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq('id', targetOrgId);
      if (orgErr) throw orgErr;

      // Bank details printed on invoices (Paramètres → Moyens de paiement)
      if (iban.trim()) {
        await upsertPaymentSettings(targetOrgId, { methodBankEnabled: true, methodBankIban: iban.trim() }).catch(err => {
          console.warn('Bank details save error:', err);
          showToast("Les coordonnées bancaires n'ont pas pu être enregistrées. Ajoutez-les dans Paramètres → Moyens de paiement.", true);
        });
      }

      // Step 3 — team invitations
      if (teamInvites.length > 0) {
        const ROLE_MAP: Record<string, string> = {
          'Administrateur': 'admin',
          'Membre':         'member',
          'Comptable':      'accountant',
          'Observateur':    'observer',
        };
        const { error: invErr } = await supabase
          .from('pending_invitations')
          .upsert(
            teamInvites.map(t => ({
              id:         t.id,
              token:      t.id,
              org_id:     targetOrgId,
              email:      t.email.toLowerCase().trim(),
              role:       ROLE_MAP[t.role] ?? 'member',
              invited_by: userId || undefined,
            })),
            { onConflict: 'org_id,email', ignoreDuplicates: true }
          );
        if (invErr) {
          console.warn('Invitation insert error:', invErr.message);
          showToast('Les invitations n\'ont pas pu être enregistrées. Réessayez depuis Paramètres → Équipe.', true);
        }
      }

      // Step 4 — clients
      if (clients.length > 0) {
        // Codes come from the per-org sequence so they never collide with existing clients
        const codes: string[] = [];
        for (let i = 0; i < clients.length; i++) codes.push(await nextClientCode(targetOrgId));
        const { error: cliErr } = await supabase.from('clients').insert(
          clients.map((c, i) => ({
            org_id:     targetOrgId,
            created_by: userId || undefined,
            code:       codes[i],
            name:       c.name,
            email:      c.email || '—',
            av:         c.av,
            contact:    '—',
            phone:      '—',
            city:       '—',
            ifu:        '',
            client_type: c.type,
            status:     'active',
          }))
        );
        if (cliErr) throw cliErr;
      }

      posthog.capture('onboarding_completed', {
        org_name:              orgName,
        clients_added:         clients.length,
        team_invites:          teamInvites.length,
        time_to_complete_seconds: Math.round((Date.now() - startTimeRef.current) / 1000),
      });
      await completeOnboarding();
      navigate('/dashboard');
    } catch (err) {
      console.error('Onboarding save error:', err);
      showToast('Impossible d\'enregistrer votre configuration. Vérifiez votre connexion et réessayez.', true);
      setSaving(false);
    }
  }

  /* ── aside pane key ── */
  const pane = cur === 'team' ? 'team' : cur === 'clients' ? 'clients' : cur === 'finish' ? 'summary' : 'invoice';

  /* ── render ── */
  return (
    <div className="ob-root">
      <div className="ob-wiz">

        {/* ───── Head ───── */}
        <header className="ob-head">
          <div className="ob-logo-mark">
            <div className="ob-logo-icon" aria-hidden>
              <img src="/assets/ICONE LOGO BILIO.png" width="18" height="18" alt="" style={{ display: 'block', objectFit: 'contain' }} />
            </div>
            <div>
              <div className="ob-logo-text">Billio</div>
              <div className="ob-logo-tag">Invoicing</div>
            </div>
          </div>

          <div className="ob-progress-wrap">
            <div className="ob-seg-track">
              {steps.map((k, i) => (
                <div
                  key={k}
                  className={`ob-seg${i === step ? ' active' : ''}${i < step ? ' done' : ''}${i > maxReached ? ' locked' : ''}`}
                  onClick={() => i <= maxReached && goTo(i)}
                  title={STEP_INFO[k].label}
                >
                  <span className="ob-seg-fill" />
                </div>
              ))}
            </div>
            <div className="ob-progress-label">
              Étape <b>{step + 1}</b> sur {steps.length} · <span className="pl-name">{cur ? STEP_INFO[cur].label : ''}</span>
            </div>
          </div>

          <div className="ob-head-right">
            {complete
              ? <button className="ob-skip-link" onClick={postpone}>Plus tard <Ico name="arrow-right" /></button>
              : <button className="ob-skip-link" onClick={() => navigate('/dashboard')}>
                  Passer la config <Ico name="arrow-right" />
                </button>}
          </div>
        </header>

        {/* ───── Body ───── */}
        <div className="ob-body">

          {/* Form column */}
          <main className="ob-main">
            <div className="ob-main-inner">

              {/* STEP 1 — Business details */}
              <section className={`ob-step${cur === 'business' ? ' active' : ''}`}>
                <div className="ob-eyebrow">
                  <span className="pellet"><Ico name="building" /></span> Votre entreprise
                </div>
                <h2 className="ob-step-title">{complete ? 'Complétez les informations de votre entreprise' : 'Parlez-nous de votre entreprise'}</h2>
                <p className="ob-step-sub">{complete
                  ? "Une facture doit porter ces mentions (facture normalisée). Sans elles, votre client professionnel risque de ne pas pouvoir déduire la TVA et de refuser la facture."
                  : 'Ces informations apparaissent sur chaque facture et devis envoyé. Vous pouvez les modifier à tout moment dans les Paramètres.'}</p>

                <div className="ob-step-form">
                  {!complete && <div className="ob-field">
                    <div className="ob-field-label">Logo de l'entreprise <span className="opt">· facultatif</span></div>
                    <div className="ob-logo-upload">
                      <div
                        className={`ob-logo-slot${logoType === 'mono' ? ' has-mono' : ''}`}
                        onClick={() => logoInputRef.current?.click()}
                      >
                        {logoType === 'img' && logoUrl
                          ? <img src={logoUrl} alt="logo" />
                          : logoType === 'mono'
                            ? <div className="ob-logo-mono">{logoInitials}</div>
                            : <><Ico name="camera" /><span>Téléverser</span></>
                        }
                        <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={handleLogoChange} />
                      </div>
                      <div className="ob-logo-actions">
                        <button className="ob-btn-sm" type="button" onClick={() => logoInputRef.current?.click()}>
                          <Ico name="camera" /> Téléverser une image
                        </button>
                        <button
                          className="ob-btn-sm ob-btn-ghost"
                          type="button"
                          onClick={() => setLogoType(logoType === 'mono' ? 'none' : 'mono')}
                        >
                          Utiliser les initiales
                        </button>
                        <div className="ob-field-hint">PNG ou SVG, au moins 200×200 px.</div>
                      </div>
                    </div>
                  </div>}

                  <div className="ob-field">
                    <label className="ob-field-label">Nom de l'entreprise</label>
                    <input
                      className={`ob-input${bizNameErr ? ' err' : ''}`}
                      type="text" value={bizName}
                      placeholder="ex. Studio Wend SARL"
                      onChange={e => { setBizName(e.target.value); setBizNameErr(false); }}
                    />
                  </div>

                  <div className="ob-row">
                    <div className="ob-field">
                      <label className="ob-field-label" htmlFor="ob-ifu">Identifiant fiscal (IFU)</label>
                      <input id="ob-ifu" className={`ob-input${errCls('ifu')}`} type="text" value={taxId} placeholder="00012345 B" onChange={e => setTaxId(e.target.value)} />
                    </div>
                    <div className="ob-field">
                      <label className="ob-field-label" htmlFor="ob-rccm">RCCM</label>
                      <input id="ob-rccm" className={`ob-input${errCls('rccm')}`} type="text" value={rccm} placeholder="BF-OUA-2021-B-1234" onChange={e => setRccm(e.target.value)} />
                    </div>
                  </div>

                  <div className="ob-row">
                    <div className="ob-field">
                      <label className="ob-field-label" htmlFor="ob-regime">Régime fiscal</label>
                      <select id="ob-regime" className={`ob-input${errCls('regime')}`} value={taxRegime} onChange={e => setTaxRegime(e.target.value)}>
                        <option value="">— Sélectionner —</option>
                        {TAX_REGIMES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                    <div className={`ob-field${fieldErr.has('division') ? ' ob-field-err' : ''}`}>
                      <div className="ob-field-label">Division fiscale</div>
                      <FiscalDivisionSelect value={divisionFiscale} onChange={setDivisionFiscale} />
                      {fieldErr.has('division') && <div className="ob-field-hint" role="alert">Choisissez votre service des impôts.</div>}
                    </div>
                  </div>

                  <div className="ob-field">
                    <label className="ob-field-label">Adresse</label>
                    <input className="ob-input" type="text" value={address} placeholder="Rue, bâtiment" onChange={e => setAddress(e.target.value)} />
                  </div>

                  <div className="ob-row-3">
                    <div className="ob-field">
                      <label className="ob-field-label" htmlFor="ob-city">Ville</label>
                      <input id="ob-city" className={`ob-input${errCls('city')}`} type="text" value={city} placeholder="ex. Ouagadougou" onChange={e => setCity(e.target.value)} />
                    </div>
                    <div className="ob-field">
                      <label className="ob-field-label">Pays</label>
                      <select className="ob-input" value={country} onChange={e => setCountry(e.target.value)}>
                        {['Burkina Faso', 'Mali', "Côte d'Ivoire", 'Sénégal', 'Niger', 'Bénin', 'Togo'].map(c => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div className="ob-field">
                      <label className="ob-field-label">Devise</label>
                      <select className="ob-input" value={currency} onChange={e => setCurrency(e.target.value)}>
                        <option value="F CFA">F CFA — Franc CFA</option>
                        <option value="EUR">EUR — Euro</option>
                        <option value="USD">USD — Dollar US</option>
                        <option value="GHS">GHS — Cedi</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              {/* STEP 2 — Invoice defaults */}
              <section className={`ob-step${cur === 'invoicing' ? ' active' : ''}`}>
                <div className="ob-eyebrow">
                  <span className="pellet"><Ico name="file-invoice" /></span> Paramètres factures
                </div>
                <h2 className="ob-step-title">Configurez vos paramètres de facturation</h2>
                <p className="ob-step-sub">Ces valeurs seront préremplies sur chaque nouvelle facture — vous pouvez les modifier au cas par cas.</p>

                <div className="ob-step-form">
                  <div className="ob-row">
                    <div className="ob-field">
                      <label className="ob-field-label">Préfixe du numéro de facture</label>
                      <input className="ob-input" type="text" value={prefix} onChange={e => setPrefix(e.target.value)} />
                    </div>
                    <div className="ob-field">
                      <label className="ob-field-label">Prochain numéro</label>
                      <input
                        className={`ob-input tnum${nextNumErr ? ' err' : ''}`}
                        type="text" value={nextNum}
                        onChange={e => { setNextNum(e.target.value); setNextNumErr(false); }}
                      />
                    </div>
                  </div>
                  <div className="ob-field-hint" style={{ marginTop: -6, marginBottom: 16 }}>
                    Votre prochaine facture sera <b>{docNum}</b>.
                  </div>

                  <div className="ob-field">
                    <div className="ob-field-label">Conditions de paiement par défaut</div>
                    <div className="ob-chip-row">
                      {TERMS_OPTIONS.map(t => (
                        <button key={t} type="button" className={`ob-chip${terms === t ? ' active' : ''}`} onClick={() => setTerms(t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ob-row">
                    <div className="ob-field">
                      <label className="ob-field-label">TVA par défaut</label>
                      <div className="ob-affix">
                        <input type="number" value={taxRate} min={0} max={100} onChange={e => setTaxRate(Number(e.target.value))} />
                        <span className="suffix">%</span>
                      </div>
                    </div>
                    <div className="ob-field">
                      <label className="ob-field-label">Moyen de paiement par défaut</label>
                      <select className="ob-input" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                        <option>Mobile Money (MTN / Orange / Wave)</option>
                        <option>Virement bancaire</option>
                        <option>Paiement à la livraison</option>
                      </select>
                    </div>
                  </div>

                  <div className="ob-field">
                    <label className="ob-field-label" htmlFor="ob-iban-setup">RIB / IBAN pour les virements</label>
                    <input id="ob-iban-setup" className="ob-input" type="text" value={iban} placeholder="BF00 0000 0000 0000 0000 0000 000" onChange={e => setIban(e.target.value)} />
                    <div className="ob-field-hint">Mention obligatoire sur vos factures (coordonnées bancaires).</div>
                  </div>

                  <div className="ob-field">
                    <label className="ob-field-label">Note de bas de facture <span className="opt">· facultatif</span></label>
                    <textarea className="ob-input" rows={2} value={footer} onChange={e => setFooter(e.target.value)} />
                  </div>
                </div>
              </section>

              {/* COMPLETION — bank details */}
              <section className={`ob-step${cur === 'bank' ? ' active' : ''}`}>
                <div className="ob-eyebrow">
                  <span className="pellet"><Ico name="building-bank" /></span> Coordonnées bancaires
                </div>
                <h2 className="ob-step-title">Ajoutez vos coordonnées bancaires</h2>
                <p className="ob-step-sub">Elles font partie des mentions obligatoires d'une facture et permettent à vos clients de payer par virement.</p>
                <div className="ob-step-form">
                  <div className="ob-field">
                    <label className="ob-field-label" htmlFor="ob-iban">RIB / IBAN</label>
                    <input id="ob-iban" className={`ob-input${errCls('iban')}`} type="text" value={iban} placeholder="BF00 0000 0000 0000 0000 0000 000" onChange={e => setIban(e.target.value)} />
                    <div className="ob-field-hint">Le virement bancaire sera activé dans Paramètres → Moyens de paiement.</div>
                  </div>
                </div>
              </section>

              {/* COMPLETION — the client being invoiced */}
              <section className={`ob-step${cur === 'client' ? ' active' : ''}`}>
                <div className="ob-eyebrow">
                  <span className="pellet"><Ico name="users" /></span> Client
                </div>
                <h2 className="ob-step-title">Complétez la fiche de {targetClient?.name.trim() || 'votre client'}</h2>
                <p className="ob-step-sub">La facture indique le type du client. L'IFU est obligatoire pour une entreprise ou un commerçant, facultatif pour un particulier.</p>
                <div className="ob-step-form">
                  <div className="ob-field">
                    <label className="ob-field-label" htmlFor="ob-cli-name">Nom ou raison sociale</label>
                    <input id="ob-cli-name" className={`ob-input${errCls('cliName')}`} type="text" value={cliName} onChange={e => setCliName(e.target.value)} />
                  </div>
                  <div className="ob-field">
                    <label className="ob-field-label" htmlFor="ob-cli-type">Type de client</label>
                    <select id="ob-cli-type" className="ob-input" value={cliType} onChange={e => setCliType(e.target.value as ClientType)}>
                      {CLIENT_TYPES.filter(t => t.code !== 'CC' || cliType === 'CC').map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="ob-field">
                    <label className="ob-field-label" htmlFor="ob-cli-city">Adresse ou ville <span className="opt">· facultatif</span></label>
                    <input id="ob-cli-city" className="ob-input" type="text" value={cliCity} placeholder="ex. Ouagadougou" onChange={e => setCliCity(e.target.value)} />
                  </div>
                  <div className="ob-row">
                    <div className="ob-field">
                      <label className="ob-field-label" htmlFor="ob-cli-ifu">IFU du client {!clientTypeDef(cliType).ifuRequired && <span className="opt">· facultatif</span>}</label>
                      <input id="ob-cli-ifu" className={`ob-input${errCls('cliIfu')}`} type="text" value={cliIfu} placeholder="00067890 C" onChange={e => setCliIfu(e.target.value)} />
                    </div>
                    <div className="ob-field">
                      <label className="ob-field-label" htmlFor="ob-cli-rccm">RCCM du client <span className="opt">· facultatif</span></label>
                      <input id="ob-cli-rccm" className="ob-input" type="text" value={cliRccm} placeholder="BF-OUA-2020-B-5678" onChange={e => setCliRccm(e.target.value)} />
                    </div>
                  </div>
                </div>
              </section>

              {complete && !completeLoaded && (
                <section className="ob-step active" aria-busy="true">
                  <p className="ob-step-sub">Chargement de vos informations…</p>
                </section>
              )}

              {/* STEP 3 — Invite team */}
              <section className={`ob-step${cur === 'team' ? ' active' : ''}`}>
                <div className="ob-eyebrow">
                  <span className="pellet"><Ico name="users" /></span> Votre équipe
                </div>
                <h2 className="ob-step-title">Invitez votre équipe</h2>
                <p className="ob-step-sub">Invitez des collaborateurs pour créer et suivre les factures ensemble. Ils recevront un e-mail d'invitation. Vous pouvez passer cette étape et ajouter des membres plus tard.</p>

                <div className="ob-step-form">
                  <div className="ob-add-row team">
                    <div className="ob-field" style={{ margin: 0 }}>
                      <label className="ob-field-label">E-mail professionnel</label>
                      <input
                        className={`ob-input${teamEmailErr ? ' err' : ''}`}
                        type="email" value={teamEmail} placeholder="nom@entreprise.com"
                        onChange={e => { setTeamEmail(e.target.value); setTeamEmailErr(false); }}
                        onKeyDown={e => e.key === 'Enter' && addTeamMember()}
                      />
                    </div>
                    <div className="ob-field" style={{ margin: 0 }}>
                      <label className="ob-field-label">Rôle</label>
                      <select className="ob-input" value={teamRole} onChange={e => setTeamRole(e.target.value)}>
                        <option>Administrateur</option>
                        <option>Membre</option>
                        <option>Comptable</option>
                        <option>Observateur</option>
                      </select>
                    </div>
                  </div>
                  <button className="ob-btn-sm" type="button" onClick={addTeamMember}>
                    <Ico name="user-plus" /> Ajouter l'invitation
                  </button>

                  <div className="ob-field-label" style={{ marginTop: 22 }}>Invitations en attente</div>
                  <div className="ob-entry-list">
                    {teamInvites.length === 0
                      ? <div className="ob-empty-note">Aucune invitation pour l'instant. Juste vous — ajoutez des membres ci-dessus ou passez cette étape.</div>
                      : teamInvites.map((t, i) => (
                        <div key={t.id} className="ob-entry">
                          <div className={`ob-entry-av ${AV[i % AV.length]}`}>{t.email[0]?.toUpperCase() ?? '?'}</div>
                          <div className="ob-entry-main">
                            <div className="ob-entry-name">{t.email}</div>
                            <div className="ob-entry-sub ob-invite-link">{inviteUrl(t.id)}</div>
                          </div>
                          <div className="ob-entry-role">{t.role}</div>
                          <button
                            className={`ob-btn-sm${copiedId === t.id ? ' ob-btn-copied' : ''}`}
                            type="button"
                            title="Copier le lien d'invitation"
                            onClick={() => copyLink(t.id)}
                          >
                            {copiedId === t.id ? <Ico name="check" /> : <Ico name="download" />}
                          </button>
                          <button className="ob-entry-del" onClick={() => removeTeamMember(i)}>
                            <Ico name="trash" />
                          </button>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </section>

              {/* STEP 4 — Add clients */}
              <section className={`ob-step${cur === 'clients' ? ' active' : ''}`}>
                <div className="ob-eyebrow">
                  <span className="pellet"><Ico name="briefcase" /></span> Vos clients
                </div>
                <h2 className="ob-step-title">Ajoutez vos premiers clients</h2>
                <p className="ob-step-sub">Ajoutez les personnes que vous facturez le plus souvent pour les retrouver rapidement lors de la création d'une facture.</p>

                <div className="ob-step-form">
                  <div className="ob-add-row client">
                    <div className="ob-field" style={{ margin: 0 }}>
                      <label className="ob-field-label">Client / entreprise</label>
                      <input
                        className={`ob-input${clientNameErr ? ' err' : ''}`}
                        type="text" value={clientName} placeholder="ex. Sahel Banque"
                        onChange={e => { setClientName(e.target.value); setClientNameErr(false); }}
                        onKeyDown={e => e.key === 'Enter' && addClient()}
                      />
                    </div>
                    <div className="ob-field" style={{ margin: 0 }}>
                      <label className="ob-field-label">E-mail de facturation <span className="opt">· facultatif</span></label>
                      <input
                        className="ob-input" type="email" value={clientEmail} placeholder="finance@entreprise.bf"
                        onChange={e => setClientEmail(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addClient()}
                      />
                    </div>
                  </div>
                  <div className="ob-field" style={{ marginBottom: 10 }}>
                    <label className="ob-field-label" htmlFor="ob-new-cli-type">Type de client</label>
                    <select id="ob-new-cli-type" className="ob-input" value={clientType} onChange={e => setClientType(e.target.value as ClientType)}>
                      {CLIENT_TYPES.filter(t => t.code !== 'CC').map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                    </select>
                  </div>
                  <button className="ob-btn-sm" type="button" onClick={addClient}>
                    <Ico name="plus" /> Ajouter le client
                  </button>

                  <div className="ob-import-strip" onClick={seedDemoClients}>
                    <div className="is-ico"><Ico name="download" /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="is-title">Importer depuis un tableur</div>
                      <div className="is-sub">Téléversez un CSV de contacts — nous mapperons les colonnes pour vous.</div>
                    </div>
                    <Ico name="chevron-right" style={{ color: 'var(--color-text-tertiary)' }} />
                  </div>

                  <div className="ob-field-label" style={{ marginTop: 22 }}>Clients ajoutés</div>
                  <div className="ob-entry-list">
                    {clients.length === 0
                      ? <div className="ob-empty-note">Aucun client pour l'instant. Ajoutez-en quelques-uns ci-dessus, ou plus tard lors de la facturation.</div>
                      : clients.map((c, i) => (
                        <div key={i} className="ob-entry">
                          <div className={`ob-entry-av ${c.av}`}>{initials(c.name)}</div>
                          <div className="ob-entry-main">
                            <div className="ob-entry-name">{c.name}</div>
                            <div className="ob-entry-sub">{clientTypeDef(c.type).label} · {c.email || 'Pas d\'e-mail'}</div>
                          </div>
                          <button className="ob-entry-del" onClick={() => removeClient(i)}>
                            <Ico name="trash" />
                          </button>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </section>

              {/* STEP 5 — Finish */}
              <section className={`ob-step${cur === 'finish' ? ' active' : ''}`}>
                <div className="ob-finish-wrap">
                  <div className="ob-finish-badge">
                    <Ico name="circle-check" />
                  </div>
                  <h2 className="ob-finish-title">Tout est prêt !</h2>
                  <p className="ob-finish-sub">Votre espace de travail est configuré. Créez votre première facture et commencez à être payé — Billio gère les relances.</p>
                  <div className="ob-finish-stats">
                    <div className="ob-fstat"><div className="ob-fstat-v">{docNum}</div><div className="ob-fstat-l">Prochaine facture</div></div>
                    <div className="ob-fstat"><div className="ob-fstat-v">{1 + teamInvites.length}</div><div className="ob-fstat-l">Membres de l'équipe</div></div>
                    <div className="ob-fstat"><div className="ob-fstat-v">{clients.length}</div><div className="ob-fstat-l">Clients ajoutés</div></div>
                  </div>
                </div>
              </section>

            </div>
          </main>

          {/* ───── Aside preview ───── */}
          <aside className="ob-aside">
            <div className="ob-aside-head">
              <div className="ob-aside-eyebrow">
                <Ico name="eye" />
                <span>
                  {pane === 'invoice' ? 'Aperçu de la facture en direct'
                    : pane === 'team' ? 'Votre espace de travail'
                    : pane === 'clients' ? 'Votre carnet de clients'
                    : 'Récapitulatif de configuration'}
                </span>
              </div>
            </div>
            <div className="ob-aside-stage">

              {/* Invoice preview */}
              <div className={`ob-preview-pane${pane === 'invoice' ? ' active' : ''}`}>
                <div className="ob-paper">
                  <div className="ob-paper-top">
                    <div className="ob-paper-biz">
                      <div className="ob-paper-logo">
                        {logoType === 'img' && logoUrl
                          ? <img src={logoUrl} alt="" />
                          : logoInitials}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="ob-paper-bizname">{bizName || 'Votre entreprise'}</div>
                        <div className="ob-paper-bizmeta">
                          {[address, [city, country].filter(Boolean).join(', ')].filter(Boolean).join('\n').split('\n').map((line, i) => (
                            <span key={i}>{line}<br /></span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="ob-paper-doc">
                      <div className="ob-paper-doctitle">FACTURE</div>
                      <div className="ob-paper-docnum">{docNum}</div>
                    </div>
                  </div>
                  <div className="ob-paper-mid">
                    <div>
                      <div className="ob-mini-label">Facturé à</div>
                      <div className="ob-mini-val">Sahel Banque<span className="dim"><br />Ouagadougou</span></div>
                    </div>
                    <div>
                      <div className="ob-mini-label">Conditions</div>
                      <div className="ob-mini-val">{terms}<span className="dim"><br />Échéance {fmtDateLong(previewDue(terms))}</span></div>
                    </div>
                  </div>
                  <div className="ob-paper-items">
                    <div className="ob-irow">
                      <div><div className="ob-idesc">Développement site web</div><div className="ob-iqty">1 × 650 000</div></div>
                      <div className="ob-iamt">{fmt(650000)}</div>
                    </div>
                    <div className="ob-irow">
                      <div><div className="ob-idesc">Hébergement annuel</div><div className="ob-iqty">1 × 120 000</div></div>
                      <div className="ob-iamt">{fmt(120000)}</div>
                    </div>
                  </div>
                  <div className="ob-paper-tot">
                    <div className="ob-trow"><span>Sous-total</span><span>{fmt(sub)}</span></div>
                    <div className="ob-trow"><span>TVA ({taxRate}%)</span><span>{fmt(taxVal)}</span></div>
                    <div className="ob-trow grand"><span>Total à payer</span><span>{fmt(sub + taxVal)} {currency}</span></div>
                  </div>
                  <div className="ob-paper-note">
                    <span>{footer}</span>
                    <div className="ob-pay-tags">
                      <span className="ob-pay-tag"><Ico name="device-mobile" /> Mobile Money</span>
                      <span className="ob-pay-tag"><Ico name="building-bank" /> Bank</span>
                    </div>
                  </div>
                </div>
                <div className="ob-tip">
                  <span className="ob-tip-icon"><Ico name="bolt" /></span>
                  <div>
                    <div className="ob-tip-title">C'est votre facture en direct</div>
                    <div className="ob-tip-sub">Tout ce que vous saisissez à gauche apparaît ici exactement comme vos clients le verront.</div>
                  </div>
                </div>
              </div>

              {/* Team roster */}
              <div className={`ob-preview-pane${pane === 'team' ? ' active' : ''}`}>
                <div className="ob-scard">
                  <div className="ob-scard-head">
                    <div className="sh-ico"><Ico name="users" /></div>
                    <div className="ob-scard-title">Membres de l'espace de travail</div>
                    <div className="ob-scard-count">{1 + teamInvites.length}</div>
                  </div>
                  <div className="ob-scard-body">
                    {/* owner */}
                    <div className="ob-roster-row">
                      <div className="ob-entry-av av-a">{logoInitials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ob-roster-name">{bizName || 'Vous'}</div>
                        <div className="ob-roster-sub">Propriétaire</div>
                      </div>
                      <div className="ob-entry-role owner">Propriétaire</div>
                    </div>
                    {teamInvites.map((t, i) => (
                      <div key={i} className="ob-roster-row">
                        <div className={`ob-entry-av ${AV[(i + 1) % AV.length]}`}>{t.email[0]?.toUpperCase() ?? '?'}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="ob-roster-name">{t.email}</div>
                          <div className="ob-roster-sub">{t.role}</div>
                        </div>
                        <div className="ob-entry-role">{t.role}</div>
                      </div>
                    ))}
                  </div>
                  <div className="ob-scard-foot">
                    <Ico name="info-circle" /> Les invitations sont envoyées par e-mail instantanément. Elles expirent dans 7 jours.
                  </div>
                </div>
                <div className="ob-tip">
                  <span className="ob-tip-icon"><Ico name="shield-check" /></span>
                  <div>
                    <div className="ob-tip-title">Les rôles maintiennent l'ordre</div>
                    <div className="ob-tip-sub">Les membres créent et envoient des factures. Les comptables consultent les rapports. Les observateurs ne font que regarder.</div>
                  </div>
                </div>
              </div>

              {/* Client roster */}
              <div className={`ob-preview-pane${pane === 'clients' ? ' active' : ''}`}>
                <div className="ob-scard">
                  <div className="ob-scard-head">
                    <div className="sh-ico"><Ico name="briefcase" /></div>
                    <div className="ob-scard-title">Votre carnet de clients</div>
                    <div className="ob-scard-count">{clients.length}</div>
                  </div>
                  <div className="ob-scard-body">
                    {clients.length === 0
                      ? <div className="ob-empty-note" style={{ margin: '8px 0' }}>Vos clients apparaîtront ici.<br />Ajoutez le premier à gauche.</div>
                      : clients.map((c, i) => (
                        <div key={i} className="ob-roster-row">
                          <div className={`ob-entry-av ${c.av}`}>{initials(c.name)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="ob-roster-name">{c.name}</div>
                            <div className="ob-roster-sub">{c.email || 'Pas d\'e-mail de facturation'}</div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                  <div className="ob-scard-foot">
                    <Ico name="info-circle" /> Sélectionnez un client en un clic lors de la création d'une facture.
                  </div>
                </div>
                <div className="ob-tip">
                  <span className="ob-tip-icon"><Ico name="bolt" /></span>
                  <div>
                    <div className="ob-tip-title">Pas encore de clients ? Pas de problème.</div>
                    <div className="ob-tip-sub">Vous pouvez aussi ajouter un client à la volée lors de votre première facturation.</div>
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div className={`ob-preview-pane${pane === 'summary' ? ' active' : ''}`}>
                <div className="ob-scard">
                  <div className="ob-scard-head">
                    <div className="sh-ico"><Ico name="circle-check" /></div>
                    <div className="ob-scard-title">Récapitulatif</div>
                  </div>
                  <div className="ob-scard-body">
                    <div className="ob-check-list">
                      {[
                        { label: bizName || 'Votre entreprise', sub: 'Informations et logo', goto: 0, done: true },
                        { label: `Préfixe ${prefix} · TVA ${taxRate}%`, sub: 'Paramètres factures', goto: 1, done: true },
                        { label: teamInvites.length ? `${teamInvites.length} invitation${teamInvites.length > 1 ? 's' : ''} envoyée${teamInvites.length > 1 ? 's' : ''}` : 'Juste vous pour l\'instant', sub: 'Équipe', goto: 2, done: teamInvites.length > 0 },
                        { label: clients.length ? `${clients.length} client${clients.length > 1 ? 's' : ''} ajouté${clients.length > 1 ? 's' : ''}` : 'Aucun client encore', sub: 'Clients', goto: 3, done: clients.length > 0 },
                      ].map(item => (
                        <div key={item.goto} className="ob-check-item">
                          <div className={`ob-check-tick${item.done ? '' : ' skip'}`}>
                            <Ico name="check" />
                          </div>
                          <div className="ob-check-main">
                            <div className="ob-check-t">{item.label}</div>
                            <div className="ob-check-s">{item.sub}</div>
                          </div>
                          <button className="ob-check-edit" onClick={() => goTo(item.goto)}>Modifier</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="ob-tip">
                  <span className="ob-tip-icon"><Ico name="sparkles" /></span>
                  <div>
                    <div className="ob-tip-title">Première facture en moins d'une minute</div>
                    <div className="ob-tip-sub">Vos paramètres sont configurés — choisissez un client et envoyez.</div>
                  </div>
                </div>
              </div>

            </div>
          </aside>
        </div>

        {/* ───── Footer ───── */}
        <footer className="ob-foot">
          {step > 0
            ? <button className="ob-btn" onClick={() => goTo(step - 1)}>
                <Ico name="arrow-left" /> Retour
              </button>
            : <div />
          }

          <div className="ob-foot-hint">
            {complete
              ? <><Ico name="file-invoice" /> Mentions obligatoires de la facture</>
              : step === steps.length - 1
                ? <><Ico name="circle-check" /> Configuration terminée</>
                : <><Ico name="clock" /> {steps.length - 1 - step > 1 ? `${steps.length - 1 - step} étapes rapides restantes` : 'Dernière étape avant la fin'}</>
            }
          </div>

          <div className="ob-foot-actions">
            {cur && STEP_INFO[cur].skippable && (
              <button className="ob-btn" onClick={() => goTo(step + 1)}>Passer pour l'instant</button>
            )}
            {step < steps.length - 1
              ? <button className="ob-btn ob-btn-primary" onClick={onNext}>
                  Continuer <Ico name="arrow-right" />
                </button>
              : complete
                ? <button className="ob-btn ob-btn-primary" onClick={handleCompleteSave} disabled={saving || !completeLoaded}>
                    {saving ? <><Ico name="loader-2" /> Enregistrement…</> : <>Enregistrer et revenir à la facture <Ico name="arrow-right" /></>}
                  </button>
              : <button className="ob-btn ob-btn-primary" onClick={handleFinish} disabled={saving}>
                  {saving
                    ? <><Ico name="loader-2" /> Enregistrement…</>
                    : <>Aller au tableau de bord <Ico name="arrow-right" /></>
                  }
                </button>
            }
          </div>
        </footer>

      </div>
    </div>
  );
}
