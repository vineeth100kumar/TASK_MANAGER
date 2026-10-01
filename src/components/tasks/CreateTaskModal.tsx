import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Tag, Calendar, Clock, Flag, MapPin, Repeat, Timer, Sparkles, Target, ChevronDown, Briefcase, Sun } from 'lucide-react';
import { ENTITY_TYPES, LABELS } from '../../services/constants';
import { api } from '../../services/api';
import { Project, Area, LifeContext } from '../../services/types';
import { parseQuickAdd, QuickAddResult } from '../../utils/quickAddParser';

const REMINDER_LEAD_OPTIONS: { value: number | ''; label: string }[] = [
  { value: '', label: 'No reminder' },
  { value: 0, label: 'At the time' },
  { value: 10, label: '10 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 24 * 60, label: '1 day before' },
];


const SMART_PARSE_KEY = 'sage-smart-parse';
const LAST_CONTEXT_KEY = 'sage-last-context';
const MORE_OPTIONS_KEY = 'sage-add-more-options';
const KEEP_ADDING_KEY = 'sage-keep-adding';

const readPref = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writePref = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local "YYYY-MM-DDTHH:mm" (what datetime-local inputs and remindAt use). toISOString() would shift it to UTC. */
const toLocalDateTime = (d: Date) => `${toLocalDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minutesBefore = (localDateTime: string, minutes: number) =>
  toLocalDateTime(new Date(new Date(localDateTime).getTime() - minutes * 60000));

/** Date the typed text points at: an explicit date, the next matching weekday for "every <day>", or today when only a time was typed. */
function parsedDate(p: QuickAddResult | null): string {
  if (!p) return '';
  if (p.date) return p.date;
  const weekly = p.repeatRule?.match(/^weekly:(\d)$/);
  if (weekly) {
    const d = new Date();
    d.setDate(d.getDate() + ((parseInt(weekly[1], 10) - d.getDay() + 7) % 7));
    return toLocalDate(d);
  }
  return p.time ? toLocalDate(new Date()) : '';
}

function parsedDateTime(p: QuickAddResult | null): string {
  const date = parsedDate(p);
  return date ? `${date}T${p?.time || '09:00'}` : '';
}

/** The form's recurrence selects only know the plain rules, so "every monday" (weekly:1) becomes weekly. */
const parsedRepeat = (p: QuickAddResult | null) => (p?.repeatRule ? p.repeatRule.replace(/^weekly:\d$/, 'weekly') : '');

function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

function durationToMinutes(text: string): number | undefined {
  const h = text.match(/(\d+)\s*h/i);
  const m = text.match(/(\d+)\s*m/i);
  const total = (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
  return total > 0 ? total : undefined;
}

const mergeTags = (manual: string[], parsed: QuickAddResult | null) => Array.from(new Set([...manual, ...(parsed?.tags || [])]));

/**
 * Keeps form fields in sync with what the title text says ("tomorrow 3pm #work !high").
 * Fields the user has changed by hand are never overwritten; everything else follows
 * the text, so deleting a token from the title clears the field it filled.
 */
function useParsedFields<T extends Record<string, any>>(
  parsed: QuickAddResult | null,
  derive: (p: QuickAddResult | null) => Partial<T>,
  setPayload: React.Dispatch<React.SetStateAction<T>>
) {
  const manual = useRef(new Set<string>());
  useEffect(() => {
    const derived = derive(parsed);
    setPayload(prev => {
      let changed = false;
      const next: any = { ...prev };
      for (const [key, value] of Object.entries(derived)) {
        if (!manual.current.has(key) && next[key] !== value) {
          next[key] = value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [parsed]);

  return <K extends keyof T>(key: K, value: T[K]) => {
    manual.current.add(key as string);
    setPayload(prev => ({ ...prev, [key]: value }));
  };
}

interface SmartTitleState {
  title: string;
  setTitle: (t: string) => void;
  parsed: QuickAddResult | null;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  entityType: string;
  setEntityType: (t: string) => void;
}

interface CreateTaskModalProps {
  onClose: () => void;
  onCreate: (payload: any) => Promise<void>;
  workspaceId: string;
  // The context the app is filtered to; unset when work and personal show together.
  lifeContext?: LifeContext;
  // Opened from the Focus view: new tasks go straight into Focus.
  defaultFocus?: boolean;
}

export function CreateTaskModal({ onClose, onCreate, workspaceId, lifeContext: filterContext, defaultFocus = false }: CreateTaskModalProps) {
  // Work or personal: the filtered context if there is one, else whatever was used last.
  const [lifeContext, setLifeContext] = useState<LifeContext>(() => filterContext || (readPref(LAST_CONTEXT_KEY) === 'personal' ? 'personal' : 'work'));
  const [keepAdding, setKeepAdding] = useState(() => readPref(KEEP_ADDING_KEY) === 'on');
  const [entityType, setEntityType] = useState('task');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [smartEnabled, setSmartEnabled] = useState(() => {
    try { return localStorage.getItem(SMART_PARSE_KEY) !== 'off'; } catch { return true; }
  });
  const parsed = useMemo(() => (smartEnabled && title.trim() ? parseQuickAdd(title) : null), [title, smartEnabled]);
  const smart: SmartTitleState = {
    title, setTitle, parsed, entityType, setEntityType,
    enabled: smartEnabled,
    setEnabled: (v: boolean) => {
      setSmartEnabled(v);
      try { localStorage.setItem(SMART_PARSE_KEY, v ? 'on' : 'off'); } catch { /* storage unavailable */ }
    },
  };
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSubmitting, onClose]);

  useEffect(() => {
    Promise.all([
      api.projects.list(),
      api.areas.list()
    ]).then(([pList, aList]) => {
      setProjects(pList);
      setAreas(aList);
    });
  }, []);

  const handleSubmit = async (payload: any) => {
    setIsSubmitting(true);
    try {
      // The forms prefill both a project and a life area; keep only the one this context shows.
      const scope = lifeContext === 'personal' ? { projectId: null } : { areaId: null };
      await onCreate({ ...payload, ...scope, title: parsed?.title || title.trim(), entityType, lifeContext });
      writePref(LAST_CONTEXT_KEY, lifeContext);
      if (keepAdding) {
        // Stay open for the next one; fields set by hand carry over.
        setIsSubmitting(false);
        setTitle('');
        setTimeout(() => (document.querySelector('[data-title-input]') as HTMLInputElement | null)?.focus(), 30);
      } else {
        onClose();
      }
    } catch (e) {
      setIsSubmitting(false);
    }
  };
  const keep = { keepAdding, setKeepAdding: (v: boolean) => { setKeepAdding(v); writePref(KEEP_ADDING_KEY, v ? 'on' : 'off'); } };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 font-sans">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 scrim" onClick={() => !isSubmitting && onClose()} />
      {/* A bottom sheet on phones, where the thumb is; a centred dialog elsewhere. */}
      <motion.div role="dialog" aria-modal="true" aria-label="New item" initial={{ opacity: 0, scale: 0.97, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 12 }} transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-2xl rounded-t-3xl sm:rounded-3xl pb-[env(safe-area-inset-bottom)] sm:pb-0 shadow-[0_24px_64px_-16px_rgb(16_24_40/0.35)] dark:shadow-[0_24px_64px_-12px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.06)] overflow-hidden relative z-10 flex flex-col max-h-[90vh] ring-1 ring-black/5 dark:ring-white/10">
        
        <div className="h-14 border-b border-gray-100 dark:border-white/5 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">New Item</h2>
            {/* Work or personal, one tap; follows the sidebar filter when it narrows to one. */}
            <div className="flex p-0.5 rounded-lg bg-gray-100 dark:bg-white/5" role="group" aria-label="Work or personal">
              {(['work', 'personal'] as const).map(c => (
                <button key={c} type="button" aria-pressed={lifeContext === c} onClick={() => setLifeContext(c)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold transition-colors ${lifeContext === c ? (c === 'personal' ? 'bg-white dark:bg-[#3a3a3c] text-orange-600 dark:text-orange-400 shadow-sm' : 'bg-white dark:bg-[#3a3a3c] text-gray-900 dark:text-white shadow-sm') : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
                  {c === 'work' ? <Briefcase size={12} /> : <Sun size={12} />} {c === 'work' ? 'Work' : 'Personal'}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => !isSubmitting && onClose()} className="p-1.5 -mr-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-white/10 transition-colors" disabled={isSubmitting} aria-label="Close"><X size={18}/></button>
        </div>

        <div className="px-6 pt-5 pb-2 shrink-0">
          <div className="flex p-1 gap-1 rounded-xl bg-gray-100 dark:bg-white/5">
             {Object.entries(ENTITY_TYPES).map(([k, v]) => (
                <label key={k} className={`relative flex-1 flex items-center justify-center py-1.5 px-3 rounded-lg cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500/60 ${entityType === v ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}>
                   {entityType === v && <motion.span layoutId="entity-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-lg bg-white dark:bg-[#3a3a3c] shadow-sm ring-1 ring-black/5 dark:ring-white/5" />}
                   <input type="radio" name="entityType" value={v} checked={entityType === v} onChange={(e) => setEntityType(e.target.value)} className="sr-only" />
                   <span className="relative text-[13px] capitalize font-semibold">{v}</span>
                </label>
             ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pt-3">
          {entityType === 'task' && <TaskForm smart={smart} onSubmit={handleSubmit} isSubmitting={isSubmitting} onCancel={onClose} workspaceId={workspaceId} lifeContext={lifeContext} projects={projects} areas={areas} keep={keep} defaultFocus={defaultFocus} />}
          {entityType === 'event' && <EventForm smart={smart} onSubmit={handleSubmit} isSubmitting={isSubmitting} onCancel={onClose} workspaceId={workspaceId} lifeContext={lifeContext} projects={projects} areas={areas} keep={keep} />}
          {entityType === 'reminder' && <ReminderForm smart={smart} onSubmit={handleSubmit} isSubmitting={isSubmitting} onCancel={onClose} workspaceId={workspaceId} lifeContext={lifeContext} projects={projects} areas={areas} keep={keep} />}
          {entityType === 'milestone' && <MilestoneForm smart={smart} onSubmit={handleSubmit} isSubmitting={isSubmitting} onCancel={onClose} workspaceId={workspaceId} lifeContext={lifeContext} projects={projects} areas={areas} keep={keep} />}
        </div>
      </motion.div>
    </div>
  );
}

function SmartTitle({ smart, disabled, placeholder = "Title" }: { smart: SmartTitleState; disabled?: boolean; placeholder?: string }) {
  const { title, setTitle, parsed, enabled, setEnabled, entityType, setEntityType } = smart;
  const chips: { icon: React.ElementType; label: string }[] = [];
  if (parsed) {
    if (parsed.dateLabel) chips.push({ icon: Calendar, label: parsed.dateLabel });
    if (parsed.time) chips.push({ icon: Clock, label: parsed.time });
    if (parsed.priority) chips.push({ icon: Flag, label: parsed.priority[0].toUpperCase() + parsed.priority.slice(1) });
    if (parsed.repeatLabel) chips.push({ icon: Repeat, label: parsed.repeatLabel });
    if (parsed.durationMinutes) chips.push({ icon: Timer, label: formatDuration(parsed.durationMinutes) });
    if (parsed.location) chips.push({ icon: MapPin, label: parsed.location });
    parsed.tags.forEach(t => chips.push({ icon: Tag, label: `#${t}` }));
  }
  const suggestedType = parsed && parsed.entityType !== 'task' && entityType === 'task' ? parsed.entityType : null;

  return (
    <div className="mb-3">
      <input autoFocus data-title-input type="text" placeholder={placeholder} required disabled={disabled} enterKeyHint="done"
        className="w-full text-xl font-bold bg-transparent outline-none placeholder-gray-400 dark:placeholder-gray-600 text-gray-900 dark:text-white"
        value={title} onChange={e => setTitle(e.target.value)} />
      <div className="flex flex-wrap items-center gap-1.5 mt-2 min-h-[22px]">
        <button type="button" onClick={() => setEnabled(!enabled)}
          title={enabled ? 'Turn off reading dates, #tags, !priority, @place from the title' : 'Read dates, #tags, !priority, @place from the title'}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${enabled ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' : 'bg-gray-100 dark:bg-white/10 text-gray-400'}`}>
          <Sparkles size={10} /> Smart {enabled ? 'on' : 'off'}
        </button>
        {enabled && chips.map(({ icon: Icon, label }) => (
          <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
            <Icon size={10} /> {label}
          </span>
        ))}
        {enabled && parsed && chips.length > 0 && parsed.title !== title.trim() && (
          <span className="text-[11px] font-medium text-gray-400 truncate max-w-full">Saves as "{parsed.title}"</span>
        )}
        {suggestedType && (
          <button type="button" onClick={() => setEntityType(suggestedType)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200">
            Make it {suggestedType === 'event' ? 'an event' : 'a reminder'}
          </button>
        )}
        {enabled && !title && (
          <span className="text-[11px] font-medium text-gray-400">Try "Call Sam tomorrow 5pm #family !high"</span>
        )}
      </div>
    </div>
  );
}

const SharedDesc = ({ desc, setDesc, disabled }: any) => (
  <textarea placeholder="Add details, links, or notes..." rows={3} disabled={disabled}
    className="w-full text-[14px] font-medium bg-transparent outline-none placeholder-gray-400 dark:placeholder-gray-600 text-gray-700 dark:text-gray-300 resize-none mb-4"
    value={desc} onChange={e => setDesc(e.target.value)} />
);

const SharedTags = ({ tags, setTags }: { tags: string[]; setTags: (t: string[]) => void }) => {
  const [draft, setDraft] = useState('');
  const addTag = (raw: string) => {
    const clean = raw.trim().toLowerCase().replace(/^#/, '');
    if (!clean || tags.includes(clean)) return;
    setTags([...tags, clean]);
  };
  return (
    <div className="space-y-1 col-span-2">
      <label className="field-label"><Tag size={11} /> Tags</label>
      <div className="flex flex-wrap items-center gap-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2">
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
            #{t}
            <button type="button" onClick={() => setTags(tags.filter(x => x !== t))}><X size={10} /></button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(draft);
              setDraft('');
            }
          }}
          placeholder={tags.length === 0 ? 'Type a tag and press Enter...' : 'Add another...'}
          className="flex-1 min-w-[100px] bg-transparent border-none outline-none text-[13px] font-medium"
        />
      </div>
      {LABELS.filter(l => !tags.includes(l.name)).length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {LABELS.filter(l => !tags.includes(l.name)).map(l => (
            <button key={l.id} type="button" onClick={() => addTag(l.name)} className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200">
              + {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SharedReminderLead = ({ value, setValue }: { value: number | ''; setValue: (v: number | '') => void }) => (
  <div className="space-y-1">
    <label className="field-label">Remind Me</label>
    <select className="field"
      value={value} onChange={e => setValue(e.target.value === '' ? '' : parseInt(e.target.value, 10))}>
      {REMINDER_LEAD_OPTIONS.map(opt => <option key={opt.label} value={opt.value}>{opt.label}</option>)}
    </select>
  </div>
);

const FooterActions = ({ isSubmitting, onCancel, label = 'Create Item', disabled = false, keep }: any) => (
  <div className="sticky bottom-0 -mx-6 px-6 py-4 mt-6 border-t border-gray-100 dark:border-white/5 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur flex items-center justify-end gap-2 shrink-0">
    {keep ? (
      <label className="mr-auto flex items-center gap-2 whitespace-nowrap text-[12.5px] font-medium text-gray-500 dark:text-gray-400 cursor-pointer select-none" title="Stay open after saving so you can add the next one">
        <input type="checkbox" checked={keep.keepAdding} onChange={e => keep.setKeepAdding(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
        Keep adding
      </label>
    ) : (
      <span className="mr-auto hidden sm:flex items-center gap-1.5 text-[12px] text-gray-400"><kbd className="kbd">Esc</kbd> to close</span>
    )}
    <button type="button" onClick={onCancel} disabled={isSubmitting} className="px-4 py-2 rounded-xl text-[14px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">Cancel</button>
    <button type="submit" disabled={isSubmitting || disabled} className="px-5 py-2 min-w-[7.5rem] justify-center rounded-xl text-[14px] font-semibold bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center gap-2 shadow-sm shadow-blue-600/25 transition-all">
      {isSubmitting ? <Loader2 size={17} className="animate-spin" /> : label}
    </button>
  </div>
);

// One-tap "when" choices for a task: the dates people pick most often.
function whenOptions() {
  const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return toLocalDate(d); };
  const now = new Date();
  const toSaturday = (6 - now.getDay() + 7) % 7;
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  return [
    { label: 'Today', value: day(0) },
    { label: 'Tomorrow', value: day(1) },
    ...(toSaturday > 1 ? [{ label: 'Weekend', value: day(toSaturday) }] : []),
    { label: 'Next week', value: day(toMonday) },
  ];
}

const PRIORITY_CYCLE = ['medium', 'high', 'urgent', 'low'] as const;
const PRIORITY_STYLE: Record<string, string> = {
  low: 'text-gray-500',
  medium: 'text-gray-500',
  high: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 ring-orange-500/30',
  urgent: 'text-red-600 dark:text-red-400 bg-red-500/10 ring-red-500/30',
};

const chipBase = 'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold ring-1 ring-inset transition-colors active:scale-[0.97]';
const chipOff = 'ring-black/[0.08] dark:ring-white/10 text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]';
const chipOn = 'bg-blue-600 text-white ring-blue-600 dark:bg-blue-500 dark:ring-blue-500';

function TaskForm({ smart, onSubmit, isSubmitting, onCancel, workspaceId, lifeContext, projects = [], areas = [], keep, defaultFocus }: any) {
  const [payload, setPayload] = useState({
    description: '', type: 'task', priority: 'medium',
    projectId: workspaceId !== 'all' ? workspaceId : (projects[0]?.id || ''),
    areaId: areas[0]?.id || '', startDate: '', dueDate: '', estimated: '',
    location: '', repeatRule: '', isFocus: !!defaultFocus
  });
  const [tags, setTags] = useState<string[]>([]);
  const [reminderLead, setReminderLead] = useState<number | ''>('');
  // Details most tasks don't need stay folded away until asked for.
  const [moreOpen, setMoreOpen] = useState(() => readPref(MORE_OPTIONS_KEY) === 'open');
  const toggleMore = () => { setMoreOpen(o => { writePref(MORE_OPTIONS_KEY, o ? 'closed' : 'open'); return !o; }); };
  const set = useParsedFields(smart.parsed, p => ({
    dueDate: parsedDate(p),
    priority: p?.priority || 'medium',
    location: p?.location || '',
    repeatRule: parsedRepeat(p),
    estimated: formatDuration(p?.durationMinutes),
  }), setPayload);

  useEffect(() => {
    if (projects.length > 0 && (!payload.projectId || payload.projectId === 'all')) {
      setPayload(prev => ({ ...prev, projectId: projects[0].id }));
    }
    if (areas.length > 0 && !payload.areaId) {
      setPayload(prev => ({ ...prev, areaId: areas[0].id }));
    }
  }, [projects, areas]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const startDate = payload.startDate ? payload.startDate : null;
    const dueDate = payload.dueDate ? payload.dueDate : (payload.startDate ? payload.startDate : null);
    let remindAt: string | null = null;
    if (reminderLead !== '' && dueDate) {
      remindAt = minutesBefore(`${dueDate}T${smart.parsed?.time || '09:00'}`, reminderLead);
    }
    onSubmit({
      ...payload,
      // Choosing Focus is a decision about the item, so it leaves the Inbox.
      ...(payload.isFocus ? { focusOrder: Date.now(), isInbox: false } : {}),
      estimatedMinutes: durationToMinutes(payload.estimated),
      labels: mergeTags(tags, smart.parsed),
      startDate,
      dueDate,
      remindAt,
      reminderLeadMinutes: reminderLead === '' ? null : reminderLead
    });
  };

  const options = whenOptions();
  const customDate = payload.dueDate && !options.some(o => o.value === payload.dueDate);
  const personal = lifeContext === 'personal';
  const moreSummary = [
    personal ? areas.find((a: any) => a.id === payload.areaId)?.name : projects.find((p: any) => p.id === payload.projectId)?.name,
    payload.estimated, payload.repeatRule && 'repeats', reminderLead !== '' && 'reminder', tags.length > 0 && `${tags.length} tag${tags.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');

  return (
    <form onSubmit={handleSubmit}>
      <SmartTitle smart={smart} disabled={isSubmitting} placeholder="What needs to be done?" />

      {/* The common choices, one tap each. */}
      <div className="flex flex-nowrap sm:flex-wrap items-center gap-2 mb-4 -mx-6 px-6 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar" role="group" aria-label="When">
        {options.map(o => {
          const on = payload.dueDate === o.value;
          return (
            <button key={o.label} type="button" aria-pressed={on} onClick={() => set('dueDate', on ? '' : o.value)} className={`${chipBase} ${on ? chipOn : chipOff}`}>
              {o.label === 'Today' && <Calendar size={13} />} {o.label}
            </button>
          );
        })}
        <label className={`${chipBase} ${customDate ? chipOn : chipOff} relative cursor-pointer`}>
          <Calendar size={13} />
          {customDate ? new Date(`${payload.dueDate}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Pick date'}
          <input type="date" aria-label="Due date" value={payload.dueDate} onChange={e => set('dueDate', e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        <span className="shrink-0 w-px h-5 bg-black/10 dark:bg-white/10 mx-0.5" aria-hidden />
        <button type="button" onClick={() => set('priority', PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(payload.priority as any) + 1) % PRIORITY_CYCLE.length])}
          className={`${chipBase} ${payload.priority === 'high' || payload.priority === 'urgent' ? PRIORITY_STYLE[payload.priority] : chipOff}`}
          title="Tap to change priority" aria-label={`Priority: ${payload.priority}`}>
          <Flag size={13} /> {payload.priority === 'medium' ? 'Priority' : payload.priority[0].toUpperCase() + payload.priority.slice(1)}
        </button>
        <button type="button" aria-pressed={payload.isFocus} onClick={() => set('isFocus', !payload.isFocus)}
          className={`${chipBase} ${payload.isFocus ? 'bg-amber-500 text-white ring-amber-500' : chipOff}`}>
          <Target size={13} /> {payload.isFocus ? 'In Focus' : 'Focus'}
        </button>
      </div>

      <button type="button" onClick={toggleMore} aria-expanded={moreOpen}
        className="w-full flex items-center gap-2 py-2 text-[13px] font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
        <ChevronDown size={15} className={`transition-transform duration-200 ${moreOpen ? '' : '-rotate-90'}`} />
        More options
        {!moreOpen && moreSummary && <span className="font-medium text-gray-400 truncate">· {moreSummary}</span>}
      </button>

      {moreOpen && (
      <div className="pt-2 animate-[rise_260ms_var(--ease-out-expo)]">
      <SharedDesc desc={payload.description} setDesc={(v:any) => set('description', v)} disabled={isSubmitting} />

      <div className="grid grid-cols-2 gap-4">
        {!personal ? (
          <div className="space-y-1">
            <label className="field-label">Project</label>
            <select className="field" value={payload.projectId} onChange={e => set('projectId', e.target.value)} disabled={isSubmitting}>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {projects.length === 0 && <option value="">No projects</option>}
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="field-label">Life Area</label>
            <select className="field field-personal" value={payload.areaId} onChange={e => set('areaId', e.target.value)} disabled={isSubmitting}>
              {areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              {areas.length === 0 && <option value="">No Life Areas Yet</option>}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className="field-label">Estimated Time</label>
          <input type="text" className="field" value={payload.estimated} onChange={e => set('estimated', e.target.value)} disabled={isSubmitting} placeholder="e.g. 2h, 45m" />
        </div>
        <div className="space-y-1">
          <label className="field-label">Start Date</label>
          <input type="date" className="field" value={payload.startDate} onChange={e => set('startDate', e.target.value)} disabled={isSubmitting} />
        </div>
        <div className="space-y-1">
          <label className="field-label">Due Date</label>
          <input type="date" className="field" value={payload.dueDate} onChange={e => set('dueDate', e.target.value)} disabled={isSubmitting} />
        </div>

        <div className="space-y-1">
          <label className="field-label">Location</label>
          <input type="text" className="field" value={payload.location} onChange={e => set('location', e.target.value)} disabled={isSubmitting} placeholder="Optional" />
        </div>

        <div className="space-y-1">
          <label className="field-label">Recurrence</label>
          <select className="field" value={payload.repeatRule} onChange={e => set('repeatRule', e.target.value)} disabled={isSubmitting}>
            <option value="">Never</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        <SharedReminderLead value={reminderLead} setValue={setReminderLead} />

        <SharedTags tags={tags} setTags={setTags} />
      </div>
      </div>
      )}

      <FooterActions isSubmitting={isSubmitting} onCancel={onCancel} label={payload.isFocus ? 'Add to Focus' : 'Add Task'} disabled={!smart.title.trim()} keep={keep} />
    </form>
  );
}

function EventForm({ smart, onSubmit, isSubmitting, onCancel, workspaceId, lifeContext, projects = [], areas = [], keep }: any) {
  const [payload, setPayload] = useState({
    description: '', type: 'meeting', startAt: '', endAt: '', location: '', repeatRule: '', priority: 'medium',
    projectId: workspaceId !== 'all' ? workspaceId : (projects[0]?.id || ''),
    areaId: areas[0]?.id || ''
  });
  const [tags, setTags] = useState<string[]>([]);
  const [reminderLead, setReminderLead] = useState<number | ''>('');
  const set = useParsedFields(smart.parsed, p => {
    const startAt = parsedDateTime(p);
    return {
      startAt,
      endAt: startAt ? minutesBefore(startAt, -(p?.durationMinutes || 60)) : '',
      priority: p?.priority || 'medium',
      location: p?.location || '',
      repeatRule: parsedRepeat(p),
    };
  }, setPayload);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const startAt = payload.startAt ? payload.startAt : null;
    const endAt = payload.endAt ? payload.endAt : null;
    const startDate = startAt ? startAt.slice(0, 10) : null;
    const dueDate = endAt ? endAt.slice(0, 10) : startDate;
    let remindAt: string | null = null;
    if (reminderLead !== '' && startAt) {
      remindAt = minutesBefore(startAt, reminderLead);
    }
    onSubmit({
      ...payload,
      labels: mergeTags(tags, smart.parsed),
      startAt,
      endAt,
      startDate,
      dueDate,
      remindAt,
      reminderLeadMinutes: reminderLead === '' ? null : reminderLead
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <SmartTitle smart={smart} disabled={isSubmitting} placeholder="Event Name" />
      <SharedDesc desc={payload.description} setDesc={(v:any) => set('description', v)} disabled={isSubmitting} />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="field-label">{lifeContext === 'personal' ? 'Life Area' : 'Project'}</label>
          {lifeContext === 'personal' ? (
            <select className="field field-personal" value={payload.areaId} onChange={e => set('areaId', e.target.value)} disabled={isSubmitting}>
              <option value="">No Life Area</option>
              {areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <select className="field" value={payload.projectId} onChange={e => set('projectId', e.target.value)} disabled={isSubmitting}>
              <option value="">No Project</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-1">
          <label className="field-label">Starts</label>
          <input type="datetime-local" className="field" value={payload.startAt} onChange={e => set('startAt', e.target.value)} disabled={isSubmitting} />
        </div>
        <div className="space-y-1">
          <label className="field-label">Ends</label>
          <input type="datetime-local" className="field" value={payload.endAt} onChange={e => set('endAt', e.target.value)} disabled={isSubmitting} />
        </div>
        <div className="space-y-1">
          <label className="field-label">Recurrence</label>
          <select className="field" value={payload.repeatRule} onChange={e => set('repeatRule', e.target.value)} disabled={isSubmitting}>
            <option value="">Never</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        <div className="space-y-1 col-span-2">
          <label className="field-label">Location or Meeting Link</label>
          <input type="text" className="field" value={payload.location} onChange={e => set('location', e.target.value)} disabled={isSubmitting} placeholder="e.g. Zoom link, Cafe, Office" />
        </div>

        <SharedReminderLead value={reminderLead} setValue={setReminderLead} />

        <SharedTags tags={tags} setTags={setTags} />
      </div>

      <FooterActions isSubmitting={isSubmitting} onCancel={onCancel} label="Add Event" disabled={!smart.title.trim()} keep={keep} />
    </form>
  );
}

function ReminderForm({ smart, onSubmit, isSubmitting, onCancel, workspaceId, lifeContext, projects = [], areas = [], keep }: any) {
  const [payload, setPayload] = useState({
    description: '', type: 'reminder', remindAt: '', repeatRule: '', priority: 'medium',
    projectId: workspaceId !== 'all' ? workspaceId : (projects[0]?.id || ''),
    areaId: areas[0]?.id || ''
  });
  const [tags, setTags] = useState<string[]>([]);
  const set = useParsedFields(smart.parsed, p => ({
    remindAt: parsedDateTime(p),
    priority: p?.priority || 'medium',
    repeatRule: parsedRepeat(p),
  }), setPayload);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const remindAt = payload.remindAt ? payload.remindAt : null;
    const dueDate = remindAt ? remindAt.slice(0, 10) : null;
    onSubmit({
      ...payload,
      labels: mergeTags(tags, smart.parsed),
      remindAt,
      dueDate,
      startDate: dueDate
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <SmartTitle smart={smart} disabled={isSubmitting} placeholder="What do you want to remember?" />
      <SharedDesc desc={payload.description} setDesc={(v:any) => set('description', v)} disabled={isSubmitting} />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="field-label">Remind At</label>
          <input type="datetime-local" className="field" value={payload.remindAt} onChange={e => set('remindAt', e.target.value)} disabled={isSubmitting} />
        </div>
        <div className="space-y-1">
          <label className="field-label">Repeat</label>
          <select className="field" value={payload.repeatRule} onChange={e => set('repeatRule', e.target.value)} disabled={isSubmitting}>
            <option value="">Never</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        <div className="space-y-1 col-span-2">
          <label className="field-label">{lifeContext === 'personal' ? 'Life Area' : 'Project'}</label>
          {lifeContext === 'personal' ? (
            <select className="field field-personal" value={payload.areaId} onChange={e => set('areaId', e.target.value)} disabled={isSubmitting}>
              <option value="">No Life Area</option>
              {areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <select className="field" value={payload.projectId} onChange={e => set('projectId', e.target.value)} disabled={isSubmitting}>
              <option value="">No Project</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        <SharedTags tags={tags} setTags={setTags} />
      </div>

      <FooterActions isSubmitting={isSubmitting} onCancel={onCancel} label="Set Reminder" disabled={!smart.title.trim()} keep={keep} />
    </form>
  );
}

function MilestoneForm({ smart, onSubmit, isSubmitting, onCancel, workspaceId, lifeContext, projects = [], areas = [], keep }: any) {
  const [payload, setPayload] = useState({
    description: '', type: 'milestone', dueDate: '', priority: 'medium',
    projectId: workspaceId !== 'all' ? workspaceId : (projects[0]?.id || ''),
    areaId: areas[0]?.id || ''
  });
  const [tags, setTags] = useState<string[]>([]);
  const set = useParsedFields(smart.parsed, p => ({
    dueDate: parsedDate(p),
    priority: p?.priority || 'medium',
  }), setPayload);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dueDate = payload.dueDate ? payload.dueDate : null;
    onSubmit({
      ...payload,
      labels: mergeTags(tags, smart.parsed),
      dueDate,
      startDate: dueDate
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <SmartTitle smart={smart} disabled={isSubmitting} placeholder="Milestone / Key Checkpoint Name" />
      <SharedDesc desc={payload.description} setDesc={(v:any) => set('description', v)} disabled={isSubmitting} />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="field-label">Target Checkpoint Date</label>
          <input type="date" className="field" value={payload.dueDate} onChange={e => set('dueDate', e.target.value)} disabled={isSubmitting} required />
        </div>

        <div className="space-y-1">
          <label className="field-label">{lifeContext === 'personal' ? 'Life Area' : 'Project'}</label>
          {lifeContext === 'personal' ? (
            <select className="field field-personal" value={payload.areaId} onChange={e => set('areaId', e.target.value)} disabled={isSubmitting}>
              {areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              {areas.length === 0 && <option value="">No Life Areas</option>}
            </select>
          ) : (
            <select className="field" value={payload.projectId} onChange={e => set('projectId', e.target.value)} disabled={isSubmitting}>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {projects.length === 0 && <option value="">No Projects</option>}
            </select>
          )}
        </div>

        <SharedTags tags={tags} setTags={setTags} />
      </div>

      <FooterActions isSubmitting={isSubmitting} onCancel={onCancel} label="Add Milestone" disabled={!smart.title.trim() || !payload.dueDate} keep={keep} />
    </form>
  );
}
