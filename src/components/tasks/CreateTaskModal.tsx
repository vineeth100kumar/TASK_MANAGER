import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Tag } from 'lucide-react';
import { PRIORITIES, WORK_ITEM_TYPES, ENTITY_TYPES, LABELS } from '../../services/mockDb';
import { api } from '../../services/api';
import { Project, Area } from '../../services/types';

const REMINDER_LEAD_OPTIONS: { value: number | ''; label: string }[] = [
  { value: '', label: 'No reminder' },
  { value: 0, label: 'At the time' },
  { value: 10, label: '10 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 24 * 60, label: '1 day before' },
];

interface CreateTaskModalProps {
  onClose: () => void;
  onCreate: (payload: any) => Promise<void>;
  workspaceId: string;
  lifeContext?: 'work' | 'personal';
}

export function CreateTaskModal({ onClose, onCreate, workspaceId, lifeContext = 'work' }: CreateTaskModalProps) {
  const [entityType, setEntityType] = useState('task');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

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
      await onCreate({ ...payload, entityType, lifeContext });
      onClose();
    } catch (e) {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0 font-sans">
      <div className="absolute inset-0 bg-black/20 dark:bg-black/60 backdrop-blur-sm" onClick={() => !isSubmitting && onClose()} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[90vh] border border-gray-100 dark:border-white/10">
        
        <div className="h-14 border-b border-gray-100 dark:border-white/5 flex items-center justify-between px-6 shrink-0">
          <h2 className="font-bold text-gray-900 dark:text-white">Create New Item</h2>
          <button onClick={() => !isSubmitting && onClose()} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" disabled={isSubmitting}><X size={20}/></button>
        </div>

        <div className="p-6 pb-2 shrink-0">
          <div className="flex gap-3">
             {Object.entries(ENTITY_TYPES).map(([k, v]) => (
                <label key={k} className={`flex-1 flex flex-col items-center justify-center py-2.5 px-3 rounded-2xl border-2 cursor-pointer transition-all ${entityType === v ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:border-blue-200'}`}>
                   <input type="radio" name="entityType" value={v} checked={entityType === v} onChange={(e) => setEntityType(e.target.value)} className="sr-only" />
                   <span className="text-[13px] capitalize font-bold">{v}</span>
                </label>
             ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 pt-2">
          {entityType === 'task' && <TaskForm onSubmit={handleSubmit} isSubmitting={isSubmitting} onCancel={onClose} workspaceId={workspaceId} lifeContext={lifeContext} projects={projects} areas={areas} />}
          {entityType === 'event' && <EventForm onSubmit={handleSubmit} isSubmitting={isSubmitting} onCancel={onClose} workspaceId={workspaceId} lifeContext={lifeContext} projects={projects} areas={areas} />}
          {entityType === 'reminder' && <ReminderForm onSubmit={handleSubmit} isSubmitting={isSubmitting} onCancel={onClose} workspaceId={workspaceId} lifeContext={lifeContext} projects={projects} areas={areas} />}
          {entityType === 'milestone' && <MilestoneForm onSubmit={handleSubmit} isSubmitting={isSubmitting} onCancel={onClose} workspaceId={workspaceId} lifeContext={lifeContext} projects={projects} areas={areas} />}
        </div>
      </motion.div>
    </div>
  );
}

const SharedTitle = ({ title, setTitle, disabled, placeholder = "Title" }: any) => (
  <input autoFocus type="text" placeholder={placeholder} required disabled={disabled}
    className="w-full text-xl font-bold bg-transparent outline-none placeholder-gray-400 dark:placeholder-gray-600 text-gray-900 dark:text-white mb-3"
    value={title} onChange={e => setTitle(e.target.value)} />
);

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
      <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase flex items-center gap-1"><Tag size={11} /> Tags</label>
      <div className="flex flex-wrap items-center gap-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2">
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
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
            <button key={l.id} type="button" onClick={() => addTag(l.name)} className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200">
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
    <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Remind Me</label>
    <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500"
      value={value} onChange={e => setValue(e.target.value === '' ? '' : parseInt(e.target.value, 10))}>
      {REMINDER_LEAD_OPTIONS.map(opt => <option key={opt.label} value={opt.value}>{opt.label}</option>)}
    </select>
  </div>
);

const FooterActions = ({ isSubmitting, onCancel, label = 'Create Item', disabled = false }: any) => (
  <div className="pt-6 mt-6 border-t border-gray-100 dark:border-white/5 flex justify-end gap-3 shrink-0">
    <button type="button" onClick={onCancel} disabled={isSubmitting} className="px-5 py-2.5 rounded-xl font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5">Cancel</button>
    <button type="submit" disabled={isSubmitting || disabled} className="px-6 py-2.5 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-blue-500/20">
      {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : label}
    </button>
  </div>
);

function TaskForm({ onSubmit, isSubmitting, onCancel, workspaceId, lifeContext, projects = [], areas = [] }: any) {
  const [payload, setPayload] = useState({
    title: '', description: '', type: 'task', priority: 'medium',
    projectId: workspaceId !== 'all' ? workspaceId : (projects[0]?.id || ''),
    areaId: areas[0]?.id || '', startDate: '', dueDate: '', estimated: '',
    location: '', repeatRule: ''
  });
  const [tags, setTags] = useState<string[]>([]);
  const [reminderLead, setReminderLead] = useState<number | ''>('');

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
      const anchor = new Date(`${dueDate}T09:00`);
      remindAt = new Date(anchor.getTime() - reminderLead * 60000).toISOString().slice(0, 16);
    }
    onSubmit({
      ...payload,
      labels: tags,
      startDate,
      dueDate,
      remindAt,
      reminderLeadMinutes: reminderLead === '' ? null : reminderLead
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <SharedTitle title={payload.title} setTitle={(v:any) => setPayload({...payload, title: v})} disabled={isSubmitting} placeholder="What needs to be done?" />
      <SharedDesc desc={payload.description} setDesc={(v:any) => setPayload({...payload, description: v})} disabled={isSubmitting} />

      <div className="grid grid-cols-2 gap-4">
        {lifeContext === 'work' ? (
          <>
            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Project</label>
              <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.projectId} onChange={e => setPayload({...payload, projectId: e.target.value})} disabled={isSubmitting}>
                {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {projects.length === 0 && <option value="">No Projects Yet</option>}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Priority</label>
              <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.priority} onChange={e => setPayload({...payload, priority: e.target.value})} disabled={isSubmitting}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent 🔥</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Start Date</label>
              <input type="date" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.startDate} onChange={e => setPayload({...payload, startDate: e.target.value})} disabled={isSubmitting} />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Due Date</label>
              <input type="date" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.dueDate} onChange={e => setPayload({...payload, dueDate: e.target.value})} disabled={isSubmitting} />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Estimated Time</label>
              <input type="text" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.estimated} onChange={e => setPayload({...payload, estimated: e.target.value})} disabled={isSubmitting} placeholder="e.g. 2h, 45m" />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Life Area</label>
              <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-orange-500" value={payload.areaId} onChange={e => setPayload({...payload, areaId: e.target.value})} disabled={isSubmitting}>
                {areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                {areas.length === 0 && <option value="">No Life Areas Yet</option>}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Priority</label>
              <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-orange-500" value={payload.priority} onChange={e => setPayload({...payload, priority: e.target.value})} disabled={isSubmitting}>
                <option value="low">Low</option>
                <option value="medium">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Start Date</label>
              <input type="date" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-orange-500" value={payload.startDate} onChange={e => setPayload({...payload, startDate: e.target.value})} disabled={isSubmitting} />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Due Date</label>
              <input type="date" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-orange-500" value={payload.dueDate} onChange={e => setPayload({...payload, dueDate: e.target.value})} disabled={isSubmitting} />
            </div>
          </>
        )}

        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Location</label>
          <input type="text" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.location} onChange={e => setPayload({...payload, location: e.target.value})} disabled={isSubmitting} placeholder="Optional" />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Recurrence</label>
          <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.repeatRule} onChange={e => setPayload({...payload, repeatRule: e.target.value})} disabled={isSubmitting}>
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

      <FooterActions isSubmitting={isSubmitting} onCancel={onCancel} label="Add Task" disabled={!payload.title.trim()} />
    </form>
  );
}

function EventForm({ onSubmit, isSubmitting, onCancel, workspaceId, lifeContext, projects = [], areas = [] }: any) {
  const [payload, setPayload] = useState({
    title: '', description: '', type: 'meeting', startAt: '', endAt: '', location: '', repeatRule: '',
    projectId: workspaceId !== 'all' ? workspaceId : (projects[0]?.id || ''),
    areaId: areas[0]?.id || ''
  });
  const [tags, setTags] = useState<string[]>([]);
  const [reminderLead, setReminderLead] = useState<number | ''>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const startAt = payload.startAt ? payload.startAt : null;
    const endAt = payload.endAt ? payload.endAt : null;
    const startDate = startAt ? startAt.slice(0, 10) : null;
    const dueDate = endAt ? endAt.slice(0, 10) : startDate;
    let remindAt: string | null = null;
    if (reminderLead !== '' && startAt) {
      remindAt = new Date(new Date(startAt).getTime() - reminderLead * 60000).toISOString().slice(0, 16);
    }
    onSubmit({
      ...payload,
      labels: tags,
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
      <SharedTitle title={payload.title} setTitle={(v:any) => setPayload({...payload, title: v})} disabled={isSubmitting} placeholder="Event Name" />
      <SharedDesc desc={payload.description} setDesc={(v:any) => setPayload({...payload, description: v})} disabled={isSubmitting} />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">{lifeContext === 'personal' ? 'Life Area' : 'Project'}</label>
          {lifeContext === 'personal' ? (
            <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-orange-500" value={payload.areaId} onChange={e => setPayload({...payload, areaId: e.target.value})} disabled={isSubmitting}>
              <option value="">No Life Area</option>
              {areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.projectId} onChange={e => setPayload({...payload, projectId: e.target.value})} disabled={isSubmitting}>
              <option value="">No Project</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Starts</label>
          <input type="datetime-local" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.startAt} onChange={e => setPayload({...payload, startAt: e.target.value})} disabled={isSubmitting} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Ends</label>
          <input type="datetime-local" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.endAt} onChange={e => setPayload({...payload, endAt: e.target.value})} disabled={isSubmitting} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Recurrence</label>
          <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.repeatRule} onChange={e => setPayload({...payload, repeatRule: e.target.value})} disabled={isSubmitting}>
            <option value="">Never</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        <div className="space-y-1 col-span-2">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Location or Meeting Link</label>
          <input type="text" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.location} onChange={e => setPayload({...payload, location: e.target.value})} disabled={isSubmitting} placeholder="e.g. Zoom link, Cafe, Office" />
        </div>

        <SharedReminderLead value={reminderLead} setValue={setReminderLead} />

        <SharedTags tags={tags} setTags={setTags} />
      </div>

      <FooterActions isSubmitting={isSubmitting} onCancel={onCancel} label="Add Event" disabled={!payload.title.trim()} />
    </form>
  );
}

function ReminderForm({ onSubmit, isSubmitting, onCancel, workspaceId, lifeContext, projects = [], areas = [] }: any) {
  const [payload, setPayload] = useState({
    title: '', description: '', type: 'reminder', remindAt: '', repeatRule: '',
    projectId: workspaceId !== 'all' ? workspaceId : (projects[0]?.id || ''),
    areaId: areas[0]?.id || ''
  });
  const [tags, setTags] = useState<string[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const remindAt = payload.remindAt ? payload.remindAt : null;
    const dueDate = remindAt ? remindAt.slice(0, 10) : null;
    onSubmit({
      ...payload,
      labels: tags,
      remindAt,
      dueDate,
      startDate: dueDate
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <SharedTitle title={payload.title} setTitle={(v:any) => setPayload({...payload, title: v})} disabled={isSubmitting} placeholder="What do you want to remember?" />
      <SharedDesc desc={payload.description} setDesc={(v:any) => setPayload({...payload, description: v})} disabled={isSubmitting} />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Remind At</label>
          <input type="datetime-local" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.remindAt} onChange={e => setPayload({...payload, remindAt: e.target.value})} disabled={isSubmitting} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Repeat</label>
          <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.repeatRule} onChange={e => setPayload({...payload, repeatRule: e.target.value})} disabled={isSubmitting}>
            <option value="">Never</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        <div className="space-y-1 col-span-2">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">{lifeContext === 'personal' ? 'Life Area' : 'Project'}</label>
          {lifeContext === 'personal' ? (
            <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-orange-500" value={payload.areaId} onChange={e => setPayload({...payload, areaId: e.target.value})} disabled={isSubmitting}>
              <option value="">No Life Area</option>
              {areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.projectId} onChange={e => setPayload({...payload, projectId: e.target.value})} disabled={isSubmitting}>
              <option value="">No Project</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        <SharedTags tags={tags} setTags={setTags} />
      </div>

      <FooterActions isSubmitting={isSubmitting} onCancel={onCancel} label="Set Reminder" disabled={!payload.title.trim()} />
    </form>
  );
}

function MilestoneForm({ onSubmit, isSubmitting, onCancel, workspaceId, lifeContext, projects = [], areas = [] }: any) {
  const [payload, setPayload] = useState({
    title: '', description: '', type: 'milestone', dueDate: '',
    projectId: workspaceId !== 'all' ? workspaceId : (projects[0]?.id || ''),
    areaId: areas[0]?.id || ''
  });
  const [tags, setTags] = useState<string[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dueDate = payload.dueDate ? payload.dueDate : null;
    onSubmit({
      ...payload,
      labels: tags,
      dueDate,
      startDate: dueDate
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <SharedTitle title={payload.title} setTitle={(v:any) => setPayload({...payload, title: v})} disabled={isSubmitting} placeholder="Milestone / Key Checkpoint Name" />
      <SharedDesc desc={payload.description} setDesc={(v:any) => setPayload({...payload, description: v})} disabled={isSubmitting} />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Target Checkpoint Date</label>
          <input type="date" className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.dueDate} onChange={e => setPayload({...payload, dueDate: e.target.value})} disabled={isSubmitting} required />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">{lifeContext === 'personal' ? 'Life Area' : 'Project'}</label>
          {lifeContext === 'personal' ? (
            <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-orange-500" value={payload.areaId} onChange={e => setPayload({...payload, areaId: e.target.value})} disabled={isSubmitting}>
              {areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              {areas.length === 0 && <option value="">No Life Areas</option>}
            </select>
          ) : (
            <select className="w-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none focus:border-blue-500" value={payload.projectId} onChange={e => setPayload({...payload, projectId: e.target.value})} disabled={isSubmitting}>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {projects.length === 0 && <option value="">No Projects</option>}
            </select>
          )}
        </div>

        <SharedTags tags={tags} setTags={setTags} />
      </div>

      <FooterActions isSubmitting={isSubmitting} onCancel={onCancel} label="Add Milestone" disabled={!payload.title.trim() || !payload.dueDate} />
    </form>
  );
}
