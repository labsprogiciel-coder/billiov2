import type { BillingPeriod } from '@/lib/plans';

/** Mensuel / Annuel switcher shown above the pricing cards. */
export default function BillingPeriodSwitch({ value, onChange, className = '' }: {
  value: BillingPeriod;
  onChange: (p: BillingPeriod) => void;
  className?: string;
}) {
  const opts: [BillingPeriod, string][] = [['monthly', 'Mensuel'], ['annual', 'Annuel']];
  return (
    <div className={`period-switch ${className}`} role="radiogroup" aria-label="Période de facturation">
      {opts.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          className={`period-switch-opt${value === key ? ' active' : ''}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
