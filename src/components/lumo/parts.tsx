// Small pieces the LUMO tabs share: panels, switches, sliders, segmented
// choices, and the settings the page saves to the Pi.
import { ReactNode, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { LumoSettings, LumoSettingsUpdate, lumoApi } from '../../services/lumo';
import { useToast } from '../../context/ToastContext';

export function Panel({ icon, title, note, right, children, className = '' }: { icon?: ReactNode; title: string; note?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-4 ${className}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">{title}</h3>
          {note && <span className="text-[12px] font-medium text-gray-400 truncate">{note}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={`relative w-11 h-[26px] rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-white/20'}`}>
      <span className={`absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : ''}`} />
    </button>
  );
}

// A labelled row: what it is on the left, the control on the right.
export function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-gray-900 dark:text-white">{title}</div>
        {hint && <div className="text-[12px] text-gray-500 dark:text-gray-400">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
  value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  return (
    <div className="flex flex-wrap p-1 rounded-xl bg-black/[0.04] dark:bg-white/5 gap-0.5" role="radiogroup">
      {options.map(o => (
        <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={`flex-1 min-w-fit px-2.5 ${size === 'sm' ? 'py-1 text-[12px]' : 'py-1.5 text-[13px]'} rounded-lg font-semibold transition-colors ${value === o.id ? 'bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// A slider that saves when you let go, not on every step.
export function Slider({ value, min, max, onCommit, label, format }: {
  value: number; min: number; max: number; onCommit: (v: number) => void; label: string; format?: (v: number) => string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <div className="flex items-center gap-3 w-full">
      <input type="range" min={min} max={max} value={v} aria-label={label}
        onChange={e => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit}
        style={{ '--fill': `${((v - min) / (max - min || 1)) * 100}%` } as CSSProperties}
        className="flex-1" />
      <span className="w-12 text-right text-[13px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">{format ? format(v) : v}</span>
    </div>
  );
}

export const selectCls = 'px-3 py-2 rounded-xl bg-black/[0.04] dark:bg-white/5 border border-black/5 dark:border-white/10 text-[14px] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40';
export const btn = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-[13.5px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none';
export const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/25`;
export const btnQuiet = `${btn} surface-item text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white`;
export const btnDanger = `${btn} text-red-600 hover:bg-red-500/10`;

// The clock's settings, loaded from the Pi and saved a change at a time. A
// change shows at once and goes back if the Pi refuses it.
export function useLumoSettings() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<LumoSettings | null>(null);
  const [error, setError] = useState('');
  const latest = useRef<LumoSettings | null>(null);
  latest.current = settings;

  const load = useCallback(async () => {
    try {
      setSettings(await lumoApi.settings());
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (update: LumoSettingsUpdate) => {
    const before = latest.current;
    if (before) setSettings(merge(before, update));
    try {
      setSettings(await lumoApi.saveSettings(update));
    } catch (e: any) {
      setSettings(before);
      showToast(`Couldn't save that: ${e.message}`, 'error');
    }
  }, [showToast]);

  return { settings, error, save, reload: load };
}

function merge<T>(base: T, update: any): T {
  if (Array.isArray(update) || typeof update !== 'object' || update === null) return update as T;
  const out: any = { ...(base as any) };
  for (const [k, v] of Object.entries(update)) out[k] = merge((base as any)?.[k], v);
  return out;
}
