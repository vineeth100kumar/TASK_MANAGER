import { Check } from 'lucide-react';
import { formatTime } from '../../utils/reminders';
import { doseProgress } from '../../utils/doses';

interface Props {
  times: string[];
  ticked: string[] | null | undefined;
  onToggle: (time: string) => void;
  label: string;
  className?: string;
}

/** One small check per time of day, e.g. "8:00 am" and "8:00 pm", with "1/2" beside them. */
export function DoseChips({ times, ticked, onToggle, label, className = '' }: Props) {
  const { done, total } = doseProgress(times, ticked);
  const set = new Set(ticked || []);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} role="group" aria-label={`${label}, doses`}>
      {times.map(t => {
        const on = set.has(t);
        return (
          <button key={t} type="button" aria-pressed={on} aria-label={`${label}, ${formatTime(t)}, ${on ? 'done' : 'not done'}`}
            onClick={(e) => { e.stopPropagation(); onToggle(t); }}
            className={`inline-flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-full text-[11px] font-semibold tabular-nums transition-colors active:scale-95 ${
              on ? 'bg-emerald-500 text-white' : 'ring-1 ring-inset ring-gray-300 dark:ring-white/15 text-gray-500 dark:text-gray-300 hover:ring-emerald-400'}`}>
            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${on ? 'bg-white/25' : 'border border-current opacity-60'}`}>{on && <Check size={9} strokeWidth={3.5} />}</span>
            {formatTime(t)}
          </button>
        );
      })}
      <span className={`text-[11px] font-semibold ${done === total ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>{done}/{total}</span>
    </div>
  );
}
