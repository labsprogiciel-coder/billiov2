import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { fetchPaymentSettings, type PaymentSettings } from '@/lib/api/payment-settings';
import { clientIssues, sellerIssues, type ComplianceIssue, type SellerInfo } from '@/lib/invoice-compliance';
import { usePermissions } from '@/lib/use-permissions';
import ComplianceDialog from '@/components/ComplianceDialog';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';

interface Pending { issues: ComplianceIssue[]; clientCode: string; confirmLabel: string; action: () => void }

/**
 * Checks the mandatory invoice mentions before an invoice is issued. `guard`
 * runs the action straight away when nothing is missing; otherwise it shows
 * the missing mentions and runs the action only if the user confirms.
 *
 * The settings are read fresh on each check, so mentions completed in another
 * tab (the dialog's links open one) count without reloading the app.
 */
export function useComplianceGuard() {
  const { orgId, orgSettings, clients } = useApp();
  const { managesOrg } = usePermissions();
  const [pending, setPending] = useState<Pending | null>(null);
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);

  const guard = useCallback(async (clientCode: string, action: () => void, confirmLabel = 'Émettre quand même') => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      await check(clientCode, action, confirmLabel);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, orgSettings, clients]);

  async function check(clientCode: string, action: () => void, confirmLabel: string) {
    let seller: SellerInfo = orgSettings;
    let payments: PaymentSettings | null = null;
    if (!MOCK && orgId) {
      // A failed read must not block issuing: fall back to what the app has loaded
      const [org, pay] = await Promise.all([
        supabase.from('organizations')
          .select('name, address, city, country, ifu, rccm, tax_regime, division_fiscale')
          .eq('id', orgId).single()
          .then(({ data, error }) => (error || !data ? null : data), () => null),
        fetchPaymentSettings(orgId).catch(() => null),
      ]);
      if (org) {
        seller = {
          name: org.name ?? '', address: org.address ?? '', city: org.city ?? '', country: org.country ?? '',
          ifu: org.ifu ?? '', rccm: org.rccm ?? '', taxRegime: org.tax_regime ?? '', divisionFiscale: org.division_fiscale ?? '',
        };
      }
      payments = pay;
    } else if (orgId) {
      payments = await fetchPaymentSettings(orgId).catch(() => null);
    }
    const client = clients.find(c => c.code === clientCode);
    const issues = [...sellerIssues(seller, payments), ...clientIssues(client)];
    if (issues.length === 0) action();
    else setPending({ issues, clientCode, confirmLabel, action });
  }

  const close = useCallback(() => setPending(null), []);

  const dialog: ReactNode = pending ? (
    <ComplianceDialog
      issues={pending.issues}
      clientCode={pending.clientCode}
      canFixSeller={managesOrg}
      confirmLabel={pending.confirmLabel}
      onConfirm={pending.action}
      onClose={close}
    />
  ) : null;

  /** `checking` is true while the settings are read: disable the issue button meanwhile. */
  return { guard, checking, dialog };
}
