// Cash collected per month or quarter (PRO-164): one series of columns, the
// current period lighter and labelled, a value tooltip on hover or focus, and
// the same figures as a table for screen readers.

import { useId, useState } from 'react';
import type { CashBar } from '@/lib/dashboard-periods';
import { fmt, fmtCompact } from '@/data';

/** A clean top for the axis: 1, 2 or 5 × 10^n, above the largest value. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export default function CashChart({ bars, caption }: { bars: CashBar[]; caption: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const tableId = useId();
  const max = niceMax(Math.max(...bars.map(b => b.amount)));
  const ticks = [max, max / 2, 0];
  const empty = bars.every(b => b.amount === 0);

  return (
    <figure className="cash-chart" aria-describedby={tableId}>
      <div className="cash-plot">
        <div className="cash-grid" aria-hidden="true">
          {ticks.map(t => (
            <div key={t} className="cash-tick" style={{ bottom: `${(t / max) * 100}%` }}>
              <span>{t === 0 ? '0' : fmtCompact(t)}</span>
            </div>
          ))}
        </div>
        <div className="cash-bars">
          {bars.map(b => {
            const h = (b.amount / max) * 100;
            const label = `${b.label}${b.current ? ' (en cours)' : ''} : ${fmt(b.amount)} F CFA`;
            return (
              <div
                key={b.key}
                className={`cash-slot${hover === b.key ? ' on' : ''}`}
                tabIndex={0}
                aria-label={label}
                onMouseEnter={() => setHover(b.key)}
                onMouseLeave={() => setHover(h => (h === b.key ? null : h))}
                onFocus={() => setHover(b.key)}
                onBlur={() => setHover(h => (h === b.key ? null : h))}
              >
                {b.current && b.amount > 0 && <span className="cash-cap" aria-hidden="true">{fmtCompact(b.amount)}</span>}
                <div className={`cash-bar${b.current ? ' current' : ''}`} style={{ height: `${Math.max(h, b.amount > 0 ? 1 : 0)}%` }} />
                {hover === b.key && (
                  <div className="cash-tip" role="tooltip">
                    <b>{fmt(b.amount)} F CFA</b>
                    <span>{b.label}{b.current ? ' · en cours' : ''}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="cash-axis" aria-hidden="true">
        {bars.map(b => <span key={b.key} className={b.current ? 'current' : undefined}>{b.label}</span>)}
      </div>
      {empty && <p className="cash-empty">Aucun encaissement sur la période.</p>}
      <table id={tableId} className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th scope="col">Période</th><th scope="col">Encaissé (F CFA)</th></tr></thead>
        <tbody>{bars.map(b => <tr key={b.key}><th scope="row">{b.label}{b.current ? ' (en cours)' : ''}</th><td>{fmt(b.amount)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
