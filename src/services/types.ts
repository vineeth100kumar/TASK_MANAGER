/**
 * SAGE - Solo Executive Task & Life Management System
 * Refined Types for a Single-User Workflow
 */

export type LifeContext = 'work' | 'personal';
// What the app is showing: one context, or both together.
export type LifeFilter = LifeContext | 'all';
export type EntityType = 'task' | 'event' | 'reminder' | 'milestone';
// 'in_review' is no longer offered; items that still have it are shown as in_progress.
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  name: string;
  key: string;
  type?: string; // not read anywhere; existing records hold 'standard'
  color: string;
  sequence: number;
  description?: string;
  flowLayout?: {
    [nodeId: string]: { x: number; y: number };
  }; // left by the old Map view; no longer read
  branches?: ProjectBranch[];
  createdAt: string;
  updatedAt?: string;
}

// A line of work that splits off a project's main line (or another branch) on a
// day, and may later be merged back. Items join one with WorkItem.branchId.
export interface ProjectBranch {
  id: string;
  name: string;
  color: string;
  parentId: string | null;   // null = branched from the main line
  startDate: string;         // YYYY-MM-DD, where it splits off
  mergedAt?: string | null;  // YYYY-MM-DD, where it joined back
  createdAt: string;
}

export interface Area {
  id: string;
  name: string;
  color: string;
  icon?: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkItem {
  id: string;
  key: string;
  title: string;
  description: string;
  entityType: EntityType;
  lifeContext?: LifeContext;
  type: string; // task, bug, feature, improvement, meeting, reminder, milestone
  status: TaskStatus;
  priority: TaskPriority;
  
  // Categorization
  projectId?: string | null;
  branchId?: string | null; // a branch of the project; unset = its main line
  areaId?: string | null;
  
  // Solo Execution metrics
  estimated?: string | null;
  actual?: string | null;
  blockedReason?: string | null;
  
  // Temporal fields
  startDate?: string | null; // YYYY-MM-DD
  dueDate?: string | null;   // YYYY-MM-DD
  dueTime?: string | null;   // HH:mm, a task's time of day; null means any time that day
  startAt?: string | null;   // ISO Datetime
  endAt?: string | null;     // ISO Datetime
  remindAt?: string | null;  // ISO Datetime
  reminderLeadMinutes?: number | null; // minutes before startAt/dueDate that remindAt was set for; null = no lead-based reminder
  repeatRule?: string | null;
  // The next copy a repeating item made when it was done, and the item a copy came from,
  // so undoing the completion can take the copy back.
  spawnedNextId?: string | null;
  spawnedFromId?: string | null;
  
  // Details & Logistics
  location?: string | null;
  labels?: string[];
  customFields?: Record<string, any>;
  dependsOn?: string[]; // IDs of tasks this item depends on

  // Attention & Cognitive Flow (Sage Attention Engine)
  isInbox?: boolean;
  isFocus?: boolean;
  focusOrder?: number | null;
  snoozedUntil?: string | null; // ISO Datetime
  snoozeCount?: number;
  waitingFor?: {
    who: string;
    about?: string;
    followUpDate?: string;
    sinceDate: string;
  } | null;
  energy?: 'low' | 'medium' | 'high';
  estimatedMinutes?: number | null;
  lastTouchedAt?: string;
  
  // Metadata & Concurrency
  version: number;
  completedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;

  // Hydrated helper properties (client-side)
  project?: Project | null;
  area?: Area | null;
  labelsList?: any[];
  subtaskCount?: number;
  completedSubtaskCount?: number;
  commentCount?: number;
  dependencies?: { blocks: WorkItem[]; blockedBy: WorkItem[] };
}

export interface Goal {
  id: string;
  title: string;
  progress: number; // 0 - 100
  targetDate: string;
  areaId?: string | null;
  projectId?: string | null;
  category?: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Habit {
  id: string;
  name: string;
  frequency: string; // e.g. "5/week", "daily"
  targetCount: number;
  history: string[]; // dates ticked, e.g. ["2026-10-01", "2026-10-02"]
  areaId?: string | null;
  streak?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Note {
  id: string;
  title: string;
  // Plain text of the note, kept for search, previews and older notes.
  content: string;
  // The formatted note (HTML, images inline) split across body0..bodyN so each
  // piece fits in one Google Sheets cell. Notes from before formatting have none.
  bodyParts?: number;
  [bodyPart: `body${number}`]: string;
  areaId?: string | null;
  projectId?: string | null;
  lifeContext?: LifeContext;   // unset on older notes, which show under both
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  workItemId: string;
  body: string;
  createdAt: string;
  deletedAt?: string | null;
}

export interface Subtask {
  id: string;
  workItemId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: string;
}

export interface Activity {
  id: string;
  workItemId: string;
  eventType: string;
  oldValue: any;
  newValue: any;
  createdAt: string;
}

// A whiteboard on the Canvas view. The drawing is Excalidraw's element list as
// JSON, split across scene0..sceneN so each piece fits in one Google Sheets
// cell (50,000 characters) when Apps Script is the backend.
export interface Board {
  id: string;
  title: string;
  lifeContext?: LifeContext;
  sceneParts: number;
  [scenePart: `scene${number}`]: string;
  createdAt: string;
  updatedAt: string;
}
