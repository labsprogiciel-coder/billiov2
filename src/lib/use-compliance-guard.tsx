import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { fetchPaymentSettings, type PaymentSettings } from '@/lib/api/payment-settings';
import { clientIssues, sellerIssues, type SellerInfo } from '@/lib/invoice-compliance';
import { usePermissions } from '@/lib/use-permissions';
import { invoiceLimitReached } from '@/lib/invoice-limit';
import UpgradeModal from '@/components/UpgradeModal';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

/** Set when the user postpones the wizard ("Plus tard"): don't send them back this session. */
export const COMPLIANCE_SNOOZE_KEY = 'billio.compliance.snoozed';

export function complianceSnoozed(): boolean {
  try { return sessionStorage.getItem(COMPLIANCE_SNOOZE_KEY) === '1'; } catch { return false; }
}
export function snoozeCompliance() {
  try { sessionStorage.setItem(COMPLIANCE_SNOOZE_KEY, '1'); } catch { /* storage unavailable */ }
}

/** Reads the mandatory mentions now (settings may have changed in another tab). */
async function loadSeller(orgId: string, fallback: SellerInfo): Promise<{ seller: SellerInfo; payments: PaymentSettings | null }> {
  if (MOCK || !orgId) return { seller: fallback, payments: orgId ? await fetchPaymentSettings(orgId).catch(() => null) : null };
  // A failed read must not block issuing: fall back to what the app has loaded
  const [org, payments] = await Promise.all([
    supabase.from('organizations')
      .select('name, address, city, country, ifu, rccm, tax_regime, division_fiscale')
      .eq('id', orgId).single()
      .then(({ data, error }) => (error || !data ? null : data), () => null),
    fetchPaymentSettings(orgId).catch(() => null),
  ]);
  const seller: SellerInfo = org ? {
    name: org.name ?? '', address: org.address ?? '', city: org.city ?? '', country: org.country ?? '',
    ifu: org.ifu ?? '', rccm: org.rccm ?? '', taxRegime: org.tax_regime ?? '', divisionFiscale: org.division_fiscale ?? '',
  } : fallback;
  return { seller, payments };
}

export interface GuardOptions {
  /** Where the wizard brings the user back to. */
  returnTo: string;
  /**
   * Runs before leaving for the wizard, e.g. saving a new invoice as a draft.
   * Returns the page to come back to, or null to stay (e.g. the save failed).
   */
  beforeLeave?: () => Promise<string | null>;
}

/**
 * Checks the plan's invoice limit, then the mandatory invoice mentions, before
 * an invoice is issued. At the Solo limit it shows the upgrade offer. When
 * nothing is missing, `guard` runs the action. Otherwise it opens the
 * onboarding wizard on the missing details (/onboarding?complete=1), which
 * saves them and brings the user back to issue the invoice.
 *
 * It runs the action anyway when the user postponed the wizard this session,
 * or when only the organisation's details are missing and the user can't
 * change them (a warning is shown then).
 */
export function useComplianceGuard() {
  const navigate = useNavigate();
  const { orgId, orgSettings, clients, invoices, plan, refreshPlan, showToast } = useApp();
  const { managesOrg } = usePermissions();
  const [checking, setChecking] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const checkingRef = useRef(false);

  const guard = useCallback(async (clientCode: string, action: () => void, opts: GuardOptions) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      // Solo plan: the monthly limit comes first (the database refuses the invoice anyway).
      // Re-read the plan before blocking: the organisation may have been upgraded meanwhile.
      if (invoiceLimitReached(plan, invoices) && invoiceLimitReached(await refreshPlan(), invoices)) { setLimitHit(true); return; }
      if (complianceSnoozed()) { action(); return; }
      const { seller, payments } = await loadSeller(orgId, orgSettings);
      const sellerMissing = sellerIssues(seller, payments).length > 0;
      // The client type says whether an IFU is required (PM, PC) or not (PP, CC)
      const clientMissing = clientIssues(clients.find(c => c.code === clientCode)).length > 0;
      if (!sellerMissing && !clientMissing) { action(); return; }
      if (!clientMissing && !managesOrg) {
        showToast("Les informations de l'entreprise sont incomplètes (IFU, RCCM, coordonnées bancaires…). Demandez à un administrateur de les compléter.", true);
        action();
        return;
      }
      const back = opts.beforeLeave ? await opts.beforeLeave() : opts.returnTo;
      if (!back) return;
      const q = new URLSearchParams({ complete: '1', return: back });
      if (clientCode) q.set('client', clientCode);
      navigate(`/onboarding?${q.toString()}`);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [orgId, orgSettings, clients, invoices, plan, refreshPlan, managesOrg, navigate, showToast]);

  const closeLimit = useCallback(() => setLimitHit(false), []);
  /** Shows the upgrade offer, e.g. when the database refused an invoice for the Solo limit. */
  const showLimit = useCallback(() => setLimitHit(true), []);
  const dialog: ReactNode = limitHit ? <UpgradeModal feature="invoices_unlimited" onClose={closeLimit} /> : null;

  /**
   * `checking` is true while the settings are read: disable the issue button
   * meanwhile. Render `dialog` (the upgrade offer when the Solo limit is hit).
   */
  return { guard, checking, dialog, showLimit };
}
