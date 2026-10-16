/**
 * chatCommands.ts
 *
 * Follow-ups in the Chat tab of New Item: anything that changes, adds to or
 * removes something rather than adding a new item.
 *
 *   "make gym high priority and a habit"     "move it to friday 5pm"
 *   "delete the gym one"                       "mark C-13 done"
 *   "add a note to C-13: ask Ravi for the pinout"
 *   "add subtask order cables to the sonar pinout"
 *   "rename gym to gym session"                "remove the reminder"
 *   "remind me 30 min before instead"          "stop repeating gym"
 *   "tag it #reels" / "remove #reels from it"  "put it in sage radar"
 *
 * A follow-up can be about the cards just drafted (saved or not) or about any
 * open item in Sage, named by key ("C-13") or by the words of its title.
 * Nothing is written here: this reads the message into commands, and says what
 * applying them to a card or to an item would change. The Chat tab does the
 * writing, asks before deleting anything saved, and keeps an Undo.
 */

import { parseQuickAdd, QuickAddPriority, formatShortDate } from './quickAddParser';
import { formatTime } from './reminders';
import { WorkItem, LifeContext } from '../services/types';
import {
  CaptureCard, CaptureContext, CardKind, normalize, extractLead, leadLabel, matchWhere,
  keyWords, words, stem, scope,
} from './chatCapture';

export interface Ops {
  delete?: boolean;
  done?: boolean;
  reopen?: boolean;
  title?: string;
  kind?: CardKind;
  priority?: QuickAddPriority;
  context?: LifeContext;
  date?: string | null; // null clears it
  time?: string | null;
  repeat?: { rule: string | null; label: string | null }; // rule null stops repeating
  lead?: { minutes: number | null }; // minutes null turns the reminder off
  place?: { projectId: string | null; branchId: string | null; areaId: string | null; label: string };
  addTags?: string[];
  removeTags?: string[];
  note?: string;
  subtask?: string;
}

export type Target = { kind: 'card'; index: number } | { kind: 'item'; id: string };
export interface Command { target: Target; ops: Ops }

// Follow-ups start like this, or name an item by key with one of the verbs.
const EDIT_START = /^\s*(?:make|change|move|reschedule|push|postpone|bring|set|mark|rename|retitle|put|switch|turn|stop|actually|no[,\s]|instead|drop|remove|delete|trash|scrap|skip|cancel|forget|don'?t|undo|untag|tag|complete|finish(?:ed)?|done|did|i\s+(?:did|finished|completed|have\s+done)|reopen|add\s+(?:a\s+)?(?:note|comment|sub-?task|step|checklist|tag|reminder)|note\s+(?:on|for|to)|remind\s+me\s+\S+\s+(?:min|mins|minutes|hours?|h|days?)?\s*(?:before|earlier)|call\s+(?:it|that|this)\s|the\s+\w+\s+(?:one|card|item)|it\s|that\s|those\s|both\s|all\s|everything\s)/i;
const VERB = /\b(?:make|change|move|reschedule|push|postpone|set|mark|rename|put|delete|remove|drop|cancel|done|complete|finish|add\s+(?:a\s+)?(?:note|comment|sub-?task|step|tag)|tag|untag|reopen)\b/i;
const KEY_RE = /\b([A-Z]{1,6}-\d+)\b/gi;

export function looksLikeEdit(message: string): boolean {
  if (EDIT_START.test(message)) return true;
  return /\b[A-Z]{1,6}-\d+\b/i.test(message) && VERB.test(message);
}

// Words that say what to do, not which item.
const OP_WORDS = new Set(('make change move reschedule push postpone bring set mark rename retitle put switch turn stop actually instead ' +
  'drop remove delete trash scrap skip cancel forget dont don\'t undo untag tag complete completed finish finished done did reopen add ' +
  'note comment subtask sub-task step checklist reminder reminders alert remind repeat repeating recurring priority high low medium urgent ' +
  'important habit event task personal work one card item please it that this those both all everything them get rid of not anymore ' +
  'title name call instead also too again into as be is now just a an the to of on in at for from with my me i have date deadline due ' +
  'time day days min mins minutes hour hours before earlier early').split(' ').map(stem));

/** The words of a message left once what-to-do words are gone: which item it's about. */
function aboutWords(text: string): string[] {
  const bare = parseQuickAdd(extractLead(text).text).title;
  return keyWords(bare).filter(w => !OP_WORDS.has(w) && w.length >= 3);
}

function scoreTitle(title: string, about: string[]): number {
  const theirs = new Set(keyWords(title));
  return about.filter(w => theirs.has(w)).length;
}

/** Which cards or items a follow-up is about. */
export function findTargets(text: string, cards: CaptureCard[], ctx: CaptureContext, last: Target | null, savedIds: Record<string, string>): Target[] {
  // By key: "C-13". A card saved as that item counts as the item.
  const keys = [...text.matchAll(KEY_RE)].map(m => m[1].toUpperCase());
  if (keys.length) {
    const found = keys.map(k => ctx.items.find(i => (i.key || '').toUpperCase() === k)).filter(Boolean) as WorkItem[];
    if (found.length) return found.map(i => ({ kind: 'item', id: i.id }));
  }
  const lower = text.toLowerCase();
  if (/\b(?:all|everything|both|them|those|these)\b/.test(lower) && cards.length) {
    return cards.map((c, index) => ({ c, index })).filter(x => x.c.include || /\b(?:add|include|keep)\b/.test(lower)).map(x => ({ kind: 'card', index: x.index }));
  }
  const about = aboutWords(text);
  // Cards first: they're what the conversation is about.
  if (about.length) {
    const scored = cards.map((c, index) => ({ index, score: scoreTitle(c.title, about) })).filter(x => x.score > 0);
    const best = Math.max(0, ...scored.map(x => x.score));
    if (best > 0) return scored.filter(x => x.score === best).map(x => ({ kind: 'card', index: x.index }));
    // Then any open item, when one stands out.
    const items = ctx.items
      .filter(i => i && !(i.labels || []).includes('alarm') && !Object.values(savedIds).includes(i.id))
      .map(i => ({ i, score: scoreTitle(i.title, about) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (items.length && (items.length === 1 || items[0].score > items[1].score)) return [{ kind: 'item', id: items[0].i.id }];
    if (items.length) return []; // two items fit equally: ask rather than guess
  }
  if (/\b(?:it|that|this|the\s+last\s+one|the\s+one)\b/.test(lower) || !about.length) {
    if (last) return [last];
    if (cards.length) return [{ kind: 'card', index: cards.length - 1 }];
  }
  return [];
}

const TAG_RE = /(?:^|\s)#([a-z][\w-]*)/gi;

/** What a follow-up asks to change. Null when nothing in it is understood. */
export function readOps(message: string, ctx: CaptureContext, now: Date = new Date()): { ops: Ops; aboutText: string } | null {
  let text = normalize(message).trim();
  const ops: Ops = {};
  let aboutText = text;

  // Things that carry their own words: notes, subtasks, new titles.
  let m: RegExpMatchArray | null;
  if ((m = text.match(/\b(?:add|put|write|leave|attach)\s+(?:a\s+)?(?:note|comment)\s+(?:to|on|for|in)\s+(.+?)\s*(?::|\bsaying\b|\bthat\s+says\b|\s-\s|—|,)\s*(.+)$/i)) ||
      (m = text.match(/\bnote\s+(?:on|for|to)\s+(.+?)\s*:\s*(.+)$/i))) {
    return { ops: { note: m[2].trim() }, aboutText: m[1] };
  }
  if ((m = text.match(/\b(?:add\s+(?:a\s+)?)?(?:note|comment)\s*:\s*(.+)$/i))) {
    return { ops: { note: m[1].trim() }, aboutText: text.slice(0, m.index) };
  }
  if ((m = text.match(/\badd\s+(?:a\s+)?(?:sub-?tasks?|steps?|checklist(?:\s+items?)?)\s+(?:to|under|for|in)\s+(.+?)\s*(?::|\s-\s|—|,)\s*(.+)$/i))) {
    return { ops: { subtask: m[2].trim() }, aboutText: m[1] };
  }
  if ((m = text.match(/\badd\s+(?:a\s+)?(?:sub-?tasks?|steps?|checklist(?:\s+items?)?)\s*:?\s*(.+?)\s+(?:to|under|for|in)\s+(.+)$/i))) {
    return { ops: { subtask: m[1].trim().replace(/^["']|["']$/g, '') }, aboutText: m[2] };
  }
  if ((m = text.match(/\b(?:rename|retitle)\s+(.+?)\s+(?:to|as|into)\s+(.+)$/i)) ||
      (m = text.match(/\bchange\s+(?:the\s+)?(?:title|name)\s+(?:of\s+)?(.+?)\s+to\s+(.+)$/i)) ||
      (m = text.match(/\bcall\s+(it|that|this)\s+(.+)$/i))) {
    const t = m[2].trim().replace(/^["']|["']$/g, '');
    return { ops: { title: t[0].toUpperCase() + t.slice(1) }, aboutText: m[1] };
  }
  if ((m = text.match(/\b(?:rename|retitle)\s+(?:it|that|this)?\s*(?:to|as)\s+(.+)$/i))) {
    const t = m[1].trim();
    return { ops: { title: t[0].toUpperCase() + t.slice(1) }, aboutText: 'it' };
  }

  // Taking things off: a reminder, a date, a repeat, a tag.
  const strip = (re: RegExp) => { text = text.replace(re, ' ').replace(/\s+/g, ' ').trim(); };
  if (/\b(?:remove|delete|drop|cancel|clear|turn\s+off|no|without|don'?t\s+(?:need|want))\s+(?:the\s+|a\s+|any\s+)?(?:reminders?|alerts?|notifications?)\b/i.test(text)) {
    ops.lead = { minutes: null };
    strip(/\b(?:remove|delete|drop|cancel|clear|turn\s+off|no|without|don'?t\s+(?:need|want))\s+(?:the\s+|a\s+|any\s+)?(?:reminders?|alerts?|notifications?)\b/i);
  }
  if (/\b(?:remove|delete|drop|clear|no)\s+(?:the\s+)?(?:date|due\s+date|deadline|day)\b|\bunschedule\b/i.test(text)) {
    ops.date = null; ops.time = null;
    strip(/\b(?:remove|delete|drop|clear|no)\s+(?:the\s+)?(?:date|due\s+date|deadline|day)\b|\bunschedule\b/i);
  }
  if (/\b(?:stop|don'?t|no\s+longer|remove|delete|cancel|turn\s+off|no)\s+(?:the\s+)?(?:repeat(?:ing|s)?|recurr\w*)\b|\bjust\s+once\b|\bone[-\s]off\b/i.test(text)) {
    ops.repeat = { rule: null, label: null };
    strip(/\b(?:stop|don'?t|no\s+longer|remove|delete|cancel|turn\s+off|no)\s+(?:the\s+)?(?:repeat(?:ing|s)?|recurr\w*)\b|\bjust\s+once\b|\bone[-\s]off\b/i);
  }
  const untag = /\b(?:remove|delete|drop|untag)\b/i.test(text) && TAG_RE.test(text);
  TAG_RE.lastIndex = 0;
  const tags = [...text.matchAll(TAG_RE)].map(t => t[1].toLowerCase());
  if (tags.length) {
    if (untag) ops.removeTags = tags; else ops.addTags = tags;
    strip(/(?:^|\s)#[a-z][\w-]*/gi);
    if (untag) strip(/\b(?:remove|delete|drop|untag)\b(?:\s+(?:the\s+)?tags?)?(?:\s+from)?/i);
  }

  // Done, undone, deleted.
  if (/\b(?:reopen|not\s+done|undo\s+done|mark\s+\S+(?:\s+\S+)?\s+(?:as\s+)?(?:not\s+done|todo|open))\b/i.test(text)) ops.reopen = true;
  else if (/\bmark\b.*\b(?:done|complete[d]?|finished)\b|\b(?:i\s+)?(?:finished|completed|did)\b|\bdone\s+with\b|^\s*(?:done|complete|finish)\b|\b(?:is|as)\s+done\b/i.test(text)) ops.done = true;
  if (!ops.lead && !ops.repeat && ops.date === undefined && !ops.removeTags &&
      /\b(?:delete|remove|drop|cancel|trash|scrap|bin|get\s+rid\s+of|forget(?:\s+about)?|don'?t\s+(?:add|save|need|want)|skip)\b/i.test(text)) ops.delete = true;

  if (!ops.delete) {
    const pr = text.match(/!(urgent|high|medium|low)\b/i) || text.match(/\b(urgent|important)\b/i);
    if (pr) ops.priority = (pr[1].toLowerCase() === 'important' ? 'high' : pr[1].toLowerCase()) as QuickAddPriority;
    const kind = text.match(/\b(?:an?\s+|into\s+an?\s+|as\s+an?\s+)(habit|reminder|event|task|meeting)\b/i);
    if (kind && /\b(?:make|turn|change|as|into|be|it'?s|should\s+be)\b/i.test(text)) ops.kind = (kind[1].toLowerCase() === 'meeting' ? 'event' : kind[1].toLowerCase()) as CardKind;
    if (/\b(?:is|as|make\s+it|it'?s|to|into)\s+personal\b|\bpersonal\b\s*$/i.test(text)) ops.context = 'personal';
    else if (/\b(?:is|as|make\s+it|it'?s|to|into)\s+work\b|\bwork\b\s*$/i.test(text)) ops.context = 'work';

    // A new time for the reminder ("30 min before instead").
    const lead = extractLead(text);
    if (lead.lead != null) { ops.lead = { minutes: lead.lead }; text = lead.text; }
    // A new day, time or repeat.
    const p = parseQuickAdd(text.replace(/!(urgent|high|medium|low)\b/gi, ''), now);
    if (p.date) ops.date = p.date;
    if (p.time) { ops.time = p.time; if (!p.date && ops.date === undefined) ops.date = undefined; }
    if (p.repeatRule) ops.repeat = { rule: p.repeatRule, label: p.repeatLabel };

    // A new place, when it's what's being changed: "put it in sage radar", "move C-13 to baby kolourz".
    const placeText = text.match(/\b(?:in|into|to|under|for)\s+(?:the\s+)?(.+)$/i)?.[1] || '';
    const where = placeText ? matchWhere(placeText, ctx) : null;
    if (where && (where.projectId || where.areaId)) {
      const project = ctx.projects.find(x => x.id === where.projectId);
      const branch = project?.branches?.find(b => b.id === where.branchId);
      const area = ctx.areas.find(a => a.id === where.areaId);
      ops.place = { projectId: where.projectId, branchId: where.branchId, areaId: where.areaId, label: project ? `${project.name}${branch ? ` › ${branch.name}` : ''}` : area?.name || '' };
      aboutText = text.replace(placeText, ' ');
    }
  }
  if (aboutText === normalize(message).trim()) aboutText = text;
  return Object.keys(ops).length ? { ops, aboutText } : null;
}

/** Commands for a follow-up, or null when it isn't understood. */
export function parseCommands(message: string, cards: CaptureCard[], ctx: CaptureContext, last: Target | null, savedIds: Record<string, string>, now: Date = new Date()): Command[] | null {
  const read = readOps(message, ctx, now);
  if (!read) return null;
  // Keys anywhere in the message name the item, wherever the op put them.
  const keyed = [...message.matchAll(KEY_RE)].length ? message : read.aboutText;
  const targets = findTargets(keyed, cards, ctx, last, savedIds);
  if (!targets.length) return null;
  return targets.map(target => ({ target, ops: read.ops }));
}

// --- Applying ---

const when = (date: string | null | undefined, time: string | null | undefined) =>
  [date && formatShortDate(date), time && formatTime(time)].filter(Boolean).join(', ');

/** Plain words for what the ops change. */
export function describe(ops: Ops): string[] {
  const out: string[] = [];
  if (ops.delete) out.push('deleted');
  if (ops.done) out.push('marked done');
  if (ops.reopen) out.push('reopened');
  if (ops.title) out.push(`renamed to "${ops.title}"`);
  if (ops.kind) out.push(`now a ${ops.kind}`);
  if (ops.priority) out.push(`${ops.priority} priority`);
  if (ops.place) out.push(`moved to ${ops.place.label}`);
  if (ops.context) out.push(ops.context);
  if (ops.date === null) out.push('no date');
  else if (ops.date || ops.time) out.push(`set for ${when(ops.date, ops.time)}`);
  if (ops.repeat) out.push(ops.repeat.rule ? (ops.repeat.label || 'repeats').toLowerCase() : 'no longer repeats');
  if (ops.lead) out.push(ops.lead.minutes == null ? 'no reminder' : `reminds ${leadLabel(ops.lead.minutes).toLowerCase()}`);
  if (ops.addTags?.length) out.push(`tagged ${ops.addTags.map(t => `#${t}`).join(' ')}`);
  if (ops.removeTags?.length) out.push(`untagged ${ops.removeTags.map(t => `#${t}`).join(' ')}`);
  if (ops.note) out.push('note added');
  if (ops.subtask) out.push(`subtask "${ops.subtask}" added`);
  return out;
}

/** A draft card with the ops applied. Deleting a draft just leaves it out. */
export function applyToCard(card: CaptureCard, ops: Ops): CaptureCard {
  const c = { ...card, tags: [...card.tags], subtasks: [...card.subtasks] };
  if (ops.delete) { c.include = false; return c; }
  if (ops.done) c.done = true;
  if (ops.reopen) c.done = false;
  if (ops.title) c.title = ops.title;
  if (ops.kind) c.kind = ops.kind;
  if (ops.priority) { c.priority = ops.priority; c.priorityGiven = true; }
  if (ops.place) {
    c.projectId = ops.place.projectId; c.branchId = ops.place.branchId; c.areaId = ops.place.areaId;
    c.lifeContext = ops.place.areaId ? 'personal' : 'work'; c.unsure = false;
  }
  if (ops.context && !ops.place) c.lifeContext = ops.context;
  if (ops.date !== undefined) c.date = ops.date;
  if (ops.time !== undefined) c.time = ops.time;
  if (ops.repeat) { c.repeatRule = ops.repeat.rule; c.repeatLabel = ops.repeat.label; }
  if (ops.lead) c.leadMinutes = ops.lead.minutes;
  if (ops.addTags) c.tags = Array.from(new Set([...c.tags, ...ops.addTags]));
  if (ops.removeTags) c.tags = c.tags.filter(t => !ops.removeTags!.includes(t));
  if (ops.note) c.description = c.description ? `${c.description}\n\n${ops.note}` : ops.note;
  if (ops.subtask) c.subtasks.push(ops.subtask);
  c.include = true;
  return c;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Field changes for a saved item (delete, done, notes, subtasks and habits are
 * handled by the caller). `before` holds the old values, for Undo.
 */
export function itemUpdates(item: WorkItem, ops: Ops): { updates: Partial<WorkItem>; before: Partial<WorkItem> } {
  const u: Partial<WorkItem> = {};
  if (ops.title) u.title = ops.title;
  if (ops.kind && ops.kind !== 'habit' && ops.kind !== item.entityType) { u.entityType = ops.kind as any; u.type = ops.kind as any; }
  if (ops.priority) u.priority = ops.priority;
  if (ops.place) {
    const ctx: LifeContext = ops.place.areaId ? 'personal' : 'work';
    Object.assign(u, scope({ lifeContext: ctx, projectId: ops.place.projectId, branchId: ops.place.branchId, areaId: ops.place.areaId }), { lifeContext: ctx });
  } else if (ops.context && ops.context !== (item.lifeContext || 'work')) {
    u.lifeContext = ops.context;
    if (ops.context === 'personal') { u.projectId = null; u.branchId = null; } else u.areaId = null;
  }
  if (ops.date === null) {
    Object.assign(u, { dueDate: null, startDate: null, dueTime: null, startAt: null, endAt: null, remindAt: null, reminderLeadMinutes: null });
  } else if (ops.date || ops.time) {
    const kind = (u.entityType || item.entityType) as string;
    if (kind === 'event') {
      const start = item.startAt ? new Date(item.startAt) : null;
      const length = start && item.endAt ? new Date(item.endAt).getTime() - start.getTime() : 3600000;
      const date = ops.date || (item.startAt || '').slice(0, 10) || item.dueDate || localDateTime(new Date()).slice(0, 10);
      const time = ops.time || (item.startAt || '').slice(11, 16) || '09:00';
      const next = new Date(`${date}T${time}`);
      u.startAt = localDateTime(next); u.endAt = localDateTime(new Date(next.getTime() + length));
      u.dueDate = date; u.startDate = date;
    } else {
      const date = ops.date || item.dueDate || localDateTime(new Date()).slice(0, 10);
      u.dueDate = date;
      if (!item.startDate || item.startDate > date || ops.date) u.startDate = date;
      if (ops.time) u.dueTime = ops.time;
      u.isInbox = false;
      // A reminder set straight at a time keeps that time on its new day.
      if (kind === 'reminder' && item.reminderLeadMinutes == null) {
        u.dueTime = ops.time || item.dueTime || (item.remindAt || '').slice(11, 16) || '09:00';
        u.reminderLeadMinutes = 0;
      } else if (ops.time && item.reminderLeadMinutes == null) u.reminderLeadMinutes = 0;
    }
  }
  if (ops.repeat) u.repeatRule = ops.repeat.rule;
  if (ops.lead) {
    u.reminderLeadMinutes = ops.lead.minutes;
    if (ops.lead.minutes == null) u.remindAt = null;
    else if (!item.dueDate && !u.dueDate && item.entityType !== 'event') u.dueDate = localDateTime(new Date()).slice(0, 10);
  }
  if (ops.addTags || ops.removeTags) {
    let tags = [...(item.labels || [])];
    if (ops.addTags) tags = Array.from(new Set([...tags, ...ops.addTags]));
    if (ops.removeTags) tags = tags.filter(t => !ops.removeTags!.includes(t));
    u.labels = tags;
  }
  if (ops.note) u.description = item.description ? `${item.description}\n\n${ops.note}` : ops.note;
  const before: any = {};
  for (const k of Object.keys(u)) before[k] = (item as any)[k] ?? null;
  return { updates: u, before };
}

/** Short name for an item in a reply: "C-13 Sonar Connector Pinout Labeling". */
export function itemName(item: Pick<WorkItem, 'key' | 'title'>): string {
  return `${item.key ? `${item.key} ` : ''}${item.title}`;
}

/** Words used to tell items apart, for tests and the AI fallback. */
export const _internals = { aboutWords, words };
