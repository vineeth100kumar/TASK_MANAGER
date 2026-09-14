import React from 'react';
import { 
  Sparkles, 
  Clock, 
  Sun, 
  CloudRain, 
  ArrowUpRight, 
  TrendingUp, 
  Wallet, 
  CreditCard, 
  CheckSquare
} from 'lucide-react';
import { DailyPerformance, AiGreetingResponse, FinanceSummary, WorkItem, WeatherData } from '../../types';
import { Skeleton } from '../common/Skeleton';
import { APP_VERSION } from '../../version';

interface DashboardViewProps {
  isLoading?: boolean;
  performance: DailyPerformance | null;
  greetingData: AiGreetingResponse | null;
  weatherData?: WeatherData | null;
  financeSummary: FinanceSummary | null;
  todayTasks: WorkItem[];
  onToggleTask: (task: WorkItem) => void;
  onNavigateToTab: (tab: 'dashboard' | 'tasks' | 'finance' | 'shortcuts') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  isLoading = false,
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
      return `Good ${period}! Your schedule is clear. Use The Wire (Ctrl+B) to draft your priorities.`;
    }
    return `Good ${period}! You have ${tasksPlanned - tasksCompleted} objectives remaining on today's docket.`;
  };

  const todayDateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).toUpperCase();

  // Dynamic Editorial Headline Generator
  const getEditorialHeadline = () => {
    if (tasksPlanned === 0 && tasksCompleted === 0) {
      return "Morning Docket Open: Strategic Objectives Await Confirmation";
    }
    if (score === 100) {
      return "Complete Clearance: All Scheduled Objectives Successfully Dispatched";
    }
    if (score >= 80) {
      return `${score}% of Strategic Targets Secured as Performance Reaches Record Stride`;
    }
    if (score >= 50) {
      return "Midday Progress: Over Half of Priority Objectives Executed";
    }
    return "Operations Underway: Critical Milestones Slated for Resolution";
  };

  if (isLoading && !performance && !greetingData) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in">
        {/* Masthead Skeleton */}
        <div className="p-6 border-2 border-stone-800 bg-[#101013] space-y-4 rounded-none">
          <Skeleton variant="text" className="w-48 h-3" />
          <Skeleton variant="text" className="w-3/4 h-12" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-stone-800">
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto border-2 border-stone-800 bg-[#101013] text-[#e8e6e1] shadow-2xl mb-24 md:mb-12">
      
      {/* TOP EAR / METADATA HEADER */}
      <div className="px-4 py-2 border-b border-stone-800 text-[10px] sm:text-xs font-ledger flex justify-between items-center text-stone-400 bg-[#0c0c0e]">
        <div>VOL. II &bull; {APP_VERSION}</div>
        <div className="hidden md:block tracking-widest uppercase">EDITION: PRIVATE SUBSCRIBER DISPATCH</div>
        <div>{todayDateStr}</div>
        <div>PRICE: FREE &bull; TIME VALUED</div>
      </div>

      {/* MASTHEAD BANNER */}
      <header className="px-4 sm:px-8 py-5 text-center border-b border-stone-800">
        <div className="text-[10px] font-ledger uppercase tracking-[0.3em] text-amber-500 mb-1">
          THE PERSONAL RECORD & OPERATING DISPATCH OF VINEETH KUMAR
        </div>
        <h1 className="font-masthead text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-stone-100 uppercase">
          The Sage Daily
        </h1>
        <div className="my-3 py-1 double-rule flex justify-between items-center text-[11px] font-editorial italic text-stone-400">
          <span>"All the Priorities, Dispatches & Ledgers Fit to Execute"</span>
          <span className="hidden sm:inline font-ledger uppercase tracking-wider not-italic text-[9px] text-stone-500">
            SYSTEM: RASPBERRY PI 5 &bull; WAL ACTIVE
          </span>
          <span>INTELLIGENCE &bull; PURPOSE &bull; CALM FOCUS</span>
        </div>
      </header>

      {/* LEAD STORY & SCORECARD BANNER */}
      <section className="border-b border-stone-800 grid grid-cols-1 lg:grid-cols-12">
        
        {/* MAIN EDITORIAL STORY (8 COLS) */}
        <div className="lg:col-span-8 p-5 sm:p-6 lg:border-r border-stone-800 space-y-4">
          <div className="flex items-center space-x-2 text-[10px] font-ledger uppercase tracking-widest text-amber-500">
            <span className="inline-block w-2 h-2 bg-amber-500"></span>
            <span>SPECIAL EXECUTIVE COMMUNIQUÉ &bull; SAGE INTELLIGENCE</span>
          </div>
          
          <h2 className="font-editorial text-2xl sm:text-4xl font-bold tracking-tight text-stone-100 leading-[1.12]">
            {getEditorialHeadline()}
          </h2>
          
          <p className="text-sm sm:text-base font-editorial italic text-stone-300 border-l-2 border-amber-600 pl-4 py-1">
            "{greetingData?.greeting || getFallbackGreeting()}"
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-editorial text-stone-300 leading-relaxed pt-1">
            <p className="drop-cap">
              BENGALURU — Today’s executive output reflects consistent alignment with strategic priorities. With {tasksCompleted} milestones completed out of {tasksPlanned} scheduled items, the focus continuum stands at {streak} consecutive days of measured progress.
            </p>
            <p>
              {focusMinutes > 0 
                ? `A total of ${focusMinutes} deliberate focus minutes have been successfully logged. Cognitive momentum remains primed for deep-work throughput.`
                : "No focus blocks recorded yet this morning. Initiate a focused drafting session or check off pending clippings to activate the tracking ledger."}
            </p>
          </div>

          <div className="pt-3 border-t border-stone-800 flex flex-wrap items-center justify-between text-[10px] font-ledger text-stone-400">
            <div>FILED UNDER: #EXECUTIVE &bull; #LIFE-OS</div>
            <div className="flex items-center space-x-2">
              <span>STATUS:</span>
              <span className="text-amber-500 font-bold">{score >= 80 ? 'OPTIMAL PACE' : 'ACTIVE INNINGS'}</span>
            </div>
          </div>
        </div>

        {/* EDITORIAL METRIC BOX: HEADLINE NUMBER (4 COLS) */}
        <div className="lg:col-span-4 p-5 sm:p-6 bg-[#0e0e11] flex flex-col justify-between space-y-5">
          <div>
            <div className="text-[10px] font-ledger uppercase tracking-widest text-stone-400 border-b border-stone-800 pb-2 mb-3">
              DAILY SCORECARD &bull; METRIC INDEX
            </div>
            
            <div className="text-center py-4 border border-stone-800 bg-[#141418]">
              <div className="text-[10px] font-ledger uppercase tracking-widest text-stone-400">PRODUCTIVITY QUOTIENT</div>
              <div className="font-editorial text-6xl sm:text-7xl font-bold text-amber-500 tracking-tight my-1">
                {tasksPlanned > 0 ? score : '--'}<span className="text-3xl text-stone-400">{tasksPlanned > 0 ? '%' : ''}</span>
              </div>
              <div className="text-[11px] font-editorial italic text-stone-300">
                {tasksCompleted} of {tasksPlanned} Objectives Secured
              </div>
            </div>
          </div>

          {/* TRI-METRIC LEDGER */}
          <div className="grid grid-cols-3 gap-2 border-t border-b border-stone-800 py-3 text-center">
            <div>
              <div className="text-[9px] font-ledger text-stone-400 uppercase">STREAK</div>
              <div className="font-editorial text-lg sm:text-xl font-bold text-stone-100">{streak} <span className="text-[9px] font-ledger font-normal text-stone-500">DAYS</span></div>
            </div>
            <div className="border-x border-stone-800">
              <div className="text-[9px] font-ledger text-stone-400 uppercase">FOCUS</div>
              <div className="font-editorial text-lg sm:text-xl font-bold text-stone-100">{focusMinutes}m</div>
            </div>
            <div>
              <div className="text-[9px] font-ledger text-stone-400 uppercase">DOCKET</div>
              <div className="font-editorial text-lg sm:text-xl font-bold text-amber-400">
                {tasksPlanned - tasksCompleted > 0 ? `${tasksPlanned - tasksCompleted}` : 'CLEAR'}
              </div>
            </div>
          </div>

          {/* WEATHER DISPATCH DESK */}
          <div className="border border-stone-800 p-3 bg-[#111114]">
            <div className="text-[9px] font-ledger uppercase text-stone-400 mb-2 flex justify-between">
              <span>METEOROLOGICAL WIRE</span>
              <span className="text-amber-500">OPEN-METEO</span>
            </div>
            {weather ? (
              <div className="flex items-center justify-between text-xs font-ledger">
                <div className="flex items-center space-x-2">
                  {weather.rain_probability > 30 ? (
                    <CloudRain className="w-4 h-4 text-blue-400" />
                  ) : (
                    <Sun className="w-4 h-4 text-amber-400" />
                  )}
                  <span className="font-bold text-stone-100">{Math.round(weather.temperature)}°C</span>
                  <span className="text-stone-400">{weather.condition}</span>
                </div>
                <div className="text-[10px] text-stone-400">
                  H:{Math.round(weather.temp_max)}° L:{Math.round(weather.temp_min)}°
                </div>
              </div>
            ) : (
              <div className="text-xs font-ledger text-stone-500">Weather feed synchronizing...</div>
            )}
          </div>

        </div>
      </section>

      {/* 3-COLUMN BROADSHEET BODY */}
      <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-stone-800">
        
        {/* COLUMN 1: CLIPPINGS (TODAY'S PRIORITIES) - 5 COLS */}
        <section className="md:col-span-5 p-5 space-y-4">
          <div className="border-b-2 border-stone-800 pb-2 flex justify-between items-baseline">
            <h3 className="font-editorial text-xl font-bold text-stone-100 tracking-tight uppercase">
              Clippings & Actionables
            </h3>
            <span className="text-[10px] font-ledger text-stone-400">
              {todayTasks.filter(t => !t.is_completed).length} PENDING
            </span>
          </div>

          <div className="space-y-2.5">
            {todayTasks.length === 0 ? (
              <div className="border border-stone-800 p-6 text-center text-xs font-editorial italic text-stone-400">
                No items clipped for today's edition. Use The Wire (Ctrl+B) to draft priority tasks.
              </div>
            ) : (
              todayTasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  onClick={() => onToggleTask(task)}
                  className={`border border-stone-800 p-3 transition-colors cursor-pointer ${
                    task.is_completed ? 'bg-stone-900/40 border-stone-800/60 opacity-70' : 'bg-[#131317] hover:bg-[#18181e]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start space-x-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={task.is_completed}
                        onChange={() => onToggleTask(task)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 rounded-none accent-amber-500 cursor-pointer shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[9px] font-ledger uppercase tracking-wider mb-0.5 text-stone-400">
                          [{task.priority?.toUpperCase()} &bull; {task.estimated_minutes ? `${task.estimated_minutes}M` : '15M'}]
                        </div>
                        <p className={`font-editorial text-sm font-semibold tracking-tight text-stone-100 ${task.is_completed ? 'line-through text-stone-500 italic' : ''}`}>
                          {task.title}
                        </p>
                      </div>
                    </div>
                    <span className={`text-[9px] font-ledger px-1.5 py-0.5 border shrink-0 rounded-none uppercase ${
                      task.priority === 'urgent'
                        ? 'bg-rose-950 text-rose-300 border-rose-800'
                        : task.priority === 'high'
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : 'bg-stone-900 text-stone-400 border-stone-800'
                    }`}>
                      {task.priority}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-2">
            <button
              onClick={() => onNavigateToTab('tasks')}
              className="w-full py-2 border border-stone-700 text-xs font-ledger uppercase tracking-wider text-stone-300 hover:bg-stone-800 transition-colors"
            >
              Open Full Clippings Docket ({todayTasks.length}) →
            </button>
          </div>
        </section>

        {/* COLUMN 2: THE FINANCIAL LEDGER - 4 COLS */}
        <section className="md:col-span-4 p-5 space-y-4">
          <div className="border-b-2 border-stone-800 pb-2 flex justify-between items-baseline">
            <h3 className="font-editorial text-xl font-bold text-stone-100 tracking-tight uppercase">
              The Financial Ledger
            </h3>
            <span className="text-[10px] font-ledger text-stone-400">BALANCE SHEET</span>
          </div>

          {/* NET LIQUIDITY CARD */}
          <div 
            onClick={() => onNavigateToTab('finance')}
            className="border border-stone-800 p-3.5 bg-[#0d0d10] cursor-pointer hover:border-stone-700 transition-colors"
          >
            <div className="text-[10px] font-ledger uppercase tracking-wider text-stone-400">NET LIQUID CAPITAL</div>
            <div className="font-ledger text-2xl font-bold text-stone-100 mt-1">
              ₹ {(financeSummary?.net_worth ?? 0).toLocaleString('en-IN')}
            </div>
            <div className="flex justify-between text-[10px] font-ledger text-stone-400 border-t border-stone-800 pt-2 mt-2">
              <span>BANK: <span className="text-stone-200 font-bold">₹{(financeSummary?.total_bank ?? 0).toLocaleString('en-IN')}</span></span>
              <span>CASH: <span className="text-stone-200 font-bold">₹{(financeSummary?.total_cash ?? 0).toLocaleString('en-IN')}</span></span>
            </div>
          </div>

          {/* TODAY'S OUTFLOW */}
          <div className="border border-stone-800 p-3 bg-[#131317]">
            <div className="flex justify-between items-center text-xs font-ledger">
              <span className="text-stone-400 uppercase text-[10px]">TODAY'S RECORDED OUTFLOW:</span>
              <span className="text-rose-400 font-bold">
                ₹ {(financeSummary?.today_spend ?? 0).toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => onNavigateToTab('finance')}
              className="w-full py-2 border border-stone-700 text-xs font-ledger uppercase tracking-wider text-stone-300 hover:bg-stone-800 transition-colors"
            >
              View Full Accounts Ledger →
            </button>
          </div>
        </section>

        {/* COLUMN 3: THE WIRE & ACCOMPLISHMENTS - 3 COLS */}
        <section className="md:col-span-3 p-5 space-y-4 bg-[#0d0d10]">
          <div className="border-b-2 border-stone-800 pb-2 flex justify-between items-baseline">
            <h3 className="font-editorial text-xl font-bold text-stone-100 tracking-tight uppercase">
              The Wire
            </h3>
            <span className="text-[10px] font-ledger text-amber-500 animate-pulse">● LIVE DISPATCH</span>
          </div>

          {/* COMPLETED TIMELINE DISPATCHES */}
          <div className="space-y-3 font-ledger text-xs text-stone-300 max-h-80 overflow-y-auto">
            {(!performance?.timeline || performance.timeline.length === 0) ? (
              <div className="border-b border-stone-800 pb-3 space-y-1">
                <div className="text-[9px] text-amber-500 font-bold">WIRE NOTICE &bull; STANDBY</div>
                <p className="font-editorial text-xs text-stone-400 leading-normal">
                  "No items checked off yet today. Mark your first objective complete to generate telegraph confirmation."
                </p>
              </div>
            ) : (
              performance.timeline.slice(0, 6).map((item, idx) => (
                <div key={item.id || idx} className="border-b border-stone-800 pb-2.5 space-y-0.5">
                  <div className="text-[9px] text-emerald-400 font-bold uppercase">
                    CONFIRMED &bull; {item.completed_at ? new Date(item.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'TODAY'}
                  </div>
                  <p className="font-editorial text-xs text-stone-200 leading-normal line-through">
                    {item.title}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="pt-2">
            <div className="border border-stone-800 p-3 bg-[#131317]">
              <div className="text-[9px] font-ledger uppercase text-stone-400">DRAFTING ROOM NOTICE</div>
              <div className="font-editorial text-sm font-bold text-stone-100 mt-1">
                Vector Canvas Active
              </div>
              <p className="text-[10px] font-editorial text-stone-400 mt-0.5">
                Use drafting board for visual sketches & sticky notes.
              </p>
            </div>
          </div>
        </section>

      </div>

      {/* FOOTER IMPRINT */}
      <footer className="px-6 py-3 border-t-2 border-stone-800 bg-[#0c0c0e] text-center text-[10px] font-ledger text-stone-500 flex flex-col sm:flex-row justify-between items-center gap-2">
        <div>PUBLISHED AUTONOMOUSLY BY SAGE LIFE OS &bull; HOSTED LOCALLY ON RASPBERRY PI 5</div>
        <div>NO TRACKERS &bull; ZERO GRADIENTS &bull; EDITORIAL INTEGRITY</div>
      </footer>

    </div>
  );
};

