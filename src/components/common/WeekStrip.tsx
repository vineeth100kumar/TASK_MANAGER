import { WeekDay } from '../../utils/progress';

// This week at a glance: a day lights up once something got done. Missed days
// stay plain; there is no streak to lose.
export function WeekStrip({ days }: { days: WeekDay[] }) {
  const active = days.filter(d => d.count > 0).length;
  const caption = active === 0
    ? 'Finish one thing to light up today'
    : `${active} active ${active === 1 ? 'day' : 'days'} this week`;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5" role="img" aria-label={caption}>
        {days.map(d => (
          <div key={d.date.toISOString()} className="flex flex-col items-center gap-1">
            <span
              title={`${d.date.toLocaleDateString('en-US', { weekday: 'long' })}: ${d.count} done`}
              className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-semibold tabular-nums transition-colors duration-500 ${
                d.count > 0 ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-600/30'
                : d.isToday ? 'ring-2 ring-inset ring-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                : d.isFuture ? 'bg-black/[0.03] dark:bg-white/[0.04] text-gray-300 dark:text-gray-600'
                : 'bg-black/[0.06] dark:bg-white/[0.08] text-gray-400'
              }`}>
              {d.label}
            </span>
          </div>
        ))}
      </div>
      <span className="text-[12.5px] font-medium text-gray-500 dark:text-gray-400">{caption}</span>
    </div>
  );
}
