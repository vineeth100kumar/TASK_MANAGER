/**
 * projectPlan.ts
 *
 * Big goals in the Chat tab ("I want to launch a YouTube channel about LUMO",
 * "plan out the Radar project", "split C-13 into steps") become a plan: a
 * project with a type, stages, and ordered tasks with dates. Groq on the Pi
 * writes the plan; everything here is the browser half:
 *
 *   1. spot a message that asks for a plan, and what it's about
 *   2. lay the tasks out on the calendar, stage after stage
 *   3. small follow-ups ("drop the logo step", "make it 2 weeks") without the AI
 *   4. a starter plan per project type when Groq can't be reached
 *
 * Nothing saves from here; the Chat tab does that on Save all.
 */

import { parseQuickAdd } from './quickAddParser';
import { localDateString } from './dateUtils';
import { CaptureContext, findSame } from './chatCapture';
import { Project, WorkItem, TaskPriority } from '../services/types';

export type PlanTypeId = 'technical' | 'nontech' | 'content' | 'other';
export const PLAN_TYPES: { id: PlanTypeId; label: string }[] = [
  { id: 'technical', label: 'Technical' }, { id: 'nontech', label: 'Non-tech' },
  { id: 'content', label: 'Content' }, { id: 'other', label: 'Other' },
];
// The first status of each type (PR #123), so new tasks start in the right column.
const FIRST_STAGE: Record<string, string> = { technical: 'backlog', content: 'idea' };

/** new: a new project. existing: more work for a project. steps: subtasks of one item. */
export type PlanMode = 'new' | 'existing' | 'steps';

export interface PlanTask {
  id: string;
  title: string;
  phase: number; // index into phases
  days: number; // how long it takes, in days
  priority: TaskPriority;
  include: boolean;
  note?: string;
}

export interface ProjectPlan {
  id: string;
  mode: PlanMode;
  goal: string; // the words he typed
  name: string;
  type: PlanTypeId;
  projectId: string | null; // existing
  itemId: string | null; // steps
  itemKey: string | null;
  start: string; // YYYY-MM-DD
  phases: string[];
  tasks: PlanTask[];
  source: 'groq' | 'template';
  summary: string;
}

export interface ScheduledTask extends PlanTask { startDate: string; dueDate: string }

const MAX_TASKS = 24;
const MAX_PHASES = 6;
const MAX_DAYS = 60;
let seq = 0;
export const planTaskId = () => `pt-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// --- Spotting a plan ---

const ASK_PLAN = /\b(?:break(?:ing)?\s+(?:it|this|that|them)?\s*down|break\s*down|breakdown|plan\s+(?:out|for)\b|plan\s+(?:my|the|a|an)\s|make\s+(?:me\s+)?a\s+plan|(?:a\s+)?roadmap\s+(?:for|to)|split\s+.+?\s+into\s+(?:steps|parts|tasks|pieces|phases|stages|subtasks)|steps\s+(?:to|for)\s|how\s+(?:do|should|would)\s+i\s+(?:go\s+about|start|launch|build))/i;
const GOAL = /^\s*(?:so\s+|ok(?:ay)?\s+|hey\s+)?(?:i\s+(?:want|wanna|need|would\s+like|'?d\s+like|plan|am\s+planning|'?m\s+planning|am\s+going|'?m\s+going|hope)\s+to|let'?s|help\s+me|my\s+goal\s+is\s+to|goal:)\s+(?:finally\s+)?(?:launch|start|build|create|make|set\s*up|open|write|learn|organi[sz]e|run|grow|ship|release|design|develop|host|throw|prepare|redo|renovate|move|plan|publish|record|get\s+into)\b/i;

/** Does this message ask for a plan rather than a few items? */
export function looksLikePlan(message: string): boolean {
  if (ASK_PLAN.test(message)) return true;
  if (!GOAL.test(message)) return false;
  // "I want to make dinner tomorrow at 7" is one item: a goal has no clock time.
  const parsed = parseQuickAdd(message);
  return !parsed.time && message.trim().split(/\s+/).length >= 4;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();

// What's left of the message once the asking words are gone: "plan out the Radar project" -> "radar".
function subject(message: string): string {
  return norm(message)
    .replace(/\b(?:can you|could you|please|pls|for me|help me|i want to|i need to|let'?s)\b/g, ' ')
    .replace(/\b(?:break(?:ing)?|breakdown|down|plan|out|make|a|an|the|my|split|into|steps|parts|tasks|pieces|phases|stages|subtasks|roadmap|for|to|of|it|this|that)\b/g, ' ')
    .replace(/\bproject\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PlanTarget { mode: PlanMode; project?: Project; item?: WorkItem }

/** A new project, more work for one already in Sage, or steps for one item. */
export function planTarget(message: string, ctx: CaptureContext): PlanTarget {
  const asked = ASK_PLAN.test(message);
  const rest = subject(message);
  if (asked) {
    // An item named by key ("split C-13 into steps") or by most of its title.
    const key = message.match(/\b([A-Z]{1,6}-\d+)\b/i)?.[1]?.toUpperCase();
    const byKey = key ? ctx.items.find(i => (i.key || '').toUpperCase() === key) : undefined;
    if (byKey) return { mode: 'steps', item: byKey };
    const project = ctx.projects.find(p => rest && (norm(p.name) === rest || (p.key && norm(p.key) === rest)));
    if (project) return { mode: 'existing', project };
    if (rest) {
      const same = findSame(message, rest, ctx);
      if (same && /\b(?:split|steps|subtasks|break)\b/i.test(message)) return { mode: 'steps', item: same };
    }
  }
  return { mode: 'new' };
}

// --- A name and a type for a new project ---

const TYPE_WORDS: [PlanTypeId, RegExp][] = [
  ['content', /\b(youtube|channel|video|vlog|podcast|reel|reels|instagram|tiktok|blog|newsletter|post|posts|content|shorts|course|book|article|episode)\b/i],
  ['technical', /\b(app|code|software|firmware|website|site|api|server|pcb|circuit|robot|device|hardware|feature|bot|dashboard|plugin|game|script|esp32|pi|clock)\b/i],
  ['nontech', /\b(move|moving|wedding|trip|holiday|vacation|party|tax|taxes|renovat\w*|visa|apply|application|house|flat|apartment|event|shop|store|business|hiring|hire)\b/i],
];

export function guessType(message: string): PlanTypeId {
  // The first word that names a kind of work decides: "a YouTube channel about the clock" is content.
  let best: { id: PlanTypeId; at: number } | null = null;
  for (const [id, re] of TYPE_WORDS) {
    const m = message.match(re);
    if (m && m.index !== undefined && (!best || m.index < best.at)) best = { id, at: m.index };
  }
  return best?.id || 'other';
}

/** "I want to launch a YouTube channel about LUMO" -> "YouTube channel about LUMO". */
export function guessName(message: string): string {
  let s = message.trim().replace(/[.!?]+$/, '');
  s = s.replace(/^(?:so|ok(?:ay)?|hey)\s+/i, '')
    .replace(/^(?:can you\s+|could you\s+|please\s+)?(?:help me\s+)?(?:i\s+(?:want|wanna|need|would\s+like|'?d\s+like|plan|am\s+planning|'?m\s+planning|am\s+going|'?m\s+going|hope)\s+to\s+|let'?s\s+|my\s+goal\s+is\s+to\s+|goal:\s*)?/i, '')
    .replace(/^(?:break\s+down|plan\s+out|plan|make\s+(?:me\s+)?a\s+plan\s+(?:for|to))\s+/i, '')
    .replace(/^(?:finally\s+)?(?:launch|start|build|create|make|set\s*up|open|run|grow|ship|release|develop|host|throw|prepare|get\s+into)\s+/i, '')
    .replace(/^(?:a|an|the|my)\s+/i, '')
    .replace(/\s+(?:by|before|in)\s+.*$/i, '');
  s = s.split(/\s+/).slice(0, 7).join(' ');
  return s ? s[0].toUpperCase() + s.slice(1) : 'New project';
}

/** "by Dec 1" or "in 6 weeks": how many days the plan should take, if he said. */
export function deadlineDays(message: string, start: string, now: Date = new Date()): number | null {
  const span = message.match(/\b(?:in|within|over|for)\s+(?:the\s+next\s+)?(\d+|a|one|two|three|four|six|eight)\s+(day|week|month)s?\b/i);
  if (span) {
    const n = ({ a: 1, one: 1, two: 2, three: 3, four: 4, six: 6, eight: 8 } as Record<string, number>)[span[1].toLowerCase()] ?? Number(span[1]);
    const unit = span[2].toLowerCase();
    return Math.min(365, n * (unit === 'day' ? 1 : unit === 'week' ? 7 : 30));
  }
  if (/\b(?:by|before|until|launch\s+on|due)\b/i.test(message)) {
    const parsed = parseQuickAdd(message, now);
    if (parsed.date && parsed.date > start) return daysBetween(start, parsed.date) + 1;
  }
  return null;
}

// --- Dates ---

const toDate = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (key: string, n: number) => { const d = toDate(key); d.setDate(d.getDate() + n); return localDateString(d); };
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);

/** Every included task gets a start and due day: stage after stage, task after task. */
export function schedule(plan: ProjectPlan): ScheduledTask[] {
  let cursor = plan.start;
  const out: ScheduledTask[] = [];
  for (const t of ordered(plan)) {
    if (!t.include) { out.push({ ...t, startDate: cursor, dueDate: cursor }); continue; }
    const due = addDays(cursor, Math.max(1, t.days) - 1);
    out.push({ ...t, startDate: cursor, dueDate: due });
    cursor = addDays(due, 1);
  }
  return out;
}

/** Tasks in stage order, keeping their order inside a stage. */
export function ordered(plan: ProjectPlan): PlanTask[] {
  return plan.phases.flatMap((_, p) => plan.tasks.filter(t => t.phase === p));
}

export function totalDays(plan: ProjectPlan): number {
  return plan.tasks.filter(t => t.include).reduce((n, t) => n + Math.max(1, t.days), 0);
}

export function endDate(plan: ProjectPlan): string {
  return addDays(plan.start, Math.max(1, totalDays(plan)) - 1);
}

/** Stretch or squeeze the task lengths so the whole plan takes about `days`. */
export function fitTo(plan: ProjectPlan, days: number): ProjectPlan {
  const live = plan.tasks.filter(t => t.include);
  if (!live.length) return plan;
  const total = totalDays(plan);
  const factor = Math.max(1, days) / Math.max(1, total);
  let tasks = plan.tasks.map(t => (t.include ? { ...t, days: Math.max(1, Math.min(MAX_DAYS, Math.round(t.days * factor))) } : t));
  // Rounding drifts; take the difference out of (or add it to) the longest tasks.
  let drift = tasks.filter(t => t.include).reduce((n, t) => n + t.days, 0) - days;
  const byLength = () => tasks.filter(t => t.include).sort((a, b) => b.days - a.days);
  for (let guard = 0; drift !== 0 && guard < 400; guard++) {
    const pick = drift > 0 ? byLength().find(t => t.days > 1) : byLength()[0];
    if (!pick) break;
    tasks = tasks.map(t => (t.id === pick.id ? { ...t, days: t.days + (drift > 0 ? -1 : 1) } : t));
    drift += drift > 0 ? -1 : 1;
  }
  return { ...plan, tasks };
}

export function spanLabel(days: number): string {
  if (days <= 1) return '1 day';
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

// --- From the AI, checked ---

export interface AiPlan {
  name?: string; type?: string; summary?: string;
  phases?: string[];
  tasks?: { title?: string; phase?: number; days?: number; priority?: string; note?: string }[];
}

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

/** The AI's plan, trimmed to what Sage can save. Null when there's nothing usable. */
export function planFromAi(ai: AiPlan | null | undefined, base: ProjectPlan): ProjectPlan | null {
  if (!ai || !Array.isArray(ai.tasks)) return null;
  const phases = (Array.isArray(ai.phases) ? ai.phases : []).map(p => String(p || '').trim().slice(0, 40)).filter(Boolean).slice(0, MAX_PHASES);
  if (!phases.length) phases.push(base.mode === 'steps' ? 'Steps' : 'Plan');
  const seen = new Set<string>();
  const tasks: PlanTask[] = [];
  for (const t of ai.tasks) {
    const title = String(t?.title || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const phase = Number.isInteger(t.phase) && t.phase! >= 0 && t.phase! < phases.length ? t.phase! : phases.length - 1;
    const days = Math.max(1, Math.min(MAX_DAYS, Math.round(Number(t.days) || 1)));
    const priority = (PRIORITIES.has(String(t.priority)) ? t.priority : 'medium') as TaskPriority;
    tasks.push({ id: planTaskId(), title, phase, days, priority, include: true, note: t.note ? String(t.note).slice(0, 200) : undefined });
    if (tasks.length >= MAX_TASKS) break;
  }
  if (tasks.length < 2) return null;
  // A stage with no tasks left goes, and the tasks after it move up.
  const used = phases.map((_, i) => tasks.some(t => t.phase === i));
  const remap = phases.map((_, i) => used.slice(0, i).filter(Boolean).length);
  const type = PLAN_TYPES.some(x => x.id === ai.type) ? ai.type as PlanTypeId : base.type;
  return {
    ...base,
    name: base.mode === 'new' ? (String(ai.name || '').trim().slice(0, 60) || base.name) : base.name,
    type: base.mode === 'new' ? type : base.type,
    phases: phases.filter((_, i) => used[i]),
    tasks: tasks.map(t => ({ ...t, phase: remap[t.phase] })),
    source: 'groq',
    summary: String(ai.summary || '').trim().slice(0, 200),
  };
}

// --- When Groq can't be reached: a starter plan for the type ---

type Step = [string, number, TaskPriority?];
const TEMPLATES: Record<PlanTypeId, [string, Step[]][]> = {
  content: [
    ['Idea', [['Decide who it’s for and what makes it different', 2, 'high'], ['Study 5 similar channels or accounts', 2], ['Pick the name, look and first 5 topics', 2]]],
    ['Make', [['Script the first piece', 2, 'high'], ['Record it', 1], ['Edit it', 2], ['Make the thumbnail or cover', 1]]],
    ['Publish', [['Set up the account and profile', 1], ['Publish the first piece', 1, 'high'], ['Share it where your audience is', 1]]],
    ['Grow', [['Plan the next 4 pieces', 1], ['Check what worked after a week', 1]]],
  ],
  technical: [
    ['Design', [['Write down what it must do', 1, 'high'], ['Sketch how it fits together', 2], ['List parts, tools or libraries', 1]]],
    ['Build', [['Build the smallest working version', 4, 'high'], ['Add the remaining features', 4], ['Tidy up and write notes', 1]]],
    ['Test', [['Test it end to end', 2, 'high'], ['Fix what broke', 2]]],
    ['Ship', [['Release it', 1, 'high'], ['Watch how it does for a week', 1]]],
  ],
  nontech: [
    ['Prepare', [['Decide what done looks like', 1, 'high'], ['List everything that has to happen', 1], ['Set a budget and dates', 1]]],
    ['Do', [['Book or buy what’s needed', 2], ['Do the main part', 3, 'high'], ['Handle the loose ends', 2]]],
    ['Wrap up', [['Check everything is finished', 1], ['Note what to do differently next time', 1]]],
  ],
  other: [
    ['Plan', [['Decide what done looks like', 1, 'high'], ['Break it into the main parts', 1]]],
    ['Do', [['Start the first part', 3, 'high'], ['Finish the remaining parts', 4]]],
    ['Review', [['Check it against what done looks like', 1], ['Wrap it up', 1]]],
  ],
};
const STEP_TEMPLATE: Step[] = [
  ['Work out what done looks like', 1, 'high'], ['Gather what you need', 1], ['Do the first half', 1], ['Do the rest', 1], ['Check it and close it', 1],
];

export function templatePlan(base: ProjectPlan): ProjectPlan {
  if (base.mode === 'steps') {
    return { ...base, phases: ['Steps'], source: 'template', summary: '',
      tasks: STEP_TEMPLATE.map(([title, days, priority]) => ({ id: planTaskId(), title, phase: 0, days, priority: priority || 'medium', include: true })) };
  }
  const tpl = TEMPLATES[base.type] || TEMPLATES.other;
  return {
    ...base, source: 'template', summary: '',
    phases: tpl.map(([name]) => name),
    tasks: tpl.flatMap(([, steps], phase) => steps.map(([title, days, priority]) => ({ id: planTaskId(), title, phase, days, priority: priority || 'medium', include: true }))),
  };
}

/** The empty plan a message starts as, before Groq or the template fills it. */
export function basePlan(message: string, ctx: CaptureContext, now: Date = new Date()): ProjectPlan {
  const target = planTarget(message, ctx);
  const start = localDateString(now);
  const name = target.project?.name || target.item?.title || guessName(message);
  const type = target.project ? ((['technical', 'nontech', 'content'].includes(target.project.type || '') ? target.project.type : 'other') as PlanTypeId) : guessType(message);
  return {
    id: `plan-${Date.now().toString(36)}`, mode: target.mode, goal: message.trim(), name, type,
    projectId: target.project?.id || null, itemId: target.item?.id || null, itemKey: target.item?.key || null,
    start: addDays(start, 0), phases: [], tasks: [], source: 'template', summary: '',
  };
}

// --- Follow-ups without the AI ---

const WORDS = (s: string) => norm(s).split(' ').filter(w => w.length > 2 && !['the', 'and', 'for', 'step', 'task', 'stage', 'phase', 'part', 'one', 'bit'].includes(w));

/** The task (or stage) a follow-up names by a word of its title. */
function findTask(words: string[], plan: ProjectPlan): PlanTask | null {
  let best: { t: PlanTask; n: number } | null = null;
  for (const t of plan.tasks) {
    const theirs = new Set(WORDS(t.title).map(w => w.slice(0, 6)));
    const n = words.filter(w => theirs.has(w.slice(0, 6))).length;
    if (n && (!best || n > best.n)) best = { t, n };
  }
  return best?.t || null;
}
function findPhase(words: string[], plan: ProjectPlan): number {
  return plan.phases.findIndex(p => WORDS(p).some(w => words.some(x => x.slice(0, 6) === w.slice(0, 6))));
}

export interface PlanEdit { plan: ProjectPlan; said: string }

/** Starts like a change to the plan above rather than a new ask. */
export function looksLikePlanEdit(message: string): boolean {
  return /^\s*(?:drop|remove|delete|skip|cut|lose|no\b|don'?t|add|also\s+add|include|make|change|rename|call|move|put|start|begin|finish|end|shorter|longer|faster|slower|more|fewer|less|split|merge|combine|swap|instead|actually|and\s+add|plus|it'?s\b|this\s+is)/i.test(message);
}

/** Changes the browser can make on its own; null means ask Groq. */
export function localPlanEdit(message: string, plan: ProjectPlan, now: Date = new Date()): PlanEdit | null {
  const m = message.trim().replace(/[.!]+$/, '');

  // "drop the logo step", "skip testing", "remove the grow stage"
  const drop = m.match(/^(?:drop|remove|delete|skip|cut|lose|no|don'?t\s+need)\s+(?:the\s+)?(.+)$/i);
  if (drop) {
    const words = WORDS(drop[1]);
    const stageWord = /\b(?:stage|phase|part|section)\b/i.test(drop[1]);
    const phase = findPhase(words, plan);
    const task = findTask(words, plan);
    if (phase >= 0 && (stageWord || !task)) {
      const tasks = plan.tasks.filter(t => t.phase !== phase).map(t => ({ ...t, phase: t.phase > phase ? t.phase - 1 : t.phase }));
      return { plan: { ...plan, phases: plan.phases.filter((_, i) => i !== phase), tasks }, said: `Dropped the ${plan.phases[phase]} stage.` };
    }
    if (task) return { plan: { ...plan, tasks: plan.tasks.filter(t => t.id !== task.id) }, said: `Dropped “${task.title}”.` };
    return null;
  }

  // "make it 2 weeks", "in 6 weeks", "finish by Dec 1", "shorter"
  const span = m.match(/^(?:make\s+it|do\s+it\s+in|in|over|fit\s+it\s+(?:in|into)|squeeze\s+it\s+(?:in|into))\s+(\d+|a|one|two|three|four|six|eight)\s+(day|week|month)s?$/i);
  const by = /^(?:finish|end|done|launch|wrap\s+up)\s+(?:it\s+)?(?:by|on|before)\s+/i.test(m);
  if (span || by) {
    const days = deadlineDays(span ? `in ${span[1]} ${span[2]}s` : m.replace(/^\w+(?:\s+up)?\s+(?:it\s+)?/i, 'by '), plan.start, now);
    if (days) return { plan: fitTo(plan, days), said: `Fitted it into ${spanLabel(days)}, ending ${endLabel(fitTo(plan, days))}.` };
  }
  if (/^(?:make\s+it\s+)?(?:shorter|faster|tighter)$/i.test(m)) {
    const days = Math.max(plan.tasks.filter(t => t.include).length, Math.round(totalDays(plan) * 0.7));
    return { plan: fitTo(plan, days), said: `Tightened it to ${spanLabel(days)}.` };
  }
  if (/^(?:make\s+it\s+)?(?:longer|slower|more\s+relaxed)$/i.test(m)) {
    const days = Math.round(totalDays(plan) * 1.4);
    return { plan: fitTo(plan, days), said: `Stretched it to ${spanLabel(days)}.` };
  }

  // "start next monday", "start on the 1st"
  const start = m.match(/^(?:start|begin)\s+(?:it\s+)?(.+)$/i);
  if (start) {
    const parsed = parseQuickAdd(`x ${start[1]}`, now);
    if (parsed.date) return { plan: { ...plan, start: parsed.date }, said: `Starts ${dayLabel(parsed.date)} now.` };
  }

  // "call it LUMO Channel", "rename it to ..."
  const rename = m.match(/^(?:call\s+it|name\s+it|rename\s+(?:it|the\s+project)\s+(?:to\s+)?)\s*["“]?(.+?)["”]?$/i);
  if (rename && plan.mode === 'new') return { plan: { ...plan, name: rename[1].slice(0, 60) }, said: `Renamed it ${rename[1]}.` };

  // "make it a content project", "it's technical"
  const type = m.match(/^(?:make\s+it|it'?s|this\s+is|change\s+it\s+to)\s+(?:a\s+|an\s+)?(technical|tech|non-?tech(?:nical)?|content|other)(?:\s+project)?$/i);
  if (type && plan.mode === 'new') {
    const t = type[1].toLowerCase();
    const id: PlanTypeId = t.startsWith('non') ? 'nontech' : t.startsWith('tech') ? 'technical' : t as PlanTypeId;
    return { plan: { ...plan, type: id }, said: `Made it a ${PLAN_TYPES.find(x => x.id === id)!.label} project.` };
  }

  // "make the script step urgent"
  const prio = m.match(/^make\s+(?:the\s+)?(.+?)\s+(low|medium|high|urgent)(?:\s+priority)?$/i);
  if (prio) {
    const task = findTask(WORDS(prio[1]), plan);
    if (task) return { plan: { ...plan, tasks: plan.tasks.map(t => (t.id === task.id ? { ...t, priority: prio[2].toLowerCase() as TaskPriority } : t)) }, said: `“${task.title}” is ${prio[2].toLowerCase()} now.` };
  }

  // "add buy a mic to make", "add a step: book the studio". A whole new stage needs the AI to fill it.
  const add = m.match(/^(?:also\s+|and\s+)?(?:add|include|plus)\s+(?:a\s+step\s*:?\s*|a\s+task\s*:?\s*)?(.+?)(?:\s+(?:to|in|into|under)\s+(?:the\s+)?(.+?)(?:\s+(?:stage|phase))?)?$/i);
  if (add && !/\b(?:stage|phase|section)\b/i.test(add[1])) {
    let phase = add[2] ? findPhase(WORDS(add[2]), plan) : -1;
    if (phase < 0) phase = Math.max(0, plan.phases.length - 1);
    const title = add[1].replace(/^(?:a|an|the)\s+/i, '');
    const task: PlanTask = { id: planTaskId(), title: title[0].toUpperCase() + title.slice(1), phase, days: 1, priority: 'medium', include: true };
    // After the last task of that stage.
    const lastAt = plan.tasks.map(t => t.phase).lastIndexOf(phase);
    const tasks = [...plan.tasks];
    tasks.splice(lastAt + 1, 0, task);
    return { plan: { ...plan, tasks }, said: `Added “${task.title}” to ${plan.phases[phase] || 'the plan'}.` };
  }
  return null;
}

/** One line on what a Groq change did: "Added the Promote stage and 3 tasks." */
export function planDiff(before: ProjectPlan, after: ProjectPlan): string {
  const had = new Set(before.tasks.map(t => t.title.toLowerCase()));
  const has = new Set(after.tasks.map(t => t.title.toLowerCase()));
  const added = after.tasks.filter(t => !had.has(t.title.toLowerCase())).length;
  const removed = before.tasks.filter(t => !has.has(t.title.toLowerCase())).length;
  const newStages = after.phases.filter(p => !before.phases.includes(p));
  const bits: string[] = [];
  if (newStages.length) bits.push(`the ${newStages.join(' and ')} stage${newStages.length > 1 ? 's' : ''}`);
  if (added) bits.push(`${added} task${added === 1 ? '' : 's'}`);
  const parts = [bits.length ? `Added ${bits.join(' and ')}` : '', removed ? `${bits.length ? 'took out' : 'Took out'} ${removed} task${removed === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.length ? `${parts.join(', ')}. Now ${after.tasks.filter(t => t.include).length} tasks, about ${spanLabel(totalDays(after))}.` : 'Changed the plan.';
}

const dayLabel = (key: string) => toDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const endLabel = (plan: ProjectPlan) => dayLabel(endDate(plan));

// --- What it saves as ---

/** The fields each new task is created with. */
export function taskPayload(plan: ProjectPlan, t: ScheduledTask, projectId: string, branchId: string | null, dependsOn: string[]): Partial<WorkItem> & { stage?: string } {
  const stage = FIRST_STAGE[plan.type];
  return {
    title: t.title,
    description: [t.note, `Part of the plan for ${plan.name}${plan.phases[t.phase] ? `, ${plan.phases[t.phase]} stage` : ''}.`].filter(Boolean).join('\n\n'),
    projectId,
    branchId,
    lifeContext: 'work',
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    isInbox: false,
    dependsOn,
    labels: ['plan'],
    ...(stage ? { stage } : {}),
  };
}
