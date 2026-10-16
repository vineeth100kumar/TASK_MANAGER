import { Star } from 'lucide-react';
import { WorkItem } from '../../services/types';
import { formatDateRange } from '../../utils/dateUtils';
import { withTime, formatClock } from '../../utils/reminders';
import { isOverdue, isSnoozedNow, planDay } from '../../utils/taskLists';
import { CompleteButton } from './CompleteButton';
import { ContextTag } from './ContextTag';
import { SnoozeMenu } from './SnoozeMenu';

const PRIORITY_STYLE: Record<string, { bar: string; label: string; text: string }> = {
  urgent: { bar: 'bg-red-500', label: 'Urgent', text: 'text-red-600 dark:text-red-400' },
  high: { bar: 'bg-orange-500', label: 'High', text: 'text-orange-600 dark:text-orange-400' },
  medium: { bar: 'bg-blue-400/70', label: '', text: '' },
  low: { bar: 'bg-gray-300 dark:bg-gray-600', label: 'Low', text: 'text-gray-400' }
};

const KIND: Record<string, string> = { reminder: 'Reminder', event: 'Event', milestone: 'Milestone' };

function whenLabel(item: WorkItem, today: string): string | null {
  if (item.startAt && planDay(item) === today) return formatClock(item.startAt);
  if (item.dueDate) return withTime(formatDateRange(null, item.dueDate), item.dueTime);
  if (item.startAt) return formatDateRange(item.startAt, null);
  if (item.startDate) return formatDateRange(item.startDate, null);
  return null;
}

function snoozeLabel(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const day = sameDay ? '' : d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ';
  return `Snoozed till ${day}${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
}

interface TaskRowProps {
  item: WorkItem;
  today: string;
  combined: boolean;          // show the Personal tag (All view)
  completing: boolean;
  saving: boolean;
  onComplete: () => void;
  onOpen: () => void;
  onStar: () => void;
  onSnoozed: () => void;
  extra?: React.ReactNode;    // e.g. a Clarify button in the Inbox
}

// One task, the same everywhere: tick, priority stripe, title, then where it
// belongs and when it's due on one quiet line.
export function TaskRow({ item, today, combined, completing, saving, onComplete, onOpen, onStar, onSnoozed, extra }: TaskRowProps) {
  const p = PRIORITY_STYLE[item.priority] || PRIORITY_STYLE.medium;
  const overdue = isOverdue(item, today);
  const when = whenLabel(item, today);
  const home = item.project?.name || item.area?.name || null;
  const snoozed = isSnoozedNow(item);

  return (
    <div className={`relative has-[[aria-expanded=true]]:z-30 pl-4 pr-3 py-3 rounded-2xl surface-item is-interactive flex items-center gap-3 group ${completing ? 'is-completing' : ''} ${snoozed ? 'opacity-70' : ''}`}>
      <span className={`absolute left-1.5 top-3 bottom-3 w-1 rounded-full ${p.bar}`} aria-hidden />
      <CompleteButton checked={completing} saving={saving} onComplete={onComplete} />
      <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
        <p className="row-title font-semibold text-[13.5px] text-gray-900 dark:text-white truncate">{item.title || 'Untitled'}</p>
        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5 text-[11px] font-medium text-gray-400">
          {p.label && <span className={`font-semibold ${p.text}`}>{p.label}</span>}
          {when && <span className={overdue ? 'text-red-500 font-semibold' : ''}>{p.label ? '· ' : ''}{when}</span>}
          {home && <span>{p.label || when ? '· ' : ''}{home}</span>}
          {KIND[item.entityType] && <span>· {KIND[item.entityType]}</span>}
          {item.status === 'in_progress' && <span className="text-blue-500 font-semibold">· In progress</span>}
          {item.waitingFor?.who ? <span className="text-purple-500 font-semibold">· Waiting on {item.waitingFor.who}</span>
            : item.status === 'blocked' && <span className="text-purple-500 font-semibold">· Blocked</span>}
          {snoozed && item.snoozedUntil && <span className="text-amber-600 dark:text-amber-400 font-semibold">· {snoozeLabel(item.snoozedUntil)}</span>}
          <ContextTag item={item} combined={combined} />
        </div>
      </div>
      {extra}
      <button
        onClick={(e) => { e.stopPropagation(); onStar(); }}
        className={`p-1.5 rounded-lg shrink-0 transition-colors ${item.isFocus ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600 hover:text-amber-500 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100'}`}
        title={item.isFocus ? 'Starred (Focus). Tap to unstar' : 'Star to keep it on Today'}
        aria-label={item.isFocus ? 'Unstar' : 'Star'}
        aria-pressed={!!item.isFocus}
      >
        <Star size={16} className={item.isFocus ? 'fill-current' : ''} />
      </button>
      {/* Always shown: a hover-only clock was invisible on phones and easy to miss on desktop. */}
      <SnoozeMenu itemId={item.id} onSnoozed={onSnoozed} className="shrink-0" />
    </div>
  );
}
