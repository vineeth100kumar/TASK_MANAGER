import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, CheckCircle2, Circle, ArrowRight, Zap, Clock, Trash2, Calendar, Target, Sparkles, ChevronRight, Check, X, BrainCircuit, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { aiEngine } from '../../services/aiEngine';
import { WorkItem, LifeContext, Project, Area } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { SnoozeMenu } from '../common/SnoozeMenu';

interface InboxViewProps {
  lifeContext: LifeContext;
  onSelectTask: (id: string) => void;
}

export function InboxView({ lifeContext, onSelectTask }: InboxViewProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [clarifyingItem, setClarifyingItem] = useState<WorkItem | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // AI Brain Dump State
  const [brainDumpText, setBrainDumpText] = useState('');
  const [isAiParsing, setIsAiParsing] = useState(false);

  // Clarify Form State
  const [targetType, setTargetType] = useState<string>('task');
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [targetAreaId, setTargetAreaId] = useState<string>('');
  const [targetDueDate, setTargetDueDate] = useState<string>('');
  const [targetPriority, setTargetPriority] = useState<string>('medium');

  const { showToast } = useToast();

  const handleBrainDumpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brainDumpText.trim()) return;

    setIsAiParsing(true);
    try {
      let parsedTasks = await aiEngine.parseBrainDump(brainDumpText);
      
      // AI robustness: If it returned a single object, wrap it in an array
      if (parsedTasks && typeof parsedTasks === 'object' && !Array.isArray(parsedTasks)) {
        if (parsedTasks.tasks && Array.isArray(parsedTasks.tasks)) {
           parsedTasks = parsedTasks.tasks;
        } else {
           parsedTasks = [parsedTasks];
        }
      }
      
      // If still not an array (or null), throw an error
      if (!Array.isArray(parsedTasks)) {
          throw new Error("AI returned invalid data format");
      }
      
      for (const t of parsedTasks) {
         await api.workItems.save({
            title: t.title,
            isInbox: true,
            lifeContext: lifeContext,
            dueDate: t.dueDate || null,
            priority: t.priority || 'medium',
            estimatedMinutes: t.estimatedMinutes || null,
            status: 'todo'
         } as any);
      }
      
      showToast(`Sage extracted ${parsedTasks.length} task${parsedTasks.length > 1 ? 's' : ''}!`);
      setBrainDumpText('');
      loadInbox();
    } catch (err: any) {
      showToast('AI Parsing failed: ' + err.message, 'error');
    } finally {
      setIsAiParsing(false);
    }
  };

  const loadInbox = async () => {
    setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInbox();
  }, [lifeContext]);

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

  const handleComplete = async (item: WorkItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.workItems.transitionStatus(item.id, 'done', item.version);
      showToast('Completed');
      loadInbox();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleFocus = async (item: WorkItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.focus.toggle(item.id);
      showToast(item.isFocus ? 'Removed from Focus' : 'Added to Focus');
      loadInbox();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.workItems.softDelete(itemId);
      showToast('Item deleted');
      loadInbox();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 font-sans">
      {/* Header Banner */}
      <div className="p-6 md:p-8 rounded-[32px] bg-[#f5f5f7] dark:bg-[#1c1c1e] border border-black/5 dark:border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
            <Inbox size={18} />
            <span>Universal Inbox</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white">
            {items.length === 0 ? 'Inbox is Zero' : `${items.length} unclarified item${items.length === 1 ? '' : 's'}`}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Thoughts captured without friction. Clarify when you have time, or keep them here.
          </p>
        </div>

        <button 
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: 'c' });
            window.dispatchEvent(event);
          }}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 active:scale-95 transition-transform"
        >
          <Zap size={14} /> Quick Capture (C)
        </button>
      </div>

      {/* AI Magic Brain Dump */}
      <form onSubmit={handleBrainDumpSubmit} className="p-1 rounded-[32px] bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 p-[2px]">
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[30px] p-2 flex items-center gap-2">
           <div className="pl-4 text-blue-500">
             <BrainCircuit size={20} />
           </div>
           <input
             type="text"
             value={brainDumpText}
             onChange={(e) => setBrainDumpText(e.target.value)}
             placeholder="Type a brain dump (e.g. 'i am going to dinner at 10pm and buy milk tomorrow')..."
             className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-medium text-gray-900 dark:text-white placeholder-gray-400 py-3"
             disabled={isAiParsing}
           />
           <button 
             type="submit"
             disabled={!brainDumpText.trim() || isAiParsing}
             className="px-6 py-3 bg-gray-900 dark:bg-white text-white dark:text-black rounded-3xl font-bold text-xs disabled:opacity-50 flex items-center gap-2"
           >
             {isAiParsing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
             {isAiParsing ? 'Parsing...' : 'Extract'}
           </button>
        </div>
      </form>

      {/* Inbox Items List */}
      {items.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-[#1c1c1e] rounded-[32px] border border-black/5 dark:border-white/5 space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-500 mx-auto flex items-center justify-center">
            <CheckCircle2 size={24} />
          </div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Your head is clear</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Everything captured has been organized or completed. Press <strong>C</strong> anywhere to capture a new thought.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              className="p-4 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-black/5 dark:border-white/5 shadow-sm hover:border-blue-200 dark:hover:border-blue-800 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-3.5 flex-1 min-w-0">
                <button 
                  onClick={(e) => handleComplete(item, e)} 
                  className="text-gray-300 hover:text-emerald-500 transition-colors shrink-0"
                >
                  <Circle size={20} />
                </button>

                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => startClarify(item)}>
                  <h4 className="font-bold text-sm text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
                    {item.title}
                  </h4>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                    <span>Captured {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {item.dueDate && <span className="text-blue-500 font-semibold">· Due {item.dueDate}</span>}
                    {item.isFocus && <span className="text-amber-500 font-bold">· In Focus</span>}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                <button 
                  onClick={(e) => handleToggleFocus(item, e)}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors ${
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
                  className="px-3.5 py-1.5 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 font-bold text-xs rounded-xl flex items-center gap-1 transition-colors"
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
            </motion.div>
          ))}
        </div>
      )}

      {/* Quick Clarify Modal Drawer */}
      <AnimatePresence>
        {clarifyingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setClarifyingItem(null)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#1c1c1e] w-full max-w-lg rounded-[32px] shadow-2xl p-6 relative z-10 border border-gray-100 dark:border-white/10 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-500">
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
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-2">What is this?</label>
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
                        className={`py-2 rounded-xl text-xs font-bold transition-all ${
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
                    <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1.5">Project / Area</label>
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
                    <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1.5">Target Date</label>
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
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-md"
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
