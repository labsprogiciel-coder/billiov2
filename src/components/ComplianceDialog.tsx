import { useEffect } from 'react';
import Icon from '@/components/Icon';
import type { ComplianceFix, ComplianceIssue } from '@/lib/invoice-compliance';

interface Props {
  issues: ComplianceIssue[];
  /** Client to open when a client mention is missing */
  clientCode?: string;
  /** Whether the user can change the organisation's settings */
  canFixSeller: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

const FIX_LINK: Record<Exclude<ComplianceFix, 'client'>, { href: string; label: string }> = {
  business: { href: '/settings?tab=business', label: 'Paramètres → Entreprise' },
  payments: { href: '/settings?tab=payments', label: 'Paramètres → Moyens de paiement' },
};

/**
 * Lists the mandatory invoice mentions that are missing before an invoice is
 * issued. The links open in a new tab so the invoice being written isn't lost.
 */
export default function ComplianceDialog({ issues, clientCode, canFixSeller, confirmLabel, onConfirm, onClose }: Props) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const seller = issues.filter(i => i.fix !== 'client');
  const client = issues.filter(i => i.fix === 'client');
  const sellerFixes = [...new Set(seller.map(i => i.fix as Exclude<ComplianceFix, 'client'>))];

  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="compliance-link">
      {label} <Icon name="external-link" size={13} ariaHidden />
      <span className="sr-only"> (nouvel onglet)</span>
    </a>
  );

  return (
    <div className="inv-overlay" onClick={onClose}>
      <div className="inv-modal" role="alertdialog" aria-modal="true" aria-labelledby="compliance-title" aria-describedby="compliance-desc" onClick={e => e.stopPropagation()}>
        <div className="inv-modal-head">
          <div className="inv-modal-title" id="compliance-title">
            <Icon name="alert-triangle" size={16} ariaHidden />
            Mentions obligatoires manquantes
          </div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={16} ariaHidden />
          </button>
        </div>
        <div className="inv-modal-body" style={{ lineHeight: 1.6 }}>
          <p id="compliance-desc" style={{ margin: '0 0 12px', color: 'var(--color-text-secondary)' }}>
            Une facture doit porter ces mentions (facture normalisée). Sans elles, votre client professionnel
            risque de ne pas pouvoir déduire la TVA et de refuser la facture.
          </p>
          {seller.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="form-label" style={{ marginBottom: 4 }}>Votre entreprise</div>
              <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
                {seller.map(i => <li key={i.key}>{i.label}</li>)}
              </ul>
              {canFixSeller
                ? <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{sellerFixes.map(f => <span key={f}>{link(FIX_LINK[f].href, `Compléter dans ${FIX_LINK[f].label}`)}</span>)}</div>
                : <div style={{ color: 'var(--color-text-secondary)' }}>Demandez à un administrateur de les compléter dans les paramètres.</div>}
            </div>
          )}
          {client.length > 0 && (
            <div>
              <div className="form-label" style={{ marginBottom: 4 }}>Client</div>
              <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
                {client.map(i => <li key={i.key}>{i.label}</li>)}
              </ul>
              {clientCode && link(`/contacts?client=${encodeURIComponent(clientCode)}`, 'Compléter la fiche client')}
            </div>
          )}
        </div>
        <div className="inv-modal-foot">
          <button className="btn" onClick={onClose} autoFocus>Annuler</button>
          <button className="btn btn-primary" onClick={() => { onClose(); onConfirm(); }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
