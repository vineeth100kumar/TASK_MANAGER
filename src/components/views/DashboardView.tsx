import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sun, CheckCircle2, AlertTriangle, Clock, Calendar as CalendarIcon, Target, Activity, Zap, Hourglass, Sparkles, ChevronRight, Check, BrainCircuit } from 'lucide-react';
import { api } from '../../services/api';
import { aiEngine } from '../../services/aiEngine';
import { WorkItem, LifeContext } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { SnoozeMenu } from '../common/SnoozeMenu';
import { formatDateRange } from '../../utils/dateUtils';

const FOCUS_DRAG_TYPE = 'application/x-sage-item';

interface DashboardViewProps {
  workspaceId: string;
  onSelectTask: (id: string) => void;
  lifeContext?: LifeContext;
  onNavigateView?: (view: string) => void;
}

export function DashboardView({ workspaceId, onSelectTask, lifeContext = 'work', onNavigateView }: DashboardViewProps) {
  const [data, setData] = useState<any>(null);
  const [time, setTime] = useState(new Date());
  const [aiBriefing, setAiBriefing] = useState<any>(null);
  const [aiFailed, setAiFailed] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  // Ask for the briefing once per visit; data refreshes shouldn't re-ask, even after a failure.
  const briefingRequested = useRef(false);
  const [isFocusDropActive, setIsFocusDropActive] = useState(false);
  const { showToast } = useToast();

  const loadAttentionData = useCallback(async () => {
    try {
      const summary = await api.attention.getTodayAttention(lifeContext);
      const habits = await api.habits.list();
      const goals = await api.goals.list();
      setData({ ...summary, habits, goals });

      if (!briefingRequested.current && summary.todayFocus && summary.todayFocus.length > 0) {
        briefingRequested.current = true;
        setIsAiLoading(true);
        try {
           const tasksString = JSON.stringify(summary.todayFocus.map((t: any) => ({ id: t.id, title: t.title, priority: t.priority })));
           const briefing = await aiEngine.getDailyBriefing(tasksString);
           setAiBriefing(briefing);
        } catch (e) {
           console.warn('AI Briefing failed:', e);
           setAiFailed(true);
        } finally {
           setIsAiLoading(false);
        }
      }
    } catch (e) {
      console.warn('Failed to load attention data:', e);
      setData({
        needsAttention: [],
        dueToday: [],
        reminders: [],
        todayFocus: [],
        quickWins: [],
        waitingFor: [],
        slippedItems: [],
        inboxCount: 0,
        habits: [],
        goals: []
      });
    }
  }, [lifeContext]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    loadAttentionData();
    return () => clearInterval(timer);
  }, [loadAttentionData]);
  useDataChanges(loadAttentionData);

  const handleComplete = async (item: WorkItem) => {
    try {
      await api.workItems.transitionStatus(item.id, 'done', item.version);
      showToast('Completed');
      loadAttentionData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddToFocus = async (itemId: string) => {
    const item = [...(data?.dueToday || []), ...(data?.quickWins || [])].find((i: WorkItem) => i.id === itemId);
    if (!item || item.isFocus) return;
    try {
      await api.focus.toggle(itemId);
      showToast('Added to Focus');
      loadAttentionData();
    } catch (err: any) {
      showToast('Could not add to Focus: ' + err.message, 'error');
    }
  };

  const handleToggleHabit = async (habitId: string, day: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.habits.toggleDay(habitId, day);
      loadAttentionData();
    } catch (err) {
      console.error(err);
    }
  };

  if (!data) {
    return (
      <div className="max-w-6xl mx-auto space-y-4 md:space-y-6" aria-busy="true" aria-label="Loading Today">
        <div className="skeleton h-44 md:h-56" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="skeleton h-56 lg:col-span-7" />
          <div className="skeleton h-56 lg:col-span-5" />
        </div>
      </div>
    );
  }

  const hasScheduled = data.dueToday?.length > 0;
  const hasQuickWins = data.quickWins?.length > 0;
  const hasWaiting = data.waitingFor?.length > 0;

  const hour = time.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // One line under the greeting that says what the day holds.
  const dayParts = [
    data.todayFocus?.length > 0 && `${data.todayFocus.length} in focus`,
    hasScheduled && `${data.dueToday.length} scheduled`,
    data.needsAttention?.length > 0 && `${data.needsAttention.length} need${data.needsAttention.length === 1 ? 's' : ''} attention`,
  ].filter(Boolean) as string[];
  const daySummary = dayParts.length === 0
    ? 'A clear day. Pick something from your inbox to focus on.'
    : dayParts.length === 1 ? `You have ${dayParts[0]} today.`
    : `You have ${dayParts.slice(0, -1).join(', ')} and ${dayParts[dayParts.length - 1]} today.`;

  const [clockTime, clockPeriod] = (() => {
    const t = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const m = t.match(/^(.*?)\s*([AaPp]\.?\s?[Mm]\.?)$/);
    return m ? [m[1], m[2]] : [t, ''];
  })();
  const [clockHours, clockMinutes] = clockTime.split(':');

  return (
    <div className="max-w-6xl mx-auto space-y-4 md:space-y-6 pb-20 font-sans stagger">
      
      {/* 1. Greeting & Hero Atmosphere */}
      <div className={`hero ${lifeContext === 'personal' ? 'hero-personal' : ''} p-5 md:p-8 rounded-3xl flex flex-col lg:flex-row items-start lg:items-end justify-between gap-6`}>
        <div className="flex-1 w-full min-w-0">
          <div className="eyebrow text-gray-500 dark:text-gray-400 mb-3">
            {lifeContext === 'personal' ? <Sun size={14} className="text-orange-500"/> : <Sparkles size={14} className="text-blue-500"/>}
            <span>{lifeContext === 'personal' ? 'Personal Life Space' : 'Work Command Center'}</span>
          </div>
          <h1 className="text-display text-[34px] md:text-[44px] lg:text-[52px] font-semibold leading-[1.05] pb-1">
            {greeting}
          </h1>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1.5 mb-5">{daySummary}</p>
          
          {/* AI Strategy Briefing */}
          <div className="rounded-2xl p-4 w-full max-w-2xl bg-white/70 dark:bg-white/[0.04] backdrop-blur-md ring-1 ring-black/[0.06] dark:ring-white/[0.08] shadow-[0_1px_2px_rgb(16_24_40/0.04)]">
             <div className={`flex items-center gap-2 mb-1.5 font-semibold text-[12px] ${lifeContext === 'personal' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400'}`}>
                <BrainCircuit size={14} /> <span>Sage AI Strategy</span>
             </div>
             {isAiLoading ? (
                 <div className="space-y-2 pt-1" aria-label="Analyzing your tasks">
                    <div className="skeleton h-3 w-11/12 !rounded-full" />
                    <div className="skeleton h-3 w-2/3 !rounded-full" />
                 </div>
             ) : aiBriefing ? (
                 <p className="text-[14px] text-gray-800 dark:text-gray-200 leading-relaxed animate-[rise_400ms_var(--ease-out-expo)]">
                    {aiBriefing.strategyText}
                 </p>
             ) : aiFailed && data.todayFocus?.length > 0 ? (
                 <p className="text-[13.5px] text-gray-500 dark:text-gray-400">Sage AI couldn't be reached, so there's no strategy for today yet.</p>
             ) : (
                 <p className="text-[13.5px] text-gray-500 dark:text-gray-400">Add items to Today's Focus to get an AI strategy.</p>
             )}
          </div>
        </div>

        <div className="text-left lg:text-right shrink-0">
          <div className="hidden lg:flex items-baseline justify-end gap-2 text-gray-900 dark:text-white" aria-label={time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}>
            <span className="text-[68px] leading-none font-extralight tracking-[-0.045em] tabular-nums">
              {clockHours}<span className="animate-[breathe_2s_ease-in-out_infinite] text-gray-400 dark:text-gray-500">:</span>{clockMinutes}
            </span>
            {clockPeriod && <span className="text-[15px] font-medium text-gray-400 tracking-normal">{clockPeriod}</span>}
          </div>
          <div className="eyebrow lg:justify-end text-gray-400 mt-2">
            {time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* 2. Needs Attention Ribbon (Overdue & Repeatedly Snoozed - Gentle & Actionable) */}
      {data.needsAttention?.length > 0 && (
        <div className="p-5 rounded-3xl bg-red-50/70 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="eyebrow text-red-600 dark:text-red-400">
              <AlertTriangle size={14} />
              <span>Needs Attention</span>
              <span className="tabular-nums opacity-70">{data.needsAttention.length}</span>
            </div>
            <span className="hidden sm:inline text-[12px] text-gray-400">Nothing changes unless you say so</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.needsAttention.slice(0, 4).map((item: WorkItem) => (
              <div key={item.id} className="p-3.5 rounded-2xl surface-item is-interactive border border-red-100 dark:border-red-900/30 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelectTask(item.id)}>
                  <h4 className="font-semibold text-[13px] text-gray-900 dark:text-white truncate">{item.title}</h4>
                  <span className="text-[11px] text-red-500 font-medium">
                    {item.dueDate ? formatDateRange(null, item.dueDate) : `Snoozed ${item.snoozeCount} times`}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleComplete(item)} className="p-1.5 text-gray-300 hover:text-emerald-500 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30" title="Complete">
                    <Check size={14} />
                  </button>
                  <SnoozeMenu itemId={item.id} onSnoozed={() => loadAttentionData()} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Main Grid: Today's Focus & Scheduled Checkpoints */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
        
        {/* Active Focus (drop target: drag items here from Scheduled or Quick Wins) */}
        <div
          onDragOver={(e) => { if (e.dataTransfer.types.includes(FOCUS_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsFocusDropActive(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsFocusDropActive(false); }}
          onDrop={(e) => { e.preventDefault(); setIsFocusDropActive(false); const id = e.dataTransfer.getData(FOCUS_DRAG_TYPE); if (id) handleAddToFocus(id); }}
          className={`${hasScheduled ? 'lg:col-span-7' : 'lg:col-span-12'} surface p-4 md:p-6 rounded-3xl border space-y-4 transition-colors ${isFocusDropActive ? 'border-amber-400 ring-4 ring-amber-400/15 bg-amber-50/60 dark:bg-amber-950/20' : 'border-black/5 dark:border-white/5'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target size={18} className="text-amber-500" />
              <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Active Focus</h3>
              {data.todayFocus?.length > 0 && <span className="text-[12px] font-semibold text-gray-400 tabular-nums">{data.todayFocus.length}</span>}
            </div>
            {onNavigateView && (
              <button onClick={() => onNavigateView('focus')} className="group/link text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-0.5">
                <span>View Focus Space</span>
                <ChevronRight size={13} className="transition-transform group-hover/link:translate-x-0.5" />
              </button>
            )}
          </div>

          {(!data.todayFocus || data.todayFocus.length === 0) ? (
            <div className={`flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 py-5 rounded-2xl border border-dashed text-center transition-colors ${isFocusDropActive ? 'border-amber-400 text-amber-600' : 'border-gray-300/80 dark:border-white/10 text-gray-400'}`}>
              <Target size={18} className="shrink-0" />
              <p className="text-[13px] font-medium">
                {isFocusDropActive ? 'Drop to add to Focus' : hasScheduled ? 'Nothing in Focus yet. Drag an item here from Scheduled.' : 'Nothing in Focus yet.'}
              </p>
              {!isFocusDropActive && (
                <button onClick={() => onNavigateView && onNavigateView('inbox')} className="text-[13px] text-blue-500 font-semibold hover:underline">
                  Pick from Inbox →
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2 stagger">
              {data.todayFocus.map((item: WorkItem, index: number) => (
                <div key={item.id} className="p-3.5 rounded-2xl surface-item is-interactive flex items-center justify-between gap-3 hover:border-amber-200 dark:hover:border-amber-500/30">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300 font-semibold text-[10px] flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>
                    <button onClick={() => handleComplete(item)} className="check-ring" aria-label="Complete">
                      <Check size={11} strokeWidth={3} />
                    </button>
                    <span onClick={() => onSelectTask(item.id)} className="font-semibold text-[13px] text-gray-900 dark:text-white truncate cursor-pointer hover:text-amber-500 transition-colors">
                      {item.title}
                    </span>
                  </div>
                  <SnoozeMenu itemId={item.id} onSnoozed={() => loadAttentionData()} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Due Today (Right: 5 cols). Hidden when empty; see the summary strip below. */}
        {hasScheduled && (
        <div className="lg:col-span-5 surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarIcon size={18} className="text-blue-500" />
            <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Scheduled for Today</h3>
            <span className="text-[12px] font-semibold text-gray-400 tabular-nums">{data.dueToday.length}</span>
          </div>

          <div className="space-y-2 stagger">
            {data.dueToday.map((item: WorkItem) => (
              <div key={item.id}
                draggable={!item.isFocus}
                onDragStart={(e) => { e.dataTransfer.setData(FOCUS_DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = 'move'; }}
                onClick={() => onSelectTask(item.id)}
                className={`p-3.5 rounded-2xl surface-item is-interactive flex items-center justify-between gap-3 cursor-pointer hover:border-blue-200 dark:hover:border-blue-500/30 ${item.isFocus ? '' : 'md:cursor-grab md:active:cursor-grabbing'}`}>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-[13px] text-gray-900 dark:text-white truncate">{item.title}</h4>
                  <span className={`text-[11px] font-medium ${item.isFocus ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>{item.isFocus ? 'In Focus' : item.startAt ? new Date(item.startAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : item.entityType === 'task' ? 'Due today' : item.entityType[0].toUpperCase() + item.entityType.slice(1)}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!item.isFocus && (
                    <button onClick={(e) => { e.stopPropagation(); handleAddToFocus(item.id); }} className="p-1.5 rounded-lg text-gray-300 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors" title="Add to Focus" aria-label="Add to Focus">
                      <Target size={16} />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleComplete(item); }} className="check-ring m-1.5" aria-label="Complete">
                    <Check size={11} strokeWidth={3} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* 4. Quick Wins & Delegations (Waiting For). Each card only shows when it has items. */}
      {(hasQuickWins || hasWaiting) && (
      <div className={`grid grid-cols-1 ${hasQuickWins && hasWaiting ? 'lg:grid-cols-2' : ''} gap-4 md:gap-6`}>
        
        {/* Quick Wins (<=15 min tasks) */}
        {hasQuickWins && (
        <div className="surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-3">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-amber-500" />
            <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Quick Wins (≤ 15 min)</h3>
          </div>
          <p className="text-xs text-gray-400">Have 10 minutes free? Knock these out quickly.</p>

          <div className="space-y-2 stagger">
            {data.quickWins.map((item: WorkItem) => (
              <div key={item.id}
                draggable={!item.isFocus}
                onDragStart={(e) => { e.dataTransfer.setData(FOCUS_DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = 'move'; }}
                className={`p-3 rounded-2xl surface-item is-interactive flex items-center justify-between gap-2 ${item.isFocus ? '' : 'md:cursor-grab md:active:cursor-grabbing'}`}>
                <span onClick={() => onSelectTask(item.id)} className="font-semibold text-[13px] text-gray-900 dark:text-white truncate cursor-pointer hover:text-blue-500">
                  {item.title}
                </span>
                <button onClick={() => handleComplete(item)} className="check-ring m-1" aria-label="Complete">
                  <Check size={11} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* Delegated Waiting For Summary */}
        {hasWaiting && (
        <div className="surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hourglass size={18} className="text-purple-500" />
              <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Waiting For ({data.waitingFor.length})</h3>
            </div>
            {onNavigateView && (
              <button onClick={() => onNavigateView('waiting_for')} className="text-xs font-semibold text-purple-500 hover:underline">
                View All →
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">Awaiting someone else's response.</p>

          <div className="space-y-2 stagger">
            {data.waitingFor.slice(0, 3).map((item: WorkItem) => (
              <div key={item.id} onClick={() => onSelectTask(item.id)} className="p-3 rounded-2xl surface-item is-interactive border border-purple-500/20 flex items-center justify-between gap-2 cursor-pointer">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold text-purple-500 uppercase block">{item.waitingFor?.who}</span>
                  <span className="font-semibold text-[13px] text-gray-900 dark:text-white truncate block">{item.waitingFor?.about || item.title}</span>
                </div>
                <ChevronRight size={14} className="text-gray-400" />
              </div>
            ))}
          </div>
        </div>
        )}

      </div>
      )}

      {/* Empty sections collapse into one quiet line instead of full-size cards. */}
      {(!hasScheduled || !hasQuickWins || !hasWaiting) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[13px] text-gray-400">
          {!hasScheduled && <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-emerald-500" /> Nothing scheduled today</span>}
          {!hasQuickWins && <span className="flex items-center gap-1.5"><Zap size={14} /> No quick wins</span>}
          {!hasWaiting && (
            <button onClick={() => onNavigateView && onNavigateView('waiting_for')} className="flex items-center gap-1.5 hover:text-purple-500 transition-colors">
              <Hourglass size={14} /> Not waiting on anyone
            </button>
          )}
        </div>
      )}

      {/* 5. Smart Resurfacing ("You haven't touched this in 14 days") */}
      {data.slippedItems?.length > 0 && (
        <div className="p-5 rounded-3xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            <Clock size={15} />
            <span>Smart Resurfacing</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            You haven't looked at these in over two weeks. Still relevant? Sage suggests; you decide.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {data.slippedItems.map((item: WorkItem) => (
              <div key={item.id} className="p-3.5 rounded-2xl surface-item is-interactive space-y-2">
                <h4 className="font-semibold text-[13px] text-gray-900 dark:text-white truncate">{item.title}</h4>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleComplete(item)} className="px-2.5 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-semibold rounded-lg hover:bg-emerald-100">
                    Done
                  </button>
                  <SnoozeMenu itemId={item.id} onSnoozed={() => loadAttentionData()} />
                  <button onClick={async () => { await api.workItems.softDelete(item.id); loadAttentionData(); }} className="px-2.5 py-1 text-gray-400 hover:text-red-500 text-[10px] font-semibold">
                    Archive
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Habits & Goals (Life Space) */}
      {lifeContext === 'personal' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Habits */}
          <div className="p-4 md:p-6 rounded-3xl surface border border-black/5 dark:border-white/5 space-y-4">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-emerald-500" />
              <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Daily Habit Streaks</h3>
            </div>
            <div className="space-y-3">
              {data.habits?.map((habit: any) => (
                <div key={habit.id} className="p-4 rounded-2xl surface-item is-interactive space-y-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-gray-900 dark:text-white">{habit.name}</span>
                    <span className="text-gray-400">{habit.streak || 0} days streak</span>
                  </div>
                  <div className="flex gap-1">
                    {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => {
                      const isDone = habit.history?.includes(day);
                      return (
                        <button
                          key={day}
                          onClick={(e) => handleToggleHabit(habit.id, day, e)}
                          className={`flex-1 h-7 rounded-lg text-[10px] font-semibold uppercase transition-all ${
                            isDone ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-white/5 text-gray-400 hover:bg-gray-200'
                          }`}
                        >
                          {day[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Goals */}
          <div className="p-4 md:p-6 rounded-3xl surface border border-black/5 dark:border-white/5 space-y-4">
            <div className="flex items-center gap-2">
              <Target size={18} className="text-blue-500" />
              <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Active Goals</h3>
            </div>
            <div className="space-y-3">
              {data.goals?.map((goal: any) => (
                <div key={goal.id} className="p-4 rounded-2xl surface-item is-interactive space-y-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-gray-900 dark:text-white">{goal.title}</span>
                    <span className="text-blue-500">{goal.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-white/10 rounded-full h-2 overflow-hidden">
                    <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${goal.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
