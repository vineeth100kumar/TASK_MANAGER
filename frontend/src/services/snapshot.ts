import { storage } from '../utils/storage';
import {
  WorkItem, Milestone, Project, DailyPerformance, FinanceSummary, Transaction,
} from '../types';

/*
 * The last thing the Pi said, kept so the app opens to something.
 *
 * The service worker deliberately never caches /api: a stale balance served
 * as if it were live is worse than no balance at all. But the consequence was
 * that away from home the app opened completely empty, which reads as data
 * loss rather than as distance.
 *
 * So the snapshot is kept here, in the app, where it can be labelled. It is
 * only ever shown with the time it was taken, and only when the live request
 * has already failed -- never in place of a request that could have been made.
 */

const KEY = 'sage_snapshot';
const VERSION = 1;

/** Enough to fill the screens; not so much that a phone's quota is a risk. */
const MAX_TRANSACTIONS = 200;

export interface SnapshotData {
  items: WorkItem[];
  milestones: Milestone[];
  projects: Project[];
  dailyPerformance: DailyPerformance | null;
  financeSummary: FinanceSummary | null;
  transactions: Transaction[];
}

export interface Snapshot {
  version: number;
  /** When the Pi last answered, as an ISO string. */
  savedAt: string;
  data: SnapshotData;
}

export function saveSnapshot(data: SnapshotData): void {
  const snapshot: Snapshot = {
    version: VERSION,
    savedAt: new Date().toISOString(),
    data: { ...data, transactions: data.transactions.slice(0, MAX_TRANSACTIONS) },
  };
  // A full quota is not worth a failed load: the app simply opens empty next
  // time, which is where it started.
  storage.setJSON(KEY, snapshot);
}

export function readSnapshot(): Snapshot | null {
  const raw = storage.getJSON<Snapshot | null>(KEY, null);
  if (!raw || raw.version !== VERSION || typeof raw.savedAt !== 'string') return null;
  if (!raw.data || !Array.isArray(raw.data.items)) return null;
  return raw;
}

export function clearSnapshot(): void {
  storage.remove(KEY);
}

/*
 * "as of 4:12 pm" while it is today, "as of Tue, 4:12 pm" within the week,
 * and a date once it is older -- so the line says how stale the data is
 * without making anyone work it out.
 */
export function describeAsOf(savedAt: string, now: Date = new Date()): string {
  const then = new Date(savedAt);
  if (Number.isNaN(then.getTime())) return 'an earlier sync';

  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) return time;

  const daysApart = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (daysApart <= 6) {
    return `${then.toLocaleDateString([], { weekday: 'short' })}, ${time}`;
  }
  return `${then.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}
