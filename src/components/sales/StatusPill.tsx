import type { StatusTone } from '@/lib/sales-tables';

/** A row's status in the dense tables (PRO-165). */
export default function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  return <span className={`dt-status ${tone}`}>{label}</span>;
}
