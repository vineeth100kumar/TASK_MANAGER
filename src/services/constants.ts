// Fixed lists the app is built around: item types, statuses, priorities, labels.
import { ShieldAlert, FileText, CheckSquare, Zap, Users, Bell, Flag } from 'lucide-react';

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
  todo: { id: 'todo', label: 'To do', color: 'bg-gray-200/50 text-gray-700 dark:bg-white/10 dark:text-gray-300', dot: 'bg-gray-400' },
  in_progress: { id: 'in_progress', label: 'Doing', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400', dot: 'bg-blue-500' },
  done: { id: 'done', label: 'Done', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400', dot: 'bg-emerald-500' },
  blocked: { id: 'blocked', label: 'Waiting', color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400', dot: 'bg-red-500' },
};

// A personal list has no workflow to enforce: an item can move to any status.
export const ALLOWED_TRANSITIONS = {
  todo: ['in_progress', 'blocked', 'done'],
  in_progress: ['todo', 'blocked', 'done'],
  done: ['todo', 'in_progress', 'blocked'],
  blocked: ['todo', 'in_progress', 'done']
};

export const PRIORITIES = {
  low: { id: 'low', label: 'Low', color: 'text-gray-500' },
  medium: { id: 'medium', label: 'Medium', color: 'text-blue-500' },
  high: { id: 'high', label: 'High', color: 'text-orange-500' },
  urgent: { id: 'urgent', label: 'Urgent', color: 'text-red-500' },
};

// Tags offered before you have used any of your own.
export const LABELS = [
  { id: 'lbl_errands', name: 'errands', color: 'bg-amber-100 text-amber-700' },
  { id: 'lbl_home', name: 'home', color: 'bg-blue-100 text-blue-700' },
  { id: 'lbl_health', name: 'health', color: 'bg-emerald-100 text-emerald-700' },
  { id: 'lbl_money', name: 'money', color: 'bg-purple-100 text-purple-700' },
  { id: 'lbl_calls', name: 'calls', color: 'bg-pink-100 text-pink-700' },
];

// Focus is for the few things you'll really do today.
export const FOCUS_LIMIT = 5;

export const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `uuid-${Math.random().toString(36).substring(2, 9)}`;
