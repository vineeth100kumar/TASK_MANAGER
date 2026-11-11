/**
 * Every task belongs somewhere. A task with no project and no life area is
 * placed by its words (a project or area it names, or the project whose open
 * tasks it most resembles); if nothing fits it goes to the Inbox project.
 * LUMO alarms are the one exception: they live on the LUMO page.
 */
import { Project, Area, WorkItem } from './types';
import { matchWhere, keyWords } from '../utils/chatCapture';
import { isAlarm } from './items';

export const INBOX_PROJECT_ID = 'inbox';
export const INBOX_PROJECT_NAME = 'Inbox';

/** No project or area, or a project/area that no longer exists (a name or slug typed by hand, a deleted project). */
export const needsPlace = (i: Partial<WorkItem>, projects?: Project[], areas?: Area[]): boolean => {
  if (i.deletedAt || isAlarm(i as any)) return false;
  if (!i.projectId && !i.areaId) return true;
  if (!projects) return false;
  const known = (list: { id: string }[] | undefined, id?: string | null) => !id || !!list?.some(x => x && x.id === id);
  return !known(projects, i.projectId) || !known(areas, i.areaId);
};

/** The project/area a loose task most likely belongs to, or null when nothing fits. */
export function suggestPlace(
  title: string, projects: Project[], areas: Area[], items: WorkItem[],
): { projectId?: string; branchId?: string; areaId?: string } | null {
  const real = projects.filter(p => p && p.id !== INBOX_PROJECT_ID);
  const hit = matchWhere(title, { projects: real, areas, items: [], tags: [], lifeContext: 'work' });
  if (hit.projectId) return { projectId: hit.projectId, branchId: hit.branchId || undefined };
  if (hit.areaId) return { areaId: hit.areaId };

  // Otherwise the project whose existing tasks share the most of this title's words.
  const mine = new Set(keyWords(title));
  if (!mine.size) return null;
  const score = new Map<string, number>();
  for (const it of items) {
    if (!it.projectId || it.projectId === INBOX_PROJECT_ID || it.deletedAt) continue;
    const shared = keyWords(it.title || '').filter(w => mine.has(w)).length;
    if (shared) score.set(it.projectId, (score.get(it.projectId) || 0) + shared);
  }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? { projectId: best[0] } : null;
}
