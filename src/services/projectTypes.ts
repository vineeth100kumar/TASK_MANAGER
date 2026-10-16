import {
  Code2, Briefcase, Clapperboard, Folder, Tag, Circle, CirclePlay, Hourglass, CircleCheck, Archive, Hammer,
  FlaskConical, OctagonPause, Rocket, ShoppingCart, Lightbulb, PenLine, Video, Scissors, CirclePause, Send, type LucideIcon,
} from 'lucide-react';
import type { Project, TaskStatus, WorkItem } from './types';
import { STATUSES } from './constants';

// What kind of work a project is. Project.type holds one of the built-in ids
// below, or any other text for a type the user made up ("Research"). Older
// records hold 'standard' or nothing, and read as Other until someone sets it.
export interface ProjectTypeInfo {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Chip colours: text and a soft background, light and dark. */
  chip: string;
  /** The view a project of this type opens in on a desk. */
  view: 'list' | 'board' | 'branches';
  /** The statuses its tasks move through, in order. */
  statuses: StatusStage[];
  custom?: boolean;
}

// A status shown for a project's tasks. Each one stands on one of the four
// base statuses the rest of Sage runs on (Today, Focus, Waiting For, LUMO,
// the Pi's reminders), so an item stores both: status (the base) and stage.
export interface StatusStage {
  id: string;
  label: string;
  base: TaskStatus;
  dot: string;
  /** Shown beside the label everywhere the status appears, so it reads without colour. */
  icon: LucideIcon;
  /** Text colour for the icon. */
  tint: string;
  /** Where an item lands when only its base status is known (a tick on Today, an
   * older item); without one, the first status on that base. */
  fallback?: boolean;
}

// Written out in full so Tailwind finds every class.
const TONES: Record<string, { dot: string; tint: string }> = {
  gray: { dot: 'bg-gray-400', tint: 'text-gray-500 dark:text-gray-400' },
  blue: { dot: 'bg-blue-500', tint: 'text-blue-600 dark:text-blue-400' },
  sky: { dot: 'bg-sky-500', tint: 'text-sky-600 dark:text-sky-400' },
  violet: { dot: 'bg-violet-500', tint: 'text-violet-600 dark:text-violet-400' },
  amber: { dot: 'bg-amber-500', tint: 'text-amber-600 dark:text-amber-400' },
  red: { dot: 'bg-red-500', tint: 'text-red-600 dark:text-red-400' },
  emerald: { dot: 'bg-emerald-500', tint: 'text-emerald-600 dark:text-emerald-400' },
};
const s = (id: string, label: string, base: TaskStatus, tone: keyof typeof TONES, icon: LucideIcon): StatusStage =>
  ({ id, label, base, icon, ...TONES[tone] });

/** To do, Doing, Waiting, Done: what every project had before types. */
export const DEFAULT_STATUSES: StatusStage[] = [
  s('todo', STATUSES.todo.label, 'todo', 'gray', Circle),
  s('in_progress', STATUSES.in_progress.label, 'in_progress', 'blue', CirclePlay),
  s('blocked', STATUSES.blocked.label, 'blocked', 'red', Hourglass),
  s('done', STATUSES.done.label, 'done', 'emerald', CircleCheck),
];

export const PROJECT_TYPES: ProjectTypeInfo[] = [
  { id: 'technical', label: 'Technical', hint: 'Code, hardware', icon: Code2,
    chip: 'text-sky-700 bg-sky-500/10 dark:text-sky-300 dark:bg-sky-400/15', view: 'branches',
    // Procurement: ordering parts or tools before the build can start.
    statuses: [s('backlog', 'Backlog', 'todo', 'gray', Archive), s('procurement', 'Procurement', 'in_progress', 'amber', ShoppingCart),
      { ...s('building', 'Building', 'in_progress', 'sky', Hammer), fallback: true },
      s('testing', 'Testing', 'in_progress', 'violet', FlaskConical), s('blocked', 'Blocked', 'blocked', 'red', OctagonPause),
      s('shipped', 'Shipped', 'done', 'emerald', Rocket)] },
  { id: 'nontech', label: 'Non-tech', hint: 'Errands, admin', icon: Briefcase,
    chip: 'text-amber-700 bg-amber-500/10 dark:text-amber-300 dark:bg-amber-400/15', view: 'list',
    statuses: [s('todo', 'To do', 'todo', 'gray', Circle), s('in_progress', 'Doing', 'in_progress', 'amber', CirclePlay),
      s('blocked', 'Waiting', 'blocked', 'red', Hourglass), s('done', 'Done', 'done', 'emerald', CircleCheck)] },
  { id: 'content', label: 'Content', hint: 'Videos, posts', icon: Clapperboard,
    chip: 'text-rose-700 bg-rose-500/10 dark:text-rose-300 dark:bg-rose-400/15', view: 'board',
    statuses: [s('idea', 'Idea', 'todo', 'amber', Lightbulb), s('scripting', 'Scripting', 'in_progress', 'blue', PenLine),
      s('recording', 'Recording', 'in_progress', 'sky', Video), s('editing', 'Editing', 'in_progress', 'violet', Scissors),
      s('blocked', 'On hold', 'blocked', 'red', CirclePause), s('published', 'Published', 'done', 'emerald', Send)] },
  { id: 'other', label: 'Other', hint: 'Anything else', icon: Folder,
    chip: 'text-gray-600 bg-gray-500/10 dark:text-gray-300 dark:bg-white/10', view: 'board',
    statuses: DEFAULT_STATUSES },
];

const BUILT_IN = new Map(PROJECT_TYPES.map(t => [t.id, t]));

/** The stored type with old and empty values folded into 'other'. */
export function projectTypeId(project: Pick<Project, 'type'> | null | undefined): string {
  const raw = (project?.type || '').trim();
  if (!raw || raw === 'standard') return 'other';
  return raw;
}

export function projectTypeInfo(typeOrProject: string | Pick<Project, 'type'> | null | undefined): ProjectTypeInfo {
  const id = typeof typeOrProject === 'string' ? projectTypeId({ type: typeOrProject }) : projectTypeId(typeOrProject);
  const known = BUILT_IN.get(id);
  if (known) return known;
  return {
    id, label: id, hint: 'Custom', icon: Tag, custom: true,
    chip: 'text-violet-700 bg-violet-500/10 dark:text-violet-300 dark:bg-violet-400/15', view: 'board', statuses: DEFAULT_STATUSES,
  };
}

/** Built-in types, then the custom ones already used by some project. */
export function allProjectTypes(projects: Project[]): ProjectTypeInfo[] {
  const custom = [...new Set(projects.map(p => projectTypeId(p)).filter(id => !BUILT_IN.has(id)))]
    .sort((a, b) => a.localeCompare(b));
  // Other stays last, after any custom types.
  return [...PROJECT_TYPES.slice(0, 3), ...custom.map(id => projectTypeInfo(id)), PROJECT_TYPES[3]];
}

/** Projects grouped by type, in allProjectTypes order, empty groups left out. */
export function groupProjectsByType(projects: Project[]): { type: ProjectTypeInfo; projects: Project[] }[] {
  return allProjectTypes(projects)
    .map(type => ({ type, projects: projects.filter(p => projectTypeId(p) === type.id) }))
    .filter(g => g.projects.length > 0);
}

/** Turns a typed custom name into a stored type; built-in labels map to their ids. */
export function normaliseTypeInput(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ').slice(0, 24);
  const match = PROJECT_TYPES.find(p => p.label.toLowerCase() === t.toLowerCase() || p.id === t.toLowerCase());
  return match ? match.id : t;
}

function onBase(base: string, statuses: StatusStage[]): StatusStage | undefined {
  const all = statuses.filter(x => x.base === base);
  return all.find(x => x.fallback) || all[0];
}

/** The status an item shows: its stored stage when that still matches its base
 * status, else the first status of its project's type with that base. A tick
 * from Today or LUMO only changes the base, and this keeps them in step. */
export function stageOf(item: Pick<WorkItem, 'status' | 'stage'>, statuses: StatusStage[]): StatusStage {
  const stored = item.stage ? statuses.find(x => x.id === item.stage && x.base === item.status) : undefined;
  return stored || onBase(item.status, statuses) || statuses[0];
}

/** Turns a picked status (a stage id, or a base status) into what to store. */
export function resolveStage(value: string, statuses: StatusStage[]): { status: TaskStatus; stage: string } {
  const hit = statuses.find(x => x.id === value) || onBase(value, statuses) || statuses[0];
  return { status: hit.base, stage: hit.id };
}

/** The statuses for the project an item belongs to; DEFAULT_STATUSES without one. */
export function statusesFor(projectId: string | null | undefined, projects: Project[]): StatusStage[] {
  if (!projectId) return DEFAULT_STATUSES;
  const project = projects.find(p => p && p.id === projectId);
  return project ? projectTypeInfo(project).statuses : DEFAULT_STATUSES;
}
