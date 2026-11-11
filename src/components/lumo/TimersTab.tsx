// The LUMO page's timer and stopwatch. Both run on the Pi, so they keep going
// with this page closed and show on the clock; this page counts along from
// the times the Pi gives it.
import { useEffect, useState } from 'react';
import { Flag, Hourglass, Pause, Play, Plus, RotateCcw, Timer as TimerIcon, X } from 'lucide-react';
import { LumoStopwatch, LumoTimer, duration, lumoApi } from '../../services/lumo';
import { useToast } from '../../context/ToastContext';
import { Panel, btnPrimary, btnQuiet, selectCls } from './parts';

const PRESETS = [1, 3, 5, 10, 15, 25, 30, 45, 60];

// Re-render about every `ms` while `on`.
function useTick(on: boolean, ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN(n => n + 1), ms);
    return () => clearInterval(id);
  }, [on, ms]);
}

function Ring({ fraction, children, tone }: { fraction: number; children: React.ReactNode; tone: string }) {
  const r = 46, c = 2 * Math.PI * r;
  return (
    <div className="relative w-56 h-56 md:w-64 md:h-64 mx-auto">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="3" className="stroke-black/[0.06] dark:stroke-white/10" />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="3" strokeLinecap="round" className={`${tone} transition-[stroke-dashoffset] duration-300`}
          stroke="currentColor" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, fraction)))} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">{children}</div>
    </div>
  );
}

export function TimersTab({ timer, stopwatch, enabled, onChange }: {
  timer: LumoTimer | null; stopwatch: LumoStopwatch | null; enabled: boolean; onChange: () => void;
}) {
  const { showToast } = useToast();
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); onChange(); } catch (e: any) { showToast(e.message, 'error'); }
  };

  if (!enabled) {
    return (
      <div className="surface rounded-3xl border border-black/5 dark:border-white/5 py-14 px-6 text-center space-y-2">
        <Hourglass size={30} className="mx-auto text-gray-300 dark:text-gray-600" />
        <p className="text-[14px] text-gray-500 max-w-md mx-auto">The timer and stopwatch run in the desk clock's part of Sage, which is off on this Pi. Set SAGE_DESK=1 and restart Sage to use them.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
      <TimerPanel timer={timer} run={run} />
      <StopwatchPanel stopwatch={stopwatch} run={run} />
    </div>
  );
}

function TimerPanel({ timer, run }: { timer: LumoTimer | null; run: (fn: () => Promise<unknown>) => void }) {
  const [h, setH] = useState(0);
  const [m, setM] = useState(5);
  const [s, setS] = useState(0);
  const [label, setLabel] = useState('');
  const state = timer?.state ?? 'idle';
  useTick(state === 'running' || state === 'done', 250);

  const left = state === 'running' && timer?.endsAt ? Math.max(0, (timer.endsAt - Date.now()) / 1000) : timer?.remaining ?? 0;
  const total = timer?.total || 1;
  const start = (seconds: number) => run(() => lumoApi.timer('start', seconds, label.trim()));
  const custom = h * 3600 + m * 60 + s;
  const num = (v: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));

  return (
    <Panel icon={<Hourglass size={16} className="text-amber-500" />} title="Timer" note={timer?.label || undefined}>
      {state === 'idle' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {PRESETS.map(p => (
              <button key={p} onClick={() => start(p * 60)}
                className="surface-item rounded-2xl py-3 text-center hover:ring-2 hover:ring-amber-500/40 active:scale-95 transition-transform">
                <div className="text-[20px] font-semibold tabular-nums text-gray-900 dark:text-white leading-none">{p}</div>
                <div className="text-[11px] font-medium text-gray-400 mt-1">min</div>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-gray-500">Or set your own</div>
            <div className="flex items-end gap-2 flex-wrap">
              {([['h', h, setH, 23], ['min', m, setM, 59], ['s', s, setS, 59]] as const).map(([unit, v, setV, max]) => (
                <label key={unit} className="flex items-baseline gap-1">
                  <input type="number" inputMode="numeric" min={0} max={max} value={v} onChange={e => setV(num(e.target.value, max))}
                    className={`${selectCls} w-16 text-center text-[18px] font-semibold tabular-nums`} aria-label={unit} />
                  <span className="text-[12px] text-gray-400">{unit}</span>
                </label>
              ))}
            </div>
            <input value={label} maxLength={24} onChange={e => setLabel(e.target.value)} placeholder="Label (optional), like Pasta"
              className={`${selectCls} w-full`} />
            <button onClick={() => start(custom)} disabled={custom < 1} className={`${btnPrimary} w-full !bg-amber-500 hover:!bg-amber-600 !shadow-amber-500/25`}>
              <Play size={15} /> Start {custom ? duration(custom) : ''}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <Ring fraction={state === 'done' ? 0 : left / total} tone={state === 'done' ? 'text-red-500' : 'text-amber-500'}>
            {state === 'done' ? (
              <>
                <div className="text-[13px] font-semibold uppercase tracking-wider text-red-500">Time's up</div>
                <div className="text-[44px] font-semibold tabular-nums tracking-[-0.03em] text-gray-900 dark:text-white animate-pulse">0:00</div>
              </>
            ) : (
              <>
                <div className="text-[13px] font-medium text-gray-400">{state === 'paused' ? 'Paused' : timer?.label || 'Timer'}</div>
                <div className={`text-[48px] md:text-[54px] font-semibold tabular-nums tracking-[-0.03em] leading-none ${state === 'paused' ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>{duration(Math.ceil(left))}</div>
                <div className="text-[12px] text-gray-400 mt-2">of {duration(total)}</div>
              </>
            )}
          </Ring>
          <div className="flex justify-center gap-2 flex-wrap">
            {state === 'done' ? (
              <button onClick={() => run(() => lumoApi.timer('cancel'))} className={btnPrimary}><X size={15} /> Stop</button>
            ) : (
              <>
                <button onClick={() => run(() => lumoApi.timer(state === 'running' ? 'pause' : 'resume'))} className={`${btnPrimary} !bg-amber-500 hover:!bg-amber-600 !shadow-amber-500/25 min-w-28`}>
                  {state === 'running' ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Resume</>}
                </button>
                <button onClick={() => run(() => lumoApi.timer('add', 60))} className={btnQuiet}><Plus size={15} /> 1 min</button>
                <button onClick={() => run(() => lumoApi.timer('cancel'))} className={btnQuiet}><X size={15} /> Cancel</button>
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function StopwatchPanel({ stopwatch, run }: { stopwatch: LumoStopwatch | null; run: (fn: () => Promise<unknown>) => void }) {
  const running = !!stopwatch?.running;
  useTick(running, 50);
  const elapsed = running && stopwatch?.startedAt ? (Date.now() - stopwatch.startedAt) / 1000 : stopwatch?.elapsed ?? 0;
  const laps = stopwatch?.laps || [];
  const done = laps.reduce((a, b) => a + b, 0);
  const current = elapsed - done;
  const best = laps.length > 1 ? Math.min(...laps) : -1, worst = laps.length > 1 ? Math.max(...laps) : -1;

  return (
    <Panel icon={<TimerIcon size={16} className="text-teal-500" />} title="Stopwatch">
      <div className="py-6 text-center">
        <div className={`text-[56px] md:text-[64px] font-semibold tabular-nums tracking-[-0.04em] leading-none ${running || !elapsed ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
          {duration(elapsed, true)}
        </div>
        {laps.length > 0 && <div className="text-[13px] text-gray-400 mt-2 tabular-nums">Lap {laps.length + 1}: {duration(current, true)}</div>}
      </div>
      <div className="flex justify-center gap-2">
        <button onClick={() => run(() => lumoApi.stopwatch(running ? 'pause' : 'start'))}
          className={`${btnPrimary} !bg-teal-600 hover:!bg-teal-700 !shadow-teal-600/25 min-w-28`}>
          {running ? <><Pause size={15} /> Pause</> : <><Play size={15} /> {elapsed ? 'Carry on' : 'Start'}</>}
        </button>
        <button onClick={() => run(() => lumoApi.stopwatch('lap'))} disabled={!running} className={btnQuiet}><Flag size={15} /> Lap</button>
        <button onClick={() => run(() => lumoApi.stopwatch('reset'))} disabled={running || !elapsed} className={btnQuiet}><RotateCcw size={15} /> Reset</button>
      </div>
      {laps.length > 0 && (
        <ol className="divide-y divide-black/5 dark:divide-white/5 max-h-72 overflow-y-auto custom-scrollbar">
          {laps.map((t, i) => ({ t, i })).reverse().map(({ t, i }) => (
            <li key={i} className={`flex justify-between py-2 text-[14px] tabular-nums ${t === best ? 'text-emerald-600 dark:text-emerald-400' : t === worst ? 'text-red-500' : 'text-gray-700 dark:text-gray-200'}`}>
              <span>Lap {i + 1}</span><span className="font-semibold">{duration(t, true)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
