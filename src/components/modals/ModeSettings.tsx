// ModeSettings - Settings > Modes: Work and Chill.
//
// Work shows everything; Chill shows only personal items and holds work
// reminders until Work mode is back. Auto follows the phone's home/away from
// the Pi's Bluetooth link (raspberry_pi/life_mode.py).

import { Briefcase, Coffee, Home, MapPin } from 'lucide-react';
import { LifeMode, describeLifeMode, setLifeMode, setLifeModeSettings, useLifeMode } from '../../services/lifeMode';
import { useToast } from '../../context/ToastContext';

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-white/20'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function Row({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-gray-900 dark:text-white">{title}</p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400">{detail}</p>
      </div>
      {children}
    </div>
  );
}

const MODES: { id: LifeMode; label: string; detail: string; icon: typeof Briefcase }[] = [
  { id: 'work', label: 'Work', detail: 'Everything shows: work and personal.', icon: Briefcase },
  { id: 'chill', label: 'Chill', detail: 'Only personal. Work is hidden, never deleted, and its reminders wait.', icon: Coffee },
];

export function ModeSettings() {
  const state = useLifeMode();
  const { showToast } = useToast();
  const onPi = state.source !== 'local';

  const run = (p: Promise<void>) => p.catch(() => showToast("Couldn't reach the Pi", 'error'));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {MODES.map(m => {
          const active = state.mode === m.id;
          return (
            <button key={m.id} onClick={() => run(setLifeMode(m.id))} aria-pressed={active}
              className={`text-left p-4 rounded-2xl border transition-colors ${active
                ? (m.id === 'chill' ? 'bg-orange-50 dark:bg-orange-950/30 border-orange-300/70 dark:border-orange-800/60' : 'bg-blue-50 dark:bg-blue-950/30 border-blue-300/70 dark:border-blue-800/60')
                : 'bg-gray-50 dark:bg-white/5 border-black/5 dark:border-white/5 hover:bg-gray-100 dark:hover:bg-white/10'}`}>
              <p className={`flex items-center gap-2 text-[14px] font-semibold ${active ? (m.id === 'chill' ? 'text-orange-700 dark:text-orange-300' : 'text-blue-700 dark:text-blue-300') : 'text-gray-900 dark:text-white'}`}>
                <m.icon size={15} /> {m.label}
              </p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">{m.detail}</p>
            </button>
          );
        })}
      </div>

      <p className="flex items-center gap-2 px-1 text-[12.5px] text-gray-600 dark:text-gray-300">
        {state.home ? <Home size={14} className="shrink-0" /> : <MapPin size={14} className="shrink-0" />}
        Now: {describeLifeMode(state)}.
        {state.held > 0 && ` ${state.held} work ${state.held === 1 ? 'reminder waits' : 'reminders wait'} for Work mode.`}
      </p>

      <Row title="Switch by home and away"
        detail={!onPi ? 'Needs the Pi, which knows when your phone is home.'
          : !state.phoneLink ? "The Pi's phone link is off, so this stays on Work."
          : 'Chill when your phone is home, Work when you leave. Picking a mode by hand lasts until you next arrive or leave.'}>
        <Toggle on={onPi && state.auto} disabled={!onPi} label="Switch by home and away" onChange={on => run(setLifeModeSettings({ auto: on }))} />
      </Row>

      <Row title="Let urgent work through in Chill"
        detail="Reminders for urgent or overdue work still reach you. Everything else waits and arrives as one note when Work mode is back.">
        <Toggle on={state.urgentThrough} disabled={!onPi} label="Let urgent work through in Chill" onChange={on => run(setLifeModeSettings({ urgentThrough: on }))} />
      </Row>
    </div>
  );
}
