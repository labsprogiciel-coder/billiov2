// The tax group of one line (PRO-138): « B · 18 % », « A · Exonéré »… Only for an organisation that
// charges VAT; without VAT every line is in H and there is nothing to choose.
import { SELECTABLE_GROUPS, groupShort, type TaxGroupCode } from '@/lib/tax-groups';

export default function TaxGroupSelect({ value, onChange, disabled, label, className = 'ie-field' }: {
  value: TaxGroupCode; onChange: (code: TaxGroupCode) => void; disabled?: boolean; label: string; className?: string;
}) {
  return (
    <select className={className} value={value} disabled={disabled} aria-label={label} title={SELECTABLE_GROUPS.find(g => g.code === value)?.label}
      onChange={e => onChange(e.target.value as TaxGroupCode)}>
      {SELECTABLE_GROUPS.map(g => <option key={g.code} value={g.code}>{groupShort(g.code)}</option>)}
    </select>
  );
}
