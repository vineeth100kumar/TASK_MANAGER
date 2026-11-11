// planProject.ts - Saving a plan from the Chat tab (see utils/projectPlan.ts).
//
// A new plan makes the project (with its type), one branch per stage starting
// on the stage's first day, and a task per step with its dates, each task
// pointing at the one before it. More work for an existing project reuses its
// branches by name. Steps for one item become its subtasks. The returned undo
// takes back everything it made.

import { api } from './api';
import { Project } from './types';
import { projectKey } from './ideaProject';
import { ProjectPlan, schedule, taskPayload } from '../utils/projectPlan';

const PHASE_COLORS = ['#8b5cf6', '#0ea5e9', '#10b981', '#f97316', '#ec4899', '#eab308'];
const TYPE_COLORS: Record<string, string> = { technical: 'bg-blue-500', content: 'bg-pink-500', nontech: 'bg-amber-500', other: 'bg-indigo-500' };

export interface SavedPlan { said: string; projectId: string | null; undo: () => Promise<void> }

export async function savePlan(plan: ProjectPlan, projects: Project[]): Promise<SavedPlan> {
  const steps = schedule(plan).filter(t => t.include);
  if (!steps.length) throw new Error('Nothing is ticked');

  if (plan.mode === 'steps') {
    if (!plan.itemId) throw new Error('Which item?');
    const made: string[] = [];
    try {
      for (const t of steps) made.push((await api.subtasks.create(plan.itemId, t.title)).id);
    } catch (e) {
      for (const id of made) await api.subtasks.delete(id).catch(() => {});
      throw e;
    }
    return {
      said: `Added ${made.length} steps to ${plan.itemKey || plan.name}`,
      projectId: null,
      undo: async () => { for (const id of made) await api.subtasks.delete(id).catch(() => {}); },
    };
  }

  const madeTasks: string[] = [];
  const madeBranches: string[] = [];
  let project: Project | undefined = plan.projectId ? projects.find(p => p.id === plan.projectId) : undefined;
  const newProject = !project;

  const undo = async () => {
    for (const id of madeTasks) await api.workItems.permanentDelete(id).catch(() => {});
    if (newProject && project) { await api.projects.delete(project.id).catch(() => {}); return; }
    if (project && madeBranches.length) {
      const now = (await api.projects.list()).find(p => p.id === project!.id);
      await api.projects.update(project.id, { branches: (now?.branches || []).filter(b => !madeBranches.includes(b.id)) }).catch(() => {});
    }
  };

  try {
    if (!project) {
      project = await api.projects.create({
        name: plan.name,
        key: projectKey(plan.name, projects.map(p => p.key)),
        color: TYPE_COLORS[plan.type] || 'bg-indigo-500',
        description: [plan.goal, plan.summary].filter(Boolean).join('\n\n'),
      });
      project = await api.projects.update(project.id, { type: plan.type });
    }

    // One branch per stage when there's more than one; a single stage is the main line.
    const branchFor: (string | null)[] = plan.phases.map(() => null);
    if (plan.phases.length > 1) {
      for (const [i, name] of plan.phases.entries()) {
        const first = steps.find(t => t.phase === i);
        if (!first) continue;
        const existing = (project.branches || []).find(b => !b.mergedAt && b.name.trim().toLowerCase() === name.trim().toLowerCase());
        if (existing) { branchFor[i] = existing.id; continue; }
        const b = await api.projects.addBranch(project.id, {
          name, color: PHASE_COLORS[i % PHASE_COLORS.length], parentId: null, startDate: first.startDate,
        });
        madeBranches.push(b.id);
        branchFor[i] = b.id;
      }
    }

    let before: string | null = null;
    for (const t of steps) {
      const created = await api.workItems.create(taskPayload(plan, t, project.id, branchFor[t.phase], before ? [before] : []));
      madeTasks.push(created.id);
      before = created.id;
    }
  } catch (e) {
    await undo();
    throw e;
  }

  const stages = plan.phases.length > 1 ? ` in ${plan.phases.length} stages` : '';
  return {
    said: newProject ? `Made ${plan.name} with ${madeTasks.length} tasks${stages}` : `Added ${madeTasks.length} tasks to ${plan.name}${stages}`,
    projectId: project.id,
    undo,
  };
}
