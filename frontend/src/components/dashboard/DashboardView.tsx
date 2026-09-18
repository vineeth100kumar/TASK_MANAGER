import React from 'react';
import { CloudRain, Sun, ChevronRight } from 'lucide-react';
import {
  DailyPerformance,
  AiGreetingResponse,
  FinanceSummary,
  WorkItem,
  WeatherData,
} from '../../types';
import { Skeleton } from '../common/Skeleton';
import { compareBySchedule, isPastDue, itemMoment } from '../../utils/dateHelpers';
import { haptics } from '../../utils/haptics';

interface DashboardViewProps {
  isLoading?: boolean;
  performance: DailyPerformance | null;
  greetingData: AiGreetingResponse | null;
  weatherData?: WeatherData | null;
  financeSummary: FinanceSummary | null;
  todayTasks: WorkItem[];
  onToggleTask: (task: WorkItem) => void;
  onNavigateToTab: (tab: 'dashboard' | 'tasks' | 'finance' | 'shortcuts' | 'whiteboard' | 'projects') => void;
}

const rupees = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

/** Seeds the entrance stagger. Children arrive in reading order, 45ms apart. */
const step = (i: number) => ({ '--i': i }) as React.CSSProperties;

/** "Yesterday", "4:00 PM", "Fri" — whichever is the useful thing to know. */
const whenLabel = (task: WorkItem): string | null => {
  const moment = itemMoment(task);
  if (moment) {
    const d = new Date(moment);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
  }
  if (!task.due_date) return null;

  const due = new Date(`${task.due_date}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (days === 0) return null; // "today" on the Today screen says nothing
  if (days === -1) return 'Yesterday';
  if (days < -1) return `${Math.abs(days)} days ago`;
  if (days === 1) return 'Tomorrow';
  return due.toLocaleDateString([], { weekday: 'short' });
};

const TaskRow: React.FC<{ task: WorkItem; onToggle: (t: WorkItem) => void }> = ({ task, onToggle }) => {
  const late = isPastDue(task);
  const when = whenLabel(task);
  const urgent = task.priority === 'urgent' && !task.is_completed;

  return (
    <div className="row row-interactive px-1">
      <button
        role="checkbox"
        aria-checked={task.is_completed}
        aria-label={task.is_completed ? `Mark ${task.title} as not done` : `Mark ${task.title} as done`}
        data-checked={task.is_completed}
        onClick={() => {
          haptics.light();
          onToggle(task);
        }}
        className="check mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-body ${task.is_completed ? 'text-ink-3 line-through' : 'text-ink'}`}>
          {task.title}
        </p>
        {(when || urgent) && !task.is_completed && (
          <div className="flex items-center gap-2 mt-0.5">
            {urgent && <span className="w-1.5 h-1.5 rounded-full bg-late-500 dark:bg-late-400 shrink-0" />}
            {when && (
              <span className={`text-meta ${late ? 'text-late-500 dark:text-late-400' : 'text-ink-3'}`}>
                {when}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/*
 * On a wide screen the glance figures become their own small surfaces in the
 * rail, where they are simply always visible, instead of a line you scroll to.
 */
const RailCard: React.FC<{
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => {
  const body = (
    <>
      <div className="text-meta text-ink-3">{label}</div>
      <div className="mt-0.5">{children}</div>
    </>
  );

  return onClick ? (
    <button onClick={onClick} className="surface px-4 py-3.5 text-left w-full">
      {body}
    </button>
  ) : (
    <div className="surface px-4 py-3.5">{body}</div>
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  isLoading = false,
  performance,
  greetingData,
  weatherData,
  financeSummary,
  todayTasks,
  onToggleTask,
  onNavigateToTab,
}) => {
  const planned = performance?.tasks_planned ?? 0;
  const completed = performance?.tasks_completed ?? 0;
  const streak = performance?.streak_days ?? 0;
  const weather = weatherData || greetingData?.weather;

  // A day happens in order, so the screen shows it in order. Without this the
  // list arrived in whatever order the database handed it over, and "Next"
  // could be the thing after the one that is actually next.
  const outstanding = todayTasks.filter((t) => !t.is_completed).sort(compareBySchedule);
  const finished = todayTasks.filter((t) => t.is_completed);

  /*
   * The one thing to do next: anything whose time has already gone by, else
   * whatever is soonest. This is the single most useful sentence on the
   * screen, so it goes at the top where the masthead used to be.
   */
  const next = outstanding.find((t) => isPastDue(t)) ?? outstanding[0];

  // Whatever is already shown as Next does not repeat in the list below it.
  const rest = outstanding.filter((t) => t.id !== next?.id);

  const total = Math.max(planned, todayTasks.length);

  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  /*
   * The placeholder carries the measurements of the thing it stands in for, so
   * nothing on the screen moves when the Pi answers. That is the whole job: a
   * skeleton of the wrong height is worse than no skeleton at all.
   */
  if (isLoading && !performance && !greetingData) {
    return (
      <div className="mx-auto max-w-2xl lg:max-w-5xl px-5 pt-3 pb-40 md:pb-16">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_244px] lg:gap-12 lg:items-start">
          <div className="min-w-0">
            <div className="pt-2">
              <Skeleton className="h-[34px] w-[118px] rounded-lg" />
              <Skeleton className="h-[18px] w-[152px] mt-2 rounded" />
            </div>

            <Skeleton className="h-[92px] w-full mt-5 rounded-surface" />

            <div className="mt-6">
              <Skeleton className="h-[18px] w-full rounded" />
              <Skeleton className="h-[3px] w-full mt-2 rounded-full" />
            </div>

            <div className="mt-7">
              <Skeleton className="h-[18px] w-[38px] rounded" />
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="row px-1">
                  <Skeleton variant="circle" className="w-[22px] h-[22px] rounded-full mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-[16px] w-[58%] rounded" />
                    <Skeleton className="h-[13px] w-[20%] mt-1.5 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="hidden lg:flex flex-col gap-4 pt-2">
            <Skeleton className="h-[76px] w-full rounded-surface" />
            <Skeleton className="h-[76px] w-full rounded-surface" />
            <Skeleton className="h-[76px] w-full rounded-surface" />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-5 pt-3 pb-40 md:pb-16">
      {/*
        On a phone this is one column. On a monitor the reading column keeps its
        measure and the leftover width becomes a rail, rather than the column
        stretching across the screen.
      */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_244px] lg:gap-12 lg:items-start">
        <div className="enter min-w-0">
          {/* Title */}
          <header className="pt-2" style={step(0)}>
            <h1 className="screen-title">Today</h1>
            <p className="text-meta text-ink-3 mt-0.5">{dateLine}</p>
          </header>

          {/* Next action — the one lifted surface on the screen, actionable in place */}
          {next && (
            <div className="surface-raised mt-5 px-4 py-3.5 flex items-start gap-3" style={step(1)}>
              <button
                role="checkbox"
                aria-checked={false}
                aria-label={`Mark ${next.title} as done`}
                data-checked={false}
                onClick={() => {
                  haptics.light();
                  onToggleTask(next);
                }}
                className="check mt-1"
              />
              <div className="min-w-0 flex-1">
                <span className="label">Next</span>
                <p className="text-lead font-semibold text-ink mt-0.5">{next.title}</p>
                <p className="text-meta text-ink-2 mt-0.5">
                  {[
                    isPastDue(next)
                      ? (whenLabel(next) ? `Was due ${whenLabel(next)}` : 'Overdue')
                      : whenLabel(next),
                    next.estimated_minutes ? `about ${next.estimated_minutes} min` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Today'}
                </p>
              </div>
            </div>
          )}

          {/* Progress — a real count, not a percentage dressed as a metric */}
          {(planned > 0 || todayTasks.length > 0) && (
            <div className="mt-6" style={step(2)}>
              <div className="flex items-baseline justify-between">
                <span className="text-meta text-ink-2 tabular">
                  {completed} of {total} done
                </span>
                {streak > 0 && (
                  <span className="text-meta text-ink-3 tabular">{streak}-day streak</span>
                )}
              </div>
              <div className="h-[3px] rounded-full bg-hairline overflow-hidden mt-2">
                <div
                  className="h-full bg-accent-500 rounded-full transition-[width] duration-700 ease-settle"
                  style={{ width: `${total > 0 ? Math.round((completed / total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* The list */}
          <section className="mt-7" style={step(3)}>
            {rest.length > 0 ? (
              <>
                <h2 className="label mb-1">Then</h2>
                <div>
                  {rest.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={onToggleTask} />
                  ))}
                </div>
              </>
            ) : outstanding.length > 0 ? null : (
              <div className="py-8 text-center">
                <p className="text-lead text-ink">
                  {finished.length > 0 ? 'All done for today.' : 'Nothing scheduled.'}
                </p>
                <p className="text-meta text-ink-3 mt-1">
                  {finished.length > 0
                    ? `${finished.length} ${finished.length === 1 ? 'task' : 'tasks'} cleared.`
                    : 'Add something below when you are ready.'}
                </p>
              </div>
            )}

            {finished.length > 0 && outstanding.length > 0 && (
              <details className="mt-5 group">
                <summary className="label cursor-pointer list-none flex items-center gap-1 select-none">
                  <ChevronRight className="w-3.5 h-3.5 transition-transform duration-200 ease-settle group-open:rotate-90" />
                  {finished.length} done
                </summary>
                <div className="mt-1">
                  {finished.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={onToggleTask} />
                  ))}
                </div>
              </details>
            )}
          </section>

          {/*
            Reference, not the point. On a phone money and weather are a line you
            glance at; the rail carries them on a monitor, so this hides there.
          */}
          <section
            className="lg:hidden mt-8 pt-5 border-t border-hairline flex flex-wrap gap-x-8 gap-y-4"
            style={step(4)}
          >
            <button onClick={() => onNavigateToTab('finance')} className="text-left">
              <div className="text-meta text-ink-3">Balance</div>
              <div className="text-body font-semibold text-ink tabular mt-px">
                {rupees(financeSummary?.net_worth ?? 0)}
              </div>
            </button>

            <button onClick={() => onNavigateToTab('finance')} className="text-left">
              <div className="text-meta text-ink-3">Spent today</div>
              <div className="text-body font-semibold text-ink tabular mt-px">
                {rupees(financeSummary?.today_spend ?? 0)}
              </div>
            </button>

            {weather && (
              <div>
                <div className="text-meta text-ink-3">Outside</div>
                <div className="flex items-center gap-1.5 text-body font-semibold text-ink mt-px">
                  {weather.rain_probability > 30 ? (
                    <CloudRain className="w-4 h-4 text-ink-3" />
                  ) : (
                    <Sun className="w-4 h-4 text-ink-3" />
                  )}
                  <span className="tabular">{Math.round(weather.temperature)}°</span>
                  <span className="text-meta font-normal text-ink-3">{weather.condition}</span>
                </div>
              </div>
            )}
          </section>

          {/* The greeting, if the model produced one worth reading. Last, not first. */}
          {greetingData?.greeting && (
            <p className="mt-7 text-meta text-ink-3 leading-relaxed" style={step(5)}>
              {greetingData.greeting}
            </p>
          )}
        </div>

        {/* The rail. Desktop only — on a phone these live in the line above. */}
        <aside className="hidden lg:flex enter flex-col gap-4 pt-2">
          <div style={step(4)}>
            <RailCard label="Balance" onClick={() => onNavigateToTab('finance')}>
              <span className="text-title font-semibold text-ink tabular">
                {rupees(financeSummary?.net_worth ?? 0)}
              </span>
            </RailCard>
          </div>

          <div style={step(5)}>
            <RailCard label="Spent today" onClick={() => onNavigateToTab('finance')}>
              <span className="text-title font-semibold text-ink tabular">
                {rupees(financeSummary?.today_spend ?? 0)}
              </span>
            </RailCard>
          </div>

          {weather && (
            <div style={step(6)}>
              <RailCard label="Outside">
                <div className="flex items-center gap-2">
                  {weather.rain_probability > 30 ? (
                    <CloudRain className="w-5 h-5 text-ink-3 shrink-0" />
                  ) : (
                    <Sun className="w-5 h-5 text-ink-3 shrink-0" />
                  )}
                  <span className="text-title font-semibold text-ink tabular">
                    {Math.round(weather.temperature)}°
                  </span>
                </div>
                <div className="text-meta text-ink-3 mt-1">{weather.condition}</div>
              </RailCard>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
