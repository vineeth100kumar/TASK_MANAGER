import { Plus, X, Repeat } from 'lucide-react';
import { DOSE_PRESETS, normalizeDoses, presetOf } from '../../utils/doses';
import { TimePicker } from './TimePicker';

interface Props {
  value: string[] | null | undefined;
  onChange: (times: string[]) => void;
  disabled?: boolean;
}

const chip = (on: boolean) => `inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-semibold ring-1 ring-inset transition-colors active:scale-[0.97] ${
  on ? 'bg-blue-600 text-white ring-blue-600 dark:bg-blue-500 dark:ring-blue-500'
    : 'ring-black/[0.08] dark:ring-white/10 text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'}`;
const timeBtn = 'inline-flex items-center h-8 px-3 rounded-full text-[12.5px] font-semibold tabular-nums bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30';

/**
 * "Times per day": Once, Morning + evening, 3 times, or your own times. With
 * more than one, each time is ticked on its own and the day is done when all are.
 */
export function DoseTimesPicker({ value, onChange, disabled }: Props) {
  const times = normalizeDoses(value);
  const preset = presetOf(times);
  // Custom starts from two times so there is something to edit.
  const pickCustom = () => onChange(times.length ? times : ['09:00', '21:00']);
  const setAt = (i: number, t: string) => onChange(normalizeDoses(times.map((x, j) => (j === i ? t : x))));
  const removeAt = (i: number) => onChange(times.filter((_, j) => j !== i));
  const addTime = () => {
    const last = times[times.length - 1] || '08:00';
    const [h, m] = last.split(':').map(Number);
    const next = `${String(Math.min(23, h + 3)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    onChange([...times, times.includes(next) ? '23:00' : next]);
  };
  return (
    <div className="space-y-2" role="group" aria-label="Times per day">
      <div className="flex flex-wrap items-center gap-2">
        {DOSE_PRESETS.map(p => (
          <button key={p.id} type="button" disabled={disabled} aria-pressed={preset === p.id} onClick={() => onChange(p.times)} className={chip(preset === p.id)}>
            {p.id === 'once' ? <Repeat size={12} /> : null}{p.label}
          </button>
        ))}
        <button type="button" disabled={disabled} aria-pressed={preset === 'custom'} onClick={pickCustom} className={chip(preset === 'custom')}>Custom</button>
      </div>
      {times.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {times.map((t, i) => (
            <span key={`${t}-${i}`} className="inline-flex items-center gap-0.5">
              <TimePicker aria-label={`Dose ${i + 1} time`} value={t} clearable={false} className={timeBtn} onChange={v => v && setAt(i, v)}>
                {formatLabel(t)}
              </TimePicker>
              {times.length > 2 && (
                <button type="button" disabled={disabled} onClick={() => removeAt(i)} aria-label={`Remove ${formatLabel(t)}`}
                  className="p-1 rounded-full text-gray-400 hover:text-red-500"><X size={12} /></button>
              )}
            </span>
          ))}
          {times.length < 6 && (
            <button type="button" disabled={disabled} onClick={addTime} className={chip(false)}><Plus size={12} />Add time</button>
          )}
        </div>
      )}
    </div>
  );
}

function formatLabel(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}
