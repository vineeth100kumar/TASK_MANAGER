import { WorkItem } from '../../services/types';

// In the combined view, a small tag marks personal items so they stand apart
// from work at a glance. Hidden when the view already shows only one context.
export function ContextTag({ item, combined }: { item: Pick<WorkItem, 'lifeContext'>; combined: boolean }) {
  if (!combined || item.lifeContext !== 'personal') return null;
  return (
    <span className="inline-flex items-center gap-1 shrink-0 text-[10.5px] font-semibold text-orange-600 dark:text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-orange-500" aria-hidden /> Personal
    </span>
  );
}
