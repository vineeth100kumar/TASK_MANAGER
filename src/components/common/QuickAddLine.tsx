import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../services/api';
import { LifeContext } from '../../services/types';
import { parseQuickAdd, formatShortDate } from '../../utils/quickAddParser';
import { useToast } from '../../context/ToastContext';

interface Props { lifeContext?: LifeContext; onAdded: () => void }

// Add in one line: "call mum tomorrow 6pm !high" saves straight to the Inbox.
// The full form is still one keypress away (N).
export function QuickAddLine({ lifeContext, onAdded }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const parsed = text.trim() ? parseQuickAdd(text) : null;
  const hint = parsed && [parsed.date && (parsed.dateLabel || formatShortDate(parsed.date)), parsed.time, parsed.priority, parsed.durationMinutes && `${parsed.durationMinutes}m`].filter(Boolean).join(' · ');

  const save = async () => {
    if (!parsed || busy) return;
    setBusy(true);
    try {
      await api.workItems.create({
        title: parsed.title,
        entityType: parsed.entityType as any,
        priority: (parsed.priority || 'medium') as any,
        dueDate: parsed.date,
        dueTime: parsed.date ? parsed.time : null,
        labels: parsed.tags,
        location: parsed.location,
        repeatRule: parsed.repeatRule,
        estimatedMinutes: parsed.durationMinutes,
        lifeContext: lifeContext === 'personal' ? 'personal' : 'work',
        isInbox: true,
        status: 'todo',
      } as any);
      setText('');
      showToast(`Added "${parsed.title}"`);
      onAdded();
    } catch (e: any) {
      showToast(e.message || 'Could not add', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={e => { e.preventDefault(); save(); }} className="surface rounded-2xl border border-black/5 dark:border-white/5 flex items-center gap-2 px-4 py-2.5">
      <Plus size={16} className="text-gray-400 shrink-0" />
      <input value={text} onChange={e => setText(e.target.value)} disabled={busy}
        placeholder="Add a task… e.g. call mum tomorrow 6pm"
        aria-label="Add a task in one line"
        onKeyDown={e => e.stopPropagation()}
        className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-gray-900 dark:text-white placeholder:text-gray-400" />
      {hint && <span className="hidden sm:inline text-[12px] text-blue-600 dark:text-blue-400 shrink-0">{hint}</span>}
    </form>
  );
}
