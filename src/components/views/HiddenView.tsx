import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Eye, EyeOff, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem } from '../../services/types';
import { useCompletion } from '../../hooks/useCompletion';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { CompleteButton } from '../common/CompleteButton';

interface HiddenViewProps {
  onSelectTask: (id: string) => void;
}

// Hidden tasks: private items no other list, count, board or plan shows. This
// page (behind the password lock in App) is the only place to see them. A
// reminder set on one still comes, as "Hidden task", without its title.
export function HiddenView({ onSelectTask }: HiddenViewProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const { showToast } = useToast();

  const load = async () => {
    try {
      setItems(await api.workItems.hidden());
    } catch (e) {
      console.error(e);
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => { load(); }, []);
  useDataChanges(load);

  const { complete, isCompleting, isSaving } = useCompletion(load);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.workItems.create({ title: title.trim(), entityType: 'task', type: 'task', priority: 'medium', status: 'todo', isHidden: true, isInbox: false });
      setTitle('');
      load();
    } catch (err: any) {
      showToast('Could not add it: ' + err.message, 'error');
    }
  };

  const unhide = async (item: WorkItem) => {
    try {
      await api.workItems.setHidden(item.id, false);
      showToast('Back in your lists', 'success', {
        label: 'Undo',
        onAction: async () => { await api.workItems.setHidden(item.id, true); load(); },
      });
      load();
    } catch (err: any) {
      showToast('Could not unhide it: ' + err.message, 'error');
    }
  };

  const open = items.filter(i => i.status !== 'done');
  const done = items.filter(i => i.status === 'done');

  const row = (item: WorkItem) => (
    <motion.div key={item.id} layout
      className="p-3.5 md:p-4 rounded-2xl surface-item is-interactive flex items-center gap-3 group">
      {item.status !== 'done'
        ? <CompleteButton checked={isCompleting(item.id)} saving={isSaving(item.id)} onComplete={(e) => { e.stopPropagation(); complete(item); }} />
        : <CompleteButton checked onComplete={() => {}} />}
      <button className="min-w-0 flex-1 text-left" onClick={() => onSelectTask(item.id)}>
        <span className={`block font-semibold text-sm leading-snug truncate ${item.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900 dark:text-white'}`}>{item.title}</span>
        {(item.dueDate || item.project) && (
          <span className="flex items-center gap-2 mt-0.5 text-[11.5px] text-gray-500 dark:text-gray-400">
            {item.dueDate && <span className="flex items-center gap-1"><Calendar size={11} />{item.dueDate}{item.dueTime ? ` ${item.dueTime}` : ''}</span>}
            {item.project && <span className="truncate">{item.project.name}</span>}
          </span>
        )}
      </button>
      <button onClick={() => unhide(item)} title="Show it in your lists again"
        className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
        <Eye size={13} /> Unhide
      </button>
    </motion.div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20 font-sans">
      <div className="hero hero-hidden p-5 md:p-8 rounded-3xl">
        <div className="eyebrow text-slate-600 dark:text-slate-300 mb-2">
          <EyeOff size={18} />
          <span>Hidden</span>
        </div>
        <h2 className="text-display text-[26px] md:text-[32px] font-semibold leading-tight">
          {!loaded ? 'Hidden tasks' : open.length === 0 ? 'Nothing hidden' : `${open.length} hidden task${open.length === 1 ? '' : 's'}`}
        </h2>
        <p className="text-[13.5px] text-gray-500 dark:text-gray-400 mt-1.5">
          Kept out of Today, Inbox, every list and the clock. Reminders still come, without the title.
        </p>
        <form onSubmit={add} className="mt-4 flex gap-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a hidden task"
            aria-label="New hidden task"
            className="flex-1 min-w-0 h-10 px-3.5 rounded-xl bg-white/80 dark:bg-white/5 border border-black/5 dark:border-white/10 text-sm outline-none focus:ring-[3px] focus:ring-gray-900/10 dark:focus:ring-white/20" />
          <button type="submit" disabled={!title.trim()}
            className="h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-gray-900 text-white dark:bg-white dark:text-black disabled:opacity-50">
            <Plus size={14} /> Add
          </button>
        </form>
      </div>

      {loaded && items.length === 0 ? (
        <div className="text-center py-16 surface rounded-3xl border border-black/5 dark:border-white/5 space-y-2">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">No hidden tasks</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Open any task and press the eye button to hide it here, or add one above.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 stagger">
          {open.map(row)}
          {done.length > 0 && <p className="pt-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Done</p>}
          {done.map(row)}
        </div>
      )}
    </div>
  );
}
