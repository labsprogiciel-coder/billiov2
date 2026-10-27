import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { AppProvider, useApp } from '@/context/AppContext';
import { ToastProvider } from '@/context/ToastContext';
import AppShell from '@/components/AppShell';

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
const InvoicePage            = lazy(() => import('./pages/InvoicePage'));
const ContactsPage           = lazy(() => import('./pages/ContactsPage'));
const ProductsPage           = lazy(() => import('./pages/ProductsPage'));
const PaymentsPage           = lazy(() => import('./pages/PaymentsPage'));
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
            <Route path="/accounting/chart-of-accounts"    element={<ChartOfAccountsPage />} />
            <Route path="/accounting/journals"             element={<JournalsPage />} />
            <Route path="/accounting/trial-balance"        element={<TrialBalancePage />} />
            <Route path="/accounting/financial-statements" element={<FinancialStatementsPage />} />
            <Route path="/accounting/fixed-assets"         element={<FixedAssetsPage />} />
            <Route path="/accounting/suppliers"            element={<Navigate to="/contacts?tab=suppliers" replace />} />
            <Route path="/accounting/tax"                  element={<TaxPage />} />
            <Route path="/accounting/period-closing"       element={<PeriodClosingPage />} />
            <Route path="/accounting/opening-balances"     element={<OpeningBalancesPage />} />
            <Route path="/reports"  element={<PlaceholderPage title="Rapports" />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/quotes"     element={<Navigate to="/invoices?tab=quotes" replace />} />
            <Route path="/quotes/:id" element={<QuotePage />} />
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

function OnboardingGuard() {
  const { needsOnboarding, loading } = useApp();
  if (loading) return null;
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="main">
      <div className="topbar">
        <div>
          <div className="page-title">{title}</div>
          <div className="page-sub">Bientôt disponible</div>
        </div>
      </div>
      <div className="content" style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 8, color: 'var(--color-text-tertiary)',
      }}>
        <div style={{ fontSize: 36 }}>🚧</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Page en construction</div>
      </div>
    </div>
  );
}
