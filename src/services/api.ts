/**
 * SAGE INDUSTRIAL-GRADE API CLIENT & DOMAIN STORE
 * - Local-First with IndexedDB transactional persistence
 * - Durable Sync Queue with Exponential Backoff & Idempotency
 * - Zero synchronous localStorage blocking
 * - Safe Tombstone replication model
 * - Versioned Backup Export / Import
 */

import { WorkItem, Project, ProjectBranch, Area, Goal, Habit, Note, Comment, Subtask, Activity, Board, Dossier, Idea, Thought, ThoughtStatus, LifeContext, DEFAULT_HABIT_REMIND_TIME } from './types';
import { LABELS, uuid, FOCUS_LIMIT } from './constants';
import { INITIAL_PROJECTS, INITIAL_AREAS, INITIAL_GOALS, INITIAL_HABITS, INITIAL_NOTES } from './sampleData';
import { toInputDateValue, toInputDateTimeValue, parseEstimateMinutes, localDateString } from '../utils/dateUtils';
import { nextOccurrence, shiftByDays, daysBetween, toDateKey } from '../utils/recurrence';
import { remindAtFor, toLocalDateTime, timeOfDay } from '../utils/reminders';
import { dateEntries, streakOf } from '../utils/habits';
import { getAllFromStore, putToStore, putBatchToStore, deleteFromStore, clearAllStores, getMeta, setMeta, migrateFromLocalStorage, getOrCreateClientId } from './db';
import { syncEngine, SyncEngineStatus, getGasUrl, syncHeaders } from './syncEngine';
import { needsPlace, suggestPlace, INBOX_PROJECT_ID, INBOX_PROJECT_NAME } from './placement';
import { normalizeItem, nextKey, selectItems, isLive, type ItemFilters, type Selection } from './items';
import { contextOf, inContext, isAlarm, isOpen, isSnoozedNow, isOnToday, compareToday, compareInbox, checkVisibility, VisibilityCheck } from '../utils/taskLists';

export interface LocalState {
  workItems: WorkItem[];
  projects: Project[];
  areas: Area[];
  goals: Goal[];
  habits: Habit[];
  notes: Note[];
  comments: Comment[];
  subtasks: Subtask[];
  activities: Activity[];
  boards: Board[];
  dossiers: Dossier[];
  ideas: Idea[];
  thoughts: Thought[];
}

let state: LocalState = {
  workItems: [],
  projects: [],
  areas: [],
  goals: [],
  habits: [],
  notes: [],
  comments: [],
  subtasks: [],
  activities: [],
  boards: [],
  dossiers: [],
  ideas: [],
  thoughts: []
};

let isInitialized = false;
let initPromise: Promise<void> | null = null;

async function initializeStore(): Promise<void> {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // 1. Check & run migration from legacy localStorage
    await migrateFromLocalStorage();

    // 2. Load all entities instantly from IndexedDB
    const [
      workItems, projects, areas, goals, habits, notes, comments, subtasks, activities, boards, dossiers, ideas, thoughts
    ] = await Promise.all([
      getAllFromStore<WorkItem>('workItems'),
      getAllFromStore<Project>('projects'),
      getAllFromStore<Area>('areas'),
      getAllFromStore<Goal>('goals'),
      getAllFromStore<Habit>('habits'),
      getAllFromStore<Note>('notes'),
      getAllFromStore<Comment>('comments'),
      getAllFromStore<Subtask>('subtasks'),
      getAllFromStore<Activity>('activities'),
      getAllFromStore<Board>('boards'),
      getAllFromStore<Dossier>('dossiers'),
      getAllFromStore<Idea>('ideas'),
      getAllFromStore<Thought>('thoughts')
    ]);

    // Sample data for local testing only (`npm run dev`). A real install starts
    // empty; the sample records are never queued for upload.
    if (import.meta.env.DEV && projects.length === 0 && areas.length === 0 && workItems.length === 0) {
      state.projects = [...INITIAL_PROJECTS];
      state.areas = [...INITIAL_AREAS];
      state.goals = [...INITIAL_GOALS];
      state.habits = [...INITIAL_HABITS];
      state.notes = [...INITIAL_NOTES];

      await Promise.all([
        putBatchToStore('projects', state.projects),
        putBatchToStore('areas', state.areas),
        putBatchToStore('goals', state.goals),
        putBatchToStore('habits', state.habits),
        putBatchToStore('notes', state.notes)
      ]);
    } else {
      state = {
        workItems,
        projects,
        areas,
        goals,
        habits,
        notes,
        comments,
        subtasks,
        activities,
        boards,
        dossiers,
        ideas,
        thoughts
      };
    }

    isInitialized = true;

    // 3. Initialize background sync engine non-blockingly
    syncEngine.onEntityChange((entityType, changes) => {
      getAllFromStore<any>(entityType).then((items) => {
        (state as any)[entityType] = items;
        externalEntityListeners.forEach(l => l(entityType, changes));
      });
    });

    sweepLooseItems().catch(err => console.warn('[placement] sweep failed:', err));

    syncEngine.init().catch(err => {
      console.warn('[SyncEngine] Background initialization warning:', err);
    });
  })();

  return initPromise;
}

// Start async initialization immediately
initializeStore().catch(console.error);

// The Inbox project is the home of anything that names no project or area.
async function ensureInboxProject(): Promise<void> {
  if (state.projects.some(p => p && p.id === INBOX_PROJECT_ID)) return;
  const now = new Date().toISOString();
  const project: Project = {
    id: INBOX_PROJECT_ID, name: INBOX_PROJECT_NAME, key: 'INBOX', color: 'bg-slate-500',
    sequence: state.projects.length + 1, type: 'other', description: 'Tasks that were added without a project.',
    createdAt: now, updatedAt: now,
  };
  state.projects.push(project);
  await persist('projects', project);
}

// Gives a loose task a project or area; returns whether it changed.
async function placeItem(item: WorkItem): Promise<boolean> {
  if (!needsPlace(item, state.projects, state.areas)) return false;
  // A project or area that no longer exists counts as none.
  if (item.projectId && !state.projects.some(p => p && p.id === item.projectId)) item.projectId = null;
  if (item.areaId && !state.areas.some(a => a && a.id === item.areaId)) item.areaId = null;
  if (item.projectId || item.areaId) return true;
  const guess = suggestPlace(item.title || '', state.projects.filter(Boolean), state.areas.filter(Boolean), state.workItems);
  if (guess) {
    item.projectId = guess.projectId || null;
    item.branchId = guess.projectId ? guess.branchId || null : null;
    item.areaId = guess.areaId || null;
  } else {
    await ensureInboxProject();
    item.projectId = INBOX_PROJECT_ID;
    item.branchId = null;
  }
  return true;
}

// Existing loose tasks (added before this rule, or by another device) get a home too.
async function sweepLooseItems(): Promise<void> {
  const now = new Date().toISOString();
  for (const item of state.workItems) {
    if (!item || !(await placeItem(item))) continue;
    item.updatedAt = now;
    item.version = (item.version || 1) + 1;
    await persist('workItems', item);
  }
}

// Every live item, read into the one shape (see items.ts). Lists start here.
// LUMO alarms are reminders underneath but not tasks: they live on the LUMO
// page, so no list, count, board, calendar or export starts with them.
function liveItems(): WorkItem[] {
  const projects = state.projects.filter(Boolean);
  return state.workItems.filter(i => isLive(i) && !isAlarm(i)).map(i => normalizeItem(i, projects));
}

function hydrateWorkItem(raw: WorkItem): WorkItem {
  if (!raw) return raw;
  const item = normalizeItem(raw, state.projects.filter(Boolean));

  const project = item.projectId ? (state.projects || []).find(p => p && p.id === item.projectId) || null : null;
  const area = item.areaId ? (state.areas || []).find(a => a && a.id === item.areaId) || null : null;
  const labelsList = Array.isArray(item.labels) ? item.labels.map(lId => LABELS.find(l => l.id === lId)).filter(Boolean) : [];
  const subtasksForItem = (state.subtasks || []).filter(s => s && s.workItemId === item.id);
  const commentsForItem = (state.comments || []).filter(c => c && c.workItemId === item.id && !c.deletedAt);

  return {
    ...item,
    project,
    area,
    labelsList,
    subtaskCount: subtasksForItem.length,
    completedSubtaskCount: subtasksForItem.filter(s => s.completed).length,
    commentCount: commentsForItem.length,
    dependencies: { blocks: [], blockedBy: [] }
  };
}

type Table = keyof LocalState;

// Save a record locally and queue it for upload.
async function persist(table: Table, record: { id: string }, revision?: number): Promise<void> {
  await putToStore(table, record);
  syncEngine.enqueueOperation(table, record.id, 'save', record, revision);
}

// Remove a record locally and queue the delete for upload.
async function removeRecord(table: Table, id: string): Promise<void> {
  (state as any)[table] = (state[table] as Array<{ id: string }>).filter(r => r && r.id !== id);
  syncEngine.cancelDebounced(table, id);
  await deleteFromStore(table, id);
  syncEngine.enqueueOperation(table, id, 'delete', { id });
}

// Moves a note to the top of the Notes list, e.g. when a thought on its map changes.
async function touchNote(id: string): Promise<void> {
  const n = state.notes.find(n => n && n.id === id);
  if (!n) return;
  n.updatedAt = new Date().toISOString();
  await putToStore('notes', n);
  syncEngine.enqueueNoteDebounced(n.id, n);
}

// The next copy of a repeating item: every date moved to the next occurrence,
// and the per-copy state (inbox, focus, snooze, waiting) starting fresh.
async function createNextOccurrence(item: WorkItem): Promise<WorkItem | null> {
  const today = toDateKey(new Date());
  const anchor = item.dueDate || item.startDate || (item.startAt ? item.startAt.slice(0, 10) : null);
  const nextDue = nextOccurrence(item.repeatRule, anchor, today);
  if (!nextDue) return null;
  const delta = daysBetween(anchor || today, nextDue);
  return api.workItems.create({
    ...item,
    status: 'todo',
    completedAt: null,
    actual: null,
    startDate: shiftByDays(item.startDate, delta),
    dueDate: item.dueDate ? shiftByDays(item.dueDate, delta) : (item.startAt ? null : nextDue),
    startAt: shiftByDays(item.startAt, delta),
    endAt: shiftByDays(item.endAt, delta),
    // Lead-time reminders are recalculated from the new date; fixed ones move with it.
    remindAt: item.reminderLeadMinutes == null ? shiftByDays(item.remindAt, delta) : null,
    isInbox: false,
    isFocus: false,
    focusOrder: null,
    snoozedUntil: null,
    snoozeCount: 0,
    waitingFor: null,
    blockedReason: null,
    spawnedNextId: null,
    spawnedFromId: item.id
  });
}

// Snoozed items stay out of every list until their time comes.
const isSnoozed = (i: WorkItem) => !!i.snoozedUntil && new Date(i.snoozedUntil).getTime() > Date.now();

// Needs sorting: in the Inbox and not placed yet. Something with a date, in
// Focus, or waiting on someone already has a place.
const needsSorting = (i: WorkItem) =>
  !!i.isInbox && !i.isFocus && !i.waitingFor && !i.dueDate && !i.startDate && !i.startAt;

let externalEntityListeners: Array<(entityType: string, changes: any[]) => void> = [];

export const api = {
  sync: {
    getState: (): LocalState => state,
    subscribeStatus: (listener: (status: SyncEngineStatus) => void) => syncEngine.subscribe(listener),
    onEntityChange: (listener: (entityType: string, changes: any[]) => void) => {
      externalEntityListeners.push(listener);
      return () => {
        externalEntityListeners = externalEntityListeners.filter(l => l !== listener);
      };
    },
    // Any change to the local data, whether made here or pulled in by sync.
    onAnyChange: (listener: (entityType: string) => void) => {
      const onRemote = (entityType: string) => listener(entityType);
      externalEntityListeners.push(onRemote);
      const unsubLocal = syncEngine.onLocalChange((entityType) => listener(entityType));
      return () => {
        externalEntityListeners = externalEntityListeners.filter(l => l !== onRemote);
        unsubLocal();
      };
    },
    onOverruled: (listener: Parameters<typeof syncEngine.onOverruled>[0]) => syncEngine.onOverruled(listener),
    forceSync: () => syncEngine.forceSyncNow(),
    getStatus: () => syncEngine.getStatus(),
    getDetailedStatus: () => syncEngine.getDetailedStatus(),
    getPendingOperations: () => syncEngine.getPendingOperations(),
    retryOperation: (opId: string) => syncEngine.retryOperation(opId),
    discardOperation: (opId: string) => syncEngine.discardOperation(opId),

    fetchAll: async (): Promise<LocalState> => {
      await initializeStore();
      try {
        const fetchUrl = getGasUrl('getAll');
        const response = await fetch(fetchUrl, { headers: syncHeaders() });
        if (response.ok) {
          const json = await response.json();
          if (json.success && json.data) {
            const data = json.data;
            const unsynced = await syncEngine.getUnsyncedKeys();
            const tables = ['workItems', 'projects', 'areas', 'goals', 'habits', 'notes', 'comments', 'subtasks', 'activities', 'boards', 'dossiers', 'ideas', 'thoughts'] as const;
            for (const table of tables) {
              const rows = data[table];
              if (!Array.isArray(rows) || rows.length === 0) continue;
              // Keep this device's version of anything it changed that hasn't uploaded yet.
              const localPending = (state[table] as any[]).filter(r => r && unsynced.has(`${table}:${r.id}`));
              const pendingIds = new Set(localPending.map(r => r.id));
              const merged = [...rows.filter((r: any) => r && !pendingIds.has(r.id)), ...localPending];
              (state as any)[table] = merged;
              await putBatchToStore(table, merged);
            }

            // Drop anything deleted on another device while this one was away.
            const deleted: Record<string, string[]> = json.deleted || {};
            for (const table of tables) {
              const gone = new Set((deleted[table] || []).filter(id => !unsynced.has(`${table}:${id}`)));
              if (gone.size === 0) continue;
              (state as any)[table] = (state[table] as Array<{ id: string }>).filter(r => r && !gone.has(r.id));
              for (const id of gone) await deleteFromStore(table, id);
            }

            if (json.serverRevision) {
              await setMeta('serverRevision', json.serverRevision);
            }
            await setMeta('lastSuccessfulSync', new Date().toISOString());
          }
        }
      } catch (err) {
        console.warn('[Sync] Offline or network error fetching all, using IndexedDB cache:', err);
      }
      return state;
    }
  },

  workItems: {
    /** Every tag in use on live items, most used first. */
    allTags: async (lifeContext?: LifeContext): Promise<{ tag: string; count: number }[]> => {
      await initializeStore();
      const counts = new Map<string, number>();
      for (const item of liveItems()) {
        if (lifeContext && contextOf(item) !== lifeContext) continue;
        for (const tag of item.labels || []) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
      return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },
    list: async (filters?: ItemFilters & { projectId?: string; lifeContext?: LifeContext }): Promise<WorkItem[]> => {
      return (await api.workItems.query(filters)).items;
    },

    /** What a project page (or All Items) shows, and how many were left out and why. */
    query: async (filters?: ItemFilters & { projectId?: string; lifeContext?: LifeContext }): Promise<Selection> => {
      await initializeStore();
      const { projectId, lifeContext, ...rest } = filters || {};
      const sel = selectItems(liveItems(), { projectId, lifeContext, filters: rest }, state.projects.filter(Boolean));
      return { ...sel, items: sel.items.map(hydrateWorkItem) };
    },

    /** Every live item in the one shape, right now (for strips and counts that can't wait). */
    snapshot: (): WorkItem[] => liveItems(),

    getDeleted: async (): Promise<WorkItem[]> => {
      await initializeStore();
      return state.workItems.filter(i => i && !!i.deletedAt).map(hydrateWorkItem);
    },

    get: async (id: string): Promise<WorkItem> => {
      await initializeStore();
      const item = state.workItems.find(i => i && i.id === id);
      if (!item) throw new Error('Work item not found');
      return hydrateWorkItem(item);
    },

    create: async (payload: Partial<WorkItem>): Promise<WorkItem> => {
      await initializeStore();
      const now = new Date().toISOString();
      const id = uuid();

      if (needsPlace(payload, state.projects, state.areas)) {
        const loose = { ...payload, title: payload.title || '' } as WorkItem;
        await placeItem(loose);
        payload = { ...payload, projectId: loose.projectId, branchId: loose.branchId, areaId: loose.areaId };
      }

      let prefix = 'TASK';
      if (payload.projectId) {
        const proj = state.projects.find(p => p && p.id === payload.projectId);
        if (proj?.key) prefix = proj.key;
      } else if (payload.areaId) {
        prefix = 'LIFE';
      }

      // One past the highest number in use; older items may have no key at all.
      const key = nextKey(state.workItems, prefix);

      // Auto-infer quick wins from action verbs if not explicitly set
      // Whole words only, so "task", "context" or "checkout" don't count.
      const isShortAction = /\b(call|email|reply|text|ping|order|buy|pay|send|clean|message|ask|fill|check)\b/i.test(payload.title || '');
      const estimatedMinutes = payload.estimatedMinutes !== undefined ? payload.estimatedMinutes : (isShortAction ? 10 : null);
      const energy = payload.energy || (isShortAction ? 'low' : 'medium');

      // A milestone is logged once the work is done, so it is always done.
      const isMilestone = (payload.entityType || payload.type) === 'milestone';
      const newItem: WorkItem = {
        id,
        key,
        title: payload.title || 'Untitled Item',
        description: payload.description || '',
        entityType: payload.entityType || 'task',
        lifeContext: payload.lifeContext || 'work',
        type: payload.type || 'task',
        status: isMilestone ? 'done' : (payload.status || 'todo'),
        priority: payload.priority || 'medium',
        projectId: payload.projectId || null,
        branchId: payload.projectId ? payload.branchId || null : null,
        areaId: payload.areaId || null,
        estimated: payload.estimated || (estimatedMinutes ? `${estimatedMinutes}m` : null),
        estimatedMinutes: estimatedMinutes,
        energy: energy as any,
        actual: null,
        blockedReason: payload.blockedReason || null,
        waitingFor: payload.waitingFor || null,
        // Only things you haven't placed yet need sorting: an item with a date,
        // in Focus, or already waiting on someone is placed.
        isInbox: payload.isInbox !== undefined
          ? payload.isInbox
          : !(payload.dueDate || payload.startDate || payload.startAt || payload.isFocus || payload.waitingFor),
        isFocus: payload.isFocus || false,
        focusOrder: payload.focusOrder || null,
        snoozedUntil: payload.snoozedUntil || null,
        snoozeCount: payload.snoozeCount || 0,
        startDate: toInputDateValue(payload.startDate) || null,
        dueDate: toInputDateValue(payload.dueDate) || null,
        dueTime: payload.dueTime || null,
        startAt: toInputDateTimeValue(payload.startAt) || null,
        endAt: toInputDateTimeValue(payload.endAt) || null,
        remindAt: toInputDateTimeValue(payload.remindAt) || null,
        reminderLeadMinutes: payload.reminderLeadMinutes ?? null,
        repeatRule: payload.repeatRule || null,
        spawnedFromId: payload.spawnedFromId || null,
        location: payload.location || null,
        labels: payload.labels || [],
        customFields: payload.customFields || {},
        // A planned task names the one before it, and starts in its project type's first status.
        ...(payload.dependsOn?.length ? { dependsOn: payload.dependsOn } : {}),
        ...((payload as any).stage && !isMilestone ? { stage: (payload as any).stage } : {}),
        version: 1,
        completedAt: isMilestone || payload.status === 'done' ? (payload.completedAt || now) : null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        lastTouchedAt: now
      };
      // A lead-time reminder ("30 min before") is worked out from the date and time.
      const leadRemindAt = remindAtFor(newItem);
      if (leadRemindAt !== undefined) newItem.remindAt = leadRemindAt;

      state.workItems.unshift(newItem);
      await persist('workItems', newItem);

      return hydrateWorkItem(newItem);
    },

    updateDetails: async (id: string, updates: Partial<WorkItem>, expectedVersion?: number): Promise<WorkItem> => {
      await initializeStore();
      const index = state.workItems.findIndex(i => i && i.id === id);
      if (index === -1) throw new Error('Item not found');

      const existing = state.workItems[index];
      const now = new Date().toISOString();
      const nextVersion = (existing.version || 1) + 1;

      // Keep the number the Today view sorts by in step with the typed estimate.
      if (updates.estimated !== undefined && updates.estimatedMinutes === undefined) {
        updates = { ...updates, estimatedMinutes: parseEstimateMinutes(updates.estimated) };
      }

      const updated: WorkItem = {
        ...existing,
        ...updates,
        startDate: updates.startDate !== undefined ? (toInputDateValue(updates.startDate) || null) : existing.startDate,
        dueDate: updates.dueDate !== undefined ? (toInputDateValue(updates.dueDate) || null) : existing.dueDate,
        startAt: updates.startAt !== undefined ? (toInputDateTimeValue(updates.startAt) || null) : existing.startAt,
        endAt: updates.endAt !== undefined ? (toInputDateTimeValue(updates.endAt) || null) : existing.endAt,
        remindAt: updates.remindAt !== undefined ? (toInputDateTimeValue(updates.remindAt) || null) : existing.remindAt,
        version: nextVersion,
        updatedAt: now
      };
      // Rescheduling moves a lead-time reminder along with the item.
      if (['dueDate', 'dueTime', 'startDate', 'startAt', 'reminderLeadMinutes', 'entityType'].some(k => k in updates)) {
        const leadRemindAt = remindAtFor(updated);
        if (leadRemindAt !== undefined) updated.remindAt = leadRemindAt;
      }

      state.workItems[index] = updated;
      await persist('workItems', updated, nextVersion);

      return hydrateWorkItem(updated);
    },

    /** stage: the project type's own status (see projectTypes.ts); left out, the stored one stays. */
    transitionStatus: async (id: string, toStatus: string, expectedVersion?: number, stage?: string | null): Promise<WorkItem> => {
      await initializeStore();
      const index = state.workItems.findIndex(i => i && i.id === id);
      if (index === -1) throw new Error('Item not found');

      const existing = state.workItems[index];
      const now = new Date().toISOString();
      const nextVersion = (existing.version || 1) + 1;

      const isNowBlocked = toStatus === 'blocked';
      const updated: WorkItem = {
        ...existing,
        status: toStatus as any,
        stage: stage !== undefined ? stage : (existing.stage ?? null),
        blockedReason: isNowBlocked ? (existing.blockedReason || 'Waiting on external input') : (toStatus === 'done' ? null : existing.blockedReason),
        // Kept through "done", so undoing it still knows who you were waiting on.
        waitingFor: isNowBlocked && !existing.waitingFor ? {
          who: 'External Party',
          about: existing.title,
          followUpDate: existing.dueDate || '',
          sinceDate: now.split('T')[0]
        } : existing.waitingFor,
        completedAt: toStatus === 'done' ? now : null,
        version: nextVersion,
        updatedAt: now,
        lastTouchedAt: now
      };

      // Repeating items: finishing one makes the next copy, once. Undoing the
      // finish takes that copy back, unless it has been changed since.
      const priorCopy = existing.spawnedNextId
        ? state.workItems.find(i => i && i.id === existing.spawnedNextId && !i.deletedAt) || null
        : null;
      if (toStatus === 'done' && existing.status !== 'done' && existing.repeatRule && !priorCopy) {
        const copy = await createNextOccurrence(existing);
        updated.spawnedNextId = copy ? copy.id : null;
      } else if (toStatus !== 'done' && existing.status === 'done' && priorCopy && priorCopy.status !== 'done' && (priorCopy.version || 1) <= 1) {
        await removeRecord('workItems', priorCopy.id);
        updated.spawnedNextId = null;
      }

      const at = state.workItems.findIndex(i => i && i.id === id);
      state.workItems[at] = updated;
      await persist('workItems', updated, nextVersion);

      return hydrateWorkItem(updated);
    },

    duplicate: async (id: string): Promise<WorkItem> => {
      await initializeStore();
      const existing = state.workItems.find(i => i && i.id === id);
      if (!existing) throw new Error('Item not found');

      const created = await api.workItems.create({
        ...existing,
        title: `${existing.title} (Copy)`,
        status: 'todo',
        completedAt: null,
        deletedAt: null
      });

      // Duplicate subtasks
      const existingSubtasks = state.subtasks.filter(s => s && s.workItemId === id);
      for (const s of existingSubtasks) {
        await api.subtasks.create(created.id, s.title);
      }

      return created;
    },

    softDelete: async (id: string): Promise<void> => {
      await initializeStore();
      const index = state.workItems.findIndex(i => i && i.id === id);
      if (index === -1) return;

      const existing = state.workItems[index];
      const now = new Date().toISOString();
      const updated: WorkItem = {
        ...existing,
        deletedAt: now,
        version: (existing.version || 1) + 1,
        updatedAt: now
      };

      state.workItems[index] = updated;
      await persist('workItems', updated, updated.version);
    },

    restore: async (id: string): Promise<WorkItem> => {
      await initializeStore();
      const index = state.workItems.findIndex(i => i && i.id === id);
      if (index === -1) throw new Error('Item not found');

      const existing = state.workItems[index];
      const now = new Date().toISOString();
      const updated: WorkItem = {
        ...existing,
        deletedAt: null,
        version: (existing.version || 1) + 1,
        updatedAt: now
      };

      state.workItems[index] = updated;
      await persist('workItems', updated, updated.version);
      return hydrateWorkItem(updated);
    },

    permanentDelete: async (id: string): Promise<void> => {
      await initializeStore();
      await removeRecord('workItems', id);
    }
  },

  projects: {
    list: async (): Promise<Project[]> => {
      await initializeStore();
      return state.projects.filter(p => p);
    },
    create: async (payload: Partial<Project>): Promise<Project> => {
      await initializeStore();
      const now = new Date().toISOString();
      const project: Project = {
        id: uuid(),
        name: payload.name || 'New Project',
        key: (payload.key || 'PROJ').toUpperCase(),
        color: payload.color || 'bg-indigo-500',
        sequence: state.projects.length + 1,
        type: payload.type || 'other',
        description: payload.description || '',
        createdAt: now,
        updatedAt: now
      };
      state.projects.push(project);
      await persist('projects', project);
      return project;
    },
    update: async (id: string, updates: Partial<Project>): Promise<Project> => {
      await initializeStore();
      const index = state.projects.findIndex(p => p && p.id === id);
      if (index === -1) throw new Error('Project not found');
      const updated = {
        ...state.projects[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      state.projects[index] = updated;
      await persist('projects', updated);
      return updated;
    },
    addBranch: async (projectId: string, branch: Omit<ProjectBranch, 'id' | 'createdAt'>): Promise<ProjectBranch> => {
      const project = state.projects.find(p => p && p.id === projectId);
      if (!project) throw new Error('Project not found');
      const created: ProjectBranch = { ...branch, id: uuid(), createdAt: new Date().toISOString() };
      await api.projects.update(projectId, { branches: [...(project.branches || []), created] });
      return created;
    },
    updateBranch: async (projectId: string, branchId: string, updates: Partial<ProjectBranch>): Promise<void> => {
      const project = state.projects.find(p => p && p.id === projectId);
      if (!project) throw new Error('Project not found');
      await api.projects.update(projectId, {
        branches: (project.branches || []).map(b => b.id === branchId ? { ...b, ...updates, id: b.id } : b)
      });
    },
    // Removing a branch hands its items and sub-branches to the line it came from.
    deleteBranch: async (projectId: string, branchId: string): Promise<void> => {
      const project = state.projects.find(p => p && p.id === projectId);
      if (!project) throw new Error('Project not found');
      const branch = (project.branches || []).find(b => b.id === branchId);
      const parentId = branch?.parentId ?? null;
      for (const item of state.workItems.filter(i => i && i.projectId === projectId && i.branchId === branchId)) {
        await api.workItems.updateDetails(item.id, { branchId: parentId });
      }
      await api.projects.update(projectId, {
        branches: (project.branches || [])
          .filter(b => b.id !== branchId)
          .map(b => b.parentId === branchId ? { ...b, parentId } : b)
      });
    },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      await removeRecord('projects', id);
    }
  },

  areas: {
    list: async (): Promise<Area[]> => {
      await initializeStore();
      return state.areas.filter(a => a);
    },
    create: async (payload: Partial<Area>): Promise<Area> => {
      await initializeStore();
      const now = new Date().toISOString();
      const area: Area = {
        id: uuid(),
        name: payload.name || 'New Area',
        color: payload.color || 'bg-purple-500',
        icon: payload.icon || 'Sparkles',
        description: payload.description || '',
        createdAt: now,
        updatedAt: now
      };
      state.areas.push(area);
      await persist('areas', area);
      return area;
    },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      await removeRecord('areas', id);
    }
  },

  goals: {
    list: async (): Promise<Goal[]> => {
      await initializeStore();
      return state.goals.filter(g => g).map(goal => {
        const linkedItems = state.workItems.filter(i => i && !i.deletedAt && ((goal.projectId && i.projectId === goal.projectId) || (goal.areaId && i.areaId === goal.areaId)));
        if (linkedItems.length > 0) {
          const done = linkedItems.filter(i => i.status === 'done').length;
          const calculatedProgress = Math.round((done / linkedItems.length) * 100);
          return { ...goal, progress: calculatedProgress };
        }
        return goal;
      });
    },
    create: async (payload: Partial<Goal>): Promise<Goal> => {
      await initializeStore();
      const now = new Date().toISOString();
      const goal: Goal = {
        id: uuid(),
        title: payload.title || 'New Goal',
        progress: payload.progress || 0,
        targetDate: payload.targetDate || '',
        areaId: payload.areaId || null,
        projectId: payload.projectId || null,
        category: payload.category || 'personal',
        description: payload.description || '',
        createdAt: now,
        updatedAt: now
      };
      state.goals.push(goal);
      await persist('goals', goal);
      return goal;
    },
    updateProgress: async (id: string, progress: number): Promise<Goal> => {
      await initializeStore();
      const g = state.goals.find(g => g && g.id === id);
      if (!g) throw new Error('Goal not found');
      g.progress = progress;
      g.updatedAt = new Date().toISOString();
      await persist('goals', g);
      return g;
    },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      await removeRecord('goals', id);
    }
  },

  habits: {
    list: async (): Promise<Habit[]> => {
      await initializeStore();
      // A habit written with "title" instead of "name" (as Claude once did) still
      // shows its name, and one missing a target or history counts as daily, unticked.
      return state.habits.filter(h => h).map(h => ({
        ...h,
        name: h.name || String((h as { title?: string }).title || '').trim() || 'Untitled habit',
        targetCount: h.targetCount || 7,
        history: Array.isArray(h.history) ? h.history : [],
      }));
    },
    create: async (payload: Partial<Habit>): Promise<Habit> => {
      await initializeStore();
      const now = new Date().toISOString();
      const habit: Habit = {
        id: uuid(),
        name: payload.name || 'New Habit',
        targetCount: Math.min(7, Math.max(1, payload.targetCount || 7)),
        frequency: (payload.targetCount || 7) >= 7 ? 'daily' : `${payload.targetCount}/week`,
        history: [],
        areaId: payload.areaId || null,
        streak: 0,
        // New habits remind by default; null turns it off, and it can be turned off on the habit.
        remindTime: payload.remindTime === null ? null
          : /^\d{2}:\d{2}$/.test(payload.remindTime || '') ? payload.remindTime : DEFAULT_HABIT_REMIND_TIME,
        remindPush: payload.remindPush !== false,
        remindEmail: !!payload.remindEmail,
        createdAt: now,
        updatedAt: now
      };
      state.habits.push(habit);
      await persist('habits', habit);
      return habit;
    },
    toggleDay: async (id: string, day: string): Promise<Habit> => {
      await initializeStore();
      const h = state.habits.find(h => h && h.id === id);
      if (!h) throw new Error('Habit not found');
      // History holds real dates; entries from when it held weekday names are dropped.
      const history = dateEntries(h.history);
      const has = history.includes(day);
      h.history = has ? history.filter(d => d !== day) : [...history, day];
      h.streak = streakOf(h.history, localDateString());
      h.updatedAt = new Date().toISOString();
      await persist('habits', h);
      return h;
    },
    update: async (id: string, updates: Pick<Partial<Habit>, 'name' | 'targetCount' | 'remindTime' | 'remindPush' | 'remindEmail'>): Promise<Habit> => {
      await initializeStore();
      const h = state.habits.find(h => h && h.id === id);
      if (!h) throw new Error('Habit not found');
      if (updates.name !== undefined) h.name = updates.name.trim() || h.name;
      if (updates.remindTime !== undefined) h.remindTime = /^\d{2}:\d{2}$/.test(updates.remindTime || '') ? updates.remindTime : null;
      if (updates.remindPush !== undefined) h.remindPush = !!updates.remindPush;
      if (updates.remindEmail !== undefined) h.remindEmail = !!updates.remindEmail;
      h.targetCount = updates.targetCount !== undefined ? Math.min(7, Math.max(1, Math.round(updates.targetCount))) : (h.targetCount || 7);
      h.frequency = h.targetCount >= 7 ? 'daily' : `${h.targetCount}/week`;
      h.updatedAt = new Date().toISOString();
      await persist('habits', h);
      return h;
    },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      await removeRecord('habits', id);
    }
  },

  notes: {
    list: async (): Promise<Note[]> => {
      await initializeStore();
      return state.notes.filter(n => n);
    },
    create: async (payload: Partial<Note>): Promise<Note> => {
      await initializeStore();
      const now = new Date().toISOString();
      const note: Note = {
        id: uuid(),
        title: payload.title || 'Untitled Note',
        content: payload.content || '',
        areaId: payload.areaId || null,
        projectId: payload.projectId || null,
        ...(payload.lifeContext ? { lifeContext: payload.lifeContext } : {}),
        ...(payload.kind ? { kind: payload.kind } : {}),
        createdAt: now,
        updatedAt: now
      };
      state.notes.unshift(note);
      await persist('notes', note);
      return note;
    },
    update: async (id: string, updates: Partial<Note>): Promise<Note> => {
      await initializeStore();
      const n = state.notes.find(n => n && n.id === id);
      if (!n) throw new Error('Note not found');
      Object.assign(n, updates);
      n.updatedAt = new Date().toISOString();
      await putToStore('notes', n);
      // Debounce note sync to avoid keystroke network spam
      syncEngine.enqueueNoteDebounced(n.id, n);
      return n;
    },
    // The formatted note as HTML. Older plain-text notes become paragraphs.
    getBody: (note: Note): string => {
      const parts = Number(note.bodyParts) || 0;
      let html = '';
      for (let i = 0; i < parts; i++) html += String(note[`body${i}`] ?? '').replace(/^~/, '');
      if (parts > 0) return html;
      const text = note.content || '';
      if (!text) return '';
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return text.split('\n').map(line => `<div>${line ? esc(line) : '<br>'}</div>`).join('');
    },
    saveBody: async (id: string, html: string, text: string): Promise<Note> => {
      await initializeStore();
      const n = state.notes.find(n => n && n.id === id);
      if (!n) throw new Error('Note not found');
      // Same split as board scenes: "~" keeps Sheets from reading a part as a
      // number or formula, and parts past the count are ignored.
      const size = 45000;
      const parts = Math.max(1, Math.ceil(html.length / size));
      for (let i = 0; i < parts; i++) n[`body${i}`] = '~' + html.slice(i * size, (i + 1) * size);
      n.bodyParts = parts;
      n.content = text.slice(0, 40000);
      n.updatedAt = new Date().toISOString();
      await putToStore('notes', n);
      syncEngine.enqueueNoteDebounced(n.id, n);
      return n;
    },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      // A map takes its thoughts with it.
      for (const t of state.thoughts.filter(t => t && t.mapId === id)) await removeRecord('thoughts', t.id);
      await removeRecord('notes', id);
    }
  },

  // Thoughts on a thought map (a note with kind 'map'), oldest first.
  thoughts: {
    list: async (mapId?: string): Promise<Thought[]> => {
      await initializeStore();
      return state.thoughts
        .filter(t => t && t.mapId && (!mapId || t.mapId === mapId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    create: async (mapId: string, payload: { text: string; status?: ThoughtStatus; topic?: string; parentId?: string | null; note?: string }): Promise<Thought> => {
      await initializeStore();
      const now = new Date().toISOString();
      const thought: Thought = {
        id: uuid(),
        mapId,
        text: payload.text.trim().slice(0, 500),
        status: payload.status || 'open',
        topic: (payload.topic || '').trim().slice(0, 40),
        parentId: payload.parentId || null,
        ...(payload.note ? { note: payload.note } : {}),
        source: 'you',
        createdAt: now,
        updatedAt: now
      };
      state.thoughts.push(thought);
      await persist('thoughts', thought);
      await touchNote(mapId);
      return thought;
    },
    update: async (id: string, updates: Partial<Pick<Thought, 'text' | 'status' | 'topic' | 'parentId' | 'note'>>): Promise<Thought> => {
      await initializeStore();
      const t = state.thoughts.find(t => t && t.id === id);
      if (!t) throw new Error('Thought not found');
      Object.assign(t, updates, { updatedAt: new Date().toISOString() });
      await persist('thoughts', t);
      await touchNote(t.mapId);
      return t;
    },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      const t = state.thoughts.find(t => t && t.id === id);
      if (!t) return;
      // Thoughts under it move up to its parent rather than vanishing.
      for (const child of state.thoughts.filter(c => c && c.parentId === id)) {
        child.parentId = t.parentId || null;
        child.updatedAt = new Date().toISOString();
        await persist('thoughts', child);
      }
      await removeRecord('thoughts', id);
      await touchNote(t.mapId);
    }
  },

  boards: {
    list: async (lifeContext?: LifeContext): Promise<Board[]> => {
      await initializeStore();
      return state.boards
        .filter(b => b && (!lifeContext || (b.lifeContext || 'work') === lifeContext))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    create: async (payload: { title?: string; lifeContext?: LifeContext }): Promise<Board> => {
      await initializeStore();
      const now = new Date().toISOString();
      const board: Board = {
        id: uuid(),
        title: payload.title || 'Untitled board',
        lifeContext: payload.lifeContext || 'work',
        sceneParts: 1,
        scene0: '~[]',
        createdAt: now,
        updatedAt: now
      };
      state.boards.push(board);
      await persist('boards', board);
      return board;
    },
    rename: async (id: string, title: string): Promise<Board> => {
      await initializeStore();
      const b = state.boards.find(b => b && b.id === id);
      if (!b) throw new Error('Board not found');
      b.title = title;
      b.updatedAt = new Date().toISOString();
      await persist('boards', b);
      return b;
    },
    // The drawing as a JSON string of Excalidraw elements.
    getScene: (board: Board): string => {
      const parts = Number(board.sceneParts) || 0;
      let json = '';
      for (let i = 0; i < parts; i++) json += String(board[`scene${i}`] ?? '').replace(/^~/, '');
      return json || '[]';
    },
    saveScene: async (id: string, sceneJson: string): Promise<Board> => {
      await initializeStore();
      const b = state.boards.find(b => b && b.id === id);
      if (!b) throw new Error('Board not found');
      const size = 45000;
      const parts = Math.max(1, Math.ceil(sceneJson.length / size));
      // Each part starts with "~" so Google Sheets keeps it as plain text (it would
      // otherwise read some parts as numbers, formulas or JSON). Parts past the new
      // count stay on the record but are ignored, since the server merges fields
      // rather than replacing the row.
      for (let i = 0; i < parts; i++) b[`scene${i}`] = '~' + sceneJson.slice(i * size, (i + 1) * size);
      b.sceneParts = parts;
      b.updatedAt = new Date().toISOString();
      await putToStore('boards', b);
      syncEngine.enqueueNoteDebounced(`board:${b.id}`, b, 'boards');
      return b;
    },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      await removeRecord('boards', id);
    }
  },

  comments: {
    list: async (workItemId: string): Promise<Comment[]> => {
      await initializeStore();
      return state.comments.filter(c => c && c.workItemId === workItemId && !c.deletedAt);
    },
    create: async (workItemId: string, body: string): Promise<Comment> => {
      await initializeStore();
      const comment: Comment = {
        id: uuid(),
        workItemId,
        body,
        createdAt: new Date().toISOString()
      };
      state.comments.push(comment);
      await persist('comments', comment);
      return comment;
    }
  },

  subtasks: {
    list: async (workItemId: string): Promise<Subtask[]> => {
      await initializeStore();
      return state.subtasks.filter(s => s && s.workItemId === workItemId);
    },
    create: async (workItemId: string, title: string): Promise<Subtask> => {
      await initializeStore();
      const subtask: Subtask = {
        id: uuid(),
        workItemId,
        title,
        completed: false,
        position: state.subtasks.filter(s => s && s.workItemId === workItemId).length,
        createdAt: new Date().toISOString()
      };
      state.subtasks.push(subtask);
      await persist('subtasks', subtask);
      return subtask;
    },
    toggle: async (id: string, completed: boolean): Promise<Subtask> => {
      await initializeStore();
      const s = state.subtasks.find(s => s.id === id);
      if (!s) throw new Error('Subtask not found');
      s.completed = completed;
      await persist('subtasks', s);
      return s;
        },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      await removeRecord('subtasks', id);
    }
  },

  activities: {
    list: async (workItemId: string): Promise<Activity[]> => {
      await initializeStore();
      return state.activities.filter(a => a && a.workItemId === workItemId);
    }
  },

  inbox: {
    list: async (lifeContext?: LifeContext): Promise<WorkItem[]> => {
      await initializeStore();
      let items = liveItems().filter(i => needsSorting(i) && i.status !== 'done' && !isSnoozed(i));
      if (lifeContext) {
        items = items.filter(i => i && contextOf(i) === lifeContext);
      }
      return items.map(hydrateWorkItem);
    },

    // Everything open, across every project, area and section. Snoozed items
    // stay listed (marked) so nothing open is ever out of sight.
    all: async (lifeContext?: LifeContext): Promise<{ items: WorkItem[]; done: WorkItem[]; check: VisibilityCheck }> => {
      await initializeStore();
      const today = localDateString();
      const live = liveItems().map(hydrateWorkItem);
      const items = live.filter(i => isOpen(i) && inContext(i, lifeContext)).sort(compareInbox(today));
      const done = live.filter(i => i.status === 'done' && inContext(i, lifeContext))
        .sort((a, b) => (b.completedAt || b.updatedAt || '').localeCompare(a.completedAt || a.updatedAt || ''));
      const alarms = state.workItems.filter(i => isLive(i) && isAlarm(i) && isOpen(i) && inContext(i, lifeContext)).length;
      const check = checkVisibility(live, new Set(items.map(i => i.id)), lifeContext, alarms);
      return { items, done, check };
    },

    clarify: async (id: string, updates: Partial<WorkItem>): Promise<WorkItem> => {
      await initializeStore();
      return api.workItems.updateDetails(id, {
        ...updates,
        isInbox: false
      });
    }
  },

  focus: {
    list: async (lifeContext?: LifeContext): Promise<WorkItem[]> => {
      await initializeStore();
      let items = liveItems().filter(i => i.isFocus && i.status !== 'done' && !isSnoozed(i));
      if (lifeContext) {
        items = items.filter(i => contextOf(i) === lifeContext);
      }
      return items.sort((a, b) => (a.focusOrder || 0) - (b.focusOrder || 0)).map(hydrateWorkItem);
    },

    toggle: async (id: string): Promise<WorkItem> => {
      await initializeStore();
      const item = state.workItems.find(i => i && i.id === id);
      if (!item) throw new Error('Item not found');

      const nextFocus = !item.isFocus;
      if (nextFocus && liveItems().filter(i => i.isFocus && i.status !== 'done').length >= FOCUS_LIMIT) {
        throw new Error(`Focus is full (${FOCUS_LIMIT}). Finish one or take one out first.`);
      }
      return api.workItems.updateDetails(id, {
        isFocus: nextFocus,
        focusOrder: nextFocus ? Date.now() : undefined
      });
    },

    reorder: async (orderedIds: string[]): Promise<void> => {
      await initializeStore();
      for (let i = 0; i < orderedIds.length; i++) {
        const id = orderedIds[i];
        const item = state.workItems.find(t => t && t.id === id);
        if (item) {
          // A new edit like any other, so the server keeps it over an older copy.
          item.focusOrder = i;
          item.version = (item.version || 1) + 1;
          item.updatedAt = new Date().toISOString();
          await persist('workItems', item, item.version);
        }
      }
    }
  },

  snooze: {
    snoozeItem: async (id: string, untilIso: string): Promise<WorkItem> => {
      await initializeStore();
      const item = state.workItems.find(i => i && i.id === id);
      if (!item) throw new Error('Item not found');

      // A reminder due while it's snoozed goes off when it comes back instead.
      const until = new Date(untilIso);
      const remindAt = item.remindAt && new Date(item.remindAt) < until ? toLocalDateTime(until) : undefined;
      return api.workItems.updateDetails(id, {
        snoozedUntil: untilIso,
        snoozeCount: (item.snoozeCount || 0) + 1,
        lastTouchedAt: new Date().toISOString(),
        ...(remindAt ? { remindAt } : {})
      });
    }
  },

  waitingFor: {
    list: async (lifeContext?: LifeContext): Promise<WorkItem[]> => {
      await initializeStore();
      let items = liveItems().filter(i => i.waitingFor && i.status !== 'done' && !isSnoozed(i));
      if (lifeContext) {
        items = items.filter(i => contextOf(i) === lifeContext);
      }
      return items.map(hydrateWorkItem);
    },

    set: async (id: string, payload: { who: string; about?: string; followUpDate?: string } | null): Promise<WorkItem> => {
      await initializeStore();
      const waitingForData = payload ? {
        who: payload.who,
        about: payload.about || '',
        followUpDate: payload.followUpDate || '',
        sinceDate: localDateString()
      } : null;

      return api.workItems.updateDetails(id, {
        waitingFor: waitingForData,
        status: payload ? 'blocked' : 'todo',
        blockedReason: payload ? `Waiting for ${payload.who}` : null,
        lastTouchedAt: new Date().toISOString()
      });
    }
  },

  // Today: one list of everything due, overdue, starting today or starred,
  // ordered overdue first, then priority, then time.
  today: {
    list: async (lifeContext?: LifeContext): Promise<{ items: WorkItem[]; snoozed: WorkItem[] }> => {
      await initializeStore();
      const today = localDateString();
      const candidates = liveItems()
        .filter(i => isOpen(i) && inContext(i, lifeContext))
        .map(hydrateWorkItem)
        .filter(i => isOnToday(i, today))
        .sort(compareToday(today));
      return {
        items: candidates.filter(i => !isSnoozedNow(i)),
        snoozed: candidates.filter(i => isSnoozedNow(i))
      };
    },

    // What Chill mode hides: open work items, and those of them on Today.
    hiddenWork: async (): Promise<{ today: number; open: number }> => {
      await initializeStore();
      const today = localDateString();
      const work = liveItems().filter(i => isOpen(i) && contextOf(i) === 'work').map(hydrateWorkItem);
      return { today: work.filter(i => isOnToday(i, today)).length, open: work.length };
    }
  },

  attention: {
    getTodayAttention: async (lifeContext?: LifeContext): Promise<any> => {
      await initializeStore();
      const now = new Date();
      const today = localDateString(now);
      const nowIso = now.toISOString();

      const items = liveItems().filter(i => !lifeContext || contextOf(i) === lifeContext);

      // Filter active (not completed, not actively snoozed past now)
      const activeItems = items.filter(i => {
        if (i.status === 'done') return false;
        if (i.snoozedUntil && i.snoozedUntil > nowIso) return false;
        return true;
      });

      // Needs Attention: Overdue items or repeatedly snoozed
      const needsAttention = activeItems.filter(i => 
        (i.dueDate && i.dueDate < today) || (i.snoozeCount && i.snoozeCount >= 2)
      ).map(hydrateWorkItem);

      // Due Today / Scheduled Today
      const dueToday = activeItems.filter(i => 
        i.dueDate === today || 
        (i.startDate && i.startDate <= today && i.dueDate && i.dueDate >= today) ||
        (i.startAt && i.startAt.startsWith(today))
      ).map(hydrateWorkItem).sort((a, b) => timeOfDay(a).localeCompare(timeOfDay(b)));

      // Reminders
      const reminders = activeItems.filter(i => 
        i.entityType === 'reminder' || (i.remindAt && i.remindAt.startsWith(today))
      ).map(hydrateWorkItem);

      // Active Focus
      const todayFocus = activeItems.filter(i => i.isFocus)
        .sort((a, b) => (a.focusOrder || 0) - (b.focusOrder || 0))
        .map(hydrateWorkItem);

      // Quick Wins: short or low-energy tasks that aren't already in Focus.
      // The typed estimate wins over the stored number, which older items
      // may not have kept in step.
      const quickWins = activeItems.filter(i => {
        if (i.isFocus || i.entityType === 'event' || i.entityType === 'milestone') return false;
        const minutes = i.estimated ? parseEstimateMinutes(i.estimated) : i.estimatedMinutes;
        return (minutes != null && minutes <= 15) || (minutes == null && i.energy === 'low');
      }).slice(0, 6).map(hydrateWorkItem);

      // Delegated Waiting For
      const waitingFor = activeItems.filter(i => !!i.waitingFor).map(hydrateWorkItem);

      // Slipping / Untouched items based on configurable threshold
      const configuredDays = Number(await getMeta('resurfacing_days')) || 14;
      const thresholdAgo = new Date(Date.now() - configuredDays * 86400000).toISOString();
      const slippedItems = activeItems.filter(i => 
        (i.updatedAt && i.updatedAt < thresholdAgo) || 
        (i.createdAt && i.createdAt < thresholdAgo && !i.lastTouchedAt)
      ).slice(0, 5).map(hydrateWorkItem);

      const inboxCount = items.filter(i => needsSorting(i) && i.status !== 'done' && !isSnoozed(i)).length;

      // What to work on when Focus is empty: overdue first, then the most
      // urgent, then the longest-waiting. Tasks only.
      const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      const rank = (i: WorkItem) => (i.dueDate && i.dueDate < today) ? 0 : (i.dueDate === today ? 1 : 2);
      const suggestions = activeItems
        .filter(i => !i.isFocus && i.entityType === 'task' && !i.waitingFor && i.status !== 'blocked')
        // Due-today items already sit in Scheduled with their own Focus button.
        .filter(i => rank(i) === 0 || (rank(i) === 2 && (i.priority === 'urgent' || i.priority === 'high')))
        .sort((a, b) => rank(a) - rank(b)
          || (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
          || (a.createdAt || '').localeCompare(b.createdAt || ''))
        .slice(0, 3)
        .map(hydrateWorkItem);

      return {
        suggestions,
        needsAttention,
        dueToday,
        reminders,
        todayFocus,
        quickWins,
        waitingFor,
        slippedItems,
        inboxCount
      };
    }
  },

  // Radar research. The Pi creates these; here they're only read, starred, and
  // (ideas) linked to the project made from them.
  dossiers: {
    list: async (): Promise<Dossier[]> => {
      await initializeStore();
      return state.dossiers.filter(d => d).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    update: async (id: string, updates: Partial<Dossier>): Promise<Dossier> => {
      await initializeStore();
      const d = state.dossiers.find(d => d && d.id === id);
      if (!d) throw new Error('Research not found');
      Object.assign(d, updates, { updatedAt: new Date().toISOString() });
      await persist('dossiers', d);
      return d;
    },
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      const d = state.dossiers.find(d => d && d.id === id);
      for (const ideaId of d?.ideaIds || []) await removeRecord('ideas', ideaId);
      await removeRecord('dossiers', id);
    }
  },

  ideas: {
    list: async (): Promise<Idea[]> => {
      await initializeStore();
      return state.ideas.filter(i => i).sort((a, b) => (b.score || 0) - (a.score || 0));
    },
    update: async (id: string, updates: Partial<Idea>): Promise<Idea> => {
      await initializeStore();
      const idea = state.ideas.find(i => i && i.id === id);
      if (!idea) throw new Error('Idea not found');
      Object.assign(idea, updates, { updatedAt: new Date().toISOString() });
      await persist('ideas', idea);
      return idea;
    }
  },

  exportBackup: async (): Promise<void> => {
    await initializeStore();
    const backupData = {
      format: 'sage-backup-v3',
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      clientId: await getOrCreateClientId(),
      data: state
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sage_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importBackup: async (backupJson: string): Promise<{ success: boolean; message: string }> => {
    try {
      const parsed = JSON.parse(backupJson);
      if (!parsed.data || typeof parsed.data !== 'object') {
        throw new Error('Invalid backup file format: missing data block');
      }

      state = {
        workItems: Array.isArray(parsed.data.workItems) ? parsed.data.workItems : [],
        projects: Array.isArray(parsed.data.projects) ? parsed.data.projects : [],
        areas: Array.isArray(parsed.data.areas) ? parsed.data.areas : [],
        goals: Array.isArray(parsed.data.goals) ? parsed.data.goals : [],
        habits: Array.isArray(parsed.data.habits) ? parsed.data.habits : [],
        notes: Array.isArray(parsed.data.notes) ? parsed.data.notes : [],
        comments: Array.isArray(parsed.data.comments) ? parsed.data.comments : [],
        subtasks: Array.isArray(parsed.data.subtasks) ? parsed.data.subtasks : [],
        activities: Array.isArray(parsed.data.activities) ? parsed.data.activities : [],
        boards: Array.isArray(parsed.data.boards) ? parsed.data.boards : [],
        dossiers: Array.isArray(parsed.data.dossiers) ? parsed.data.dossiers : [],
        ideas: Array.isArray(parsed.data.ideas) ? parsed.data.ideas : [],
        thoughts: Array.isArray(parsed.data.thoughts) ? parsed.data.thoughts : []
      };

      await Promise.all([
        putBatchToStore('workItems', state.workItems),
        putBatchToStore('projects', state.projects),
        putBatchToStore('areas', state.areas),
        putBatchToStore('goals', state.goals),
        putBatchToStore('habits', state.habits),
        putBatchToStore('notes', state.notes),
        putBatchToStore('comments', state.comments),
        putBatchToStore('subtasks', state.subtasks),
        putBatchToStore('activities', state.activities),
        putBatchToStore('boards', state.boards),
        putBatchToStore('dossiers', state.dossiers),
        putBatchToStore('ideas', state.ideas),
        putBatchToStore('thoughts', state.thoughts)
      ]);

      // Upload everything restored, not just tasks, so other devices get it too.
      // Stamped as just saved, so the server takes the backup over newer copies.
      const restoredAt = new Date().toISOString();
      for (const table of Object.keys(state) as Table[]) {
        for (const record of state[table] as Array<{ id: string; updatedAt?: string }>) {
          if (!record?.id) continue;
          await syncEngine.enqueueOperation(table, record.id, 'save', record.updatedAt ? { ...record, updatedAt: restoredAt } : record);
        }
      }

      return { success: true, message: `Successfully imported ${state.workItems.length} items from backup` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to import backup' };
    }
  },

  getMeta: async (key: string): Promise<any> => {
    return getMeta(key);
  },

  setMeta: async (key: string, value: any): Promise<void> => {
    return setMeta(key, value);
  },

  clearAllData: async (): Promise<void> => {
    // The Pi saves a backup before it clears, and refuses without the word
    // below. If it refuses or can't be reached, nothing is wiped here either:
    // clearing only this device would let the next sync bring everything back.
    const fetchUrl = getGasUrl('clearAll');
    const response = await fetch(fetchUrl, {
      method: 'POST',
      // text/plain keeps this a simple request; application/json makes the browser
      // send a CORS preflight, which Apps Script rejects.
      headers: syncHeaders({ 'Content-Type': 'text/plain;charset=utf-8' }),
      body: JSON.stringify({ action: 'clearAll', confirm: 'DELETE' })
    });
    if (!response.ok) throw new Error(`The server didn't clear its data (HTTP ${response.status}), so nothing was cleared.`);

    await clearAllStores();
    state = {
      workItems: [], projects: [], areas: [], goals: [], habits: [], notes: [], comments: [], subtasks: [], activities: [], boards: [], dossiers: [], ideas: [], thoughts: []
    };
    try {
      localStorage.removeItem('sage_solo_v5');
      localStorage.removeItem('sage_tab_bus');
    } catch (e) {}

    window.location.reload();
  }
};
