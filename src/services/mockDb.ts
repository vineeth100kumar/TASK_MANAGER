import { ShieldAlert, FileText, CheckSquare, Zap, Users, Bell, Flag } from 'lucide-react';
import { User, Project, Area, Goal, Habit, Note, WorkItem } from './types';

export const ENTITY_TYPES = {
  TASK: 'task',
  EVENT: 'event',
  REMINDER: 'reminder',
  MILESTONE: 'milestone'
};

export const WORK_ITEM_TYPES = {
  task: { id: 'task', category: 'task', label: 'Task', icon: CheckSquare, color: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10' },
  bug: { id: 'bug', category: 'task', label: 'Bug', icon: ShieldAlert, color: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
  feature: { id: 'feature', category: 'task', label: 'Feature', icon: FileText, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' },
  improvement: { id: 'improvement', category: 'task', label: 'Improvement', icon: Zap, color: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
  meeting: { id: 'meeting', category: 'event', label: 'Meeting', icon: Users, color: 'text-purple-500 bg-purple-50 dark:bg-purple-500/10' },
  reminder: { id: 'reminder', category: 'reminder', label: 'Reminder', icon: Bell, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' },
  milestone: { id: 'milestone', category: 'milestone', label: 'Milestone', icon: Flag, color: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10' }
};

export const STATUSES = {
  todo: { id: 'todo', label: 'To Do', color: 'bg-gray-200/50 text-gray-700 dark:bg-white/10 dark:text-gray-300', dot: 'bg-gray-400' },
  in_progress: { id: 'in_progress', label: 'In Progress', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400', dot: 'bg-blue-500' },
  in_review: { id: 'in_review', label: 'In Review', color: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400', dot: 'bg-purple-500' },
  done: { id: 'done', label: 'Done', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400', dot: 'bg-emerald-500' },
  blocked: { id: 'blocked', label: 'Blocked', color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400', dot: 'bg-red-500' },
};

export const ALLOWED_TRANSITIONS = {
  todo: ['in_progress', 'blocked'],
  in_progress: ['in_review', 'blocked', 'todo'],
  in_review: ['done', 'in_progress', 'blocked'],
  done: ['in_progress'],
  blocked: ['todo', 'in_progress']
};

export const PRIORITIES = {
  low: { id: 'low', label: 'Low', color: 'text-gray-500' },
  medium: { id: 'medium', label: 'Medium', color: 'text-blue-500' },
  high: { id: 'high', label: 'High', color: 'text-orange-500' },
  urgent: { id: 'urgent', label: 'Urgent', color: 'text-red-500' },
};

export const TEAMS = [
  { id: 'eng', name: 'Engineering' },
  { id: 'product', name: 'Product' },
  { id: 'design', name: 'Design' },
  { id: 'marketing', name: 'Marketing' }
];

export const LABELS = [
  { id: 'lbl_backend', name: 'backend', color: 'bg-blue-100 text-blue-700' },
  { id: 'lbl_frontend', name: 'frontend', color: 'bg-amber-100 text-amber-700' },
  { id: 'lbl_urgent', name: 'urgent', color: 'bg-red-100 text-red-700' },
];

export const ACTIVITY_EVENTS = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  ASSIGNED: 'ASSIGNED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  DELETED: 'DELETED'
};

export const CURRENT_USER: User = {
  id: 'usr_1',
  name: 'You',
  role: 'Owner',
  avatar: 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white',
  email: ''
};

export const CURRENT_USER_ID = CURRENT_USER.id;

export const DEFAULT_USERS: User[] = [
  CURRENT_USER
];

export const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `uuid-${Math.random().toString(36).substring(2, 9)}`;
export const getISODate = (offsetDays = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString().split('T')[0]; };
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const INITIAL_PROJECTS: Project[] = [
  { id: 'proj_sage', name: 'Sage System', key: 'SAGE', color: 'bg-indigo-500', sequence: 1, type: 'standard', description: 'Core product workspace', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

export const INITIAL_AREAS: Area[] = [
  { id: 'area_health', name: 'Health & Fitness', color: 'bg-emerald-500', icon: 'Activity', description: 'Personal physical health', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'area_learning', name: 'Deep Learning', color: 'bg-purple-500', icon: 'Sparkles', description: 'Continuous education and reading', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

export const INITIAL_GOALS: Goal[] = [
  { id: 'goal_1', title: 'Launch Sage V2 Local-First Engine', progress: 100, targetDate: getISODate(30), category: 'work', description: 'Finish industrial sync upgrade', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

export const INITIAL_HABITS: Habit[] = [
  { id: 'habit_1', name: 'Morning Focus & Deep Work', frequency: 'daily', targetCount: 5, history: ['mon', 'tue', 'wed'], streak: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

export const INITIAL_NOTES: Note[] = [
  { id: 'note_1', title: 'Sage Architecture Principles', content: 'Local-First, zero blocking IO, IndexedDB persistence, durable sync queue with exponential backoff.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

export const INITIAL_WORK_ITEMS: WorkItem[] = [];

export const db = {
  users: DEFAULT_USERS,
  workspaces: [{ id: 'ws_1', name: 'Workspace' }],
  projects: INITIAL_PROJECTS,
  areas: INITIAL_AREAS,
  goals: INITIAL_GOALS,
  habits: INITIAL_HABITS,
  notes: INITIAL_NOTES,
  workItems: INITIAL_WORK_ITEMS,
  dependencies: [],
  subtasks: [],
  comments: [],
  activities: []
};
