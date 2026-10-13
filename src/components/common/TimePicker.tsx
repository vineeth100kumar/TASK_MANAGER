import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Clock } from 'lucide-react';
import { Popover } from './Popover';
import { DatePicker } from './DatePicker';
import { formatTime } from '../../utils/reminders';
import { useIsMobile } from '../../hooks/useIsMobile';

const pad = (n: number) => String(n).padStart(2, '0');
const isTime = (v: string | null | undefined): v is string => !!v && /^\d{2}:\d{2}$/.test(v);

/** Reads what people type for a time: "9", "930", "9:30", "9.30pm", "9p", "21:15", "noon". */
export function parseTypedTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  if (t === 'noon' || t === 'midday') return '12:00';
  if (t === 'midnight') return '00:00';
  const m = t.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(a|am|p|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3]?.[0];
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'p' && h < 12) h += 12;
    if (mer === 'a' && h === 12) h = 0;
  } else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

const QUICK = [
  { label: '9 am', value: '09:00' },
  { label: 'Noon', value: '12:00' },
  { label: '6 pm', value: '18:00' },
  { label: '9 pm', value: '21:00' },
];

// Type a time or pick from a list of quarter hours; the list opens scrolled to
// the chosen time (or the next quarter hour from now).
export function TimePanel({ value, onPick, onClear, step = 15, autoFocus = true }: {
  value: string;
  onPick: (time: string) => void;
  onClear?: () => void;
  step?: number;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const slots = useMemo(() => {
    const out: string[] = [];
    for (let m = 0; m < 24 * 60; m += step) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    if (isTime(value) && !out.includes(value)) out.push(value);
    return out.sort();
  }, [step, value]);

  useEffect(() => {
    const now = new Date();
    const mins = Math.ceil((now.getHours() * 60 + now.getMinutes()) / step) * step;
    const target = isTime(value) ? value : `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-time="${target}"]`) ?? listRef.current?.querySelector<HTMLElement>('[data-time]');
    if (el && listRef.current) listRef.current.scrollTop = el.offsetTop - listRef.current.clientHeight / 2 + el.offsetHeight / 2;
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, []);

  const commit = () => {
    const t = parseTypedTime(draft);
    if (t) onPick(t); else setBad(true);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-time]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  return (
    <div className="w-full md:w-[15rem] p-3">
      <input ref={inputRef} value={draft} inputMode="text" placeholder={isTime(value) ? formatTime(value) : 'Type a time, e.g. 9:30pm'}
        aria-label="Type a time" aria-invalid={bad || undefined}
        onChange={e => { setDraft(e.target.value); setBad(false); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus() ?? listRef.current?.querySelector<HTMLElement>('[data-time]')?.focus(); }
        }}
        className={`field !min-h-9 !py-1.5 !text-[13.5px] ${bad ? '!border-red-400 animate-[shake_300ms]' : ''}`} />
      {bad && <p className="mt-1 px-1 text-[11.5px] font-medium text-red-500">Try 9, 9:30, 930pm or 21:15</p>}
      <div className="grid grid-cols-4 gap-1 mt-2">
        {QUICK.map(q => (
          <button key={q.value} type="button" onClick={() => onPick(q.value)} title={formatTime(q.value)}
            className={`picker-chip !px-0 justify-center ${value === q.value ? 'is-on' : ''}`}>{q.label}</button>
        ))}
      </div>
      <div ref={listRef} role="listbox" aria-label="Times" onKeyDown={onListKey}
        style={{ maskImage: 'linear-gradient(transparent, #000 14px, #000 calc(100% - 14px), transparent)' }}
        className="relative mt-2 -mx-1 px-1 py-2 h-52 overflow-y-auto custom-scrollbar overscroll-contain">
        {slots.map(t => {
          const on = t === value;
          return (
            <button key={t} type="button" role="option" aria-selected={on} data-time={t} onClick={() => onPick(t)}
              className={`select-option w-full tabular-nums ${on ? 'is-selected is-active' : ''}`}>
              <span className={`flex-1 text-left ${t.endsWith(':00') || on ? '' : 'text-gray-500 dark:text-gray-400'}`}>{formatTime(t)}</span>
              {on && <Check size={15} strokeWidth={2.5} className="shrink-0" aria-hidden />}
            </button>
          );
        })}
      </div>
      {onClear && isTime(value) && (
        <div className="flex justify-end mt-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.08]">
          <button type="button" onClick={onClear} className="text-[12.5px] font-semibold text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 px-2 py-1 rounded-lg">Clear time</button>
        </div>
      )}
    </div>
  );
}

// A time field: shows "9:30 am" and opens TimePanel. Children replace the
// default trigger contents, as with DatePicker.
export function TimePicker({ id, value, onChange, className = '', placeholder = 'Time', disabled, clearable = true, align, icon = true, step, children, 'aria-label': ariaLabel, title }: {
  id?: string;
  value: string | null | undefined;
  onChange: (time: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  align?: 'start' | 'end';
  icon?: boolean;
  step?: number;
  children?: ReactNode;
  'aria-label'?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();
  const v = value || '';
  const pick = (t: string) => { setOpen(false); ref.current?.focus(); if (t !== v) onChange(t); };

  return (
    <>
      <button ref={ref} id={id} type="button" disabled={disabled} title={title} aria-haspopup="dialog" aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}${isTime(v) ? `: ${formatTime(v)}` : ''}` : undefined}
        onClick={() => setOpen(o => !o)} data-open={open || undefined}
        className={children ? className : `select-trigger ${className}`}>
        {children ?? (
          <>
            {icon && <Clock size={15} className="select-chevron shrink-0" aria-hidden />}
            <span className={`flex-1 min-w-0 truncate tabular-nums ${isTime(v) ? '' : 'select-placeholder'}`}>{isTime(v) ? formatTime(v) : placeholder}</span>
          </>
        )}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align={align} label={ariaLabel || 'Pick a time'}>
        <TimePanel value={v} onPick={pick} step={step} autoFocus={!isMobile}
          onClear={clearable ? () => { setOpen(false); onChange(''); } : undefined} />
      </Popover>
    </>
  );
}

// A date and a time side by side, for values like "2026-10-14T09:30". Picking
// a date keeps the time (9 am if there was none); picking a time alone dates it today.
export function DateTimePicker({ value, onChange, className = '', wrapperClassName = '', disabled, clearable = true, defaultTime = '09:00', align, 'aria-label': ariaLabel }: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  className?: string;
  wrapperClassName?: string;
  disabled?: boolean;
  clearable?: boolean;
  defaultTime?: string;
  align?: 'start' | 'end';
  'aria-label'?: string;
}) {
  const v = value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(0, 16) : '';
  const date = v.slice(0, 10);
  const time = v.slice(11, 16);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  return (
    <div className={`flex items-center gap-2 min-w-0 ${wrapperClassName}`}>
      <DatePicker value={date} disabled={disabled} clearable={clearable} align={align} aria-label={ariaLabel ? `${ariaLabel} date` : 'Date'}
        onChange={d => onChange(d ? `${d}T${time || defaultTime}` : '')} className={`flex-1 min-w-0 ${className}`} />
      <TimePicker value={time} disabled={disabled} clearable={false} align={align} aria-label={ariaLabel ? `${ariaLabel} time` : 'Time'}
        onChange={t => onChange(t ? `${date || today()}T${t}` : '')} className={`shrink-0 w-[7.75rem] ${className}`} />
    </div>
  );
}
