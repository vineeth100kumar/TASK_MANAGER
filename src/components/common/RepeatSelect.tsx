import { REPEAT_OPTIONS, MORE_REPEAT_OPTIONS, repeatLabel } from '../../utils/recurrence';
import { Select } from './Select';

// The repeat choices, shared by the add form and the task panel. A rule set
// elsewhere (smart add's "every mon wed fri") shows as its own choice.
export function RepeatSelect({ value, onChange, className, disabled, align }: {
  value: string | null | undefined;
  onChange: (rule: string) => void;
  className?: string;
  disabled?: boolean;
  align?: 'start' | 'end';
}) {
  const current = value || '';
  const known = REPEAT_OPTIONS.some(o => o.value === current) || MORE_REPEAT_OPTIONS.some(g => g.options.some(o => o.value === current));
  return (
    <Select className={className} value={current} disabled={disabled} onChange={onChange} align={align} aria-label="Repeat">
      {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      {!known && <option value={current}>{repeatLabel(current)}</option>}
      {MORE_REPEAT_OPTIONS.map(g => (
        <optgroup key={g.group} label={g.group}>
          {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}
