import { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Check, Flag, FolderPlus, ListChecks, Loader2, Pencil, Sparkles, Wand2 } from 'lucide-react';
import { Select } from '../common/Select';
import { DatePicker } from '../common/DatePicker';
import { formatShortDate } from '../../utils/quickAddParser';
import { PLAN_TYPES, PlanTask, PlanTypeId, ProjectPlan, schedule, totalDays, endDate, spanLabel } from '../../utils/projectPlan';

const PHASE_COLORS = ['#8b5cf6', '#0ea5e9', '#10b981', '#f97316', '#ec4899', '#eab308'];
const PRIORITY_CYCLE = ['medium', 'high', 'urgent', 'low'] as const;
const DAY_STEPS = [1, 2, 3, 5, 7, 10, 14, 21, 30];

const chip = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap';
const chipGray = `${chip} bg-gray-100 dark:bg-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/[0.12]`;
const chipBlue = `${chip} bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/70`;

export interface PlanState {
  id: string;
  plan: ProjectPlan;
  loading: boolean;
  saved: boolean;
}

const range = (a: string, b: string) => (a === b ? formatShortDate(a) : `${formatShortDate(a)} – ${formatShortDate(b)}`);

export function PlanCard({ state, busy, projectName, onChange, onSave, onAsItems }: {
  state: PlanState;
  busy: boolean;
  projectName: string;
  onChange: (plan: ProjectPlan) => void;
  onSave: () => void;
  onAsItems: () => void;
}) {
  const { plan, loading, saved } = state;
  const [renaming, setRenaming] = useState(false);
  const locked = saved || loading;
  const steps = plan.mode === 'steps';
  const sched = schedule(plan);
  const included = plan.tasks.filter(t => t.include).length;
  const days = totalDays(plan);
  const setTask = (id: string, patch: Partial<PlanTask>) => onChange({ ...plan, tasks: plan.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)) });

  if (loading) {
    return (
      <div className="mt-2.5 rounded-2xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#2c2c2e] px-3.5 py-3">
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Breaking it down with Groq…</p>
        <div className="mt-3 space-y-2" aria-hidden>
          {[70, 55, 62, 48].map((w, i) => <div key={i} className="h-3 rounded bg-gray-100 dark:bg-white/[0.06] animate-pulse" style={{ width: `${w}%` }} />)}
        </div>
      </div>
    );
  }

  const intro = steps
    ? `${included} steps for ${plan.itemKey ? `${plan.itemKey} · ` : ''}${plan.name}. They'll be added as its subtasks.`
    : `${plan.mode === 'new' ? 'A plan' : `More for ${projectName || plan.name}`}: ${included} tasks${plan.phases.length > 1 ? ` in ${plan.phases.length} stages` : ''}, about ${spanLabel(days)}.`;

  return (
    <div className="flex-1 min-w-0">
      <p className="pt-1 text-[13.5px] leading-snug text-gray-600 dark:text-gray-300">{intro}</p>
      {plan.source === 'template' && !saved && (
        <p className="mt-1 text-[11.5px] text-amber-600 dark:text-amber-400">Groq couldn't be reached, so this starts from the {PLAN_TYPES.find(t => t.id === plan.type)?.label} template. Change anything before saving.</p>
      )}
      <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        className={`mt-2.5 rounded-2xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#2c2c2e] overflow-hidden ${saved ? 'opacity-80' : ''}`}>
        <div className="px-3.5 pt-3 pb-2.5 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-7 w-7 shrink-0 rounded-lg bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 grid place-items-center">
              {steps ? <ListChecks size={15} /> : <FolderPlus size={15} />}
            </span>
            {renaming ? (
              <input autoFocus defaultValue={plan.name} aria-label="Project name"
                onBlur={e => { onChange({ ...plan, name: e.target.value.trim().slice(0, 60) || plan.name }); setRenaming(false); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false); }}
                className="flex-1 min-w-0 text-[15px] font-bold bg-transparent outline-none border-b border-blue-500 text-gray-900 dark:text-white" />
            ) : (
              <span className="flex-1 min-w-0 truncate text-[15px] font-bold text-gray-900 dark:text-white">{plan.name}</span>
            )}
            {plan.mode === 'new' && !locked && !renaming && (
              <button type="button" onClick={() => setRenaming(true)} aria-label="Rename the project" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shrink-0"><Pencil size={13} /></button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {plan.mode === 'new' && (
              <Select value={plan.type} onChange={v => onChange({ ...plan, type: v as PlanTypeId })} disabled={locked} aria-label="Project type" className={chipGray}>
                {PLAN_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            )}
            <span className={`${chip} ${plan.mode === 'new' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-white/[0.08] text-gray-600 dark:text-gray-300'}`}>
              {plan.mode === 'new' ? 'New project' : steps ? 'Subtasks' : `Adds to ${projectName}`}
            </span>
            {!steps && (
              <DatePicker value={plan.start} onChange={d => d && onChange({ ...plan, start: d })} disabled={locked} clearable={false} aria-label="Start day" className={chipBlue}>
                <Calendar size={10} /> {range(plan.start, endDate(plan))}
              </DatePicker>
            )}
            {plan.source === 'groq' && <span className={`${chip} text-gray-400`}><Sparkles size={10} /> Groq</span>}
          </div>
          {plan.summary && <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400 leading-snug">{plan.summary}</p>}
        </div>

        <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
          {plan.phases.map((phase, p) => {
            const rows = sched.filter(t => t.phase === p);
            if (!rows.length) return null;
            const live = rows.filter(t => t.include);
            return (
              <div key={`${phase}-${p}`} className="px-3.5 py-2.5">
                {plan.phases.length > 1 && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: PHASE_COLORS[p % PHASE_COLORS.length] }} />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">{phase}</span>
                    {live.length > 0 && !steps && <span className="ml-auto text-[10.5px] text-gray-400 shrink-0">{range(live[0].startDate, live[live.length - 1].dueDate)}</span>}
                  </div>
                )}
                <ol className="space-y-1">
                  {rows.map(t => (
                    <TaskRow key={t.id} task={t} n={sched.indexOf(t) + 1} locked={locked} steps={steps}
                      dates={t.include ? range(t.startDate, t.dueDate) : ''} onChange={patch => setTask(t.id, patch)} />
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </motion.div>

      {!saved && (
        <>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <button type="button" onClick={onSave} disabled={busy || included === 0}
              className="h-9 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-semibold disabled:opacity-40 active:scale-[0.97] transition inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save all {included}
            </button>
            <button type="button" onClick={onAsItems} className="h-9 px-3 rounded-xl text-[13px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10">Just add it as one item</button>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400 leading-snug">Reply to change it: “drop the logo step”, “add a testing stage”, “make it 3 weeks”, “start Monday”.</p>
        </>
      )}
    </div>
  );
}

function TaskRow({ task: t, n, locked, steps, dates, onChange }: {
  task: PlanTask; n: number; locked: boolean; steps: boolean; dates: string; onChange: (patch: Partial<PlanTask>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const nextDays = DAY_STEPS.find(d => d > t.days) ?? 1;
  return (
    <li className={`flex items-start gap-2 ${t.include ? '' : 'opacity-45'}`}>
      <button type="button" disabled={locked} onClick={() => onChange({ include: !t.include })} aria-pressed={t.include} aria-label={t.include ? `Leave out ${t.title}` : `Include ${t.title}`}
        className={`mt-[3px] h-4 w-4 shrink-0 rounded-[5px] grid place-items-center ${t.include ? 'bg-blue-600 text-white' : 'ring-[1.5px] ring-inset ring-gray-300 dark:ring-white/25'}`}>
        {t.include && <Check size={11} strokeWidth={3} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
          <div className="flex items-baseline gap-1.5 min-w-0 flex-1 basis-56">
            <span className="text-[10.5px] font-bold text-gray-400 tabular-nums shrink-0 w-4 text-right">{n}</span>
            {editing ? (
              <input autoFocus defaultValue={t.title} aria-label="Task title"
                onBlur={e => { onChange({ title: e.target.value.trim() || t.title }); setEditing(false); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }}
                className="flex-1 min-w-0 text-[13.5px] font-medium bg-transparent outline-none border-b border-blue-500 text-gray-900 dark:text-white" />
            ) : (
              <button type="button" disabled={locked} onClick={() => setEditing(true)} title="Rename"
                className={`flex-1 min-w-0 text-left text-[13.5px] font-medium leading-snug text-gray-900 dark:text-white ${t.include ? '' : 'line-through'}`}>{t.title}</button>
            )}
          </div>
          <div className="flex items-center gap-1 pl-[22px] sm:pl-0 sm:ml-auto shrink-0">
            {!steps && dates && <span className="text-[10.5px] text-gray-400 mr-0.5 whitespace-nowrap">{dates}</span>}
            {!steps && (
              <button type="button" disabled={locked} onClick={() => onChange({ days: nextDays })} title="How long it takes" className={chipGray}>
                {t.days === 1 ? '1 day' : `${t.days} days`}
              </button>
            )}
            {(t.priority !== 'medium' || !locked) && (
              <button type="button" disabled={locked} title="Change priority"
                onClick={() => onChange({ priority: PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(t.priority as any) + 1) % PRIORITY_CYCLE.length] })}
                className={t.priority === 'urgent' ? `${chip} bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300` : t.priority === 'high' ? `${chip} bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300` : chipGray}>
                <Flag size={10} /> {t.priority[0].toUpperCase() + t.priority.slice(1)}
              </button>
            )}
          </div>
        </div>
        {t.note && t.include && <p className="mt-0.5 pl-[22px] text-[11px] text-gray-400 leading-snug">{t.note}</p>}
      </div>
    </li>
  );
}

export function BreakDownButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-9 px-3 rounded-xl text-[13px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 inline-flex items-center gap-1.5">
      <Wand2 size={14} /> Break it down
    </button>
  );
}
