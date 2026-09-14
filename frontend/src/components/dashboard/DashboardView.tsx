import React from 'react';
import { 
  Sun, 
  CloudRain, 
  ArrowUpRight, 
  CheckSquare, 
  Wallet, 
  PenTool,
  Sparkles,
  CheckCircle2,
  TrendingUp
} from 'lucide-react';
import { DailyPerformance, AiGreetingResponse, FinanceSummary, WorkItem, WeatherData } from '../../types';
import { Skeleton } from '../common/Skeleton';
import { APP_VERSION } from '../../version';
import {
  Clipping,
  ClipRule,
  SectionEyebrow,
  Hed,
  TapeStrip,
  TornEdge,
  Dateline,
  ScoreBar,
  TaskClipping,
  LedgerRow,
} from '../newspaper';

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
    year: 'numeric',
  }).toUpperCase();

  // Dynamic Editorial Headline Generator
  const getEditorialHeadline = () => {
    if (tasksPlanned === 0 && tasksCompleted === 0) {
      return 'Morning Docket Open: Strategic Objectives Await Confirmation';
    }
    if (score === 100) {
      return 'Complete Clearance: All Scheduled Objectives Successfully Dispatched';
    }
    if (score >= 80) {
      return `${score}% of Strategic Targets Secured as Performance Reaches Record Stride`;
    }
    if (score >= 50) {
      return 'Midday Progress: Over Half of Priority Objectives Executed';
    }
    return 'Operations Underway: Critical Milestones Slated for Resolution';
  };

  if (isLoading && !performance && !greetingData) {
    return (
      <div className="board-bg min-h-screen p-4 sm:p-6 md:p-8 animate-in fade-in max-w-7xl mx-auto">
        <div className="clipping p-6 space-y-4 shadow-sm mb-4">
          <Skeleton variant="text" className="w-48 h-3 bg-stone-300" />
          <Skeleton variant="text" className="w-3/4 h-12 bg-stone-300" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-ink-rule">
            <Skeleton variant="card" className="h-48 bg-stone-200" />
            <Skeleton variant="card" className="h-48 bg-stone-200" />
            <Skeleton variant="card" className="h-48 bg-stone-200" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="board-bg min-h-screen p-3 sm:p-5 md:p-8 relative max-w-7xl mx-auto pb-24 md:pb-16 select-text transition-colors duration-300">
      
      {/* Decorative Scotch Tape Strips (Anchoring Clippings to Cork Board) */}
      <TapeStrip rotate={-3} className="top-2 left-[15%] hidden sm:block z-10" />
      <TapeStrip rotate={2} className="top-2 right-[18%] hidden sm:block z-10" />
      <TapeStrip rotate={-5} className="top-[180px] -left-2 hidden lg:block z-10" />
      <TapeStrip rotate={6} className="top-[220px] -right-2 hidden lg:block z-10" />
      <TapeStrip rotate={-2} className="bottom-24 left-[10%] hidden md:block z-10" />
      <TapeStrip rotate={3} className="bottom-28 right-[12%] hidden md:block z-10" />

      {/* 1. MASTHEAD CLIPPING (Full Width Anchor) */}
      <Clipping variant="white" rotate={0} className="mb-4 sm:mb-5 shadow-sm relative overflow-hidden" padding="p-4 sm:p-6">
        {/* Torn Top Accent */}
        <TornEdge position="top" className="mb-2" />

        {/* Header Metadata Bar */}
        <div className="flex flex-wrap justify-between items-center text-[9px] sm:text-[10px] font-ledger text-ink-muted border-b border-ink-rule pb-1.5 mb-3 gap-y-1">
          <div className="font-bold">VOL. II &bull; RPi5 &bull; {APP_VERSION}</div>
          <div className="tracking-[0.18em] uppercase font-semibold">EDITION: PRIVATE SUBSCRIBER DISPATCH</div>
          <Dateline>{todayDateStr}</Dateline>
          <div className="hidden sm:block">PRICE: FREE &bull; TIME VALUED</div>
        </div>

        {/* Masthead Headline */}
        <header className="text-center py-2 sm:py-3">
          <div className="text-[9px] sm:text-[10px] font-ledger uppercase tracking-[0.28em] text-ink-amber font-bold mb-1">
            THE PERSONAL RECORD & OPERATING DISPATCH OF VINEETH KUMAR
          </div>
          <h1 className="font-masthead text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-ink-primary uppercase leading-none my-1">
            The Sage Daily
          </h1>
          <ClipRule variant="double" className="my-2.5" />
          <div className="flex flex-wrap justify-between items-center text-[10px] sm:text-[11px] font-editorial italic text-ink-muted px-1 gap-y-1">
            <span>&ldquo;All the Priorities, Dispatches & Ledgers Fit to Execute&rdquo;</span>
            <span className="hidden md:inline font-ledger uppercase tracking-wider not-italic text-[9px] text-ink-faint">
              SYSTEM: RASPBERRY PI 5 &bull; WAL ACTIVE &bull; ZERO TELEMETRY
            </span>
            <span>INTELLIGENCE &bull; PURPOSE &bull; CALM FOCUS</span>
          </div>
        </header>

        {/* Torn Bottom Accent */}
        <TornEdge position="bottom" className="mt-2" />
      </Clipping>

      {/* 2. TOP ROW: SCORE + TOP STORY + WEATHER (3 Columns) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 mb-4 sm:mb-5 items-start">
        
        {/* Score Clipping (4 cols on desktop) */}
        <Clipping variant="aged" rotate={0.8} className="md:col-span-4 shadow-sm flex flex-col justify-between" padding="p-4 sm:p-5">
          <div>
            <SectionEyebrow badge="QUOTIENT">DAILY SCORECARD &bull; METRIC INDEX</SectionEyebrow>
            <div className="border border-ink-rule bg-paper-cream/60 p-4 text-center my-2">
              <div className="text-[9px] font-ledger uppercase tracking-widest text-ink-muted font-bold">
                PRODUCTIVITY QUOTIENT
              </div>
              <div className="font-editorial text-5xl sm:text-6xl font-black text-ink-primary tracking-tight my-1">
                {tasksPlanned > 0 ? score : '--'}<span className="text-2xl font-normal text-ink-muted">{tasksPlanned > 0 ? '%' : ''}</span>
              </div>
              <div className="text-[11px] font-editorial italic text-ink-muted">
                {tasksCompleted} of {tasksPlanned} Objectives Secured
              </div>
              <ScoreBar value={score} showTicks={true} className="mt-3" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 border-t border-b border-ink-rule py-2.5 text-center mt-3">
            <div>
              <div className="text-[8px] font-ledger text-ink-faint uppercase font-bold">STREAK</div>
              <div className="font-editorial text-lg font-bold text-ink-primary">
                {streak} <span className="text-[8px] font-ledger font-normal text-ink-muted">DAYS</span>
              </div>
            </div>
            <div className="border-x border-ink-rule">
              <div className="text-[8px] font-ledger text-ink-faint uppercase font-bold">FOCUS</div>
              <div className="font-editorial text-lg font-bold text-ink-primary">{focusMinutes}m</div>
            </div>
            <div>
              <div className="text-[8px] font-ledger text-ink-faint uppercase font-bold">DOCKET</div>
              <div className="font-editorial text-lg font-bold text-ink-amber">
                {tasksPlanned - tasksCompleted > 0 ? `${tasksPlanned - tasksCompleted}` : 'CLEAR'}
              </div>
            </div>
          </div>

          <div className="mt-3 pt-2 text-[9px] font-ledger text-ink-faint flex justify-between items-center">
            <span>STATUS: <strong className="text-ink-primary uppercase">{score >= 80 ? 'OPTIMAL PACE' : 'ACTIVE INNINGS'}</strong></span>
            <span>#EXECUTIVE</span>
          </div>
        </Clipping>

        {/* Top Story Clipping (5 cols on desktop) */}
        <Clipping variant="white" rotate={-1.2} className="md:col-span-5 shadow-sm space-y-3" padding="p-4 sm:p-5">
          <SectionEyebrow badge="COMMUNIQUÉ">SPECIAL EXECUTIVE DISPATCH</SectionEyebrow>
          
          <Hed size="md" level={2} className="text-ink-primary leading-tight">
            {getEditorialHeadline()}
          </Hed>

          <p className="text-xs sm:text-sm font-editorial italic text-ink-muted border-l-2 border-ink-primary pl-3 py-1 bg-paper-cream/40">
            &ldquo;{greetingData?.greeting || getFallbackGreeting()}&rdquo;
          </p>

          <div className="text-[11px] font-editorial text-ink-primary leading-relaxed">
            <span className="font-bold text-ink-primary">BENGALURU — </span>
            Today’s executive output reflects consistent alignment with strategic priorities. With {tasksCompleted} milestones completed out of {tasksPlanned} scheduled items, the focus continuum stands at {streak} consecutive days of measured progress.
          </div>

          {todayTasks.length > 0 && (
            <div className="pt-2 border-t border-ink-rule">
              <div className="text-[9px] font-ledger uppercase tracking-wider text-ink-faint font-bold mb-1.5">
                CRITICAL HIGHLIGHTS ({Math.min(todayTasks.length, 3)})
              </div>
              <div className="space-y-1">
                {todayTasks.slice(0, 3).map((task) => (
                  <TaskClipping key={task.id} item={task} onToggle={onToggleTask} />
                ))}
              </div>
            </div>
          )}
        </Clipping>

        {/* Weather & Meteorological Wire (3 cols on desktop) */}
        <Clipping variant="cream" rotate={1.5} className="md:col-span-3 shadow-sm space-y-3 flex flex-col justify-between" padding="p-4 sm:p-5">
          <div>
            <SectionEyebrow badge="OPEN-METEO">METEOROLOGICAL WIRE</SectionEyebrow>
            {weather ? (
              <div className="p-3 border border-ink-rule bg-paper-base/60 space-y-2 my-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {weather.rain_probability > 30 ? (
                      <CloudRain className="w-5 h-5 text-blue-700" />
                    ) : (
                      <Sun className="w-5 h-5 text-amber-600" />
                    )}
                    <span className="font-ledger text-2xl font-black text-ink-primary">
                      {Math.round(weather.temperature)}°C
                    </span>
                  </div>
                  <div className="text-right text-[9px] font-ledger text-ink-muted">
                    <div>H: {Math.round(weather.temp_max)}°</div>
                    <div>L: {Math.round(weather.temp_min)}°</div>
                  </div>
                </div>
                <div className="text-xs font-editorial italic text-ink-muted">
                  {weather.condition} &bull; Rain: {weather.rain_probability}%
                </div>
              </div>
            ) : (
              <div className="text-xs font-ledger text-ink-faint py-3 italic">
                Meteorological feed synchronizing with atmospheric wire...
              </div>
            )}
          </div>

          {/* Drafting Room Notice */}
          <div className="border-t border-ink-rule pt-2.5">
            <div className="flex items-center justify-between text-[9px] font-ledger text-ink-muted font-bold uppercase mb-1">
              <span>DRAFTING ROOM</span>
              <PenTool className="w-3 h-3 text-ink-muted" />
            </div>
            <p className="text-[11px] font-editorial text-ink-muted leading-tight">
              Visual drafting board active for freeform sketches and sticky clippings.
            </p>
            <button
              onClick={() => onNavigateToTab('whiteboard')}
              className="mt-2 w-full py-1.5 border border-ink-rule bg-paper-white hover:bg-paper-aged text-[10px] font-ledger uppercase tracking-wider text-ink-primary font-bold transition-colors flex items-center justify-center gap-1"
            >
              <span>Launch Canvas</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </Clipping>

      </div>

      {/* 3. MIDDLE ROW: KANBAN CLIPPINGS + FINANCE LEDGER + TIMELINE WIRE (3 Columns) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 mb-4 sm:mb-5 items-start">
        
        {/* Kanban Clippings (5 cols on desktop) */}
        <Clipping variant="aged" rotate={-1} className="md:col-span-5 shadow-sm space-y-3" padding="p-4 sm:p-5">
          <SectionEyebrow badge={`${todayTasks.filter(t => !t.is_completed).length} PENDING`}>
            CLIPPINGS &bull; TODAY'S ACTIONABLES
          </SectionEyebrow>

          <Hed size="sm" level={3} className="text-ink-primary tracking-tight">
            Priority Docket for Immediate Dispatch
          </Hed>

          <div className="space-y-1 divide-y divide-ink-rule/30">
            {todayTasks.length === 0 ? (
              <div className="border border-ink-rule p-4 text-center text-xs font-editorial italic text-ink-muted">
                No items clipped for today's edition. Use The Wire (Ctrl+B) to draft priority tasks.
              </div>
            ) : (
              todayTasks.slice(0, 6).map((task) => (
                <TaskClipping key={task.id} item={task} onToggle={onToggleTask} />
              ))
            )}
          </div>

          <div className="pt-2">
            <button
              onClick={() => onNavigateToTab('tasks')}
              className="w-full py-2 border border-ink-rule bg-paper-white hover:bg-paper-aged text-xs font-ledger uppercase tracking-wider text-ink-primary font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <span>Open Full Clippings Docket ({todayTasks.length})</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </Clipping>

        {/* Finance Ledger (4 cols on desktop) */}
        <Clipping variant="white" rotate={0.6} className="md:col-span-4 shadow-sm space-y-3 flex flex-col justify-between" padding="p-4 sm:p-5">
          <div>
            <SectionEyebrow badge="BALANCE SHEET">THE FINANCIAL LEDGER</SectionEyebrow>
            
            <div 
              onClick={() => onNavigateToTab('finance')}
              className="border border-ink-rule p-3.5 bg-paper-cream/50 cursor-pointer hover:bg-paper-cream/80 transition-colors my-2"
            >
              <div className="text-[9px] font-ledger uppercase tracking-wider text-ink-muted font-bold">
                NET LIQUID CAPITAL
              </div>
              <div className="font-ledger text-2xl font-black text-ink-primary mt-0.5">
                ₹ {(financeSummary?.net_worth ?? 0).toLocaleString('en-IN')}
              </div>
            </div>

            <div className="space-y-1 border-t border-ink-rule pt-2">
              <LedgerRow
                label="Bank Reserves"
                value={`₹ ${(financeSummary?.total_bank ?? 0).toLocaleString('en-IN')}`}
                sublabel="PRIMARY OPERATING"
              />
              <LedgerRow
                label="Liquid Cash"
                value={`₹ ${(financeSummary?.total_cash ?? 0).toLocaleString('en-IN')}`}
                sublabel="VAULT & ON-HAND"
              />
              <LedgerRow
                label="Today's Recorded Outflow"
                value={`₹ ${(financeSummary?.today_spend ?? 0).toLocaleString('en-IN')}`}
                diff={(financeSummary?.today_spend ?? 0) > 0 ? '-EXPENSE' : 'BALANCED'}
                isPositive={false}
              />
            </div>
          </div>

          <div className="pt-3">
            <button
              onClick={() => onNavigateToTab('finance')}
              className="w-full py-2 border border-ink-rule bg-paper-base hover:bg-paper-aged text-xs font-ledger uppercase tracking-wider text-ink-primary font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <span>View Full Accounts Ledger</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </Clipping>

        {/* The Wire / Timeline Dispatches (3 cols on desktop) */}
        <Clipping variant="cream" rotate={1.8} className="md:col-span-3 shadow-sm space-y-3" padding="p-4 sm:p-5">
          <SectionEyebrow badge="LIVE">THE WIRE &bull; TELEGRAPH</SectionEyebrow>
          
          <TornEdge position="top" className="mb-1" />

          <div className="space-y-2.5 font-ledger text-xs max-h-72 overflow-y-auto pr-1">
            {(!performance?.timeline || performance.timeline.length === 0) ? (
              <div className="border-b border-ink-rule pb-3 space-y-1">
                <div className="text-[9px] text-ink-amber font-bold uppercase tracking-wider">
                  WIRE NOTICE &bull; STANDBY
                </div>
                <p className="font-editorial text-xs text-ink-muted leading-normal">
                  &ldquo;No items checked off yet today. Mark your first objective complete to generate telegraph confirmation.&rdquo;
                </p>
              </div>
            ) : (
              performance.timeline.slice(0, 6).map((item, idx) => (
                <div key={item.id || idx} className="border-b border-ink-rule/40 pb-2 space-y-0.5 last:border-b-0">
                  <div className="text-[8px] text-ink-success font-bold uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    <span>
                      CONFIRMED &bull; {item.completed_at ? new Date(item.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'TODAY'}
                    </span>
                  </div>
                  <p className="font-editorial text-xs text-ink-muted leading-tight line-through">
                    {item.title}
                  </p>
                </div>
              ))
            )}
          </div>

          <TornEdge position="bottom" className="mt-1" />
        </Clipping>

      </div>

      {/* 4. BOTTOM ROW: MILESTONES & DISPATCH IMPRINT */}
      <Clipping variant="white" rotate={0.4} className="shadow-sm" padding="p-4 sm:p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-ink-muted text-xs font-editorial">
          <div className="space-y-1">
            <div className="font-ledger text-[9px] uppercase tracking-wider text-ink-primary font-bold">
              AUTONOMOUS DISPATCH
            </div>
            <p className="leading-relaxed text-[11px]">
              The Sage Daily compiles executive performance metrics, financial balance sheets, and tactical task clippings autonomously from local SQLite databases.
            </p>
          </div>

          <div className="space-y-1 md:border-x border-ink-rule md:px-4">
            <div className="font-ledger text-[9px] uppercase tracking-wider text-ink-primary font-bold">
              PERFORMANCE SPECS
            </div>
            <p className="leading-relaxed text-[11px]">
              Focus continuum: {streak} consecutive days &bull; Focus logged: {focusMinutes} minutes &bull; Completion pace: {score}% &bull; Hardware: Raspberry Pi 5.
            </p>
          </div>

          <div className="space-y-1">
            <div className="font-ledger text-[9px] uppercase tracking-wider text-ink-primary font-bold">
              EDITORIAL IMPRINT
            </div>
            <p className="leading-relaxed text-[11px]">
              Published by Sage Life OS &bull; Hosted locally on Raspberry Pi 5 &bull; No trackers &bull; Zero external cloud dependencies.
            </p>
          </div>
        </div>

        <ClipRule variant="double" className="my-3" />

        <footer className="text-center text-[9px] font-ledger text-ink-faint flex flex-col sm:flex-row justify-between items-center gap-1">
          <div>PUBLISHED AUTONOMOUSLY BY SAGE LIFE OS &bull; HOSTED LOCALLY ON RASPBERRY PI 5</div>
          <div>VOL. II &bull; {APP_VERSION} &bull; ALL RIGHTS RESERVED</div>
        </footer>
      </Clipping>

    </div>
  );
};
