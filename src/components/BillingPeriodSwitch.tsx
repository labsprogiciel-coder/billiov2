import { useRef, type KeyboardEvent } from 'react';
import type { BillingPeriod } from '@/lib/plans';

const OPTS: [BillingPeriod, string][] = [['monthly', 'Mensuel'], ['annual', 'Annuel']];

/**
 * Mensuel / Annuel switcher shown above the pricing cards. A radio group: one
 * Tab stop (the selected option), arrow keys move the selection.
 */
export default function BillingPeriodSwitch({ value, onChange, className = '' }: {
  value: BillingPeriod;
  onChange: (p: BillingPeriod) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + OPTS.length) % OPTS.length;
    onChange(OPTS[next][0]);
    refs.current[next]?.focus();
  }
  return (
    <div className={`period-switch ${className}`} role="radiogroup" aria-label="Période de facturation">
      {OPTS.map(([key, label], i) => (
        <button
          key={key}
          ref={el => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={value === key}
          tabIndex={value === key ? 0 : -1}
          className={`period-switch-opt${value === key ? ' active' : ''}`}
          onClick={() => onChange(key)}
          onKeyDown={e => onKeyDown(e, i)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
