import { useEffect } from 'react';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import { CERTIFIED_OFFER, PLANS, formatPrice, minPlanForFeature, type Feature, type PlanId } from '@/lib/plans';
import { useApp } from '@/context/AppContext';

// Re-export so consumers don't have to import plans separately
export type { Feature };

interface Props {
  feature:  Feature;
  onClose:  () => void;
}

const PLAN_ORDER_ARR: PlanId[] = ['solo', 'business', 'cabinet', 'enterprise'];

export default function UpgradeModal({ feature, onClose }: Props) {
  const { plan: currentPlan } = useApp();
  const requiredPlan = minPlanForFeature(feature);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="inv-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="upg-modal" role="dialog" aria-modal="true" aria-label="Mettre à niveau">
        <div className="inv-modal-head">
          <div className="inv-modal-title">
            <Icon name="sparkles" size={17} />
            Passez à la vitesse supérieure
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="upg-plans">
          {PLANS.map((p, i) => {
            const isCurrent  = p.id === currentPlan;
            const isRequired = p.id === requiredPlan;
            const isDisabled = i < PLAN_ORDER_ARR.indexOf(currentPlan);

            return (
              <div
                key={p.id}
                className={[
                  'upg-plan-card',
                  isRequired  ? 'upg-plan-card--highlighted' : '',
                  isCurrent   ? 'upg-plan-card--current'     : '',
                  isDisabled  ? 'upg-plan-card--dim'         : '',
                ].filter(Boolean).join(' ')}
              >
                {p.popular && !isCurrent && (
                  <div className="upg-popular-badge">Le plus populaire</div>
                )}
                {isCurrent && (
                  <div className="upg-current-badge">Plan actuel</div>
                )}

                <div className="upg-plan-name">{p.name}</div>
                <div className="upg-plan-tagline">{p.tagline}</div>

                <div className="upg-plan-price">
                  {p.price === null ? (
                    <>
                      <span className="upg-price-label">À partir de</span>
                      <span className="upg-price-amount">Sur devis</span>
                      <span className="upg-price-note">Contrat annuel</span>
                    </>
                  ) : p.price === 0 ? (
                    <>
                      <span className="upg-price-currency">{p.currency}</span>
                      <span className="upg-price-amount">0</span>
                      <span className="upg-price-note">/ mois</span>
                    </>
                  ) : (
                    <>
                      <span className="upg-price-currency">{p.currency}</span>
                      <span className="upg-price-amount">{formatPrice(p.price)}</span>
                      <span className="upg-price-note">/ mois</span>
                      {p.annualPrice && (
                        <span className="upg-price-annual">ou {formatPrice(p.annualPrice)} {p.currency} / an</span>
                      )}
                    </>
                  )}
                </div>

                <ul className="upg-perk-list">
                  {p.perks.map(perk => (
                    <li key={perk} className="upg-perk" title={perk}>
                      <Icon name="check" size={13} className="upg-perk-icon" />
                      <span className="upg-perk-text">{perk}</span>
                    </li>
                  ))}
                </ul>

                {!isCurrent && (
                  <button
                    className={`btn upg-cta-btn${isRequired ? ' btn-primary' : ''}`}
                    onClick={() => {
                      posthog.capture('plan_upgrade_clicked', { current_plan: currentPlan, target_plan: p.id, feature });
                      onClose();
                    }}
                  >
                    {p.ctaLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Certified e-invoicing (PRO-137): announced, not sold yet */}
        <div className="upg-certified">
          <div className="upg-certified-head">
            <Icon name="shield-check" size={16} className="upg-certified-icon" />
            <span className="upg-certified-name">{CERTIFIED_OFFER.name}</span>
            <span className="upg-certified-badge">{CERTIFIED_OFFER.badge}</span>
          </div>
          <div className="upg-certified-price">
            À partir de <strong>{formatPrice(CERTIFIED_OFFER.annualPrice)} {CERTIFIED_OFFER.currency}</strong> / an
          </div>
          <ul className="upg-certified-points">
            {CERTIFIED_OFFER.points.map(pt => (
              <li key={pt}><Icon name="check" size={12} className="upg-perk-icon" />{pt}</li>
            ))}
          </ul>
          <button
            className="btn btn-sm"
            onClick={() => {
              posthog.capture('certified_invoicing_interest', { current_plan: currentPlan, feature, source: 'upgrade_modal' });
              onClose();
            }}
          >
            {CERTIFIED_OFFER.ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
