import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { toUserRole, type UserRole } from '@/lib/permissions';
import posthog from 'posthog-js';
import { useToast } from '@/context/ToastContext';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { INITIAL_INVOICES, INITIAL_ACTIVITY, INITIAL_CLIENTS, INITIAL_PAYMENTS, INITIAL_PRODUCTS, INITIAL_QUOTES } from '@/data';
import { fetchInvoices,  dbToInvoice  } from '@/lib/api/invoices';
import { fetchClients,   dbToClient   } from '@/lib/api/clients';
import { fetchPayments,  dbToPayment  } from '@/lib/api/payments';
import { fetchProducts,  dbToProduct  } from '@/lib/api/products';
import { fetchQuotes,    dbToQuote    } from '@/lib/api/quotes';
import { fetchActivities, dbToActivity } from '@/lib/api/activities';
import { fetchOpeningBalanceAdopted } from '@/lib/api/accounting';
import type { Invoice, Activity, ClientRecord, Payment, Product, Quote, Client } from '@/lib/schemas';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { withEffectiveStatus } from '@/lib/invoice-status';
import type { PaperConfig } from '@/components/InvoicePaper';
import { DEFAULT_CONFIG } from '@/lib/invoice-template';
import { fetchDefaultTemplate } from '@/lib/api/invoice-templates';
import { hasFeature as checkFeature, type PlanId, type PlanStatus, type Feature } from '@/lib/plans';

export interface OrgSettings {
  name:                 string;
  address:              string;
  city:                 string;
  country:              string;
  email:                string;
  phone:                string;
  ifu:                  string;
  rccm:                 string;
  taxRegime:            string;
  divisionFiscale:      string;
  /** Cadastral reference of the place of sale (11 digits) */
  cadastralRef:         string;
  /** ISO date string (YYYY-MM-DD) — used for first-year IS exemption and threshold prorating */
  businessCreationDate: string;
  paymentTerms:         string;
  deliveryTerms:        string;
}

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

const EMPTY_ORG: OrgSettings = { name: '', address: '', city: '', country: '', email: '', phone: '', ifu: '', rccm: '', taxRegime: '', divisionFiscale: '', cadastralRef: '', businessCreationDate: '', paymentTerms: 'Net 14 jours', deliveryTerms: 'À convenir' };

interface AppContextValue {
  // Entities
  invoices:    Invoice[];      setInvoices:    Dispatch<SetStateAction<Invoice[]>>;
  activity:    Activity[];     setActivity:    Dispatch<SetStateAction<Activity[]>>;
  clients:     ClientRecord[]; setClients:     Dispatch<SetStateAction<ClientRecord[]>>;
  payments:    Payment[];      setPayments:    Dispatch<SetStateAction<Payment[]>>;
  products:    Product[];      setProducts:    Dispatch<SetStateAction<Product[]>>;
  quotes:      Quote[];        setQuotes:      Dispatch<SetStateAction<Quote[]>>;
  // Derived lookup: client code → {name, city, av}
  clientsMap:  Record<string, Client>;
  // Org profile (used by invoice templates)
  orgSettings: OrgSettings;
  setOrgSettings: Dispatch<SetStateAction<OrgSettings>>;
  /** The organisation's default invoice template; the PDF is drawn from it. */
  invoiceTemplate:    PaperConfig;
  setInvoiceTemplate: Dispatch<SetStateAction<PaperConfig>>;
  // Auth
  userId:      string;
  orgId:       string;
  userLabel:   string;
  userInitials:string;
  userRole:    UserRole;
  // Onboarding
  needsOnboarding:    boolean;
  /** Reloads the org (settings, data, realtime) once onboarding has been saved. */
  completeOnboarding: () => Promise<void>;
  // Opening balances
  openingBalancesAdopted:    boolean;
  setOpeningBalancesAdopted: Dispatch<SetStateAction<boolean>>;
  // Plan / feature flags
  plan:          PlanId;
  planStatus:    PlanStatus;
  planRenewsAt:  string | null;
  trialEndsAt:   string | null;
  hasFeature:    (feature: Feature) => boolean;
  /** Re-reads the plan (Billio changes it in Supabase while the app is open). */
  refreshPlan:   () => Promise<PlanId>;
  // UI
  loading:   boolean;
  showToast: (msg: string, isError?: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [invoices,  setInvoices]  = useState<Invoice[]>(MOCK ? INITIAL_INVOICES : []);
  const [activity,  setActivity]  = useState<Activity[]>(MOCK ? INITIAL_ACTIVITY : []);
  const [clients,   setClients]   = useState<ClientRecord[]>(MOCK ? INITIAL_CLIENTS : []);
  const [payments,  setPayments]  = useState<Payment[]>(MOCK ? INITIAL_PAYMENTS : []);
  const [products,  setProducts]  = useState<Product[]>(MOCK ? INITIAL_PRODUCTS : []);
  const [quotes,    setQuotes]    = useState<Quote[]>(MOCK ? INITIAL_QUOTES : []);

  const [orgSettings,     setOrgSettings]     = useState<OrgSettings>(EMPTY_ORG);
  const [invoiceTemplate, setInvoiceTemplate] = useState<PaperConfig>(DEFAULT_CONFIG);

  const [userId,          setUserId]          = useState(MOCK ? 'mock-user' : '');
  const [orgId,           setOrgId]           = useState(MOCK ? 'mock-org'  : '');
  const [userLabel,       setUserLabel]       = useState('');
  const [userInitials,    setUserInitials]    = useState('??');
  const [userRole,        setUserRole]        = useState<UserRole>(MOCK ? 'admin' : 'observer');
  const [needsOnboarding,         setNeedsOnboarding]         = useState(false);
  const [openingBalancesAdopted,  setOpeningBalancesAdopted]  = useState(false);
  const [plan,          setPlan]          = useState<PlanId>(MOCK ? 'solo' : 'solo');
  const [planStatus,    setPlanStatus]    = useState<PlanStatus>('free');
  const [planRenewsAt,  setPlanRenewsAt]  = useState<string | null>(null);
  const [trialEndsAt,   setTrialEndsAt]   = useState<string | null>(null);
  const [loading,                 setLoading]                 = useState(!MOCK);

  const { showToast } = useToast();
  const realtimeRef  = useRef<RealtimeChannel | null>(null);
  const bootRef      = useRef<((user: User) => Promise<void>) | null>(null);
  // User the current data was loaded for. supabase-js re-emits SIGNED_IN every
  // time the tab regains focus; rebooting then would unmount the page (losing
  // unsaved forms) and refetch everything.
  const bootedUserRef = useRef<string | null>(null);

  // Pending invoices past their due date are shown as overdue. Pages read this
  // view; setInvoices still updates the stored list.
  const invoicesView = useMemo(() => withEffectiveStatus(invoices), [invoices]);

  // Derived client lookup
  const clientsMap = useMemo<Record<string, Client>>(
    () => Object.fromEntries(clients.map(c => [c.code, { name: c.name, city: c.city, av: c.av, country: c.country, contact: c.contact !== '—' ? c.contact : undefined, email: c.email !== '—' ? c.email : undefined, phone: c.phone !== '—' ? c.phone : undefined, ifu: c.ifu, rccm: c.rccm, taxRegime: c.taxRegime, fiscalDivision: c.fiscalDivision, withholdingScenario: c.withholdingScenario, clientType: c.clientType }])),
    [clients],
  );

  useEffect(() => {
    if (MOCK) {
      setUserLabel('Serge W.');
      setUserInitials('SW');
      fetchDefaultTemplate('mock-org').then(t => { if (t) setInvoiceTemplate(t.config); }).catch(() => {});
      return;
    }

    async function boot(user: User) {
      setLoading(true);
      setUserId(user.id);
      const email = user.email ?? '';
      const meta  = user.user_metadata as Record<string, string> | undefined;
      const first = meta?.first_name ?? meta?.firstName ?? '';
      const last  = meta?.last_name  ?? meta?.lastName  ?? '';
      if (first || last) {
        setUserLabel(`${first} ${last}`.trim());
        setUserInitials(`${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || email[0]?.toUpperCase() || '?');
      } else {
        const name = email.split('@')[0];
        setUserLabel(name);
        setUserInitials(name.slice(0, 2).toUpperCase());
      }

      // Resolve the user's org and check onboarding status
      const { data: membership, error: memberErr } = await supabase
        .from('org_members')
        .select('org_id, role')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      // PGRST116 = no rows found — valid for new users who need onboarding
      if (memberErr && memberErr.code !== 'PGRST116') {
        console.error('[boot] org_members fetch error:', memberErr.message);
        showToast('Erreur lors du chargement de votre profil. Veuillez réessayer.', true);
        bootedUserRef.current = null;
        setLoading(false);
        return;
      }
      const resolvedOrgId = membership?.org_id ?? '';
      setOrgId(resolvedOrgId);
      setUserRole(toUserRole(membership?.role as string | undefined));

      if (!resolvedOrgId) {
        setNeedsOnboarding(true);
      } else {
        const { data: org, error: orgErr } = await supabase
          .from('organizations')
          .select('name, address, city, country, email, phone, ifu, rccm, tax_regime, division_fiscale, cadastral_ref, business_creation_date, payment_terms, delivery_terms, onboarding_completed_at, plan, plan_status, plan_renews_at, trial_ends_at')
          .eq('id', resolvedOrgId)
          .single();
        if (orgErr) {
          console.error('[boot] org fetch error:', orgErr.message);
          showToast('Erreur lors du chargement de l\'organisation. Veuillez réessayer.', true);
          bootedUserRef.current = null;
          setLoading(false);
          return;
        }
        setNeedsOnboarding(!org.onboarding_completed_at);
        if (org) {
          setOrgSettings({
            name:           org.name            ?? '',
            address:        org.address         ?? '',
            city:           org.city            ?? '',
            country:        org.country         ?? '',
            email:          org.email           ?? '',
            phone:          org.phone           ?? '',
            ifu:            org.ifu             ?? '',
            rccm:           org.rccm            ?? '',
            taxRegime:            org.tax_regime            ?? '',
            divisionFiscale:      org.division_fiscale      ?? '',
            cadastralRef:         org.cadastral_ref         ?? '',
            businessCreationDate: org.business_creation_date ?? '',
            paymentTerms:         org.payment_terms         ?? 'Net 14 jours',
            deliveryTerms:        org.delivery_terms        ?? 'À convenir',
          });
          const rawPlan = org.plan as string | null;
          const validPlans: PlanId[] = ['solo', 'business', 'cabinet', 'enterprise'];
          const resolvedPlan: PlanId = validPlans.includes(rawPlan as PlanId) ? (rawPlan as PlanId) : 'solo';
          setPlan(resolvedPlan);

          const validStatuses: PlanStatus[] = ['free', 'trialing', 'active', 'canceled', 'past_due'];
          const rawStatus = org.plan_status as string | null;
          setPlanStatus(validStatuses.includes(rawStatus as PlanStatus) ? (rawStatus as PlanStatus) : (resolvedPlan === 'solo' ? 'free' : 'active'));
          setPlanRenewsAt((org.plan_renews_at as string | null) ?? null);
          setTrialEndsAt((org.trial_ends_at  as string | null) ?? null);
        }
      }

      if (resolvedOrgId) {
        try {
          const year = new Date().getFullYear();
          const [inv, cli, pay, prod, quo, act, obAdopted] = await Promise.all([
            fetchInvoices(resolvedOrgId),
            fetchClients(resolvedOrgId),
            fetchPayments(resolvedOrgId),
            fetchProducts(resolvedOrgId),
            fetchQuotes(resolvedOrgId),
            fetchActivities(resolvedOrgId),
            fetchOpeningBalanceAdopted(resolvedOrgId, year),
          ]);
          setInvoices(inv);
          setClients(cli);
          setPayments(pay);
          setProducts(prod);
          setQuotes(quo);
          setActivity(act);
          setOpeningBalancesAdopted(obAdopted);
          setupRealtime(resolvedOrgId);
          // Not fatal: without a saved default the PDF uses the standard template
          fetchDefaultTemplate(resolvedOrgId)
            .then(t => setInvoiceTemplate(t?.config ?? DEFAULT_CONFIG))
            .catch(err => console.warn('[boot] invoice template fetch failed, using the standard one:', err));
        } catch (err) {
          console.error('[boot] data fetch error:', err);
          showToast('Erreur lors du chargement des données. Veuillez réessayer.', true);
          bootedUserRef.current = null;
          setLoading(false);
          return;
        }
      }

      posthog.identify(user.id, {
        email,
        name: `${first} ${last}`.trim() || email.split('@')[0],
        org_id: resolvedOrgId,
        role: membership?.role ?? 'member',
      });

      setLoading(false);
    }

    function setupRealtime(orgId: string) {
      if (realtimeRef.current) supabase.removeChannel(realtimeRef.current);
      const ch = supabase
        .channel(`org:${orgId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices',  filter: `org_id=eq.${orgId}` }, ({ eventType, new: n, old: o }) => {
          const row = n as Record<string, unknown>;
          if (eventType === 'INSERT') setInvoices(prev => prev.some(x => x.id === row.id) ? prev : [dbToInvoice(row), ...prev]);
          if (eventType === 'UPDATE') setInvoices(prev => prev.map(x => x.id === row.id ? dbToInvoice(row) : x));
          if (eventType === 'DELETE') setInvoices(prev => prev.filter(x => x.id !== (o as Record<string, unknown>).id));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients',   filter: `org_id=eq.${orgId}` }, ({ eventType, new: n, old: o }) => {
          const row = n as Record<string, unknown>;
          if (eventType === 'INSERT') setClients(prev => prev.some(x => x.code === row.code) ? prev : [...prev, dbToClient(row)].sort((a, b) => a.name.localeCompare(b.name)));
          if (eventType === 'UPDATE') setClients(prev => prev.map(x => x.code === row.code ? dbToClient(row) : x));
          if (eventType === 'DELETE') setClients(prev => prev.filter(x => x.code !== (o as Record<string, unknown>).code));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payments',  filter: `org_id=eq.${orgId}` }, ({ eventType, new: n, old: o }) => {
          const row = n as Record<string, unknown>;
          if (eventType === 'INSERT') setPayments(prev => prev.some(x => x.id === row.id) ? prev : [dbToPayment(row), ...prev]);
          if (eventType === 'UPDATE') setPayments(prev => prev.map(x => x.id === row.id ? dbToPayment(row) : x));
          if (eventType === 'DELETE') setPayments(prev => prev.filter(x => x.id !== (o as Record<string, unknown>).id));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products',  filter: `org_id=eq.${orgId}` }, ({ eventType, new: n, old: o }) => {
          const row = n as Record<string, unknown>;
          if (eventType === 'INSERT') setProducts(prev => prev.some(x => x.id === row.id) ? prev : [...prev, dbToProduct(row)].sort((a, b) => a.name.localeCompare(b.name)));
          if (eventType === 'UPDATE') setProducts(prev => prev.map(x => x.id === row.id ? dbToProduct(row) : x));
          if (eventType === 'DELETE') setProducts(prev => prev.filter(x => x.id !== (o as Record<string, unknown>).id));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes',    filter: `org_id=eq.${orgId}` }, ({ eventType, new: n, old: o }) => {
          const row = n as Record<string, unknown>;
          if (eventType === 'INSERT') setQuotes(prev => prev.some(x => x.id === row.id) ? prev : [dbToQuote(row), ...prev]);
          if (eventType === 'UPDATE') setQuotes(prev => prev.map(x => x.id === row.id ? dbToQuote(row) : x));
          if (eventType === 'DELETE') setQuotes(prev => prev.filter(x => x.id !== (o as Record<string, unknown>).id));
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities', filter: `org_id=eq.${orgId}` }, ({ new: n }) => {
          setActivity(prev => [dbToActivity(n as Record<string, unknown>), ...prev].slice(0, 50));
        })
        .subscribe();
      realtimeRef.current = ch;
    }

    function teardownRealtime() {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
    }

    bootRef.current = boot;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
        if (bootedUserRef.current === session.user.id) {
          // Same user (supabase-js re-emits SIGNED_IN on refocus): pick up a role changed meanwhile
          void supabase.from('org_members').select('role').eq('user_id', session.user.id).limit(1).maybeSingle()
            .then(({ data, error }) => { if (!error && data) setUserRole(toUserRole(data.role as string)); });
          return;
        }
        bootedUserRef.current = session.user.id;
        boot(session.user);
      }
      if (event === 'USER_UPDATED' && session?.user) {
        const user = session.user;
        const email = user.email ?? '';
        const meta  = user.user_metadata as Record<string, string> | undefined;
        const first = meta?.first_name ?? meta?.firstName ?? '';
        const last  = meta?.last_name  ?? meta?.lastName  ?? '';
        if (first || last) {
          setUserLabel(`${first} ${last}`.trim());
          setUserInitials(`${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || email[0]?.toUpperCase() || '?');
        } else {
          const name = email.split('@')[0];
          setUserLabel(name);
          setUserInitials(name.slice(0, 2).toUpperCase());
        }
      }
      if (event === 'SIGNED_OUT') {
        bootedUserRef.current = null;
        posthog.reset();
        teardownRealtime();
        setUserId('');
        setOrgId('');
        setUserLabel('');
        setUserInitials('??');
        setUserRole('observer');
        setOrgSettings(EMPTY_ORG);
        setInvoiceTemplate(DEFAULT_CONFIG);
        setNeedsOnboarding(false);
        setInvoices([]);
        setClients([]);
        setPayments([]);
        setProducts([]);
        setQuotes([]);
        setActivity([]);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      teardownRealtime();
    };
  }, []);

  const completeOnboarding = useCallback(async () => {
    if (MOCK) { setNeedsOnboarding(false); return; }
    // Re-run the full boot so a newly created org gets its settings, data and
    // realtime channel — not just its clients.
    const { data: { user } } = await supabase.auth.getUser();
    if (user && bootRef.current) await bootRef.current(user);
    else setNeedsOnboarding(false);
  }, []);

  const hasFeature = useCallback((feature: Feature) => checkFeature(plan, feature), [plan]);

  const refreshPlan = useCallback(async (): Promise<PlanId> => {
    if (MOCK || !orgId) return plan;
    const { data, error } = await supabase.from('organizations').select('plan, plan_status').eq('id', orgId).single();
    if (error || !data) return plan;
    const validPlans: PlanId[] = ['solo', 'business', 'cabinet', 'enterprise'];
    const next: PlanId = validPlans.includes(data.plan as PlanId) ? (data.plan as PlanId) : 'solo';
    setPlan(next);
    const validStatuses: PlanStatus[] = ['free', 'trialing', 'active', 'canceled', 'past_due'];
    if (validStatuses.includes(data.plan_status as PlanStatus)) setPlanStatus(data.plan_status as PlanStatus);
    return next;
  }, [orgId, plan]);

  return (
    <AppContext.Provider value={{
      invoices: invoicesView, setInvoices,
      activity,  setActivity,
      clients,   setClients,
      payments,  setPayments,
      products,  setProducts,
      quotes,    setQuotes,
      clientsMap,
      orgSettings, setOrgSettings,
      invoiceTemplate, setInvoiceTemplate,
      userId,
      orgId,
      userLabel, userInitials, userRole,
      needsOnboarding, completeOnboarding,
      openingBalancesAdopted, setOpeningBalancesAdopted,
      plan, planStatus, planRenewsAt, trialEndsAt, hasFeature, refreshPlan,
      loading,
      showToast,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
