import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, CheckCircle2, Plus, Trash2, Target, Sparkles, ChevronRight, Check, X, Play } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem, LifeContext, Project, Area } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { SnoozeMenu } from '../common/SnoozeMenu';
import { useDataChanges } from '../../hooks/useDataChanges';
import { formatDateRange } from '../../utils/dateUtils';
import { SwipeRow, tomorrowMorning } from '../common/SwipeRow';
import { InboxTriage } from './InboxTriage';

interface InboxViewProps {
  lifeContext: LifeContext;
  onSelectTask: (id: string) => void;
}

export function InboxView({ lifeContext, onSelectTask }: InboxViewProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [clarifyingItem, setClarifyingItem] = useState<WorkItem | null>(null);
  const [isTriaging, setIsTriaging] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

  // Clarify Form State
  const [targetType, setTargetType] = useState<string>('task');
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [targetAreaId, setTargetAreaId] = useState<string>('');
  const [targetDueDate, setTargetDueDate] = useState<string>('');
  const [targetPriority, setTargetPriority] = useState<string>('medium');

  const { showToast } = useToast();

  const loadInbox = async () => {
    try {
      const inboxItems = await api.inbox.list(lifeContext);
      setItems(inboxItems);
      const [projs, ars] = await Promise.all([
        api.projects.list(),
        api.areas.list()
      ]);
      setProjects(projs);
      setAreas(ars);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadInbox();
  }, [lifeContext]);
  useDataChanges(loadInbox);

  const startClarify = (item: WorkItem) => {
    setClarifyingItem(item);
    setTargetType(item.type || 'task');
    setTargetProjectId(item.projectId || '');
    setTargetAreaId(item.areaId || '');
    setTargetDueDate(item.dueDate || '');
    setTargetPriority(item.priority || 'medium');
  };

  const handleApplyClarify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clarifyingItem) return;

    try {
      await api.inbox.clarify(clarifyingItem.id, {
        type: targetType,
        entityType: targetType === 'meeting' ? 'event' : targetType === 'reminder' ? 'reminder' : targetType === 'milestone' ? 'milestone' : 'task',
        projectId: targetProjectId || null,
        areaId: targetAreaId || null,
        dueDate: targetDueDate || null,
        priority: targetPriority as any
      });
      showToast('Item organized and moved out of Inbox');
      setClarifyingItem(null);
      loadInbox();
    } catch (err: any) {
      showToast('Failed to organize: ' + err.message, 'error');
    }
  };

  const handleComplete = async (item: WorkItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await api.workItems.transitionStatus(item.id, 'done', item.version);
      showToast('Completed');
      loadInbox();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleFocus = async (item: WorkItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await api.focus.toggle(item.id);
      showToast(item.isFocus ? 'Removed from Focus' : 'Added to Focus');
      loadInbox();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (itemId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await api.workItems.softDelete(itemId);
      showToast('Item deleted');
      loadInbox();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSnoozeTomorrow = async (item: WorkItem) => {
    try {
      await api.snooze.snoozeItem(item.id, tomorrowMorning().toISOString());
      showToast('Snoozed until tomorrow');
      loadInbox();
    } catch (err: any) {
      showToast('Snooze failed: ' + err.message, 'error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 font-sans">
      {/* Header Banner */}
      <div className="hero p-5 md:p-8 rounded-3xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="eyebrow text-blue-600 dark:text-blue-400 mb-2">
            <Inbox size={14} />
            <span>Universal Inbox</span>
          </div>
          <h2 className="text-display text-[26px] md:text-[32px] font-semibold leading-tight">
            {items.length === 0 ? 'Inbox zero' : `${items.length} unclarified item${items.length === 1 ? '' : 's'}`}
          </h2>
          <p className="text-[13.5px] text-gray-500 dark:text-gray-400 mt-1.5">
            Thoughts captured without friction. Clarify when you have time, or keep them here.
          </p>
        </div>

        <div className="flex items-center gap-2">
        {items.length > 0 && (
          <button
            onClick={() => setIsTriaging(true)}
            className="px-4 py-2.5 bg-gradient-to-b from-gray-800 to-gray-950 hover:from-gray-700 hover:to-gray-900 dark:from-white dark:to-gray-200 text-white dark:text-black font-semibold text-[12.5px] rounded-xl shadow-sm shadow-black/20 ring-1 ring-inset ring-white/10 dark:ring-black/5 flex items-center gap-2 active:scale-[0.97] transition-all"
          >
            <Play size={13} className="fill-current" /> Process inbox
          </button>
        )}
        <button 
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: 'n' });
            window.dispatchEvent(event);
          }}
          className="px-4 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-500 hover:to-blue-700 text-white font-semibold text-[12.5px] rounded-xl shadow-sm shadow-blue-600/25 ring-1 ring-inset ring-white/15 hidden md:flex items-center gap-2 active:scale-[0.97] transition-all"
        >
          <Plus size={14} /> Add Item (N)
        </button>
        </div>
      </div>

      {/* Inbox Items List */}
      {items.length === 0 ? (
        <div className="text-center py-20 surface rounded-3xl border border-black/5 dark:border-white/5 space-y-3 stagger">
          <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500 mx-auto flex items-center justify-center">
            <CheckCircle2 size={24} />
          </div>
          <h3 className="text-[17px] font-semibold tracking-tight text-gray-900 dark:text-white">Your head is clear</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Everything captured has been organized or completed. Press <strong>N</strong> anywhere to add a new item.
          </p>
        </div>
      ) : (
        <div className="space-y-3 stagger">
          {items.map((item) => (
            <motion.div key={item.id} layout>
            <SwipeRow onSwipeRight={() => handleComplete(item)} onSwipeLeft={() => handleSnoozeTomorrow(item)}>
            <div
              className="p-4 rounded-2xl surface-item is-interactive hover:border-blue-200 dark:hover:border-blue-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-3.5 flex-1 min-w-0">
                <button 
                  onClick={(e) => handleComplete(item, e)} 
                  className="check-ring !w-5 !h-5"
                  aria-label="Complete"
                >
                  <Check size={12} strokeWidth={3} />
                </button>

                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => startClarify(item)}>
                  <h4 className="font-semibold text-[14px] tracking-[-0.005em] text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
                    {item.title}
                  </h4>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                    <span>Captured {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {item.dueDate && <span className={`font-semibold ${formatDateRange(null, item.dueDate)?.startsWith('Overdue') ? 'text-red-500' : 'text-blue-500'}`}>· {formatDateRange(null, item.dueDate)}</span>}
                    {item.isFocus && <span className="text-amber-500 font-bold">· In Focus</span>}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                <button 
                  onClick={(e) => handleToggleFocus(item, e)}
                  className={`px-3 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition-colors ${
                    item.isFocus 
                      ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400' 
                      : 'bg-gray-100 dark:bg-white/5 text-gray-500 hover:text-gray-900 dark:hover:text-white'
                  }`}
                  title="Toggle Focus"
                >
                  <Target size={13} />
                  <span>{item.isFocus ? 'In Focus' : '+ Focus'}</span>
                </button>

                <SnoozeMenu itemId={item.id} onSnoozed={() => loadInbox()} />

                <button 
                  onClick={() => startClarify(item)}
                  className="px-3.5 py-1.5 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 font-semibold text-xs rounded-xl flex items-center gap-1 transition-colors"
                >
                  <span>Clarify</span>
                  <ChevronRight size={13} />
                </button>

                <button 
                  onClick={(e) => handleDelete(item.id, e)}
                  className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            </SwipeRow>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {isTriaging && (
          <InboxTriage items={items} onChanged={loadInbox} onClose={() => { setIsTriaging(false); loadInbox(); }} />
        )}
      </AnimatePresence>

      {/* Quick Clarify Modal Drawer */}
      <AnimatePresence>
        {clarifyingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 scrim" onClick={() => setClarifyingItem(null)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#1c1c1e] w-full max-w-lg rounded-3xl shadow-2xl p-6 relative z-10 border border-gray-100 dark:border-white/10 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-500">
                  <Sparkles size={15} />
                  <span>Quick Clarify</span>
                </div>
                <button onClick={() => setClarifyingItem(null)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
              </div>

              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-snug">{clarifyingItem.title}</h3>
              </div>

              <form onSubmit={handleApplyClarify} className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 block mb-2">What is this?</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { id: 'task', label: 'Task' },
                      { id: 'reminder', label: 'Reminder' },
                      { id: 'meeting', label: 'Event' },
                      { id: 'milestone', label: 'Milestone' }
                    ].map(t => (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => setTargetType(t.id)}
                        className={`py-2 rounded-xl text-xs font-semibold transition-all ${
                          targetType === t.id 
                            ? 'bg-blue-600 text-white shadow-sm' 
                            : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 block mb-1.5">Project / Area</label>
                    <select 
                      value={targetProjectId || targetAreaId}
                      onChange={e => {
                        const val = e.target.value;
                        const isProj = projects.some(p => p.id === val);
                        if (isProj) {
                          setTargetProjectId(val);
                          setTargetAreaId('');
                        } else {
                          setTargetAreaId(val);
                          setTargetProjectId('');
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/5 border border-transparent dark:border-white/10 text-xs font-semibold outline-none dark:text-white"
                    >
                      <option value="">No Project (General)</option>
                      <optgroup label="Projects">
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </optgroup>
                      <optgroup label="Life Areas">
                        {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </optgroup>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 block mb-1.5">Target Date</label>
                    <input 
                      type="date"
                      value={targetDueDate}
                      onChange={e => setTargetDueDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/5 border border-transparent dark:border-white/10 text-xs font-semibold outline-none dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
                  <button
                    type="button"
                    onClick={() => setClarifyingItem(null)}
                    className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700"
                  >
                    Keep in Inbox
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 shadow-md"
                  >
                    <Check size={14} /> Organize & Move Out
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
