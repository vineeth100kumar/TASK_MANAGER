import { Thought, ThoughtStatus } from '../../services/types';
import { toDateKey } from '../../utils/recurrence';

/** The four icons, in the order they're offered. */
export const STATUSES: ThoughtStatus[] = ['open', 'unsure', 'good', 'bad'];

export const STATUS_NAMES: Record<ThoughtStatus, string> = {
  open: 'Open',
  unsure: 'Unsure',
  good: 'Holds up',
  bad: 'Doesn’t hold',
};

/** A thought is settled once it holds up or has been ruled out. */
export const isSettled = (s: ThoughtStatus) => s === 'good' || s === 'bad';

/** What a tap on the icon moves a thought to next. */
export const nextStatus = (s: ThoughtStatus): ThoughtStatus => STATUSES[(STATUSES.indexOf(s) + 1) % STATUSES.length];

// Kept clear of the status colours (green, red, amber) so a topic never reads as a verdict.
const TOPIC_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#0ea5e9', '#a855f7', '#6366f1', '#06b6d4'];
export const MAIN_COLOR = '#64748b';

export function statusOf(t: Pick<Thought, 'status'>): ThoughtStatus {
  return STATUSES.includes(t.status) ? t.status : 'open';
}

export function countStatuses(thoughts: Thought[]): Record<ThoughtStatus, number> {
  const c: Record<ThoughtStatus, number> = { open: 0, unsure: 0, good: 0, bad: 0 };
  for (const t of thoughts) c[statusOf(t)]++;
  return c;
}

/** Topics in the order they were first used; each gets the same colour on every device. */
export function topicsOf(thoughts: Thought[]): { name: string; color: string }[] {
  const names: string[] = [];
  for (const t of sortThoughts(thoughts)) {
    const name = (t.topic || '').trim();
    if (name && !names.some(n => n.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names.map((name, i) => ({ name, color: TOPIC_COLORS[i % TOPIC_COLORS.length] }));
}

export function sortThoughts(thoughts: Thought[]): Thought[] {
  return [...thoughts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

const STATUS_PREFIXES: Array<[RegExp, ThoughtStatus]> = [
  [/^(pro|good|yes|holds?)(?:\s*:\s*|\s+[-\u2013]\s+)/i, 'good'],
  [/^(con|bad|no|drop(ped)?)(?:\s*:\s*|\s+[-\u2013]\s+)/i, 'bad'],
  [/^(unsure|confused|maybe|hmm)(?:\s*:\s*|\s+[-\u2013]\s+)/i, 'unsure'],
  [/^~\s*/, 'unsure'],
  [/^(open|q|question)(?:\s*:\s*|\s+[-\u2013]\s+)/i, 'open'],
  [/^\?\s*/, 'open'],
];

/**
 * Reads one typed line: a leading "pro:", "con:", "unsure:" (or ~), "?"
 * picks the icon, and "#topic" anywhere picks the topic, matched to an
 * existing one regardless of case. Whatever is left is the thought.
 */
export function parseThought(line: string, topics: string[]): { text: string; status?: ThoughtStatus; topic?: string } {
  let text = line.trim();
  let status: ThoughtStatus | undefined;
  for (const [re, s] of STATUS_PREFIXES) {
    if (re.test(text)) { status = s; text = text.replace(re, ''); break; }
  }
  let topic: string | undefined;
  const tag = text.match(/(^|\s)#([\p{L}\p{N}_-]+)/u);
  if (tag) {
    const raw = tag[2].replace(/[-_]/g, ' ');
    topic = topics.find(t => t.toLowerCase() === raw.toLowerCase()) || raw.charAt(0).toUpperCase() + raw.slice(1);
    text = (text.slice(0, tag.index) + text.slice((tag.index || 0) + tag[0].length)).replace(/\s{2,}/g, ' ').trim();
  }
  return { text, status, topic };
}

/** Pasted text becomes one thought per line, dropping list bullets and blank lines. */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•●]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

export type ThoughtRow =
  | { kind: 'day'; date: string }
  | { kind: 'fork'; lane: number; topic: string; color: string; at: string }
  | { kind: 'settle'; lane: number; topic: string; color: string; at: string }
  | { kind: 'thought'; lane: number; color: string; thought: Thought };

export interface ThoughtFlow {
  rows: ThoughtRow[];
  laneCount: number;
  /** Each lane's run over the rows (the main line is the first). */
  spans: { lane: number; from: number; to: number; color: string; open: boolean }[];
}

/**
 * Lays a map out oldest first, like a project's branches: thoughts with no
 * topic on the main line, each topic on its own lane from its first thought.
 * A topic whose thoughts are all settled folds back after its last one, and
 * its lane is free for the next topic.
 */
export function buildThoughtFlow(thoughts: Thought[], colors?: { name: string; color: string }[]): ThoughtFlow {
  const sorted = sortThoughts(thoughts);
  // A filtered view passes the whole map's topics, so colours don't shift.
  const topics = colors || topicsOf(sorted);
  const colorOf = (name: string) => topics.find(t => t.name.toLowerCase() === name.toLowerCase())?.color || MAIN_COLOR;
  const keyOf = (t: Thought) => (t.topic || '').trim().toLowerCase();

  const lastIndex = new Map<string, number>();
  sorted.forEach((t, i) => keyOf(t) && lastIndex.set(keyOf(t), i));
  const settled = new Map<string, boolean>();
  for (const t of sorted) {
    const k = keyOf(t);
    if (k) settled.set(k, (settled.get(k) ?? true) && isSettled(statusOf(t)));
  }

  const rows: ThoughtRow[] = [];
  const spans: ThoughtFlow['spans'] = [{ lane: 0, from: 0, to: 0, color: MAIN_COLOR, open: true }];
  const laneOf = new Map<string, number>();
  const spanOf = new Map<string, number>();
  const laneFree: boolean[] = [false];
  let day = '';

  sorted.forEach((t, i) => {
    const d = toDateKey(new Date(t.createdAt));
    if (d !== day) { rows.push({ kind: 'day', date: d }); day = d; }
    const k = keyOf(t);
    let lane = 0;
    if (k) {
      if (!laneOf.has(k)) {
        lane = 1;
        while (laneFree[lane] === false) lane++;
        laneFree[lane] = false;
        laneOf.set(k, lane);
        const name = t.topic!.trim();
        rows.push({ kind: 'fork', lane, topic: topics.find(x => x.name.toLowerCase() === k)?.name || name, color: colorOf(name), at: t.createdAt });
        spanOf.set(k, spans.length);
        spans.push({ lane, from: rows.length - 1, to: rows.length - 1, color: colorOf(name), open: true });
      }
      lane = laneOf.get(k)!;
    }
    rows.push({ kind: 'thought', lane, color: k ? colorOf(t.topic!) : MAIN_COLOR, thought: t });
    if (k) spans[spanOf.get(k)!].to = rows.length - 1;
    if (k && lastIndex.get(k) === i && settled.get(k)) {
      const s = spans[spanOf.get(k)!];
      rows.push({ kind: 'settle', lane, topic: topics.find(x => x.name.toLowerCase() === k)?.name || t.topic!, color: s.color, at: t.createdAt });
      s.to = rows.length - 1;
      s.open = false;
      laneFree[lane] = true;
    }
  });
  spans[0].to = Math.max(0, rows.length - 1);
  // Open topics run on to the end.
  spans.forEach(s => { if (s.open) s.to = Math.max(s.to, rows.length - 1); });
  const laneCount = Math.max(1, ...spans.map(s => s.lane + 1));
  return { rows, laneCount, spans };
}
