import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Sun, Sparkles, Check, BrainCircuit, CalendarCheck, ChevronDown, Moon, Inbox as InboxIcon } from 'lucide-react';
import { api } from '../../services/api';
import { aiEngine } from '../../services/aiEngine';
import { WorkItem, LifeContext } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { useCachedState } from '../../hooks/useCachedState';
import { getTodayString } from '../../utils/dateUtils';
import { isOverdue } from '../../utils/taskLists';
import { HabitTodayCard } from '../habits/HabitViews';
import { countDoneToday, weekActivity } from '../../utils/progress';
import { WeekStrip } from '../common/WeekStrip';
import { useCompletion } from '../../hooks/useCompletion';
import { ProgressRing } from '../common/ProgressRing';
import { CountUp } from '../common/CountUp';
import { Celebrate } from '../common/Celebrate';
import { Fold } from '../common/Fold';
import { TaskRow } from '../common/TaskRow';
import { ReminderPrompt } from '../common/ReminderPrompt';
import { RadarBriefCard } from '../radar/RadarBriefCard';

interface DashboardViewProps {
  workspaceId: string;
  onSelectTask: (id: string) => void;
  lifeContext?: LifeContext;
  onNavigateView?: (view: string) => void;
}

interface TodayData {
  items: WorkItem[];
  snoozed: WorkItem[];
  habits: any[];
  doneToday: number;
  week: any[];
}

// Today is one list: everything overdue, due today, starting today or starred,
// overdue first, then by priority, then by time. No buckets.
export function DashboardView({ onSelectTask, lifeContext, onNavigateView }: DashboardViewProps) {
  const [data, setData] = useCachedState<TodayData | null>(`today-list:${lifeContext || 'all'}`, null);
  const [time, setTime] = useState(new Date());
  const [aiBriefing, setAiBriefing] = useState<any>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  // Ask for the briefing once per visit; data refreshes shouldn't re-ask, even after a failure.
  const briefingRequested = useRef(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const [today, habits] = await Promise.all([api.today.list(lifeContext), api.habits.list()]);
      setData({ ...today, habits, doneToday: countDoneToday(lifeContext), week: weekActivity(lifeContext) });

      if (!briefingRequested.current && today.items.length > 0) {
        briefingRequested.current = true;
        setIsAiLoading(true);
        try {
          const tasksString = JSON.stringify(today.items.slice(0, 8).map(t => ({ id: t.id, title: t.title, priority: t.priority })));
          setAiBriefing(await aiEngine.getDailyBriefing(tasksString));
        } catch (e) {
          console.warn('AI Briefing failed:', e);
        } finally {
          setIsAiLoading(false);
        }
      }
    } catch (e) {
      console.warn('Failed to load Today:', e);
      setData({ items: [], snoozed: [], habits: [], doneToday: 0, week: [] });
    }
  }, [lifeContext, setData]);

  useEffect(() => {
    let day = getTodayString();
    const timer = setInterval(() => {
      setTime(new Date());
      // Left open overnight, Today was still yesterday's.
      if (getTodayString() !== day) { day = getTodayString(); load(); }
    }, 60_000);
    load();
    return () => clearInterval(timer);
  }, [load]);
  useDataChanges(load);

  const { complete: handleComplete, isCompleting, isSaving } = useCompletion(load);

  const handleStar = async (item: WorkItem) => {
    try {
      await api.focus.toggle(item.id);
      if (!item.isFocus && item.isInbox) await api.inbox.clarify(item.id, {});
      load();
    } catch (err: any) {
      showToast(err.message || 'Could not change the star', 'error');
    }
  };

  const handleToggleHabit = async (habitId: string, day: string) => {
    try {
      await api.habits.toggleDay(habitId, day);
      load();
    } catch (err) {
      console.error(err);
    }
  };

  if (!data) {
    return (
      <div className="max-w-6xl mx-auto space-y-4 md:space-y-6" aria-busy="true" aria-label="Loading Today">
        <div className="skeleton h-44 md:h-56" />
        <div className="skeleton h-72" />
      </div>
    );
  }

  const todayIso = getTodayString();
  const items = data.items || [];
  const snoozed = data.snoozed || [];
  const overdueCount = items.filter(i => isOverdue(i, todayIso)).length;

  const doneToday = data.doneToday || 0;
  const remaining = items.length;
  const total = doneToday + remaining;
  const allDone = total > 0 && remaining === 0;

  const hour = time.getHours();
  const greeting = allDone ? 'All done for today' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const daySummary = (() => {
    if (allDone) return `You finished ${doneToday} ${doneToday === 1 ? 'thing' : 'things'} today. Enjoy the rest of it.`;
    if (remaining === 0) return 'Nothing due today. Pick something from the Inbox when you are ready.';
    if (doneToday > 0) return remaining === 1 ? `${doneToday} done. Just one to go.` : `${doneToday} done, ${remaining} to go.`;
    return `${remaining} ${remaining === 1 ? 'thing' : 'things'} for today${overdueCount ? `, ${overdueCount} overdue` : ''}. Start at the top.`;
  })();

  const accent = lifeContext === 'personal' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400';
  const showBriefing = isAiLoading || !!aiBriefing;

  return (
    <div className="max-w-4xl mx-auto space-y-4 md:space-y-6 pb-20 font-sans stagger">

      {/* Greeting and today's progress */}
      <div className={`hero ${lifeContext === 'personal' ? 'hero-personal' : ''} p-5 md:p-8 rounded-3xl`}>
        <div className="flex items-center justify-between gap-5">
          <div className="flex-1 min-w-0">
            <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2 md:mb-3">
              {lifeContext === 'personal' ? <Sun size={14} className="text-orange-500"/> : <Sparkles size={14} className="text-blue-500"/>}
              <span>{time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
            </div>
            <h1 className="text-display text-[30px] md:text-[44px] lg:text-[52px] font-semibold leading-[1.05] pb-1">
              {greeting}
            </h1>
            <p className="text-[14.5px] md:text-[15px] text-gray-500 dark:text-gray-400 mt-1 md:mt-1.5">{daySummary}</p>
            {data.week?.length > 0 && <div className="mt-4"><WeekStrip days={data.week} /></div>}
          </div>

          {total > 0 && (
            <div className="relative shrink-0 flex items-center justify-center">
              <div className="md:hidden"><ProgressRing done={doneToday} total={total} size={64} stroke={6} tone={lifeContext === 'personal' ? 'personal' : 'work'} /></div>
              <div className="hidden md:block"><ProgressRing done={doneToday} total={total} size={112} stroke={9} tone={lifeContext === 'personal' ? 'personal' : 'work'} /></div>
              <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                {allDone ? (
                  <Celebrate distance={46}><Check className="text-emerald-500 w-6 h-6 md:w-9 md:h-9" strokeWidth={3} /></Celebrate>
                ) : (
                  <>
                    <span className="text-[17px] md:text-[28px] font-semibold tracking-tight tabular-nums text-gray-900 dark:text-white"><CountUp value={doneToday} from={0} /><span className="text-gray-400 font-normal">/{total}</span></span>
                    <span className="hidden md:block text-[11px] font-medium text-gray-400 mt-1">done</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* AI briefing: only takes space when there's something to read. */}
        {showBriefing && (
          <div className="mt-4 md:mt-5 rounded-2xl p-4 w-full max-w-2xl bg-white/70 dark:bg-white/[0.04] backdrop-blur-md ring-1 ring-black/[0.06] dark:ring-white/[0.08] shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
             <div className={`flex items-center gap-2 mb-1.5 font-semibold text-[12px] ${accent}`}>
                <BrainCircuit size={14} /> <span>Sage AI Strategy</span>
             </div>
             {isAiLoading ? (
                 <div className="space-y-2 pt-1" aria-label="Analyzing your tasks">
                    <div className="skeleton h-3 w-11/12 !rounded-full" />
                    <div className="skeleton h-3 w-2/3 !rounded-full" />
                 </div>
             ) : (
                 <p className="text-[14px] text-gray-800 dark:text-gray-200 leading-relaxed animate-[rise_400ms_var(--ease-out-expo)]">
                    {aiBriefing.strategyText}
                 </p>
             )}
          </div>
        )}
      </div>

      <ReminderPrompt />

      {/* The one list */}
      <section className="surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-3" aria-label="Today's tasks">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarCheck size={18} className="text-blue-500" />
            <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Today</h3>
            <span className="text-[12px] font-semibold text-gray-400 tabular-nums">{items.length}</span>
          </div>
          <span className="hidden sm:inline text-[12px] text-gray-400">Overdue first, then priority, then time</span>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center text-center py-8 gap-2">
            {doneToday > 0 ? (
              <Celebrate><div className="w-11 h-11 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 flex items-center justify-center"><Check size={20} strokeWidth={3} /></div></Celebrate>
            ) : (
              <div className="w-11 h-11 rounded-full bg-gray-100 dark:bg-white/5 text-gray-400 flex items-center justify-center"><CalendarCheck size={20} /></div>
            )}
            <p className="text-[14px] font-semibold text-gray-900 dark:text-white">{doneToday > 0 ? 'Today is clear' : 'Nothing due today'}</p>
            {onNavigateView && (
              <button onClick={() => onNavigateView('inbox')} className="text-[13px] text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-1">
                <InboxIcon size={13} /> See all tasks in the Inbox
              </button>
            )}
          </div>
        ) : (
          <div className="stagger -mb-2">
            <AnimatePresence initial={false}>
              {items.map(item => (
                <Fold key={item.id}>
                  <TaskRow
                    item={item} today={todayIso} combined={!lifeContext}
                    completing={isCompleting(item.id)} saving={isSaving(item.id)}
                    onComplete={() => handleComplete(item)} onOpen={() => onSelectTask(item.id)}
                    onStar={() => handleStar(item)} onSnoozed={load}
                  />
                </Fold>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Snoozed items for today stay one tap away instead of vanishing. */}
        {snoozed.length > 0 && (
          <div className="pt-1">
            <button onClick={() => setShowSnoozed(s => !s)} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-expanded={showSnoozed}>
              <Moon size={13} /> {snoozed.length} snoozed for later
              <ChevronDown size={13} className={`transition-transform ${showSnoozed ? 'rotate-180' : ''}`} />
            </button>
            {showSnoozed && (
              <div className="mt-2 space-y-2">
                {snoozed.map(item => (
                  <TaskRow
                    key={item.id} item={item} today={todayIso} combined={!lifeContext}
                    completing={isCompleting(item.id)} saving={isSaving(item.id)}
                    onComplete={() => handleComplete(item)} onOpen={() => onSelectTask(item.id)}
                    onStar={() => handleStar(item)} onSnoozed={load}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Habits: a fresh entry each day, so a missed day shows as missed instead of carrying over. */}
      {lifeContext !== 'work' && data.habits?.length > 0 && (
        <HabitTodayCard habits={data.habits} today={todayIso} onToggle={handleToggleHabit} />
      )}

      {/* Radar brief: opt-in in Settings > Radar, and work only. */}
      {lifeContext !== 'personal' && onNavigateView && <RadarBriefCard onOpen={() => onNavigateView('radar')} />}
    </div>
  );
}
