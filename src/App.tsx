import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { AppProvider, useApp } from '@/context/AppContext';
import { ToastProvider } from '@/context/ToastContext';
import AppShell from '@/components/AppShell';
import { ACCOUNTING_ENABLED, UI_V2 } from '@/lib/features';
import FeatureGuard from '@/components/FeatureGuard';
import type { Feature } from '@/lib/plans';

// ── Lazy page chunks ────────────────────────────────────────────────────────
// Each import() becomes its own JS chunk; the browser only downloads a page
// when the user navigates to it. The PWA service worker caches chunks after
// first visit, so subsequent navigations are instant.
const LandingPage            = lazy(() => import('./pages/LandingPage'));
const InvoiceGeneratorPage   = lazy(() => import('./pages/InvoiceGeneratorPage'));
const AuthPage               = lazy(() => import('./pages/AuthPage'));
const ResetPasswordPage      = lazy(() => import('./pages/ResetPasswordPage'));
const InvitePage             = lazy(() => import('./pages/InvitePage'));
const OnboardingPage         = lazy(() => import('./pages/OnboardingPage'));
const DashboardPage          = lazy(() => import('./pages/DashboardPage'));
const SalesPage              = lazy(() => import('./pages/SalesPage'));
const QuotesPage             = lazy(() => import('./pages/QuotesPage'));
const PaymentsPage           = lazy(() => import('./pages/PaymentsPage'));
const InvoicePage            = lazy(() => import('./pages/InvoicePage'));
const ContactsPage           = lazy(() => import('./pages/ContactsPage'));
const ProductsPage           = lazy(() => import('./pages/ProductsPage'));
const QuotePage              = lazy(() => import('./pages/QuotePage'));
const TemplatesPage          = lazy(() => import('./pages/TemplatesPage'));
const SettingsPage           = lazy(() => import('./pages/SettingsPage'));
const ChartOfAccountsPage    = lazy(() => import('./pages/accounting/ChartOfAccountsPage'));
const JournalsPage           = lazy(() => import('./pages/accounting/JournalsPage'));
const TrialBalancePage       = lazy(() => import('./pages/accounting/TrialBalancePage'));
const FinancialStatementsPage= lazy(() => import('./pages/accounting/FinancialStatementsPage'));
const FixedAssetsPage        = lazy(() => import('./pages/accounting/FixedAssetsPage'));
const TaxPage                = lazy(() => import('./pages/accounting/TaxPage'));
const PeriodClosingPage      = lazy(() => import('./pages/accounting/PeriodClosingPage'));
const OpeningBalancesPage    = lazy(() => import('./pages/accounting/OpeningBalancesPage'));

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

export default function App() {
  const navigate = useNavigate();
  const [mockAuthed, setMockAuthed] = useState(false);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    if (MOCK) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
        navigate('/reset-password');
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const resolving = !MOCK && session === undefined;
  const authed   = MOCK ? mockAuthed : !!session;
  const onLogout = MOCK
    ? () => setMockAuthed(false)
    : () => { supabase.auth.signOut(); };

  return (
    <ToastProvider>
    <AppProvider>
      <Suspense fallback={<div style={{ background: 'var(--color-background-primary)', minHeight: '100dvh' }} />}>
      <Routes>
        {/* Root / login — default landing */}
        <Route
          path="/"
          element={authed && !isRecovery
            ? <Navigate to="/dashboard" replace />
            : <AuthPage onLogin={MOCK ? () => setMockAuthed(true) : undefined} />
          }
        />
        <Route path="/login" element={<Navigate to="/" replace />} />

        {/* Legacy landing page */}
        <Route
          path="/landing"
          element={authed ? <Navigate to="/dashboard" replace /> : <LandingPage />}
        />

        {/* Public tools */}
        <Route path="/invoice-generator" element={<InvoiceGeneratorPage />} />
        <Route
          path="/reset-password"
          element={isRecovery
            ? <ResetPasswordPage onDone={() => setIsRecovery(false)} />
            : <Navigate to="/login" replace />
          }
        />
        <Route path="/invite/:token" element={<InvitePage />} />

        {/* Protected — wait for session to resolve before redirecting */}
        <Route
          element={resolving ? null : authed ? <AppShell onLogout={onLogout} /> : <Navigate to="/" replace />}
        >
          {/* Onboarding renders inside AppShell (gets the sidebar), not guarded */}
          <Route path="/onboarding" element={<OnboardingPage />} />

          {/* All other routes redirect to /onboarding when setup is missing */}
          <Route element={<OnboardingGuard />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/invoices" element={<SalesPage />} />
            <Route path="/invoices/:id" element={<InvoicePage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/clients"  element={<Navigate to="/contacts" replace />} />
            <Route path="/products" element={<ProductsPage />} />
            {ACCOUNTING_ENABLED ? (<>
              <Route path="/accounting/chart-of-accounts"    element={<Gated feature="accounting_syscohada" title="Plan comptable"><ChartOfAccountsPage /></Gated>} />
              <Route path="/accounting/journals"             element={<Gated feature="accounting_syscohada" title="Journaux"><JournalsPage /></Gated>} />
              <Route path="/accounting/trial-balance"        element={<Gated feature="accounting_syscohada" title="Balance générale"><TrialBalancePage /></Gated>} />
              <Route path="/accounting/financial-statements" element={<Gated feature="accounting_syscohada" title="États financiers"><FinancialStatementsPage /></Gated>} />
              <Route path="/accounting/fixed-assets"         element={<Gated feature="fixed_assets" title="Immobilisations"><FixedAssetsPage /></Gated>} />
              <Route path="/accounting/suppliers"            element={<Navigate to="/contacts" replace />} />
              <Route path="/accounting/tax"                  element={<Gated feature="accounting_syscohada" title="Fiscalité"><TaxPage /></Gated>} />
              <Route path="/accounting/period-closing"       element={<Gated feature="period_closing" title="Clôture"><PeriodClosingPage /></Gated>} />
              <Route path="/accounting/opening-balances"     element={<Gated feature="accounting_syscohada" title="Ouverture"><OpeningBalancesPage /></Gated>} />
            </>) : (
              <Route path="/accounting/*" element={<Navigate to="/dashboard" replace />} />
            )}
            {/* Reports aren't built yet; old links land on the dashboard */}
            <Route path="/reports"  element={<Navigate to="/dashboard" replace />} />
            {/* In the ERP look Devis and Paiements are pages of their own (PRO-165) */}
            <Route path="/payments" element={UI_V2 ? <Gated feature="payments_mobilemoney" title="Paiements"><PaymentsPage /></Gated> : <Navigate to="/invoices?tab=payments" replace />} />
            <Route path="/quotes"     element={UI_V2 ? <Gated feature="quotes" title="Devis"><QuotesPage /></Gated> : <Navigate to="/invoices?tab=quotes" replace />} />
            <Route path="/quotes/:id" element={<Gated feature="quotes" title="Devis"><QuotePage /></Gated>} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
      </Suspense>
    </AppProvider>
    </ToastProvider>
  );
}

// The sidebar hides locked pages, but a bookmarked or typed URL must be gated too
function Gated({ feature, title, children }: { feature: Feature; title: string; children: React.ReactNode }) {
  const { hasFeature } = useApp();
  if (hasFeature(feature)) return <>{children}</>;
  return (
    <div className="main">
      <div className="topbar"><div><div className="page-title">{title}</div></div></div>
      <div className="content"><FeatureGuard feature={feature}>{null}</FeatureGuard></div>
    </div>
  );
}

function OnboardingGuard() {
  const { needsOnboarding, loading } = useApp();
  if (loading) return null;
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

