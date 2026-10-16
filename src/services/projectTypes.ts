import { Code2, Briefcase, Clapperboard, Folder, Tag, type LucideIcon } from 'lucide-react';
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
}

const s = (id: string, label: string, base: TaskStatus, dot: string): StatusStage => ({ id, label, base, dot });

/** To do, Doing, Waiting, Done: what every project had before types. */
export const DEFAULT_STATUSES: StatusStage[] = (['todo', 'in_progress', 'blocked', 'done'] as TaskStatus[])
  .map(id => s(id, STATUSES[id as keyof typeof STATUSES].label, id, STATUSES[id as keyof typeof STATUSES].dot));

export const PROJECT_TYPES: ProjectTypeInfo[] = [
  { id: 'technical', label: 'Technical', hint: 'Code, hardware', icon: Code2,
    chip: 'text-sky-700 bg-sky-500/10 dark:text-sky-300 dark:bg-sky-400/15', view: 'branches',
    statuses: [s('backlog', 'Backlog', 'todo', 'bg-gray-400'), s('building', 'Building', 'in_progress', 'bg-sky-500'),
      s('testing', 'Testing', 'in_progress', 'bg-violet-500'), s('blocked', 'Blocked', 'blocked', 'bg-red-500'),
      s('shipped', 'Shipped', 'done', 'bg-emerald-500')] },
  { id: 'nontech', label: 'Non-tech', hint: 'Errands, admin', icon: Briefcase,
    chip: 'text-amber-700 bg-amber-500/10 dark:text-amber-300 dark:bg-amber-400/15', view: 'list',
    statuses: [s('todo', 'To do', 'todo', 'bg-gray-400'), s('in_progress', 'Doing', 'in_progress', 'bg-amber-500'),
      s('blocked', 'Waiting', 'blocked', 'bg-red-500'), s('done', 'Done', 'done', 'bg-emerald-500')] },
  { id: 'content', label: 'Content', hint: 'Videos, posts', icon: Clapperboard,
    chip: 'text-rose-700 bg-rose-500/10 dark:text-rose-300 dark:bg-rose-400/15', view: 'board',
    statuses: [s('idea', 'Idea', 'todo', 'bg-gray-400'), s('scripting', 'Scripting', 'in_progress', 'bg-amber-500'),
      s('recording', 'Recording', 'in_progress', 'bg-sky-500'), s('editing', 'Editing', 'in_progress', 'bg-violet-500'),
      s('blocked', 'On hold', 'blocked', 'bg-red-500'), s('published', 'Published', 'done', 'bg-emerald-500')] },
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

/** The status an item shows: its stored stage when that still matches its base
 * status, else the first status of its project's type with that base. A tick
 * from Today or LUMO only changes the base, and this keeps them in step. */
export function stageOf(item: Pick<WorkItem, 'status' | 'stage'>, statuses: StatusStage[]): StatusStage {
  const stored = item.stage ? statuses.find(x => x.id === item.stage && x.base === item.status) : undefined;
  return stored || statuses.find(x => x.base === item.status) || statuses[0];
}

/** Turns a picked status (a stage id, or a base status) into what to store. */
export function resolveStage(value: string, statuses: StatusStage[]): { status: TaskStatus; stage: string } {
  const hit = statuses.find(x => x.id === value) || statuses.find(x => x.base === value) || statuses[0];
  return { status: hit.base, stage: hit.id };
}

/** The statuses for the project an item belongs to; DEFAULT_STATUSES without one. */
export function statusesFor(projectId: string | null | undefined, projects: Project[]): StatusStage[] {
  if (!projectId) return DEFAULT_STATUSES;
  const project = projects.find(p => p && p.id === projectId);
  return project ? projectTypeInfo(project).statuses : DEFAULT_STATUSES;
}
