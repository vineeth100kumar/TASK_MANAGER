/**
 * SAGE - Solo Executive Task & Life Management System
 * Refined Types for a Single-User Workflow
 */

export type LifeContext = 'work' | 'personal';
export type EntityType = 'task' | 'event' | 'reminder' | 'milestone';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  name: string;
  key: string;
  type: 'work' | 'personal';
  color: string;
  sequence: number;
  description?: string;
  flowLayout?: {
    [nodeId: string]: { x: number; y: number };
  };
  createdAt: string;
  updatedAt?: string;
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
  areaId?: string | null;
  
  // Solo Execution metrics
  estimated?: string | null;
  actual?: string | null;
  blockedReason?: string | null;
  
  // Temporal fields
  startDate?: string | null; // YYYY-MM-DD
  dueDate?: string | null;   // YYYY-MM-DD
  startAt?: string | null;   // ISO Datetime
  endAt?: string | null;     // ISO Datetime
  remindAt?: string | null;  // ISO Datetime
  repeatRule?: string | null;
  
  // Details & Logistics
  location?: string | null;
  labels?: string[];
  customFields?: Record<string, any>;
  dependsOn?: string[]; // IDs of tasks this item depends on

  // Attention & Cognitive Flow (Sage Attention Engine)
  isInbox?: boolean;
  isFocus?: boolean;
  focusOrder?: number;
  snoozedUntil?: string | null; // ISO Datetime
  snoozeCount?: number;
  waitingFor?: {
    who: string;
    about?: string;
    followUpDate?: string;
    sinceDate: string;
  } | null;
  energy?: 'low' | 'medium' | 'high';
  estimatedMinutes?: number;
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
  history: string[]; // e.g. ["mon", "tue", "fri"]
  areaId?: string | null;
  streak?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  areaId?: string | null;
  projectId?: string | null;
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
