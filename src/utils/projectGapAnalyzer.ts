/**
 * SAGE PROJECT MAP GAP ANALYZER
 * Heuristics to detect structural gaps, dead ends, orphan tasks, and stale blockers.
 * All rules are advisory, dismissible, and never blocking.
 */

import { WorkItem, Project } from '../services/types';

export interface ProjectGap {
  id: string;              // unique gap id: `${type}_${targetId}`
  type: 'orphan_node' | 'dead_end_milestone' | 'long_unbroken_chain' | 'stale_blocker';
  targetId: string;        // workItem id
  title: string;
  description: string;
  severity: 'warning' | 'suggestion' | 'info';
}

export function analyzeProjectGaps(
  projectItems: WorkItem[], 
  dismissedGapIds: Set<string> = new Set()
): ProjectGap[] {
  const gaps: ProjectGap[] = [];
  const activeItems = projectItems.filter(i => !i.deletedAt && i.status !== 'done');
  if (activeItems.length === 0) return gaps;

  const itemMap = new Map<string, WorkItem>(projectItems.map(i => [i.id, i]));

  // Build incoming & outgoing dependency maps
  const incomingMap = new Map<string, string[]>(); // item -> items that depend on it
  const outgoingMap = new Map<string, string[]>(); // item -> items it depends on

  projectItems.forEach(item => {
    outgoingMap.set(item.id, item.dependsOn || []);
    (item.dependsOn || []).forEach(depId => {
      if (!incomingMap.has(depId)) incomingMap.set(depId, []);
      incomingMap.get(depId)!.push(item.id);
    });
  });

  // Calculate project connectivity ratio
  const connectedItemsCount = projectItems.filter(i => 
    (outgoingMap.get(i.id)?.length || 0) > 0 || (incomingMap.get(i.id)?.length || 0) > 0
  ).length;
  const connectivityRatio = projectItems.length > 0 ? connectedItemsCount / projectItems.length : 0;

  for (const item of activeItems) {
    // 1. Orphan Node Check
    // If project connectivity >= 70%, flag active tasks with 0 incoming & 0 outgoing links
    if (connectivityRatio >= 0.7 && item.entityType === 'task') {
      const incoming = incomingMap.get(item.id) || [];
      const outgoing = outgoingMap.get(item.id) || [];
      if (incoming.length === 0 && outgoing.length === 0) {
        const gapId = `orphan_${item.id}`;
        if (!dismissedGapIds.has(gapId)) {
          gaps.push({
            id: gapId,
            type: 'orphan_node',
            targetId: item.id,
            title: `Orphan Task: "${item.title}"`,
            description: 'This task has no prerequisites or downstream dependencies. Connect it to your flow or keep it standalone.',
            severity: 'suggestion'
          });
        }
      }
    }

    // 2. Dead-end Milestone Check
    // Milestone within 7 days of due date with no completed or in-progress tasks in dependency chain
    if (item.entityType === 'milestone' && item.dueDate) {
      const now = new Date();
      const dueDate = new Date(item.dueDate);
      const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= 7) {
        const prerequisites = outgoingMap.get(item.id) || [];
        const hasActivePrereq = prerequisites.some(pid => {
          const prereq = itemMap.get(pid);
          return prereq && (prereq.status === 'in_progress' || prereq.status === 'done');
        });

        if (prerequisites.length === 0 || !hasActivePrereq) {
          const gapId = `deadend_${item.id}`;
          if (!dismissedGapIds.has(gapId)) {
            gaps.push({
              id: gapId,
              type: 'dead_end_milestone',
              targetId: item.id,
              title: `Milestone due in ${diffDays} day${diffDays === 1 ? '' : 's'} has no active prerequisites`,
              description: `"${item.title}" is approaching, but no preparatory tasks are in progress or connected to it.`,
              severity: 'warning'
            });
          }
        }
      }
    }

    // 3. Stale Blocker Check
    // Blocked item whose linked Waiting-For entry has had no response > 7 days
    if (item.status === 'blocked' && item.waitingFor) {
      const since = item.waitingFor.sinceDate ? new Date(item.waitingFor.sinceDate).getTime() : new Date(item.updatedAt).getTime();
      const daysWaiting = Math.floor((Date.now() - since) / (1000 * 60 * 60 * 24));

      if (daysWaiting >= 7) {
        const gapId = `stale_blocker_${item.id}`;
        if (!dismissedGapIds.has(gapId)) {
          gaps.push({
            id: gapId,
            type: 'stale_blocker',
            targetId: item.id,
            title: `Blocked task waiting ${daysWaiting} days on ${item.waitingFor.who || 'someone'}`,
            description: `"${item.title}" has been waiting over a week. Consider sending a follow-up or reassigning.`,
            severity: 'warning'
          });
        }
      }
    }
  }

  // 4. Long Unbroken Chain Check
  // 6+ sequentially dependent tasks with no milestone checkpoint
  const visited = new Set<string>();
  for (const item of activeItems) {
    if (visited.has(item.id)) continue;
    let chainLength = 1;
    let curr = item;
    let hasMilestone = curr.entityType === 'milestone';

    while (curr) {
      visited.add(curr.id);
      const outgoing = outgoingMap.get(curr.id) || [];
      if (outgoing.length === 0) break;
      const next = itemMap.get(outgoing[0]);
      if (!next) break;
      chainLength++;
      if (next.entityType === 'milestone') hasMilestone = true;
      curr = next;
    }

    if (chainLength >= 6 && !hasMilestone) {
      const gapId = `chain_${item.id}`;
      if (!dismissedGapIds.has(gapId)) {
        gaps.push({
          id: gapId,
          type: 'long_unbroken_chain',
          targetId: item.id,
          title: `Long execution chain (${chainLength} tasks) without checkpoints`,
          description: 'Consider adding an intermediate Milestone to celebrate progress and anchor the timeline.',
          severity: 'suggestion'
        });
      }
    }
  }

  return gaps;
}
