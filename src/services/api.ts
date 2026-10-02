/**
 * SAGE INDUSTRIAL-GRADE API CLIENT & DOMAIN STORE
 * - Local-First with IndexedDB transactional persistence
 * - Durable Sync Queue with Exponential Backoff & Idempotency
 * - Zero synchronous localStorage blocking
 * - Safe Tombstone replication model
 * - Versioned Backup Export / Import
 */

import { WorkItem, Project, Area, Goal, Habit, Note, Comment, Subtask, Activity, Board, LifeContext } from './types';
import { LABELS, uuid } from './constants';
import { INITIAL_PROJECTS, INITIAL_AREAS, INITIAL_GOALS, INITIAL_HABITS, INITIAL_NOTES } from './sampleData';
import { toInputDateValue, toInputDateTimeValue, parseDateString, parseEstimateMinutes } from '../utils/dateUtils';
import { getAllFromStore, putToStore, putBatchToStore, deleteFromStore, clearAllStores, getMeta, setMeta, migrateFromLocalStorage, getOrCreateClientId } from './db';
import { syncEngine, SyncEngineStatus, getGasUrl, syncHeaders } from './syncEngine';

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
  boards: []
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
      workItems, projects, areas, goals, habits, notes, comments, subtasks, activities, boards
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
      getAllFromStore<Board>('boards')
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
        boards
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

    syncEngine.init().catch(err => {
      console.warn('[SyncEngine] Background initialization warning:', err);
    });
  })();

  return initPromise;
}

// Start async initialization immediately
initializeStore().catch(console.error);

function hydrateWorkItem(item: WorkItem): WorkItem {
  if (!item) return item;
  
  const project = item.projectId ? (state.projects || []).find(p => p && p.id === item.projectId) || null : null;
  const area = item.areaId ? (state.areas || []).find(a => a && a.id === item.areaId) || null : null;
  const labelsList = Array.isArray(item.labels) ? item.labels.map(lId => LABELS.find(l => l.id === lId)).filter(Boolean) : [];
  const subtasksForItem = (state.subtasks || []).filter(s => s && s.workItemId === item.id);
  const commentsForItem = (state.comments || []).filter(c => c && c.workItemId === item.id && !c.deletedAt);

  const cleanStartDate = toInputDateValue(item.startDate);
  const cleanDueDate = toInputDateValue(item.dueDate);
  const cleanStartAt = toInputDateTimeValue(item.startAt);
  const cleanEndAt = toInputDateTimeValue(item.endAt);
  const cleanRemindAt = toInputDateTimeValue(item.remindAt);

  return {
    ...item,
    startDate: cleanStartDate || null,
    dueDate: cleanDueDate || null,
    startAt: cleanStartAt || null,
    endAt: cleanEndAt || null,
    remindAt: cleanRemindAt || null,
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
            const tables = ['workItems', 'projects', 'areas', 'goals', 'habits', 'notes', 'comments', 'subtasks', 'activities', 'boards'] as const;
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
    list: async (filters?: {
      projectId?: string;
      lifeContext?: LifeContext;
      status?: string;
      search?: string;
      entityType?: string;
      priority?: string;
    }): Promise<WorkItem[]> => {
      await initializeStore();
      let items = state.workItems.filter(i => i && !i.deletedAt);

      if (filters?.lifeContext) {
        items = items.filter(i => i && (i.lifeContext || 'work') === filters.lifeContext);
      }

      if (filters?.projectId && filters.projectId !== 'all') {
        items = items.filter(i => i.projectId === filters.projectId || i.areaId === filters.projectId);
      }

      if (filters?.entityType && filters.entityType !== 'all') {
        items = items.filter(i => (i.entityType || 'task') === filters.entityType);
      }

      if (filters?.priority && filters.priority !== 'all') {
        items = items.filter(i => i.priority === filters.priority);
      }

      if (filters?.status && filters.status !== 'all') {
        if (filters.status === 'open') {
          items = items.filter(i => i.status !== 'done');
        } else if (filters.status === 'done') {
          items = items.filter(i => i.status === 'done');
        } else {
          items = items.filter(i => i.status === filters.status);
        }
      }

      if (filters?.search) {
        const q = filters.search.toLowerCase();
        items = items.filter(i =>
          i.title.toLowerCase().includes(q) ||
          i.key.toLowerCase().includes(q) ||
          (i.description && i.description.toLowerCase().includes(q))
        );
      }

      return items.map(hydrateWorkItem);
    },

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

      let prefix = 'TASK';
      if (payload.projectId) {
        const proj = state.projects.find(p => p && p.id === payload.projectId);
        if (proj?.key) prefix = proj.key;
      } else if (payload.areaId) {
        prefix = 'LIFE';
      }

      const count = state.workItems.filter(i => i && i.key.startsWith(prefix)).length + 1;
      const key = `${prefix}-${count}`;

      // Auto-infer quick wins from action verbs if not explicitly set
      // Whole words only, so "task", "context" or "checkout" don't count.
      const isShortAction = /\b(call|email|reply|text|ping|order|buy|pay|send|clean|message|ask|fill|check)\b/i.test(payload.title || '');
      const estimatedMinutes = payload.estimatedMinutes !== undefined ? payload.estimatedMinutes : (isShortAction ? 10 : null);
      const energy = payload.energy || (isShortAction ? 'low' : 'medium');

      const newItem: WorkItem = {
        id,
        key,
        title: payload.title || 'Untitled Item',
        description: payload.description || '',
        entityType: payload.entityType || 'task',
        lifeContext: payload.lifeContext || 'work',
        type: payload.type || 'task',
        status: payload.status || 'todo',
        priority: payload.priority || 'medium',
        projectId: payload.projectId || null,
        areaId: payload.areaId || null,
        estimated: payload.estimated || (estimatedMinutes ? `${estimatedMinutes}m` : null),
        estimatedMinutes: estimatedMinutes,
        energy: energy as any,
        actual: null,
        blockedReason: payload.blockedReason || null,
        waitingFor: payload.waitingFor || null,
        isInbox: payload.isInbox !== undefined ? payload.isInbox : true,
        isFocus: payload.isFocus || false,
        focusOrder: payload.focusOrder || null,
        snoozedUntil: payload.snoozedUntil || null,
        snoozeCount: payload.snoozeCount || 0,
        startDate: toInputDateValue(payload.startDate) || null,
        dueDate: toInputDateValue(payload.dueDate) || null,
        startAt: toInputDateTimeValue(payload.startAt) || null,
        endAt: toInputDateTimeValue(payload.endAt) || null,
        remindAt: toInputDateTimeValue(payload.remindAt) || null,
        reminderLeadMinutes: payload.reminderLeadMinutes ?? null,
        repeatRule: payload.repeatRule || null,
        location: payload.location || null,
        labels: payload.labels || [],
        customFields: payload.customFields || {},
        version: 1,
        completedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        lastTouchedAt: now
      };

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

      state.workItems[index] = updated;
      await persist('workItems', updated, nextVersion);

      return hydrateWorkItem(updated);
    },

    transitionStatus: async (id: string, toStatus: string, expectedVersion?: number): Promise<WorkItem> => {
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
        blockedReason: isNowBlocked ? (existing.blockedReason || 'Waiting on external input') : (toStatus === 'done' ? null : existing.blockedReason),
        waitingFor: isNowBlocked && !existing.waitingFor ? {
          who: 'External Party',
          about: existing.title,
          followUpDate: existing.dueDate || '',
          sinceDate: now.split('T')[0]
        } : (toStatus === 'done' ? null : existing.waitingFor),
        completedAt: toStatus === 'done' ? now : null,
        version: nextVersion,
        updatedAt: now,
        lastTouchedAt: now
      };

      state.workItems[index] = updated;
      await persist('workItems', updated, nextVersion);

      // Auto-Advancing Occurrence Engine for Recurring Tasks
      if (toStatus === 'done' && existing.repeatRule) {
        const rule = existing.repeatRule.toLowerCase().trim();
        const baseDate = parseDateString(existing.dueDate || existing.startDate) || new Date();
        const nextDate = new Date(baseDate);

        if (rule === 'daily') nextDate.setDate(nextDate.getDate() + 1);
        else if (rule === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
        else if (rule === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);

        const y = nextDate.getFullYear();
        const m = String(nextDate.getMonth() + 1).padStart(2, '0');
        const d = String(nextDate.getDate()).padStart(2, '0');
        const nextDateStr = `${y}-${m}-${d}`;

        await api.workItems.create({
          ...existing,
          title: existing.title,
          status: 'todo',
          startDate: nextDateStr,
          dueDate: nextDateStr,
          completedAt: null
        });
      }

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
        type: 'standard',
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
      return state.habits.filter(h => h);
    },
    create: async (payload: Partial<Habit>): Promise<Habit> => {
      await initializeStore();
      const now = new Date().toISOString();
      const habit: Habit = {
        id: uuid(),
        name: payload.name || 'New Habit',
        frequency: 'daily',
        targetCount: payload.targetCount || 5,
        history: [],
        areaId: payload.areaId || null,
        streak: 0,
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
      const history = h.history || [];
      const has = history.includes(day);
      h.history = has ? history.filter(d => d !== day) : [...history, day];
      h.streak = h.history.length;
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
    delete: async (id: string): Promise<void> => {
      await initializeStore();
      await removeRecord('notes', id);
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
      let items = state.workItems.filter(i => i && !i.deletedAt && i.isInbox && i.status !== 'done');
      if (lifeContext) {
        items = items.filter(i => i && (i.lifeContext || 'work') === lifeContext);
      }
      return items.map(hydrateWorkItem);
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
      let items = state.workItems.filter(i => i && !i.deletedAt && i.isFocus && i.status !== 'done');
      if (lifeContext) {
        items = items.filter(i => (i.lifeContext || 'work') === lifeContext);
      }
      return items.sort((a, b) => (a.focusOrder || 0) - (b.focusOrder || 0)).map(hydrateWorkItem);
    },

    toggle: async (id: string): Promise<WorkItem> => {
      await initializeStore();
      const item = state.workItems.find(i => i && i.id === id);
      if (!item) throw new Error('Item not found');

      const nextFocus = !item.isFocus;
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

      return api.workItems.updateDetails(id, {
        snoozedUntil: untilIso,
        snoozeCount: (item.snoozeCount || 0) + 1,
        lastTouchedAt: new Date().toISOString()
      });
    }
  },

  waitingFor: {
    list: async (lifeContext?: LifeContext): Promise<WorkItem[]> => {
      await initializeStore();
      let items = state.workItems.filter(i => i && !i.deletedAt && i.waitingFor && i.status !== 'done');
      if (lifeContext) {
        items = items.filter(i => (i.lifeContext || 'work') === lifeContext);
      }
      return items.map(hydrateWorkItem);
    },

    set: async (id: string, payload: { who: string; about?: string; followUpDate?: string } | null): Promise<WorkItem> => {
      await initializeStore();
      const waitingForData = payload ? {
        who: payload.who,
        about: payload.about || '',
        followUpDate: payload.followUpDate || '',
        sinceDate: new Date().toISOString().split('T')[0]
      } : null;

      return api.workItems.updateDetails(id, {
        waitingFor: waitingForData,
        status: payload ? 'blocked' : 'todo',
        blockedReason: payload ? `Waiting for ${payload.who}` : null,
        lastTouchedAt: new Date().toISOString()
      });
    }
  },

  attention: {
    getTodayAttention: async (lifeContext?: LifeContext): Promise<any> => {
      await initializeStore();
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const nowIso = now.toISOString();

      const items = state.workItems.filter(i => 
        i && !i.deletedAt && 
        (!lifeContext || (i.lifeContext || 'work') === lifeContext)
      );

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
      ).map(hydrateWorkItem);

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

      const inboxCount = items.filter(i => i.isInbox && i.status !== 'done').length;

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
        boards: Array.isArray(parsed.data.boards) ? parsed.data.boards : []
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
        putBatchToStore('boards', state.boards)
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
    try {
      const fetchUrl = getGasUrl('clearAll');
      await fetch(fetchUrl, {
        method: 'POST',
        // text/plain keeps this a simple request; application/json makes the browser
        // send a CORS preflight, which Apps Script rejects.
        headers: syncHeaders({ 'Content-Type': 'text/plain;charset=utf-8' }),
        body: JSON.stringify({ action: 'clearAll' })
      });
    } catch (e) {
      console.error('Failed to clear cloud database', e);
    }
    
    await clearAllStores();
    state = {
      workItems: [], projects: [], areas: [], goals: [], habits: [], notes: [], comments: [], subtasks: [], activities: [], boards: []
    };
    try {
      localStorage.removeItem('sage_solo_v5');
      localStorage.removeItem('sage_tab_bus');
    } catch (e) {}

    window.location.reload();
  }
};
