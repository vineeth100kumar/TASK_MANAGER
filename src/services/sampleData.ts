// Sample records shown on a fresh local dev install (`npm run dev`) only.
import { Project, Area, Goal, Habit, Note } from './types';

const getISODate = (offsetDays = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString().split('T')[0]; };

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
  { id: 'habit_1', name: 'Morning Focus & Deep Work', frequency: 'daily', targetCount: 5, history: [], streak: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

export const INITIAL_NOTES: Note[] = [
  { id: 'note_1', title: 'Sage Architecture Principles', content: 'Local-First, zero blocking IO, IndexedDB persistence, durable sync queue with exponential backoff.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];
