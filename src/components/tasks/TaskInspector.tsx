import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Trash2, X, Circle, CheckCircle, Flag, Calendar as CalendarIcon, FileText, Play, Activity, ShieldAlert, Bell, Plus, Folder, Copy, Camera, Tag } from 'lucide-react';
import { api } from '../../services/api';
import { STATUSES, PRIORITIES, WORK_ITEM_TYPES, ALLOWED_TRANSITIONS, LABELS } from '../../services/constants';
import { Project, Area } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { downloadTaskImage } from '../../utils/imageExport';

import { toInputDateValue, toInputDateTimeValue } from '../../utils/dateUtils';

const REMINDER_LEAD_OPTIONS: { value: number | ''; label: string }[] = [
  { value: '', label: 'No reminder' },
  { value: 0, label: 'At the time' },
  { value: 10, label: '10 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 24 * 60, label: '1 day before' },
];

interface TaskInspectorProps {
  taskId: string;
  onClose: () => void;
  onTransition: (task: any, newStatus: string) => Promise<void>;
  onUpdateDetails: (task: any, updates: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function TaskInspector({ taskId, onClose, onTransition, onUpdateDetails, onDelete }: TaskInspectorProps) {
  const { showToast } = useToast();
  const [task, setTask] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [subtasks, setSubtasks] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [activeTab, setActiveTab] = useState('details');
  const [loading, setLoading] = useState(true);

  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [commentText, setCommentText] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [isSavingDesc, setIsSavingDesc] = useState(false);

  const handleDuplicate = async () => {
    if (!task) return;
    try {
      await api.workItems.duplicate(task.id);
      showToast('Item duplicated');
      onClose();
    } catch (e: any) {
      showToast('Failed to duplicate item', 'error');
    }
  };

  const loadData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const [t, pList, aList, cData, sData, aData] = await Promise.all([
        api.workItems.get(taskId),
        api.projects.list(),
        api.areas.list(),
        api.comments.list(taskId),
        api.subtasks.list(taskId),
        api.activities.list(taskId)
      ]);
      setTask(t);
      setProjects(pList);
      setAreas(aList);
      if (isInitial) {
        setEditTitle(t.title);
        setEditDesc(t.description || '');
      }
      setComments(cData); 
      setSubtasks(sData); 
      setActivities(aData);
    } catch (e) {
      showToast("Failed to load details", "error");
      onClose();
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [taskId, onClose, showToast]);

  useEffect(() => { loadData(true); }, [loadData]);
  useDataChanges(() => loadData());

  const submitTitle = async () => {
    if (editTitle !== task.title) {
      await onUpdateDetails(task, { title: editTitle });
      loadData();
    }
  };

  const submitDesc = async () => {
    if (editDesc !== task.description) {
      setIsSavingDesc(true);
      try {
        await onUpdateDetails(task, { description: editDesc });
        loadData();
      } finally {
        setIsSavingDesc(false);
      }
    }
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    try {
      await onTransition(task, newStatus);
      loadData();
    } catch (err) {
      loadData();
    }
  };

  const handlePostComment = async () => {
    if (!commentText.trim()) return;
    const txt = commentText;
    setCommentText('');
    try {
      await api.comments.create(taskId, txt);
      loadData();
    } catch (e) {
      showToast("Failed to post note", "error");
      setCommentText(txt);
    }
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtask.trim()) return;
    const txt = newSubtask; 
    setNewSubtask('');
    try {
      await api.subtasks.create(taskId, txt);
      loadData();
    } catch (e) {
      showToast("Failed to add subtask", "error");
      setNewSubtask(txt);
    }
  };

  const handleToggleSubtask = async (subId: string, current: boolean) => {
    try {
      await api.subtasks.toggle(subId, !current);
      loadData();
    } catch (e) {
      showToast("Failed to update subtask", "error");
    }
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (loading || !task) return (
     <>
       <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 scrim z-40" />
       <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="fixed inset-y-0 right-0 z-50 w-full md:w-[560px] lg:w-[600px] bg-white dark:bg-[#1c1c1e] flex items-center justify-center shadow-2xl">
         <Loader2 className="animate-spin text-gray-400" size={32} />
       </motion.aside>
     </>
  );

  const allowedStatuses = [task.status, ...(ALLOWED_TRANSITIONS[task.status as keyof typeof ALLOWED_TRANSITIONS] || [])];
  if (!allowedStatuses.includes('done')) allowedStatuses.push('done');

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} className="fixed inset-0 scrim z-40" />
      
      <motion.aside role="dialog" aria-modal="true"
        initial={{ x: '100%', boxShadow: '-20px 0 50px rgba(0,0,0,0)' }} animate={{ x: 0, boxShadow: '-20px 0 50px rgba(0,0,0,0.1)' }} exit={{ x: '100%' }} transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed inset-y-0 right-0 z-50 w-full md:w-[560px] lg:w-[600px] bg-white dark:bg-[#1c1c1e] border-l border-gray-200 dark:border-white/10 flex flex-col shadow-2xl"
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-white/5 bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-bold tracking-widest uppercase text-gray-500">{task.key}</span>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${(WORK_ITEM_TYPES as any)[task.type]?.color || 'bg-gray-100 text-gray-700'}`}>
              {(() => {
                const TypeIcon = (WORK_ITEM_TYPES as any)[task.type]?.icon || FileText;
                return <TypeIcon size={12} strokeWidth={3} />;
              })()}
              <span>{(WORK_ITEM_TYPES as any)[task.type]?.label || task.type}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { downloadTaskImage(task, task.project); showToast('Task picture (.png) downloaded!'); }} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors" title="Download Task Picture (PNG)"><Camera size={17} /></button>
            <button onClick={handleDuplicate} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors" title="Duplicate Item"><Copy size={17} /></button>
            <button onClick={() => { if(window.confirm("Move item to trash?")) { onDelete(task.id); onClose(); } }} className="p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" aria-label="Delete item"><Trash2 size={18} /></button>
            <div className="w-px h-5 bg-gray-200 dark:bg-white/10 mx-1"></div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300" aria-label="Close panel"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="px-6 md:px-8 pt-8 pb-6">
             <textarea className="w-full bg-transparent text-2xl md:text-3xl font-bold resize-none outline-none border-none text-gray-900 dark:text-white leading-tight placeholder-gray-300 dark:placeholder-gray-700 hover:bg-gray-50 dark:hover:bg-white/5 focus:bg-gray-50 dark:focus:bg-white/5 rounded-2xl p-2 -ml-2 transition-colors"
                value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={submitTitle} rows={2} placeholder="Item Title" />
              
              <div className="flex bg-gray-100/80 dark:bg-white/5 p-1 rounded-[14px] w-fit mt-4 border border-black/5 dark:border-white/5">
                <button onClick={() => setActiveTab('details')} className={`px-5 py-2 rounded-[10px] text-[14px] font-semibold transition-all ${activeTab === 'details' ? 'bg-white dark:bg-[#2c2c2e] shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>Details</button>
                <button onClick={() => setActiveTab('activity')} className={`px-5 py-2 rounded-[10px] text-[14px] font-semibold flex items-center gap-2 transition-all ${activeTab === 'activity' ? 'bg-white dark:bg-[#2c2c2e] shadow-sm text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                  Activity Log <span className="bg-gray-200 dark:bg-white/10 px-2 py-0.5 rounded-full text-[11px]">{activities.length}</span>
                </button>
              </div>
          </div>

          <div className="px-6 md:px-8 pb-20">
            {activeTab === 'details' ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                
                <div className="bg-[#f5f5f7] dark:bg-white/5 rounded-3xl border border-black/5 dark:border-white/5 overflow-hidden">
                  
                  {task.entityType === 'task' && (
                    <>
                      <PropertyRow icon={Circle} label="Status">
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500" 
                          value={task.status} onChange={handleStatusChange}>
                          {Object.values(STATUSES).filter(s => allowedStatuses.includes(s.id)).map(s => <option key={s.id} value={s.id} className="text-gray-900">{s.label}</option>)}
                        </select>
                      </PropertyRow>

                      {task.status === 'blocked' && (
                        <PropertyRow icon={ShieldAlert} label="Blocked Reason">
                          <input type="text" className="bg-transparent font-semibold text-red-600 dark:text-red-400 outline-none text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 w-full"
                            value={task.blockedReason || ''} onChange={async (e) => { await onUpdateDetails(task, { blockedReason: e.target.value }); loadData(); }} placeholder="Reason for block..." />
                        </PropertyRow>
                      )}

                      <PropertyRow icon={Flag} label="Priority">
                        <select className={`bg-transparent font-semibold outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 ${(PRIORITIES as any)[task.priority]?.color}`} 
                          value={task.priority} onChange={async (e) => { await onUpdateDetails(task, {priority: e.target.value}); loadData(); }}>
                          {Object.keys(PRIORITIES).map(p => <option key={p} value={p} className="text-gray-900">{(PRIORITIES as any)[p].label}</option>)}
                        </select>
                      </PropertyRow>

                      <PropertyRow icon={Folder} label="Space / Project">
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500" 
                          value={task.projectId || task.areaId || ''} onChange={async (e) => {
                            const val = e.target.value;
                            const isP = projects.some(p => p.id === val);
                            await onUpdateDetails(task, { projectId: isP ? val : null, areaId: !isP ? val : null });
                            loadData();
                          }}>
                          {projects.map(p => <option key={p.id} value={p.id} className="text-gray-900">{p.name}</option>)}
                          {areas.map(a => <option key={a.id} value={a.id} className="text-gray-900">{a.name} (Area)</option>)}
                        </select>
                      </PropertyRow>

                      <PropertyRow icon={CalendarIcon} label="Dates">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 justify-end">
                          <input type="date" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right hover:bg-gray-200 dark:hover:bg-white/10 px-1 py-1 rounded-md focus:ring-2 focus:ring-blue-500 text-[14px] tabular-nums w-[138px]"
                            value={toInputDateValue(task.startDate)} onChange={async (e) => { await onUpdateDetails(task, { startDate: e.target.value || null }); loadData(); }} />
                          <span className="text-gray-400 font-bold">→</span>
                          <input type="date" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right hover:bg-gray-200 dark:hover:bg-white/10 px-1 py-1 rounded-md focus:ring-2 focus:ring-blue-500 text-[14px] tabular-nums w-[138px]"
                            value={toInputDateValue(task.dueDate)} onChange={async (e) => { await onUpdateDetails(task, { dueDate: e.target.value || null }); loadData(); }} />
                        </div>
                      </PropertyRow>

                      <PropertyRow icon={FileText} label="Estimate">
                        <input type="text" className="w-20 bg-transparent font-semibold text-gray-900 dark:text-white outline-none text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500"
                          value={task.estimated || ''} onChange={async (e) => { await onUpdateDetails(task, { estimated: e.target.value }); loadData(); }} placeholder="e.g. 2h" />
                      </PropertyRow>

                      <PropertyRow icon={FileText} label="Location">
                        <input type="text" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 w-full"
                          value={task.location || ''} onChange={async (e) => { await onUpdateDetails(task, { location: e.target.value }); loadData(); }} placeholder="Optional" />
                      </PropertyRow>

                      <PropertyRow icon={Activity} label="Recurrence">
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500"
                          value={task.repeatRule || ''} onChange={async (e) => { await onUpdateDetails(task, { repeatRule: e.target.value || null }); loadData(); }}>
                          <option value="" className="text-gray-900">Never</option>
                          <option value="daily" className="text-gray-900">Daily</option>
                          <option value="weekdays" className="text-gray-900">Every weekday</option>
                          <option value="weekly" className="text-gray-900">Weekly</option>
                          <option value="monthly" className="text-gray-900">Monthly</option>
                          <option value="yearly" className="text-gray-900">Yearly</option>
                        </select>
                      </PropertyRow>

                      <PropertyRow icon={Bell} label="Remind Me" isLast>
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500"
                          value={task.reminderLeadMinutes ?? ''} onChange={async (e) => {
                            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            const anchorDate = task.dueDate || task.startDate;
                            let remindAt: string | null = null;
                            if (val !== null && anchorDate) {
                              remindAt = new Date(new Date(`${anchorDate}T09:00`).getTime() - val * 60000).toISOString().slice(0, 16);
                            }
                            await onUpdateDetails(task, { reminderLeadMinutes: val, remindAt });
                            loadData();
                          }}>
                          {REMINDER_LEAD_OPTIONS.map(opt => <option key={opt.label} value={opt.value} className="text-gray-900">{opt.label}</option>)}
                        </select>
                      </PropertyRow>
                    </>
                  )}

                  {task.entityType === 'event' && (
                    <>
                      <PropertyRow icon={Circle} label="Status">
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500" 
                          value={task.status} onChange={handleStatusChange}>
                          <option value="todo" className="text-gray-900">Scheduled</option>
                          <option value="done" className="text-gray-900">Attended ✓</option>
                          <option value="blocked" className="text-gray-900">Cancelled</option>
                        </select>
                      </PropertyRow>
                      <PropertyRow icon={CalendarIcon} label="Start Time">
                        <input type="datetime-local" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 color-scheme-light dark:color-scheme-dark"
                          value={toInputDateTimeValue(task.startAt)} onChange={async (e) => { 
                            const val = e.target.value;
                            await onUpdateDetails(task, { startAt: val || null, startDate: val ? val.slice(0, 10) : null }); 
                            loadData(); 
                          }} />
                      </PropertyRow>
                      <PropertyRow icon={CalendarIcon} label="End Time">
                        <input type="datetime-local" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 color-scheme-light dark:color-scheme-dark"
                          value={toInputDateTimeValue(task.endAt)} onChange={async (e) => { 
                            const val = e.target.value;
                            await onUpdateDetails(task, { endAt: val || null, dueDate: val ? val.slice(0, 10) : null }); 
                            loadData(); 
                          }} />
                      </PropertyRow>
                      <PropertyRow icon={FileText} label="Location / Link">
                        <input type="text" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 w-full"
                          value={task.location || ''} onChange={async (e) => { await onUpdateDetails(task, { location: e.target.value }); loadData(); }} placeholder="Zoom link or room..." />
                      </PropertyRow>

                      <PropertyRow icon={Activity} label="Recurrence">
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500"
                          value={task.repeatRule || ''} onChange={async (e) => { await onUpdateDetails(task, { repeatRule: e.target.value || null }); loadData(); }}>
                          <option value="" className="text-gray-900">Never</option>
                          <option value="daily" className="text-gray-900">Daily</option>
                          <option value="weekdays" className="text-gray-900">Every weekday</option>
                          <option value="weekly" className="text-gray-900">Weekly</option>
                          <option value="monthly" className="text-gray-900">Monthly</option>
                          <option value="yearly" className="text-gray-900">Yearly</option>
                        </select>
                      </PropertyRow>

                      <PropertyRow icon={Bell} label="Remind Me" isLast>
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500"
                          value={task.reminderLeadMinutes ?? ''} onChange={async (e) => {
                            const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                            let remindAt: string | null = null;
                            if (val !== null && task.startAt) {
                              remindAt = new Date(new Date(task.startAt).getTime() - val * 60000).toISOString().slice(0, 16);
                            }
                            await onUpdateDetails(task, { reminderLeadMinutes: val, remindAt });
                            loadData();
                          }}>
                          {REMINDER_LEAD_OPTIONS.map(opt => <option key={opt.label} value={opt.value} className="text-gray-900">{opt.label}</option>)}
                        </select>
                      </PropertyRow>
                    </>
                  )}

                  {task.entityType === 'reminder' && (
                    <>
                      <PropertyRow icon={Circle} label="Status">
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500" 
                          value={task.status} onChange={handleStatusChange}>
                          <option value="todo" className="text-gray-900">Active</option>
                          <option value="done" className="text-gray-900">Completed ✓</option>
                        </select>
                      </PropertyRow>
                      <PropertyRow icon={Bell} label="Remind At">
                        <input type="datetime-local" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 color-scheme-light dark:color-scheme-dark"
                          value={toInputDateTimeValue(task.remindAt)} onChange={async (e) => { 
                            const val = e.target.value;
                            await onUpdateDetails(task, { remindAt: val || null, dueDate: val ? val.slice(0, 10) : null, startDate: val ? val.slice(0, 10) : null }); 
                            loadData(); 
                          }} />
                      </PropertyRow>
                      <PropertyRow icon={Activity} label="Repeat Rule" isLast>
                        <input type="text" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 w-full"
                          value={task.repeatRule || ''} onChange={async (e) => { await onUpdateDetails(task, { repeatRule: e.target.value }); loadData(); }} placeholder="e.g. daily, weekly" />
                      </PropertyRow>
                    </>
                  )}

                  {task.entityType === 'milestone' && (
                    <>
                      <PropertyRow icon={Circle} label="Milestone State">
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500" 
                          value={task.status} onChange={handleStatusChange}>
                          <option value="todo" className="text-gray-900">Upcoming (In Flight)</option>
                          <option value="done" className="text-gray-900">Achieved ✓</option>
                        </select>
                      </PropertyRow>
                      <PropertyRow icon={CalendarIcon} label="Target Checkpoint">
                        <input type="date" className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500 color-scheme-light dark:color-scheme-dark"
                          value={toInputDateValue(task.dueDate || task.startDate)} onChange={async (e) => { 
                            const val = e.target.value || null;
                            await onUpdateDetails(task, { dueDate: val, startDate: val }); 
                            loadData(); 
                          }} />
                      </PropertyRow>
                      <PropertyRow icon={Folder} label="Space / Project" isLast>
                        <select className="bg-transparent font-semibold text-gray-900 dark:text-white outline-none cursor-pointer text-right appearance-none hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded-md focus:ring-2 focus:ring-blue-500" 
                          value={task.projectId || task.areaId || ''} onChange={async (e) => {
                            const val = e.target.value;
                            const isP = projects.some(p => p.id === val);
                            await onUpdateDetails(task, { projectId: isP ? val : null, areaId: !isP ? val : null });
                            loadData();
                          }}>
                          {projects.map(p => <option key={p.id} value={p.id} className="text-gray-900">{p.name}</option>)}
                          {areas.map(a => <option key={a.id} value={a.id} className="text-gray-900">{a.name} (Area)</option>)}
                        </select>
                      </PropertyRow>
                    </>
                  )}
                </div>

                <div>
                  <h4 className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-1.5"><Tag size={12} /> Tags</h4>
                  <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-white/5 rounded-3xl border border-gray-200 dark:border-white/10 shadow-sm p-4">
                    {(task.labels || []).map((t: string) => (
                      <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                        #{t}
                        <button onClick={async () => { await onUpdateDetails(task, { labels: (task.labels || []).filter((x: string) => x !== t) }); loadData(); }}><X size={11} /></button>
                      </span>
                    ))}
                    <TagAdder
                      existing={task.labels || []}
                      onAdd={async (tag: string) => { await onUpdateDetails(task, { labels: [...(task.labels || []), tag] }); loadData(); }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                     <h4 className="text-[12px] font-semibold uppercase tracking-wider text-gray-400">Notes & Description</h4>
                     {isSavingDesc && <span className="text-[12px] font-medium text-gray-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Saving...</span>}
                  </div>
                  <textarea className="w-full bg-white dark:bg-white/5 rounded-3xl border border-gray-200 dark:border-white/10 p-6 shadow-sm min-h-[120px] text-[15px] font-medium outline-none resize-y custom-scrollbar focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    value={editDesc} onChange={(e) => setEditDesc(e.target.value)} onBlur={submitDesc} placeholder="Add personal notes, instructions, links..." />
                </div>

                <div>
                  <h4 className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Checklist ({subtasks.filter(s=>s.completed).length}/{subtasks.length})</h4>
                  <div className="bg-white dark:bg-white/5 rounded-3xl border border-gray-200 dark:border-white/10 shadow-sm overflow-hidden">
                    {subtasks.map((st, idx) => (
                      <div key={st.id} className={`flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer ${idx !== subtasks.length - 1 ? 'border-b border-gray-100 dark:border-white/5' : ''}`} onClick={() => handleToggleSubtask(st.id, st.completed)}>
                        <button className={`flex-shrink-0 transition-transform ${st.completed ? 'text-blue-500' : 'text-gray-300 dark:text-gray-600'}`}>{st.completed ? <CheckCircle size={22} /> : <Circle size={22} />}</button>
                        <span className={`text-[15px] font-medium transition-all ${st.completed ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-white'}`}>{st.title}</span>
                      </div>
                    ))}
                    <form onSubmit={handleAddSubtask} className={`p-4 flex items-center gap-4 bg-gray-50/50 dark:bg-white/5 focus-within:bg-white dark:focus-within:bg-white/10 ${subtasks.length > 0 ? 'border-t border-gray-100 dark:border-white/5' : ''}`}>
                      <Plus size={22} className="text-gray-400" />
                      <input type="text" placeholder="Add a checklist item..." value={newSubtask} onChange={e=>setNewSubtask(e.target.value)} className="bg-transparent border-none outline-none flex-1 text-[15px] font-medium" />
                    </form>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 pb-10">
                <div className="space-y-4">
                   {comments.map(c => (
                     <div key={c.id} className="bg-gray-50 dark:bg-white/5 p-4 rounded-2xl border border-gray-100 dark:border-white/5">
                       <div className="text-xs text-gray-400 mb-1">{new Date(c.createdAt).toLocaleString()}</div>
                       <p className="text-[14px] text-gray-800 dark:text-gray-200 font-medium whitespace-pre-wrap">{c.body}</p>
                     </div>
                   ))}
                   {comments.length === 0 && (
                     <div className="text-sm text-gray-400 py-6 text-center">No notes added yet.</div>
                   )}
                </div>

                <div className="sticky bottom-0 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl pt-4 pb-6 mt-8 border-t border-gray-100 dark:border-white/10 z-20 -mx-6 md:-mx-8 px-6 md:px-8">
                  <div className="flex items-center gap-3 bg-white dark:bg-[#2c2c2e] p-2 px-3 rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg focus-within:ring-2 ring-blue-500/50">
                    <input type="text" placeholder="Add a quick note or log..." value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handlePostComment()} className="w-full bg-transparent outline-none text-[14px] font-medium dark:text-white" />
                    <button onClick={handlePostComment} disabled={!commentText.trim()} className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl active:scale-95 shrink-0" aria-label="Send note"><Play size={14} className="ml-0.5 fill-white" /></button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}

function TagAdder({ existing, onAdd }: { existing: string[]; onAdd: (tag: string) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const clean = draft.trim().toLowerCase().replace(/^#/, '');
    if (clean && !existing.includes(clean)) onAdd(clean);
    setDraft('');
  };
  const suggestions = LABELS.filter(l => !existing.includes(l.name));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
        placeholder="Add a tag..."
        className="bg-transparent border-none outline-none text-[13px] font-medium min-w-[100px]"
      />
      {suggestions.map(l => (
        <button key={l.id} type="button" onClick={() => onAdd(l.name)} className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200">
          + {l.name}
        </button>
      ))}
    </div>
  );
}

function PropertyRow({ icon: Icon, label, children, isLast = false }: { icon: any, label: string, children: React.ReactNode, isLast?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 p-4 px-4 sm:px-6 ${!isLast ? 'border-b border-black/5 dark:border-white/5' : ''}`}>
      <div className="flex items-center gap-2.5 text-gray-500 w-32 sm:w-1/3 shrink-0 mt-1.5"><Icon size={17} strokeWidth={2} className="shrink-0" /><span className="text-[13.5px] font-medium whitespace-nowrap">{label}</span></div>
      <div className="flex-1 flex flex-col items-end text-right min-w-0">{children}</div>
    </div>
  );
}
