import React from 'react';
import { 
  Sparkles, 
  Flame, 
  Clock, 
  CheckCircle2, 
  Sun, 
  CloudRain, 
  ArrowUpRight, 
  TrendingUp, 
  Wallet, 
  CreditCard, 
  Coins 
} from 'lucide-react';
import { DailyPerformance, AiGreetingResponse, FinanceSummary, WorkItem, WeatherData } from '../../types';

interface DashboardViewProps {
  performance: DailyPerformance | null;
  greetingData: AiGreetingResponse | null;
  weatherData?: WeatherData | null;
  financeSummary: FinanceSummary | null;
  todayTasks: WorkItem[];
  onToggleTask: (task: WorkItem) => void;
  onNavigateToTab: (tab: 'dashboard' | 'tasks' | 'finance' | 'shortcuts') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  performance,
  greetingData,
  weatherData,
  financeSummary,
  todayTasks,
  onToggleTask,
  onNavigateToTab
}) => {
  const tasksPlanned = performance?.tasks_planned ?? 0;
  const tasksCompleted = performance?.tasks_completed ?? 0;
  const score = tasksPlanned > 0 ? Math.round((tasksCompleted / tasksPlanned) * 100) : (tasksCompleted > 0 ? 100 : 0);
  const streak = performance?.streak_days ?? 0;
  const focusMinutes = performance?.focus_minutes_logged ?? 0;
  const weather = weatherData || greetingData?.weather;

  // Real-time dynamic greeting fallback
  const getFallbackGreeting = () => {
    const hr = new Date().getHours();
    const period = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : hr < 21 ? 'evening' : 'night';
    if (tasksPlanned === 0) {
      return `Good ${period}! Your schedule is clear. Use the AI Brain Dump (Ctrl+K) to plan your priorities.`;
    }
    return `Good ${period}! You have ${tasksPlanned - tasksCompleted} tasks remaining today. Maintain your momentum.`;
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12">
      {/* 1. AI Greeting & Live Weather Card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800/80 p-6 shadow-xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center space-x-2 text-blue-400 text-xs font-semibold tracking-wide uppercase">
              <Sparkles className="w-4 h-4" />
              <span>Sage Executive Intelligence</span>
            </div>
            <h1 className="text-xl md:text-2xl font-semibold text-zinc-100 leading-snug">
              {greetingData?.greeting || getFallbackGreeting()}
            </h1>
          </div>

          {/* Live Weather Widget (Open-Meteo) */}
          {weather ? (
            <div className="flex items-center space-x-4 bg-zinc-800/50 backdrop-blur-md px-4 py-3 rounded-xl border border-zinc-700/50 shrink-0">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                {weather.rain_probability > 30 ? (
                  <CloudRain className="w-6 h-6 text-blue-400" />
                ) : (
                  <Sun className="w-6 h-6 text-amber-400" />
                )}
              </div>
              <div>
                <div className="flex items-baseline space-x-1.5">
                  <span className="text-2xl font-bold text-zinc-100">{Math.round(weather.temperature)}°C</span>
                  <span className="text-xs text-zinc-400 font-medium">{weather.condition}</span>
                </div>
                <div className="flex items-center space-x-2 text-[11px] text-zinc-400">
                  <span>H: {Math.round(weather.temp_max)}° L: {Math.round(weather.temp_min)}°</span>
                  {weather.rain_probability > 0 && (
                    <span className="text-blue-400 font-medium">🌧 {weather.rain_probability}% rain</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center space-x-3 bg-zinc-800/30 px-3 py-2 rounded-xl border border-zinc-800 text-zinc-400 text-xs shrink-0">
              <Sun className="w-4 h-4 text-zinc-500 animate-spin" />
              <span>Connecting weather...</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Today's Performance Metrics & Quick Finance Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Productivity Score Ring */}
        <div className="bg-zinc-900/70 border border-zinc-800/80 p-5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
            <span>Today's Score</span>
            <TrendingUp className={`w-4 h-4 ${score > 0 ? 'text-emerald-400' : 'text-zinc-500'}`} />
          </div>
          <div className="my-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-zinc-100">
              {tasksPlanned > 0 ? `${score}%` : '--'}
            </span>
            <span className={`text-xs font-medium ${score >= 80 ? 'text-emerald-400' : 'text-zinc-400'}`}>
              {tasksPlanned === 0 ? 'No tasks yet' : score >= 80 ? 'Optimal' : 'In Progress'}
            </span>
          </div>
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full rounded-full transition-all duration-500" 
              style={{ width: `${score}%` }} 
            />
          </div>
        </div>

        {/* Task Velocity */}
        <div className="bg-zinc-900/70 border border-zinc-800/80 p-5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
            <span>Tasks Done</span>
            <CheckCircle2 className={`w-4 h-4 ${tasksCompleted > 0 ? 'text-blue-400' : 'text-zinc-500'}`} />
          </div>
          <div className="my-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-zinc-100">{tasksCompleted}</span>
            <span className="text-xs text-zinc-400">/ {tasksPlanned} planned</span>
          </div>
          <p className="text-xs text-zinc-400">
            {tasksPlanned === 0 ? 'No tasks for today' : tasksPlanned - tasksCompleted > 0 ? `${tasksPlanned - tasksCompleted} remaining today` : 'All tasks cleared!'}
          </p>
        </div>

        {/* Focus Time & Streak */}
        <div className="bg-zinc-900/70 border border-zinc-800/80 p-5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
            <span>Focus Time</span>
            <Clock className={`w-4 h-4 ${focusMinutes > 0 ? 'text-purple-400' : 'text-zinc-500'}`} />
          </div>
          <div className="my-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-zinc-100">{focusMinutes}m</span>
            <span className="text-xs text-purple-400 font-medium">{focusMinutes > 0 ? 'Logged' : 'Ready'}</span>
          </div>
          <div className="flex items-center space-x-1.5 text-xs text-zinc-400 font-medium">
            <Flame className={`w-3.5 h-3.5 ${streak > 0 ? 'fill-amber-400 text-amber-400' : 'text-zinc-600'}`} />
            <span className={streak > 0 ? 'text-amber-400' : 'text-zinc-500'}>
              {streak > 0 ? `${streak} Day Streak` : 'Complete task to start streak'}
            </span>
          </div>
        </div>

        {/* Finance Snapshot */}
        <div 
          onClick={() => onNavigateToTab('finance')}
          className="bg-zinc-900/70 border border-zinc-800/80 p-5 rounded-2xl flex flex-col justify-between cursor-pointer hover:border-zinc-700 transition-colors group"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
            <span>Bank & Cash Balance</span>
            <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
          </div>
          <div className="my-3">
            <span className="text-2xl font-bold text-zinc-100">
              ₹{(financeSummary?.net_worth ?? 0).toLocaleString('en-IN')}
            </span>
            <div className="text-[11px] text-zinc-400 mt-0.5 flex space-x-2">
              <span>Bank: ₹{(financeSummary?.total_bank ?? 0).toLocaleString('en-IN')}</span>
              <span>•</span>
              <span>Cash: ₹{(financeSummary?.total_cash ?? 0).toLocaleString('en-IN')}</span>
            </div>
          </div>
          <div className="text-xs text-zinc-400 flex items-center justify-between">
            <span>Today's Spend:</span>
            <span className="font-semibold text-zinc-200">₹{(financeSummary?.today_spend ?? 0).toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* 3. Today's Action Queue & Accomplishment Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Tasks Queue (Left 2 cols) */}
        <div className="lg:col-span-2 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center space-x-2">
              <span>Today's Action Items</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                {todayTasks.filter(t => !t.is_completed).length} pending
              </span>
            </h2>
            <button
              onClick={() => onNavigateToTab('tasks')}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium"
            >
              View All
            </button>
          </div>

          <div className="space-y-2">
            {todayTasks.length === 0 ? (
              <div className="text-center py-8 text-zinc-400 text-xs">
                No items scheduled for today. Capture items using AI Brain Dump!
              </div>
            ) : (
              todayTasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  onClick={() => onToggleTask(task)}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                    task.is_completed
                      ? 'bg-zinc-900/30 border-zinc-800/40 text-zinc-400'
                      : 'bg-zinc-900/80 border-zinc-800/80 hover:border-zinc-700 text-zinc-200'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={task.is_completed}
                      onChange={() => onToggleTask(task)}
                      className="w-4 h-4 rounded text-blue-600 bg-zinc-800 border-zinc-700 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    <div>
                      <p className={`text-xs font-medium ${task.is_completed ? 'line-through' : ''}`}>
                        {task.title}
                      </p>
                      {task.repeat_rule && (
                        <span className="text-[10px] text-blue-400">🔄 {task.repeat_rule}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span
                      className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${
                        task.priority === 'urgent'
                          ? 'bg-red-500/20 text-red-400'
                          : task.priority === 'high'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {task.priority}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Accomplishment Timeline (Right 1 col) */}
        <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-zinc-100 mb-4 flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Completed Today</span>
          </h2>

          <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
            {(!performance?.timeline || performance.timeline.length === 0) ? (
              <div className="text-center py-8 text-zinc-400 text-xs">
                No items checked off yet today. Check off your first task to start your timeline!
              </div>
            ) : (
              performance.timeline.map((item, idx) => (
                <div key={item.id || idx} className="flex items-start space-x-3 text-xs">
                  <div className="w-2 h-2 mt-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-zinc-200 font-medium">{item.title}</p>
                    <p className="text-[10px] text-zinc-400">
                      {item.completed_at ? new Date(item.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Completed today'}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
