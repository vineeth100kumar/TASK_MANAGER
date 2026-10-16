import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, CheckCircle2, Plus, Sparkles, ChevronRight, Check, X, Play, ShieldCheck, AlertTriangle, RotateCcw } from 'lucide-react';
import { useCompletion } from '../../hooks/useCompletion';
import { TaskRow } from '../common/TaskRow';
import { Celebrate } from '../common/Celebrate';
import { Fold } from '../common/Fold';
import { timeAgo } from '../../utils/progress';
import { VisibilityCheck } from '../../utils/taskLists';
import { getTodayString } from '../../utils/dateUtils';
import { api } from '../../services/api';
import { WorkItem, LifeContext, Project, Area } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { useCachedState } from '../../hooks/useCachedState';
import { SwipeRow, tomorrowMorning } from '../common/SwipeRow';
import { InboxTriage } from './InboxTriage';
import { Select } from '../common/Select';
import { DatePicker } from '../common/DatePicker';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { HiddenWorkLine } from '../common/HiddenWorkLine';
import { useLifeMode } from '../../services/lifeMode';

interface InboxViewProps {
  lifeContext?: LifeContext;
  onSelectTask: (id: string) => void;
}

export function InboxView({ lifeContext, onSelectTask }: InboxViewProps) {
  const chill = useLifeMode().mode === 'chill';
  // The Inbox lists every open item in every project, area and section.
  const [items, setItems, loaded] = useCachedState<WorkItem[]>(`inbox-all:${lifeContext || 'all'}`, []);
  const [done, setDone] = useState<WorkItem[]>([]);
  const [check, setCheck] = useState<VisibilityCheck | null>(null);
  // Captured but not given a date, project or star yet. Process inbox walks these.
  const [unsorted, setUnsorted] = useState<WorkItem[]>([]);
  const [showDone, setShowDone] = useState(false);
  // Celebrate an empty list only when it was emptied during this visit.
  const hadItems = useRef(false);
  const [clarifyingItem, setClarifyingItem] = useState<WorkItem | null>(null);
  const closeClarify = React.useCallback(() => setClarifyingItem(null), []);
  useEscapeKey(closeClarify, !!clarifyingItem);
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
      const [all, toSort] = await Promise.all([api.inbox.all(lifeContext), api.inbox.list(lifeContext)]);
      if (all.items.length > 0) hadItems.current = true;
      setItems(all.items);
      setDone(all.done);
      setCheck(all.check);
      setUnsorted(toSort);
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

  const { complete: handleComplete, isCompleting, isSaving } = useCompletion(loadInbox);

  const handleStar = async (item: WorkItem) => {
    try {
      await api.focus.toggle(item.id);
      if (!item.isFocus && item.isInbox) await api.inbox.clarify(item.id, {});
      showToast(item.isFocus ? 'Unstarred' : 'Starred. It shows on Today');
      loadInbox();
    } catch (err: any) {
      showToast(err.message || 'Could not change the star', 'error');
    }
  };

  const handleReopen = async (item: WorkItem) => {
    try {
      await api.workItems.updateDetails(item.id, { status: 'todo', completedAt: null } as any);
      showToast('Reopened');
      loadInbox();
    } catch (err: any) {
      showToast('Could not reopen: ' + err.message, 'error');
    }
  };

  const unsortedIds = new Set(unsorted.map(i => i.id));
  const todayIso = getTodayString();
  const projectCount = new Set(items.map(i => i.projectId || i.areaId || 'none')).size;

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
            <span>Inbox · every task</span>
          </div>
          <h2 className="text-display text-[26px] md:text-[32px] font-semibold leading-tight">
            {!loaded ? 'Inbox' : items.length === 0 ? 'Nothing open' : `${items.length} open ${items.length === 1 ? 'task' : 'tasks'}`}
          </h2>
          <p className="text-[13.5px] text-gray-500 dark:text-gray-400 mt-1.5">
            {!loaded ? '\u00a0' : items.length === 0 ? 'Everything is done.' : `Across ${projectCount} ${projectCount === 1 ? 'place' : 'places'}. Overdue first, then by date and priority.`}
          </p>
        </div>

        <div className="flex items-center gap-2">
        {unsorted.length > 0 && (
          <button
            onClick={() => setIsTriaging(true)}
            className="px-4 py-2.5 bg-gradient-to-b from-gray-800 to-gray-950 hover:from-gray-700 hover:to-gray-900 dark:from-white dark:to-gray-200 text-white dark:text-black font-semibold text-[12.5px] rounded-xl shadow-sm shadow-black/20 ring-1 ring-inset ring-white/10 dark:ring-black/5 flex items-center gap-2 active:scale-[0.97] transition-all"
          >
            <Play size={13} className="fill-current" /> Sort {unsorted.length} new
          </button>
        )}
        <button 
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: 'n' });
            window.dispatchEvent(event);
          }}
          className="px-4 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-500 hover:to-blue-700 text-white font-semibold text-[12.5px] rounded-xl shadow-sm shadow-blue-600/25 ring-1 ring-inset ring-white/15 hidden md:flex items-center gap-2 active:scale-[0.97] transition-all"
        >
          <Plus size={14} /> Add item <kbd className="ml-0.5 px-1.5 rounded-md bg-white/20 text-[10.5px] font-semibold leading-[18px]">N</kbd>
        </button>
        </div>
      </div>

      {/* Chill mode: work is out of sight, never lost. */}
      {!showDone && <HiddenWorkLine scope="open" />}

      {/* Open / Done */}
      {loaded && (
        <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100 dark:bg-white/5 w-fit text-[12.5px] font-semibold" role="tablist">
          {[{ id: false, label: `Open ${items.length}` }, { id: true, label: `Done ${done.length}` }].map(t => (
            <button key={String(t.id)} role="tab" aria-selected={showDone === t.id} onClick={() => setShowDone(t.id)}
              className={`px-3 py-1.5 rounded-lg transition-colors ${showDone === t.id ? 'bg-white dark:bg-[#2c2c2e] shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!loaded ? null : showDone ? (
        done.length === 0 ? (
          <p className="text-center py-12 text-[13px] text-gray-400">Nothing finished yet.</p>
        ) : (
          <div className="space-y-2">
            {done.slice(0, 100).map(item => (
              <div key={item.id} className="px-4 py-3 rounded-2xl surface-item flex items-center gap-3">
                <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelectTask(item.id)}>
                  <p className="text-[13.5px] font-medium text-gray-500 line-through truncate">{item.title || 'Untitled'}</p>
                  <p className="text-[11px] text-gray-400">{item.project?.name || item.area?.name || 'No project'}{item.completedAt ? ` · done ${timeAgo(item.completedAt)}` : ''}</p>
                </div>
                <button onClick={() => handleReopen(item)} className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1">
                  <RotateCcw size={12} /> Reopen
                </button>
              </div>
            ))}
            {done.length > 100 && <p className="text-center text-[12px] text-gray-400">Showing the latest 100 of {done.length}. All Items has the rest.</p>}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="text-center py-20 surface rounded-3xl border border-black/5 dark:border-white/5 space-y-3 stagger">
          {hadItems.current ? (
            <Celebrate className="mx-auto">
              <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500 flex items-center justify-center ring-8 ring-emerald-500/[0.06]">
                <CheckCircle2 size={24} />
              </div>
            </Celebrate>
          ) : (
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500 mx-auto flex items-center justify-center">
              <CheckCircle2 size={24} />
            </div>
          )}
          <h3 className="text-[17px] font-semibold tracking-tight text-gray-900 dark:text-white">Your head is clear</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Press <strong>N</strong> anywhere to capture the next thought.
          </p>
        </div>
      ) : (
        <div className="relative has-[[aria-expanded=true]]:z-30 stagger -mb-2">
          <AnimatePresence initial={false}>
          {items.map((item) => (
            <Fold key={item.id}>
            <SwipeRow onSwipeRight={() => handleComplete(item)} onSwipeLeft={() => handleSnoozeTomorrow(item)}>
              <TaskRow
                item={item} today={todayIso} combined={!lifeContext}
                completing={isCompleting(item.id)} saving={isSaving(item.id)}
                onComplete={() => handleComplete(item)}
                onOpen={() => unsortedIds.has(item.id) ? startClarify(item) : onSelectTask(item.id)}
                onStar={() => handleStar(item)} onSnoozed={loadInbox}
                extra={unsortedIds.has(item.id) ? (
                  <button onClick={(e) => { e.stopPropagation(); startClarify(item); }}
                    className="shrink-0 px-2.5 py-1 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 font-semibold text-[11.5px] rounded-lg flex items-center gap-0.5 transition-colors">
                    New <ChevronRight size={12} />
                  </button>
                ) : null}
              />
            </SwipeRow>
            </Fold>
          ))}
          </AnimatePresence>
        </div>
      )}

      {/* Visible vs total: proves no open task is out of sight. */}
      {loaded && check && !showDone && (
        <div className={`flex items-start gap-2 px-4 py-3 rounded-2xl text-[12.5px] ${check.missing.length ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300' : 'bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300'}`}>
          {check.missing.length ? <AlertTriangle size={15} className="shrink-0 mt-px" /> : <ShieldCheck size={15} className="shrink-0 mt-px" />}
          <div className="space-y-0.5">
            <p className="font-semibold">
              {check.missing.length
                ? `${check.missing.length} open ${check.missing.length === 1 ? 'task is' : 'tasks are'} not listed: ${check.missing.slice(0, 3).map(i => i.title || 'Untitled').join(', ')}`
                : `All ${check.listed} open ${check.listed === 1 ? 'task is' : 'tasks are'} listed above.`}
            </p>
            {(check.alarms > 0 || check.otherContext > 0) && (
              <p className="opacity-80">
                {[check.alarms > 0 && `${check.alarms} LUMO ${check.alarms === 1 ? 'alarm lives' : 'alarms live'} on the LUMO page`,
                  check.otherContext > 0 && (chill
                    ? `${check.otherContext} more in Work, hidden in Chill (switch to Work to see them)`
                    : `${check.otherContext} more ${lifeContext === 'work' ? 'in Personal' : 'in Work'} (switch to All to see them)`)]
                  .filter(Boolean).join('. ')}.
              </p>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {isTriaging && (
          <InboxTriage items={unsorted} onChanged={loadInbox} onClose={() => { setIsTriaging(false); loadInbox(); }} />
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
                <button type="button" onClick={() => setClarifyingItem(null)} className="p-1.5 -mr-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-white/10 transition-colors" aria-label="Close"><X size={18}/></button>
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
                    <Select 
                      value={targetProjectId || targetAreaId}
                      onChange={v => {
                        const val = v;
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
                    </Select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 block mb-1.5">Target Date</label>
                    <DatePicker
                      value={targetDueDate}
                      onChange={v => setTargetDueDate(v)}
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
