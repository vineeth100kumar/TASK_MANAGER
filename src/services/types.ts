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
  type?: string; // technical | nontech | content | other | a custom name; see projectTypes.ts
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
  /** The project type's own status (e.g. 'editing'); status keeps the base. See projectTypes.ts. */
  stage?: string | null;
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

/** Reminder time every new habit starts with (same as claude_api.py). */
export const DEFAULT_HABIT_REMIND_TIME = '20:00';

export interface Habit {
  id: string;
  name: string;
  frequency: string; // e.g. "5/week", "daily"
  targetCount: number;
  history: string[]; // dates ticked, e.g. ["2026-10-01", "2026-10-02"]
  areaId?: string | null;
  streak?: number;
  // A daily nudge at this time ("19:30") on days the habit isn't ticked yet,
  // sent by the Pi (raspberry_pi/notifier.py). Unset means no reminder.
  // New habits start at DEFAULT_HABIT_REMIND_TIME.
  remindTime?: string | null;
  remindPush?: boolean;   // to the website / home-screen app (default on)
  remindEmail?: boolean;  // to the notification email (default off)
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
  // 'map' makes the note a thought map: its thoughts live in the thoughts table.
  // 'html' is a report and 'code' a code snippet, usually pushed by an AI: the
  // body parts hold the source as sent, shown in a sandboxed frame or code view.
  kind?: 'map' | 'html' | 'code' | null;
  language?: string;          // for code notes
  source?: string;            // who sent it: claude, gemini, ... (unset: you)
  createdAt: string;
  updatedAt: string;
}

// How far a thought on a map has been worked out: open (just captured), unsure
// (confused or still researching), good (holds up) or bad (doesn't hold).
export type ThoughtStatus = 'open' | 'unsure' | 'good' | 'bad';

export interface Thought {
  id: string;
  mapId: string;              // the note (kind 'map') it belongs to
  text: string;
  status: ThoughtStatus;
  topic?: string;             // its branch on the map; empty is the main line
  parentId?: string | null;   // the thought it sits under
  note?: string;
  source?: string;            // 'you', or 'claude' when added from a Claude chat
  createdAt: string;
  updatedAt?: string;
  revision?: number;
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

// Radar research (raspberry_pi/radar_research.py). The Pi writes these; the app
// only stars them and links an idea to the project made from it.
export interface RadarSourceRef {
  title: string;
  url: string;
  kind: 'news' | 'web' | 'hn';
  site: string;
}

export interface Dossier {
  id: string;
  theme: string;
  depth: 'brief' | 'memo';
  engine: string | null;
  status: 'done' | 'needs_review' | 'failed';
  error?: string;
  summary: string;
  macro: string;
  whyNow: string;
  valueChain: { layer: string; players: string; gap: string }[];
  claims: { text: string; source: number | null }[];
  painPoints: { text: string; url: string }[];
  sources: RadarSourceRef[];   // claims and ideas cite these by number, from 1
  steps: { name: string; detail: string; seconds: number | null }[];
  ideaIds: string[];
  noteId: string | null;
  starred: boolean;
  raw?: string;                // the AI's answer when it couldn't be read
  lifeContext?: LifeContext;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaRisk {
  kind: string;
  detail: string;
  severity: 'High' | 'Medium' | 'Low';
  mitigation: string;
}

export interface IdeaPhase {
  name: string;
  startWeek: number;
  endWeek: number;
  steps: string[];
}

export interface Idea {
  id: string;
  dossierId: string;
  name: string;
  oneLiner: string;
  icp: string;
  pain: string;
  whyNow: string;
  // Estimates from the AI; the app labels them so.
  acvUsd: number | null;
  grossMarginPct: number | null;
  paybackMonths: number | null;
  salesCycleWeeks: number | null;
  moat: { network: number; switching: number; data: number; cost: number; regulatory: number };
  ratings: { whyNow: number; pain: number; money: number; fit?: number };
  score: number;
  // fit is there for ideas made after My edge (out of 15; the others shrink to fit).
  scoreParts: { whyNow: number; pain: number; money: number; moat: number; safety: number; fit?: number };
  risks: IdeaRisk[];
  playbook: IdeaPhase[];
  tags: string[];
  sources: number[];
  starred: boolean;
  projectId: string | null;
  // Kept from a Lab spark: no dossier, score or playbook until it's researched.
  stage?: 'spark';
  sparkId?: string;
  fit?: number;        // 0-10, how well it suits My edge
  fitWhy?: string;
  angle?: string;
  clue?: { label: string; title: string; link: string };
  lifeContext?: LifeContext;
  createdAt: string;
  updatedAt: string;
}
