import { WorkItem } from '../../services/types';
import { getTodayString } from '../../utils/dateUtils';
import { compareToday, formatMinutes, isOpen, isOverdue, pickUpNext, totalMinutes } from '../../utils/taskLists';

interface Props { items: WorkItem[]; onSelect: (id: string) => void }

// A project's front page: what to do next and where it stands, in one line.
// Numbers that are zero are left out; with nothing open it says so.
export function ProjectFront({ items, onSelect }: Props) {
  const today = getTodayString();
  const open = items.filter(i => isOpen(i) && i.entityType !== 'milestone').sort(compareToday(today));
  const next = pickUpNext(open);
  const late = open.filter(i => isOverdue(i, today)).length;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const doneWeek = items.filter(i => i.status === 'done' && (i.completedAt || '') >= weekAgo).length;
  const { minutes } = totalMinutes(open);
  const facts = [
    open.length ? '' : 'Nothing open', // the type bar below already counts open items
    late ? `${late} late` : '',
    doneWeek ? `${doneWeek} done this week` : '',
    minutes ? `about ${formatMinutes(minutes)} left` : '',
  ].filter(Boolean);

  return (
    <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      {next && (
        <button onClick={() => onSelect(next.id)} className="surface-item is-interactive rounded-2xl px-4 py-2.5 text-left min-w-0 sm:max-w-md">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Up next</span>
          <span className="block text-[14px] font-semibold text-gray-900 dark:text-white truncate">{next.title || 'Untitled'}</span>
        </button>
      )}
      <p className="text-[13px] text-gray-500 dark:text-gray-400">
        {facts.map((f, i) => <span key={f} className={f.endsWith('late') ? 'text-red-500 font-semibold' : ''}>{i ? ' · ' : ''}{f}</span>)}
      </p>
    </div>
  );
}
