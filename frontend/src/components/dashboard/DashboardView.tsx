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
import { isOverdue } from '../../utils/dateHelpers';
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

/** "Yesterday", "4:00 PM", "Fri" — whichever is the useful thing to know. */
const whenLabel = (task: WorkItem): string | null => {
  if (task.start_at) {
    const d = new Date(task.start_at);
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
  const late = isOverdue(task.due_date, task.is_completed);
  const when = whenLabel(task);
  const urgent = task.priority === 'urgent' && !task.is_completed;

  return (
    <div className="row">
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

  const outstanding = todayTasks.filter((t) => !t.is_completed);
  const finished = todayTasks.filter((t) => t.is_completed);

  /*
   * The one thing to do next: the most overdue item, else the most urgent, else
   * the first on the list. This is the single most useful sentence on the
   * screen, so it goes at the top where the masthead used to be.
   */
  const next =
    outstanding.find((t) => isOverdue(t.due_date, t.is_completed)) ??
    outstanding.find((t) => t.priority === 'urgent') ??
    outstanding[0];

  // Whatever is already shown as Next does not repeat in the list below it.
  const rest = outstanding.filter((t) => t.id !== next?.id);

  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  if (isLoading && !performance && !greetingData) {
    return (
      <div className="max-w-2xl mx-auto px-5 pt-3 pb-40 md:pb-16 space-y-6">
        <div className="space-y-2 pt-2">
          <Skeleton variant="text" className="w-32 h-8" />
          <Skeleton variant="text" className="w-40 h-4" />
        </div>
        <Skeleton variant="card" className="h-24 rounded-surface" />
        <div className="space-y-3">
          <Skeleton variant="row" className="h-12" />
          <Skeleton variant="row" className="h-12" />
          <Skeleton variant="row" className="h-12" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-5 pt-3 pb-40 md:pb-16">
      {/* Title */}
      <header className="pt-2">
        <h1 className="screen-title">Today</h1>
        <p className="text-meta text-ink-3 mt-0.5">{dateLine}</p>
      </header>

      {/* Next action — the one lifted surface on the screen, actionable in place */}
      {next && (
        <div className="surface-sunken mt-5 px-4 py-3.5 flex items-start gap-3">
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
                isOverdue(next.due_date, next.is_completed) ? 'Overdue' : whenLabel(next),
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
        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <span className="text-meta text-ink-2 tabular">
              {completed} of {Math.max(planned, todayTasks.length)} done
            </span>
            {streak > 0 && (
              <span className="text-meta text-ink-3 tabular">{streak}-day streak</span>
            )}
          </div>
          <div className="h-[3px] rounded-full bg-hairline overflow-hidden mt-2">
            <div
              className="h-full bg-accent-500 rounded-full transition-[width] duration-500 ease-settle"
              style={{
                width: `${
                  Math.max(planned, todayTasks.length) > 0
                    ? Math.round((completed / Math.max(planned, todayTasks.length)) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* The list */}
      <section className="mt-7">
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
              <ChevronRight className="w-3.5 h-3.5 transition-transform duration-150 group-open:rotate-90" />
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
        Reference, not the point. Money and weather are a line you glance at,
        so they get a line — not two full cards each.
      */}
      <section className="mt-8 pt-5 border-t border-hairline flex flex-wrap gap-x-8 gap-y-4">
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
        <p className="mt-7 text-meta text-ink-3 leading-relaxed">{greetingData.greeting}</p>
      )}
    </div>
  );
};
