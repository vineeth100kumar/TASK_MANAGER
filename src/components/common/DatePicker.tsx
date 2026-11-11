import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from './Popover';
import { localDateString, parseLocalDate } from '../../utils/dateUtils';
import { useIsMobile } from '../../hooks/useIsMobile';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number) {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(d.getDate(), last));
  return x;
}
const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}/.test(v);

/** "Tue, Oct 14", with the year when it isn't this year. */
export function formatPickedDate(value: string): string {
  const d = parseLocalDate(value.slice(0, 10));
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

// A month grid with quick picks. Monday first, like the rest of Sage.
export function CalendarPanel({ value, onPick, onClear, min, max, accent = 'blue', autoFocus = true }: {
  value: string;
  onPick: (date: string) => void;
  onClear?: () => void;
  min?: string;
  max?: string;
  accent?: 'blue' | 'orange';
  autoFocus?: boolean;
}) {
  const today = localDateString();
  const [focusDay, setFocusDay] = useState(() => parseLocalDate(isDate(value) ? value.slice(0, 10) : today));
  const month = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusKey = localDateString(focusDay);
  const moved = useRef(false);

  const days = useMemo(() => {
    const lead = (month.getDay() + 6) % 7;
    const start = addDays(month, -lead);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month.getTime()]);
  // Trim a sixth week that is entirely next month.
  const shown = days[35].getMonth() !== month.getMonth() ? days.slice(0, 35) : days;

  useEffect(() => {
    if (!autoFocus && !moved.current) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${focusKey}"]`)?.focus({ preventScroll: true });
  }, [focusKey, autoFocus]);

  const outOfRange = (key: string) => (min && key < min) || (max && key > max);
  const go = (d: Date) => { moved.current = true; setFocusDay(d); };

  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      PageUp: () => addMonths(focusDay, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDay, e.shiftKey ? 12 : 1),
      Home: () => addDays(focusDay, -((focusDay.getDay() + 6) % 7)),
      End: () => addDays(focusDay, 6 - ((focusDay.getDay() + 6) % 7)),
    };
    if (map[e.key]) { e.preventDefault(); go(map[e.key]()); }
  };

  const nextMonday = addDays(parseLocalDate(today), ((8 - new Date().getDay()) % 7) || 7);
  const quick = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: localDateString(addDays(parseLocalDate(today), 1)) },
    { label: 'Next week', value: localDateString(nextMonday) },
  ];
  const sel = accent === 'orange'
    ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/30 hover:bg-orange-500'
    : 'bg-blue-600 text-white shadow-sm shadow-blue-600/30 hover:bg-blue-600 dark:bg-blue-500';
  const ring = accent === 'orange' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400';

  return (
    <div className="w-full md:w-[18.5rem] p-3 select-none">
      <div className="flex items-center justify-between px-1 pb-2">
        <button type="button" onClick={() => go(parseLocalDate(isDate(value) ? value.slice(0, 10) : today))}
          className="text-[14px] font-semibold text-gray-900 dark:text-white tracking-tight px-1.5 py-1 -ml-1.5 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" aria-live="polite">
          {month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </button>
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Previous month" onClick={() => go(addMonths(focusDay, -1))} className="picker-icon-btn"><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next month" onClick={() => go(addMonths(focusDay, 1))} className="picker-icon-btn"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 mb-1" aria-hidden>
        {WEEKDAYS.map(d => <span key={d} className="h-7 grid place-items-center text-[11px] font-semibold text-gray-400 dark:text-gray-500">{d}</span>)}
      </div>
      <div ref={gridRef} role="grid" aria-label={month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} onKeyDown={onKey} className="grid grid-cols-7 gap-y-0.5">
        {shown.map(d => {
          const key = localDateString(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isSel = isDate(value) && value.slice(0, 10) === key;
          const isToday = key === today;
          const off = !!outOfRange(key);
          return (
            <button key={key} type="button" role="gridcell" data-day={key} tabIndex={key === focusKey ? 0 : -1}
              aria-selected={isSel} aria-current={isToday ? 'date' : undefined} disabled={off}
              aria-label={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              onClick={() => onPick(key)}
              className={`relative mx-auto h-9 w-9 md:h-8 md:w-8 rounded-full text-[13px] tabular-nums transition-colors focus-visible:!outline-offset-0
                ${isSel ? `${sel} font-semibold` : isToday ? `${ring} font-semibold hover:bg-black/[0.05] dark:hover:bg-white/[0.08]` : inMonth ? 'text-gray-800 dark:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]' : 'text-gray-300 dark:text-gray-600 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}
                ${off ? 'opacity-30 cursor-not-allowed hover:bg-transparent' : ''}`}>
              {d.getDate()}
              {isToday && !isSel && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-current" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
        {quick.filter(q => !outOfRange(q.value)).map(q => (
          <button key={q.label} type="button" onClick={() => onPick(q.value)}
            className={`picker-chip ${isDate(value) && value.slice(0, 10) === q.value ? 'is-on' : ''}`}>{q.label}</button>
        ))}
        {onClear && isDate(value) && (
          <button type="button" onClick={onClear} className="ml-auto text-[12.5px] font-semibold text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 px-2 py-1 rounded-lg">Clear</button>
        )}
      </div>
    </div>
  );
}

// A date field that opens the calendar above. Pass children to draw your own
// trigger (the Add Item chips do); otherwise it shows the date or placeholder.
export function DatePicker({ id, value, onChange, className = '', placeholder = 'Pick a date', disabled, clearable = true, min, max, accent, align, icon = true, children, 'aria-label': ariaLabel, title }: {
  id?: string;
  value: string | null | undefined;
  onChange: (date: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  min?: string;
  max?: string;
  accent?: 'blue' | 'orange';
  align?: 'start' | 'end';
  icon?: boolean;
  children?: ReactNode;
  'aria-label'?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();
  const v = value || '';
  const pick = (d: string) => { setOpen(false); ref.current?.focus(); if (d !== v.slice(0, 10)) onChange(d); };

  return (
    <>
      <button ref={ref} id={id} type="button" disabled={disabled} title={title} aria-haspopup="dialog" aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}${isDate(v) ? `: ${formatPickedDate(v)}` : ''}` : undefined}
        onClick={() => setOpen(o => !o)} data-open={open || undefined}
        className={children ? className : `select-trigger ${className}`}>
        {children ?? (
          <>
            {icon && <Calendar size={15} className="select-chevron shrink-0" aria-hidden />}
            <span className={`flex-1 min-w-0 truncate tabular-nums ${isDate(v) ? '' : 'select-placeholder'}`}>{isDate(v) ? formatPickedDate(v) : placeholder}</span>
          </>
        )}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align={align} label={ariaLabel || 'Pick a date'}>
        <CalendarPanel value={v} onPick={pick} min={min} max={max} accent={accent} autoFocus={!isMobile}
          onClear={clearable ? () => { setOpen(false); onChange(''); } : undefined} />
      </Popover>
    </>
  );
}
