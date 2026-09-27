import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, CornerDownLeft, Calendar, Clock, X, Check, ChevronDown,
  Flag, Tag, MapPin, Repeat, Bell, FileText, Folder, CheckSquare, Users
} from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { LifeContext, Project, Area } from '../../services/types';
import { PRIORITIES, LABELS } from '../../services/mockDb';
import { parseQuickAdd, QuickAddEntityType, QuickAddPriority } from '../../utils/quickAddParser';

interface QuickCaptureModalProps {
  onClose: () => void;
  onCaptured?: () => void;
  lifeContext?: LifeContext;
}

const REMINDER_LEAD_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'At the time' },
  { value: 10, label: '10 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 24 * 60, label: '1 day before' },
];

const ENTITY_OPTIONS: { id: QuickAddEntityType; label: string; icon: any }[] = [
  { id: 'task', label: 'Task', icon: CheckSquare },
  { id: 'event', label: 'Event', icon: Users },
  { id: 'reminder', label: 'Reminder', icon: Bell },
];

type Overrides = Partial<{
  entityType: QuickAddEntityType;
  priority: QuickAddPriority | null;
  date: string | null;
  time: string | null;
  tags: string[];
  location: string | null;
  repeatRule: string | null;
  durationMinutes: number | null;
}>;

function combineDateTime(date: string | null, time: string | null, fallbackHour = 9): string | null {
  if (!date) return null;
  const t = time || `${String(fallbackHour).padStart(2, '0')}:00`;
  return `${date}T${t}`;
}

export function QuickCaptureModal({ onClose, onCaptured, lifeContext = 'work' }: QuickCaptureModalProps) {
  const [text, setText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});

  // Manual-only fields (never inferred from the text line)
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [reminderLeadMinutes, setReminderLeadMinutes] = useState<number | null>(null);
  const [endTime, setEndTime] = useState(''); // manual event end HH:mm override
  const [tagDraft, setTagDraft] = useState('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    inputRef.current?.focus();
    Promise.all([api.projects.list(), api.areas.list()]).then(([p, a]) => {
      setProjects(p);
      setAreas(a);
    }).catch(() => {});
  }, []);

  const parsed = useMemo(() => parseQuickAdd(text, new Date()), [text]);

  const entityType = overrides.entityType ?? parsed.entityType;
  const priority = overrides.priority === null ? null : (overrides.priority ?? parsed.priority);
  const date = overrides.date === null ? null : (overrides.date ?? parsed.date);
  const time = overrides.time === null ? null : (overrides.time ?? parsed.time);
  const location = overrides.location === null ? null : (overrides.location ?? parsed.location);
  const repeatRule = overrides.repeatRule === null ? null : (overrides.repeatRule ?? parsed.repeatRule);
  const tags = overrides.tags ?? parsed.tags;
  const durationMinutes = overrides.durationMinutes === null ? null : (overrides.durationMinutes ?? parsed.durationMinutes);

  const dateLabel = overrides.date !== undefined ? (date ? date : null) : parsed.dateLabel;

  const removeTag = (t: string) => setOverrides(o => ({ ...o, tags: tags.filter(x => x !== t) }));
  const addTag = (t: string) => {
    const clean = t.trim().toLowerCase().replace(/^#/, '');
    if (!clean || tags.includes(clean)) return;
    setOverrides(o => ({ ...o, tags: [...tags, clean] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = parsed.title.trim();
    if (!cleanTitle || isSaving) return;

    setIsSaving(true);
    try {
      const payload: any = {
        title: cleanTitle,
        description,
        lifeContext,
        entityType,
        type: entityType === 'event' ? 'meeting' : entityType,
        priority: priority || 'medium',
        status: 'todo',
        labels: tags,
        projectId: lifeContext === 'work' ? (projectId || null) : null,
        areaId: lifeContext === 'personal' ? (areaId || null) : null,
        isInbox: !(projectId || areaId),
      };

      if (entityType === 'event') {
        const startAt = combineDateTime(date, time);
        payload.startAt = startAt;
        payload.startDate = date;
        payload.dueDate = date;
        payload.location = location || null;
        if (startAt) {
          const dur = durationMinutes ?? 60;
          const end = endTime ? combineDateTime(date, endTime) : new Date(new Date(startAt).getTime() + dur * 60000).toISOString().slice(0, 16);
          payload.endAt = end;
        }
        if (reminderLeadMinutes !== null && startAt) {
          payload.remindAt = new Date(new Date(startAt).getTime() - reminderLeadMinutes * 60000).toISOString().slice(0, 16);
          payload.reminderLeadMinutes = reminderLeadMinutes;
        }
        payload.repeatRule = repeatRule || null;
      } else if (entityType === 'reminder') {
        const remindAt = combineDateTime(date, time);
        payload.remindAt = remindAt;
        payload.startDate = date;
        payload.dueDate = date;
        payload.repeatRule = repeatRule || null;
      } else {
        // task
        payload.dueDate = date;
        payload.startDate = date;
        payload.location = location || null;
        payload.repeatRule = repeatRule || null;
        if (durationMinutes) {
          payload.estimatedMinutes = durationMinutes;
          payload.estimated = durationMinutes >= 60 ? `${Math.round(durationMinutes / 60)}h` : `${durationMinutes}m`;
        }
        const anchor = combineDateTime(date, time);
        if (reminderLeadMinutes !== null && anchor) {
          payload.remindAt = new Date(new Date(anchor).getTime() - reminderLeadMinutes * 60000).toISOString().slice(0, 16);
          payload.reminderLeadMinutes = reminderLeadMinutes;
        }
      }

      await api.workItems.create(payload);
      showToast(`Captured${payload.isInbox ? ' to Inbox' : ''}`);
      if (onCaptured) onCaptured();
      onClose();
    } catch (err: any) {
      showToast('Capture failed: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const chipBase = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all';
  const chipOn = 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800';
  const chipOff = 'bg-gray-100 dark:bg-white/5 text-gray-400 border-transparent';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 md:pt-28 p-4 font-sans">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -20 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden relative z-10 border border-gray-100 dark:border-white/10 max-h-[85vh] flex flex-col"
      >
        <div className="p-6 pb-0 space-y-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
              <Zap size={15} className="text-amber-500" />
              <span>Quick Capture</span>
            </div>
            <span className="text-[11px] font-mono text-gray-400">Esc to close</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              ref={inputRef}
              type="text"
              placeholder="Dinner tomorrow at 7pm @Cafe #personal !high, or remind me to call mom in 3 days"
              value={text}
              onChange={e => setText(e.target.value)}
              className="w-full text-lg md:text-xl font-medium bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-400"
            />

            {/* Live-parsed chips */}
            <div className="flex flex-wrap items-center gap-2">
              {ENTITY_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setOverrides(o => ({ ...o, entityType: opt.id }))}
                  className={`${chipBase} ${entityType === opt.id ? chipOn : chipOff}`}
                >
                  <opt.icon size={13} />
                  <span>{opt.label}</span>
                </button>
              ))}

              {date && (
                <button type="button" onClick={() => setOverrides(o => ({ ...o, date: null }))} className={`${chipBase} ${chipOn}`}>
                  <Calendar size={13} />
                  <span>{dateLabel || date}</span>
                  <X size={12} />
                </button>
              )}

              {time && (
                <button type="button" onClick={() => setOverrides(o => ({ ...o, time: null }))} className={`${chipBase} ${chipOn}`}>
                  <Clock size={13} />
                  <span>{time}</span>
                  <X size={12} />
                </button>
              )}

              {priority && priority !== 'medium' && (
                <button type="button" onClick={() => setOverrides(o => ({ ...o, priority: null }))} className={`${chipBase} ${chipOn}`}>
                  <Flag size={13} />
                  <span>{(PRIORITIES as any)[priority]?.label || priority}</span>
                  <X size={12} />
                </button>
              )}

              {location && (
                <button type="button" onClick={() => setOverrides(o => ({ ...o, location: null }))} className={`${chipBase} ${chipOn}`}>
                  <MapPin size={13} />
                  <span>{location}</span>
                  <X size={12} />
                </button>
              )}

              {repeatRule && (
                <button type="button" onClick={() => setOverrides(o => ({ ...o, repeatRule: null }))} className={`${chipBase} ${chipOn}`}>
                  <Repeat size={13} />
                  <span>{parsed.repeatLabel || repeatRule}</span>
                  <X size={12} />
                </button>
              )}

              {tags.map(t => (
                <button key={t} type="button" onClick={() => removeTag(t)} className={`${chipBase} ${chipOn}`}>
                  <Tag size={13} />
                  <span>#{t}</span>
                  <X size={12} />
                </button>
              ))}
            </div>

            {/* More options disclosure */}
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 pt-1"
            >
              <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
              <span>{expanded ? 'Fewer options' : 'More options'}</span>
            </button>
          </form>
        </div>

        {expanded && (
          <div className="px-6 pb-2 space-y-4 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Priority</label>
                <select
                  className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                  value={priority || 'medium'}
                  onChange={e => setOverrides(o => ({ ...o, priority: e.target.value as QuickAddPriority }))}
                >
                  {Object.keys(PRIORITIES).map(p => <option key={p} value={p}>{(PRIORITIES as any)[p].label}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">{lifeContext === 'personal' ? 'Life Area' : 'Project'}</label>
                {lifeContext === 'personal' ? (
                  <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange-500" value={areaId} onChange={e => setAreaId(e.target.value)}>
                    <option value="">Inbox (unsorted)</option>
                    {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : (
                  <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500" value={projectId} onChange={e => setProjectId(e.target.value)}>
                    <option value="">Inbox (unsorted)</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Date</label>
                <input type="date" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                  value={date || ''} onChange={e => setOverrides(o => ({ ...o, date: e.target.value || null }))} />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">{entityType === 'event' ? 'Start Time' : 'Time'}</label>
                <input type="time" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                  value={time || ''} onChange={e => setOverrides(o => ({ ...o, time: e.target.value || null }))} />
              </div>

              {entityType === 'event' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">End Time</label>
                    <input type="time" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                      value={endTime} onChange={e => setEndTime(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Location</label>
                    <input type="text" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                      value={location || ''} onChange={e => setOverrides(o => ({ ...o, location: e.target.value || null }))} placeholder="Zoom link, cafe, office..." />
                  </div>
                </>
              )}

              {entityType === 'task' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Location</label>
                  <input type="text" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                    value={location || ''} onChange={e => setOverrides(o => ({ ...o, location: e.target.value || null }))} placeholder="Optional" />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Recurrence</label>
                <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                  value={repeatRule || ''} onChange={e => setOverrides(o => ({ ...o, repeatRule: e.target.value || null }))}>
                  <option value="">Never</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Every weekday</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              {entityType !== 'reminder' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase flex items-center gap-1"><Bell size={11} /> Remind me</label>
                  <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                    value={reminderLeadMinutes === null ? '' : reminderLeadMinutes}
                    onChange={e => setReminderLeadMinutes(e.target.value === '' ? null : parseInt(e.target.value, 10))}>
                    {REMINDER_LEAD_OPTIONS.map(opt => <option key={opt.label} value={opt.value === null ? '' : opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              )}

              {entityType === 'task' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Estimate</label>
                  <input type="text" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-semibold outline-none focus:border-blue-500"
                    defaultValue={durationMinutes ? (durationMinutes >= 60 ? `${Math.round(durationMinutes / 60)}h` : `${durationMinutes}m`) : ''}
                    onChange={e => {
                      const v = e.target.value.trim();
                      const mHour = v.match(/(\d+(?:\.\d+)?)\s*h/i);
                      const mMin = v.match(/(\d+)\s*m/i);
                      let mins: number | null = null;
                      if (mHour) mins = Math.round(parseFloat(mHour[1]) * 60) + (mMin ? parseInt(mMin[1], 10) : 0);
                      else if (mMin) mins = parseInt(mMin[1], 10);
                      setOverrides(o => ({ ...o, durationMinutes: mins }));
                    }}
                    placeholder="e.g. 2h, 45m" />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase flex items-center gap-1"><Tag size={11} /> Tags</label>
              <div className="flex flex-wrap items-center gap-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2">
                {tags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                    #{t}
                    <button type="button" onClick={() => removeTag(t)}><X size={10} /></button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagDraft}
                  onChange={e => setTagDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag(tagDraft);
                      setTagDraft('');
                    }
                  }}
                  placeholder={tags.length === 0 ? 'Type a tag and press Enter...' : 'Add another...'}
                  className="flex-1 min-w-[100px] bg-transparent border-none outline-none text-[13px] font-medium"
                />
              </div>
              {LABELS.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {LABELS.filter(l => !tags.includes(l.name)).map(l => (
                    <button key={l.id} type="button" onClick={() => addTag(l.name)} className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200">
                      + {l.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase flex items-center gap-1"><FileText size={11} /> Notes</label>
              <textarea rows={2} className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[13px] font-medium outline-none focus:border-blue-500 resize-none"
                value={description} onChange={e => setDescription(e.target.value)} placeholder="Add details, links, or notes..." />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-white/5 shrink-0">
          <div className="text-xs text-gray-400 flex items-center gap-1">
            <Folder size={13} />
            <span>
              {projectId ? projects.find(p => p.id === projectId)?.name
                : areaId ? areas.find(a => a.id === areaId)?.name
                : `${lifeContext === 'personal' ? 'Personal' : 'Work'} Inbox`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={!text.trim() || isSaving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-md active:scale-95 transition-transform"
            >
              <span>Capture</span>
              <CornerDownLeft size={13} />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
