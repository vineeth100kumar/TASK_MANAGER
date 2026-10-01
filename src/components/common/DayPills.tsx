import { WeekDay } from '../../utils/progress';

// The Coral look's week row: weekday over date, today in a white pill, and a
// dot under any day something got done.
export function DayPills({ days }: { days: WeekDay[] }) {
  return (
    <div className="grid grid-cols-7 gap-1 md:max-w-xl">
      {days.map(d => (
        <div key={d.date.toISOString()}
          title={`${d.date.toLocaleDateString('en-US', { weekday: 'long' })}: ${d.count} done`}
          className={`flex flex-col items-center gap-1.5 py-2.5 rounded-full transition-colors ${d.isToday ? 'bg-white text-[#070707]' : ''}`}>
          <span className={`text-[12px] md:text-[13px] ${d.isToday ? 'opacity-70' : 'opacity-75'}`}>{d.date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
          <span className="text-[17px] md:text-[19px] font-semibold tabular-nums leading-none">{d.date.getDate()}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${d.count > 0 ? (d.isToday ? 'bg-[#d95639]' : 'bg-current') : 'bg-transparent'}`} />
        </div>
      ))}
    </div>
  );
}
