import { Code2, Briefcase, Clapperboard, Folder, Tag, type LucideIcon } from 'lucide-react';
import type { Project } from './types';

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
  /** Suggested stages, kept as tags on items; the project page counts them. */
  stages: string[];
  custom?: boolean;
}

export const PROJECT_TYPES: ProjectTypeInfo[] = [
  { id: 'technical', label: 'Technical', hint: 'Code, hardware', icon: Code2,
    chip: 'text-sky-700 bg-sky-500/10 dark:text-sky-300 dark:bg-sky-400/15', view: 'branches',
    stages: ['design', 'build', 'test', 'ship'] },
  { id: 'nontech', label: 'Non-tech', hint: 'Errands, admin', icon: Briefcase,
    chip: 'text-amber-700 bg-amber-500/10 dark:text-amber-300 dark:bg-amber-400/15', view: 'list',
    stages: ['plan', 'do', 'review'] },
  { id: 'content', label: 'Content', hint: 'Videos, posts', icon: Clapperboard,
    chip: 'text-rose-700 bg-rose-500/10 dark:text-rose-300 dark:bg-rose-400/15', view: 'board',
    stages: ['idea', 'script', 'record', 'edit', 'publish'] },
  { id: 'other', label: 'Other', hint: 'Anything else', icon: Folder,
    chip: 'text-gray-600 bg-gray-500/10 dark:text-gray-300 dark:bg-white/10', view: 'board',
    stages: [] },
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
    chip: 'text-violet-700 bg-violet-500/10 dark:text-violet-300 dark:bg-violet-400/15', view: 'board', stages: [],
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
