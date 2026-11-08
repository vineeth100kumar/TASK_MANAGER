// HolidaySettings - Settings > Holidays: which India holidays show on
// Calendar, Timeline and Today, plus the upcoming list. Display only: the
// choice is per device and holidays are never tasks (utils/holidays.ts).

import { HOLIDAYS, HOLIDAY_SCOPE, HOLIDAY_YEARS, HolidayPref, filterHolidays, setHolidayPref, useHolidayPref } from '../../utils/holidays';
import { getTodayString } from '../../utils/dateUtils';
import { HolidayTag } from '../common/HolidayTag';

const CHOICES: { id: HolidayPref; label: string; detail: string }[] = [
  { id: 'all', label: 'All', detail: 'Gazetted and restricted (optional) holidays.' },
  { id: 'gazetted', label: 'Gazetted only', detail: 'Only the days central offices close.' },
  { id: 'off', label: 'Off', detail: 'No holidays anywhere.' },
];

export function HolidaySettings() {
  const pref = useHolidayPref();
  const today = getTodayString();
  const upcoming = filterHolidays(HOLIDAYS, pref === 'off' ? 'all' : pref).filter(h => h.date >= today).slice(0, 8);
  const last = HOLIDAY_YEARS[HOLIDAY_YEARS.length - 1];

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-[14px] font-semibold text-gray-900 dark:text-white">India holidays</h4>
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-0.5">
          Shown on Calendar, Timeline and Today. They are labels, not tasks: no reminders, never overdue, not in Inbox or streaks.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Which holidays show">
        {CHOICES.map(c => {
          const active = pref === c.id;
          return (
            <button key={c.id} role="radio" aria-checked={active} onClick={() => setHolidayPref(c.id)}
              className={`text-left p-3 rounded-2xl border transition-colors ${active
                ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-300/70 dark:border-rose-800/60'
                : 'bg-gray-50 dark:bg-white/5 border-black/5 dark:border-white/5 hover:bg-gray-100 dark:hover:bg-white/10'}`}>
              <p className={`text-[13.5px] font-semibold ${active ? 'text-rose-700 dark:text-rose-300' : 'text-gray-900 dark:text-white'}`}>{c.label}</p>
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{c.detail}</p>
            </button>
          );
        })}
      </div>

      <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5">
        <p className="eyebrow text-gray-400 mb-2">Coming up</p>
        {upcoming.length === 0 ? (
          <p className="text-[13px] text-gray-500">No more holidays in the list. It needs the {last + 1} list added.</p>
        ) : (
          <ul className="space-y-1.5">
            {upcoming.map(h => (
              <li key={h.date + h.name} className="flex items-center gap-3 text-[13px]">
                <span className="w-24 shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                  {new Date(`${h.date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <HolidayTag holiday={h} size="xs" className="min-w-0" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11.5px] text-gray-400 leading-relaxed">
        {HOLIDAY_SCOPE}, {HOLIDAY_YEARS.join(' and ')}. * Id, Muharram, Milad-un-Nabi and similar dates can move a day with moon sighting; the government announces any change.
        Restricted holidays are optional: central employees pick two. State holidays differ and are not included.
      </p>
    </div>
  );
}
