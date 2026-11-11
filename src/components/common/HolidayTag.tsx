// A read-only India holiday label (utils/holidays.ts). Not a task: no click,
// no tick, no due state. Gazetted holidays are solid, restricted ones dashed.

import { Holiday, holidayLabel } from '../../utils/holidays';

export function holidayTitle(h: Holiday): string {
  return `${h.name} · ${holidayLabel(h)}${h.moonSighting ? ' · date may move with moon sighting' : ''}`;
}

export function HolidayTag({ holiday, size = 'sm', className = '' }: { holiday: Holiday; size?: 'xs' | 'sm'; className?: string }) {
  const g = holiday.type === 'gazetted';
  return (
    <span title={holidayTitle(holiday)} data-holiday={holiday.type}
      className={`inline-flex items-center gap-1 max-w-full truncate rounded-md font-semibold ${size === 'xs' ? 'text-[11px] px-1.5 py-[2px]' : 'text-[12px] px-2 py-0.5'}
        ${g ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
            : 'border border-dashed border-rose-300 text-rose-600/90 dark:border-rose-400/40 dark:text-rose-300/80'} ${className}`}>
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${g ? 'bg-rose-500' : 'bg-rose-300 dark:bg-rose-400/60'}`} />
      <span className="truncate">{holiday.name}{holiday.moonSighting ? '*' : ''}</span>
    </span>
  );
}
