import { Check, X, Flame, Trash2, Bell, Globe, Mail } from 'lucide-react';
import { Habit } from '../../services/types';
import { formatShortDate } from '../../utils/quickAddParser';
import { HabitDay, bestStreakOf, doneThisWeek, habitDay, lastNDays, recentWeeks, streakOf } from '../../utils/habits';
import { Select } from '../common/Select';
import { TimePicker } from '../common/TimePicker';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const STATE_LABEL: Record<HabitDay, string> = {
  done: 'done', missed: 'missed', open: 'not done yet', future: 'upcoming', before: 'before you started',
};

const cellClass = (state: HabitDay) => ({
  done: 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/25',
  missed: 'bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-400',
  open: 'bg-transparent text-emerald-600 dark:text-emerald-400 border-2 border-dashed border-emerald-400/70',
  future: 'bg-gray-50 text-gray-300 dark:bg-white/[0.03] dark:text-gray-600',
  before: 'bg-gray-50 text-gray-300 dark:bg-white/[0.03] dark:text-gray-600',
}[state]);

const weekdayLetter = (date: string) => DAY_LETTERS[(new Date(`${date}T00:00`).getDay() + 6) % 7];

function targetLabel(target: number) {
  return target >= 7 ? 'Every day' : `${target} ${target === 1 ? 'day' : 'days'} a week`;
}

interface TodayProps {
  habits: Habit[];
  today: string;
  onToggle: (habitId: string, date: string) => void;
}

/**
 * Today's entry for each habit. Ticking it marks today only; tomorrow brings a
 * fresh entry and an unticked day stays in the history as missed.
 */
export function HabitTodayCard({ habits, today, onToggle }: TodayProps) {
  const done = habits.filter(h => habitDay(h, today, today) === 'done').length;
  const week = lastNDays(today, 7).reverse();
  return (
    <section aria-label="Today's habits" className="p-4 md:p-6 rounded-3xl surface border border-black/5 dark:border-white/5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Today's habits</h3>
        <span className={`text-[12px] font-semibold ${done === habits.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
          {done === habits.length ? 'All done today' : `${done} of ${habits.length} done`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {habits.map(habit => {
          const isDone = habitDay(habit, today, today) === 'done';
          const streak = streakOf(habit.history, today);
          return (
            <li key={habit.id} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 p-2.5 md:p-3 rounded-2xl surface-item">
              <button
                type="button"
                onClick={() => onToggle(habit.id, today)}
                aria-pressed={isDone}
                aria-label={`${habit.name}, today`}
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                  isDone ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30' : 'border-2 border-gray-300 dark:border-white/20 hover:border-emerald-400 text-transparent hover:text-emerald-400'
                }`}>
                <Check size={16} strokeWidth={3} />
              </button>
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-semibold truncate ${isDone ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{habit.name}</div>
                <div className="text-[11.5px] text-gray-400 flex items-center gap-1.5">
                  {streak > 0 && <span className="inline-flex items-center gap-0.5 text-orange-500 font-semibold"><Flame size={11} />{streak}</span>}
                  <span>{doneThisWeek(habit.history, today)} of {Math.min(7, habit.targetCount || 7)} this week</span>
                </div>
              </div>
              <div className="flex gap-1 w-full sm:w-auto pl-11 sm:pl-0" aria-label={`${habit.name}, last 7 days`}>
                {week.map(date => {
                  const state = habitDay(habit, date, today);
                  return (
                    <button key={date} type="button" disabled={state === 'future'}
                      onClick={() => onToggle(habit.id, date)}
                      title={`${formatShortDate(date)}: ${STATE_LABEL[state]}`}
                      aria-label={`${habit.name}, ${formatShortDate(date)}, ${STATE_LABEL[state]}`}
                      className={`w-6 h-6 rounded-md text-[9.5px] font-bold flex items-center justify-center transition-colors ${cellClass(state)}`}>
                      {state === 'done' ? <Check size={11} strokeWidth={3} /> : state === 'missed' ? <X size={11} strokeWidth={3} /> : weekdayLetter(date)}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface HistoryProps {
  habit: Habit;
  today: string;
  onToggle: (date: string) => void;
  onUpdate: (updates: { name?: string; targetCount?: number; remindTime?: string | null; remindPush?: boolean; remindEmail?: boolean }) => void;
  onDelete: (e: React.MouseEvent) => void;
}

/** One habit's record: a day-by-day grid of the last six weeks with done and missed days. */
export function HabitHistory({ habit, today, onToggle, onUpdate, onDelete }: HistoryProps) {
  const weeks = recentWeeks(today, 6);
  const last30 = lastNDays(today, 30).map(d => habitDay(habit, d, today));
  const doneCount = last30.filter(s => s === 'done').length;
  const missedCount = last30.filter(s => s === 'missed').length;
  const target = Math.min(7, habit.targetCount || 7);

  return (
    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 space-y-3">
      <div className="flex items-center gap-2">
        <input
          key={habit.name}
          defaultValue={habit.name}
          aria-label="Habit name"
          onBlur={e => { if (e.target.value.trim() && e.target.value !== habit.name) onUpdate({ name: e.target.value }); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="flex-1 min-w-0 bg-transparent font-semibold text-[15px] text-gray-900 dark:text-white outline-none rounded-lg px-1 -mx-1 focus:bg-white dark:focus:bg-white/10"
        />
        <Select value={target} onChange={v => onUpdate({ targetCount: Number(v) })} aria-label="How often"
          className="shrink-0 bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1 text-[12px] font-semibold text-gray-600 dark:text-gray-300 outline-none dark:[color-scheme:dark]">
          {[7, 6, 5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{targetLabel(n)}</option>)}
        </Select>
        <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-colors" title="Delete habit">
          <Trash2 size={15} />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          ['Streak', `${streakOf(habit.history, today)}d`],
          ['Best', `${bestStreakOf(habit.history)}d`],
          ['This week', `${doneThisWeek(habit.history, today)}/${target}`],
          ['Done · missed, 30d', `${doneCount} · ${missedCount}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white dark:bg-white/5 px-1.5 py-2">
            <div className="text-[13px] font-bold text-gray-900 dark:text-white leading-tight">{value}</div>
            <div className="text-[10.5px] font-medium text-gray-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <HabitReminder habit={habit} onUpdate={onUpdate} />

      <div role="grid" aria-label={`${habit.name}, last six weeks`} className="space-y-1">
        <div role="row" className="grid grid-cols-7 gap-1">
          {DAY_LETTERS.map((l, i) => <div key={i} role="columnheader" className="text-[10px] font-semibold text-gray-400 text-center">{l}</div>)}
        </div>
        {weeks.map(week => (
          <div key={week[0]} role="row" className="grid grid-cols-7 gap-1">
            {week.map(date => {
              const state = habitDay(habit, date, today);
              return (
                <button key={date} role="gridcell" type="button" disabled={state === 'future'}
                  onClick={() => onToggle(date)}
                  aria-pressed={state === 'done'}
                  title={`${formatShortDate(date)}: ${STATE_LABEL[state]}`}
                  aria-label={`${formatShortDate(date)}, ${STATE_LABEL[state]}`}
                  className={`h-8 rounded-lg text-[11px] font-semibold flex items-center justify-center transition-colors ${cellClass(state)} ${state === 'future' ? 'cursor-default' : 'hover:opacity-80'}`}>
                  {state === 'missed' ? <X size={12} strokeWidth={3} /> : Number(date.slice(8))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-400">
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500" />Done</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-200 dark:bg-red-500/40" />Missed</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded border-2 border-dashed border-emerald-400/70" />Today</span>
        <span>Tap a day to change it.</span>
      </div>
    </div>
  );
}

/**
 * When to nudge about a habit, and where: the website (push to the home-screen
 * app and browsers) and/or email. The Pi sends it on days the habit isn't
 * ticked yet, and skips the rest of the week once the weekly target is met.
 */
function HabitReminder({ habit, onUpdate }: { habit: Habit; onUpdate: HistoryProps['onUpdate'] }) {
  const on = !!habit.remindTime;
  const push = habit.remindPush !== false;
  const email = !!habit.remindEmail;
  const chip = (active: boolean) => `inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-semibold border transition-colors disabled:opacity-40 ${
    active ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-500/15 dark:border-blue-500/30 dark:text-blue-300'
      : 'bg-white border-gray-200 text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-400'}`;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={`${habit.name} reminder`}>
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-gray-500 dark:text-gray-400"><Bell size={13} />Remind me</span>
      <TimePicker aria-label="Reminder time" placeholder="Off" value={habit.remindTime || null}
        className="field !w-[6.5rem] !min-h-0 !py-1 !px-2 text-[12px]"
        onChange={t => onUpdate({ remindTime: t || null })} />
      <button type="button" disabled={!on} aria-pressed={on && push} onClick={() => onUpdate({ remindPush: !push })}
        className={chip(on && push)} title="Notification on the website and the home-screen app">
        <Globe size={12} />Website
      </button>
      <button type="button" disabled={!on} aria-pressed={on && email} onClick={() => onUpdate({ remindEmail: !email })}
        className={chip(on && email)} title="Email to the address in Settings > Notifications">
        <Mail size={12} />Email
      </button>
      {on && !push && !email && <span className="text-[11px] text-amber-600 dark:text-amber-400">Pick Website or Email</span>}
    </div>
  );
}
