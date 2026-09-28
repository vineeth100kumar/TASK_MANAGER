import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Sun, CheckCircle2, Circle, AlertTriangle, Clock, Calendar as CalendarIcon, Target, Activity, Zap, Hourglass, Sparkles, ChevronRight, Check, BrainCircuit } from 'lucide-react';
import { api } from '../../services/api';
import { aiEngine } from '../../services/aiEngine';
import { WorkItem, LifeContext } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { SnoozeMenu } from '../common/SnoozeMenu';

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
  const [isAiLoading, setIsAiLoading] = useState(false);
  // Ask for the briefing once per visit; data refreshes shouldn't re-ask, even after a failure.
  const briefingRequested = useRef(false);
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
      <div className="flex justify-center items-center py-32">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );
  }

  const hour = time.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 font-sans">
      
      {/* 1. Greeting & Hero Atmosphere */}
      <div className={`p-8 rounded-[32px] border border-black/5 dark:border-white/5 relative overflow-hidden flex flex-col md:flex-row items-start md:items-end justify-between gap-6 ${
        lifeContext === 'personal' 
          ? 'bg-gradient-to-br from-orange-100/70 via-amber-50 to-white dark:from-orange-950/30 dark:via-amber-900/10 dark:to-black' 
          : 'bg-gradient-to-br from-blue-50 via-[#f5f5f7] to-white dark:from-blue-950/20 dark:via-[#1c1c1e] dark:to-black'
      }`}>
        <div className="flex-1 w-full">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-2">
            {lifeContext === 'personal' ? <Sun size={15} className="text-orange-500"/> : <Sparkles size={15} className="text-blue-500"/>}
            <span>{lifeContext === 'personal' ? 'Personal Life Space' : 'Work Command Center'}</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight leading-tight mb-4">
            {greeting}.
          </h1>
          
          {/* AI Strategy Briefing */}
          <div className="bg-white/60 dark:bg-black/40 backdrop-blur-md rounded-2xl p-4 border border-black/5 dark:border-white/10 w-full max-w-2xl">
             <div className="flex items-center gap-2 mb-2 text-blue-600 dark:text-blue-400 font-bold text-xs">
                <BrainCircuit size={14} /> <span>Sage AI Strategy</span>
             </div>
             {isAiLoading ? (
                 <div className="flex items-center gap-2 text-gray-500 text-sm font-medium">
                    <Loader2 size={14} className="animate-spin" /> Analyzing your tasks...
                 </div>
             ) : aiBriefing ? (
                 <p className="text-sm text-gray-800 dark:text-gray-200 font-medium leading-relaxed">
                    {aiBriefing.strategyText}
                 </p>
             ) : (
                 <p className="text-sm text-gray-500 italic">Add items to Today's Focus to get an AI strategy.</p>
             )}
          </div>
        </div>

        <div className="text-left md:text-right shrink-0">
          <div className="text-4xl md:text-6xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mt-1">
            {time.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* 2. Needs Attention Ribbon (Overdue & Repeatedly Snoozed - Gentle & Actionable) */}
      {data.needsAttention?.length > 0 && (
        <div className="p-5 rounded-[28px] bg-red-50/70 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
              <AlertTriangle size={15} />
              <span>Needs Attention ({data.needsAttention.length})</span>
            </div>
            <span className="text-[11px] text-gray-400 font-semibold">User decides; never auto-changed</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.needsAttention.slice(0, 4).map((item: WorkItem) => (
              <div key={item.id} className="p-3.5 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-red-100 dark:border-red-900/30 flex items-center justify-between gap-3 shadow-sm">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelectTask(item.id)}>
                  <h4 className="font-bold text-xs text-gray-900 dark:text-white truncate">{item.title}</h4>
                  <span className="text-[10px] text-red-500 font-semibold">
                    {item.dueDate ? `Overdue (${item.dueDate})` : 'Snoozed multiple times'}
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
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Active Focus (Left: 7 cols) */}
        <div className="md:col-span-7 bg-[#f5f5f7] dark:bg-[#1c1c1e] p-6 rounded-[32px] border border-black/5 dark:border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target size={18} className="text-amber-500" />
              <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">Active Focus</h3>
            </div>
            {onNavigateView && (
              <button onClick={() => onNavigateView('focus')} className="text-xs font-bold text-blue-500 hover:underline flex items-center gap-1">
                <span>View Focus Space</span>
                <ChevronRight size={12} />
              </button>
            )}
          </div>

          {(!data.todayFocus || data.todayFocus.length === 0) ? (
            <div className="text-center py-10 bg-white dark:bg-[#2c2c2e] rounded-2xl border border-black/5 dark:border-white/5 space-y-2">
              <Target size={24} className="text-gray-300 mx-auto" />
              <p className="text-xs text-gray-400 font-semibold">No items pinned to focus right now.</p>
              <button 
                onClick={() => onNavigateView && onNavigateView('inbox')}
                className="text-xs text-blue-500 font-bold hover:underline"
              >
                Pick from Inbox →
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.todayFocus.map((item: WorkItem, index: number) => (
                <div key={item.id} className="p-4 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/5 flex items-center justify-between gap-3 shadow-sm hover:border-amber-200 transition-all">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300 font-bold text-[10px] flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>
                    <button onClick={() => handleComplete(item)} className="text-gray-300 hover:text-emerald-500 shrink-0">
                      <Circle size={18} />
                    </button>
                    <span onClick={() => onSelectTask(item.id)} className="font-bold text-xs text-gray-900 dark:text-white truncate cursor-pointer hover:text-amber-500 transition-colors">
                      {item.title}
                    </span>
                  </div>
                  <SnoozeMenu itemId={item.id} onSnoozed={() => loadAttentionData()} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Due Today & Reminders (Right: 5 cols) */}
        <div className="md:col-span-5 bg-[#f5f5f7] dark:bg-[#1c1c1e] p-6 rounded-[32px] border border-black/5 dark:border-white/5 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarIcon size={18} className="text-blue-500" />
            <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">Scheduled for Today</h3>
          </div>

          {(!data.dueToday || data.dueToday.length === 0) && (!data.reminders || data.reminders.length === 0) ? (
            <div className="text-center py-10 bg-white dark:bg-[#2c2c2e] rounded-2xl border border-black/5 dark:border-white/5 space-y-1">
              <CheckCircle2 size={24} className="text-emerald-500 mx-auto mb-2" />
              <p className="text-xs font-bold text-gray-800 dark:text-gray-200">Clear calendar today</p>
              <p className="text-[11px] text-gray-400">No scheduled tasks or reminders due.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.dueToday?.map((item: WorkItem) => (
                <div key={item.id} onClick={() => onSelectTask(item.id)} className="p-3.5 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/5 flex items-center justify-between gap-3 shadow-sm cursor-pointer hover:border-blue-200 transition-colors">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-xs text-gray-900 dark:text-white truncate">{item.title}</h4>
                    <span className="text-[10px] text-blue-500 font-semibold uppercase">{item.entityType}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleComplete(item); }} className="text-gray-300 hover:text-emerald-500 shrink-0">
                    <Circle size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4. Quick Wins & Delegations (Waiting For) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Quick Wins (<=15 min tasks) */}
        <div className="bg-[#f5f5f7] dark:bg-[#1c1c1e] p-6 rounded-[32px] border border-black/5 dark:border-white/5 space-y-3">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-amber-500" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">Quick Wins (≤ 15 min)</h3>
          </div>
          <p className="text-xs text-gray-400">Have 10 minutes free? Knock these out quickly.</p>

          {(!data.quickWins || data.quickWins.length === 0) ? (
            <div className="text-xs text-gray-400 py-4 text-center">No short tasks tagged.</div>
          ) : (
            <div className="space-y-2">
              {data.quickWins.map((item: WorkItem) => (
                <div key={item.id} className="p-3 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shadow-sm">
                  <span onClick={() => onSelectTask(item.id)} className="font-bold text-xs text-gray-900 dark:text-white truncate cursor-pointer hover:text-blue-500">
                    {item.title}
                  </span>
                  <button onClick={() => handleComplete(item)} className="p-1 text-gray-300 hover:text-emerald-500">
                    <Check size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delegated Waiting For Summary */}
        <div className="bg-[#f5f5f7] dark:bg-[#1c1c1e] p-6 rounded-[32px] border border-black/5 dark:border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hourglass size={18} className="text-purple-500" />
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">Waiting For ({data.waitingFor?.length || 0})</h3>
            </div>
            {onNavigateView && (
              <button onClick={() => onNavigateView('waiting_for')} className="text-xs font-bold text-purple-500 hover:underline">
                View All →
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">Awaiting someone else's response.</p>

          {(!data.waitingFor || data.waitingFor.length === 0) ? (
            <div className="text-xs text-gray-400 py-4 text-center">No pending delegations.</div>
          ) : (
            <div className="space-y-2">
              {data.waitingFor.slice(0, 3).map((item: WorkItem) => (
                <div key={item.id} onClick={() => onSelectTask(item.id)} className="p-3 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-purple-500/20 flex items-center justify-between gap-2 shadow-sm cursor-pointer">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-extrabold text-purple-500 uppercase block">{item.waitingFor?.who}</span>
                    <span className="font-bold text-xs text-gray-900 dark:text-white truncate block">{item.waitingFor?.about || item.title}</span>
                  </div>
                  <ChevronRight size={14} className="text-gray-400" />
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* 5. Smart Resurfacing ("You haven't touched this in 14 days") */}
      {data.slippedItems?.length > 0 && (
        <div className="p-5 rounded-[28px] bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            <Clock size={15} />
            <span>Smart Resurfacing</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            You haven't looked at these in over two weeks. Still relevant? Sage suggests; you decide.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {data.slippedItems.map((item: WorkItem) => (
              <div key={item.id} className="p-3.5 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/5 space-y-2 shadow-sm">
                <h4 className="font-bold text-xs text-gray-900 dark:text-white truncate">{item.title}</h4>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleComplete(item)} className="px-2.5 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded-lg hover:bg-emerald-100">
                    Done
                  </button>
                  <SnoozeMenu itemId={item.id} onSnoozed={() => loadAttentionData()} />
                  <button onClick={async () => { await api.workItems.softDelete(item.id); loadAttentionData(); }} className="px-2.5 py-1 text-gray-400 hover:text-red-500 text-[10px] font-bold">
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
          <div className="p-6 rounded-[32px] bg-[#f5f5f7] dark:bg-[#1c1c1e] border border-black/5 dark:border-white/5 space-y-4">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-emerald-500" />
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">Daily Habit Streaks</h3>
            </div>
            <div className="space-y-3">
              {data.habits?.map((habit: any) => (
                <div key={habit.id} className="p-4 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/5 space-y-2 shadow-sm">
                  <div className="flex justify-between items-center text-xs font-bold">
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
                          className={`flex-1 h-7 rounded-lg text-[10px] font-bold uppercase transition-all ${
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
          <div className="p-6 rounded-[32px] bg-[#f5f5f7] dark:bg-[#1c1c1e] border border-black/5 dark:border-white/5 space-y-4">
            <div className="flex items-center gap-2">
              <Target size={18} className="text-blue-500" />
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">Active Goals</h3>
            </div>
            <div className="space-y-3">
              {data.goals?.map((goal: any) => (
                <div key={goal.id} className="p-4 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/5 space-y-2 shadow-sm">
                  <div className="flex justify-between items-center text-xs font-bold">
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
