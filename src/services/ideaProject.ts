// ideaProject.ts - Turning a Radar idea into real Sage work.
//
// "Turn into a project" makes a project named after the idea, one branch per
// playbook phase (starting on the week the phase starts), and a task per step,
// spread across the phase. The idea remembers the project, and the returned
// undo removes everything it made.

import { api } from './api';
import { Idea, Project, WorkItem } from './types';
import { localDateString } from '../utils/dateUtils';
import { FOCUS_LIMIT } from './constants';

const PHASE_COLORS = ['#8b5cf6', '#0ea5e9', '#10b981', '#f97316', '#ec4899'];

const addDays = (base: Date, days: number): string => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return localDateString(d);
};

// "PayBridge SEA" -> "PBS"; a key already in use gets a number.
export function projectKey(name: string, taken: string[]): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let key = words.length > 1 ? words.map(w => w[0]).join('').slice(0, 4) : (words[0] || 'IDEA').slice(0, 4);
  if (key.length < 2) key = (words.join('') + 'IDEA').slice(0, 3);
  const used = new Set(taken.map(k => k.toUpperCase()));
  if (!used.has(key)) return key;
  for (let n = 2; ; n++) if (!used.has(`${key}${n}`)) return `${key}${n}`;
}

export interface MadeProject {
  project: Project;
  tasks: WorkItem[];
  undo: () => Promise<void>;
}

export async function turnIntoProject(idea: Idea, start: Date = new Date()): Promise<MadeProject> {
  const projects = await api.projects.list();
  const project = await api.projects.create({
    name: idea.name,
    key: projectKey(idea.name, projects.map(p => p.key)),
    color: 'bg-purple-500',
    description: `${idea.oneLiner}\n\nBuyer: ${idea.icp}\nFrom Radar (score ${idea.score}/100).`,
  });
  const tasks: WorkItem[] = [];
  const phases = idea.playbook.length ? idea.playbook : [{ name: 'First steps', startWeek: 1, endWeek: 2, steps: [`Talk to 5 people like: ${idea.icp}`] }];
  for (const [i, phase] of phases.entries()) {
    const first = (phase.startWeek - 1) * 7;
    const last = Math.max(first, phase.endWeek * 7 - 1);
    const branch = await api.projects.addBranch(project.id, {
      name: phase.name,
      color: PHASE_COLORS[i % PHASE_COLORS.length],
      parentId: null,
      startDate: addDays(start, first),
    });
    for (const [k, step] of phase.steps.entries()) {
      // Steps fall due evenly across the phase, the last on its final day.
      const due = first + Math.round(((k + 1) / phase.steps.length) * (last - first));
      tasks.push(await api.workItems.create({
        title: step,
        description: `${phase.name} (weeks ${phase.startWeek}–${phase.endWeek}) of ${idea.name}.`,
        projectId: project.id,
        branchId: branch.id,
        lifeContext: 'work',
        dueDate: addDays(start, due),
        isInbox: false,
        labels: ['radar'],
        customFields: { ideaId: idea.id },
      }));
    }
  }
  await api.ideas.update(idea.id, { projectId: project.id });

  const undo = async () => {
    for (const t of tasks) await api.workItems.permanentDelete(t.id);
    await api.projects.delete(project.id);
    await api.ideas.update(idea.id, { projectId: null });
  };
  return { project, tasks, undo };
}

// The idea's first step, in Focus. Without a project yet, it's added as a
// task of its own (so Focus works before committing to the whole plan).
export async function focusFirstStep(idea: Idea): Promise<WorkItem> {
  const focusCount = (await api.focus.list()).length;
  if (focusCount >= FOCUS_LIMIT) throw new Error(`Focus is full (${FOCUS_LIMIT}). Finish one or take one out first.`);
  const step = idea.playbook[0]?.steps[0] || `Talk to 5 people like: ${idea.icp}`;
  if (idea.projectId) {
    const items = (await api.workItems.list({ projectId: idea.projectId }))
      .filter(i => i.status !== 'done' && !i.isFocus)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    if (items[0]) return api.focus.toggle(items[0].id);
  }
  return api.workItems.create({
    title: step,
    description: `First step for ${idea.name}, from Radar.`,
    lifeContext: 'work',
    isFocus: true,
    focusOrder: Date.now(),
    labels: ['radar'],
    customFields: { ideaId: idea.id },
  });
}
