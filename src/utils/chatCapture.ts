/**
 * chatCapture.ts
 *
 * Turns a chatty message ("tmrw morning finish the sonar pinout for ci4 and then
 * look at camera focus. gym mon wed fri 7am") into draft items for the Chat tab
 * of New Item. Everything here runs in the browser and is instant:
 *
 *   1. split the message into separate asks
 *   2. read dates, times, repeats, tags and priority with quickAddParser
 *   3. match words to projects, branches, areas and open items
 *
 * What's still unclear (no project or area found) is marked `unsure`, and the
 * Chat tab asks the Pi (Groq) about just that. Nothing saves from here.
 */

import { parseQuickAdd, QuickAddPriority, formatShortDate } from './quickAddParser';
import { formatTime } from './reminders';
import { Project, Area, WorkItem, LifeContext } from '../services/types';

export type CardKind = 'task' | 'reminder' | 'event' | 'habit';

export interface CaptureContext {
  projects: Project[];
  areas: Area[];
  items: WorkItem[]; // open items, to spot ones that already exist
  tags: string[];
  lifeContext: LifeContext; // the sheet's Work / Personal switch
}

export interface CardMatch { id: string; key: string; title: string; isInbox: boolean }

export interface CaptureCard {
  id: string;
  text: string; // the words of the message this card came from
  title: string;
  kind: CardKind;
  lifeContext: LifeContext;
  projectId: string | null;
  branchId: string | null;
  areaId: string | null;
  date: string | null;
  time: string | null;
  repeatRule: string | null;
  repeatLabel: string | null;
  priority: QuickAddPriority;
  priorityGiven: boolean;
  tags: string[];
  durationMinutes: number | null;
  location: string | null;
  match: CardMatch | null;
  useMatch: boolean; // update the matched item instead of adding a new one
  include: boolean;
  why: string[];
  unsure: boolean;
}

// Typed shortcuts the parser doesn't know, spelled out first.
const SLANG: [RegExp, string][] = [
  [/\b(tmrw|tmrow|tmr|tmw|tomoz|tomo|2moro|tomorow|tommorow|tommorrow)\b/gi, 'tomorrow'],
  [/\b(tonite|2nite)\b/gi, 'tonight'],
  [/\b2day\b/gi, 'today'],
  [/\b(urgent|high|medium|low)\s+(priority|prio|pri)\b/gi, '!$1'],
  [/\b(priority|prio)\s+(urgent|high|medium|low)\b/gi, '!$2'],
  [/\b(?:on\s+)?(sat|sun)(?=\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b)/gi, 'on $1'],
];

export function normalize(text: string): string {
  return SLANG.reduce((t, [re, to]) => t.replace(re, to), text);
}

// Where one ask ends and the next starts. Each piece remembers how it was
// joined on, so "and then look at X" can follow the day of the one before.
const JOINERS = /\s*(?:[.;!?]+(?:\s+|$)|\n+|,?\s+and\s+then\s+|,?\s+then\s+|,?\s+after\s+that\s+|,?\s+also\s+|,?\s+plus\s+)/i;
const FOLLOWS = /^(?:and\s+then|then|after\s+that)$/i;

export interface Piece { text: string; follows: boolean }

export function splitMessage(message: string): Piece[] {
  const pieces: Piece[] = [];
  let rest = message.trim();
  let follows = false;
  while (rest) {
    const m = rest.match(JOINERS);
    if (!m || m.index === undefined) { pieces.push({ text: rest, follows }); break; }
    const head = rest.slice(0, m.index).trim();
    if (head) pieces.push({ text: head, follows });
    follows = FOLLOWS.test(m[0].replace(/[.,;!?\n]/g, '').trim());
    rest = rest.slice(m.index + m[0].length).trim();
  }
  return pieces.filter(p => /[a-z]/i.test(p.text));
}

// Words that say nothing about which item this is.
const STOP = new Set(('a an the to for of on in at by and or with my me it this that these those is are be do does ' +
  'finish finishing start starting continue work working look looking check into about up out get got make need needs ' +
  'should must will want try please also then just some more again new item task').split(' '));
// Words too common to pick a project or branch by themselves.
const COMMON = new Set(('work project projects personal life home team stuff app baby look feel quick phone sync server ' +
  'daily rhythm updates update wifi welcome back face link sounds alarms passwords privacy notifications capture main ' +
  'desk clock firmware dashboard').split(' '));
// Areas often go by other words.
const AREA_WORDS: Record<string, string[]> = {
  fitness: ['gym', 'workout', 'run', 'running', 'pushups', 'yoga', 'exercise', 'cardio', 'swim', 'walk', 'stretch', 'weights'],
  health: ['doctor', 'dentist', 'meds', 'medicine', 'pills', 'checkup', 'gym', 'sleep'],
  finance: ['pay', 'bill', 'bills', 'rent', 'bank', 'tax', 'taxes', 'invoice', 'budget'],
  money: ['pay', 'bill', 'bills', 'rent', 'bank', 'tax', 'budget'],
  home: ['clean', 'laundry', 'groceries', 'dishes', 'fix', 'repair'],
  driving: ['drive', 'driving', 'car', 'lesson', 'licence', 'license'],
  family: ['mom', 'mum', 'dad', 'sister', 'brother', 'family'],
};

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
const stem = (w: string) => w.replace(/(ings?|ed|es|s)$/, '').slice(0, 7);
const keyWords = (s: string) => words(s).filter(w => !STOP.has(w) && w.length > 1).map(stem);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`, 'i').test(text);

interface Where { projectId: string | null; branchId: string | null; areaId: string | null; phrase: string | null; why: string | null }

/** The project, branch or area a piece of text names, and the words that named it. */
export function matchWhere(text: string, ctx: CaptureContext): Where {
  const none: Where = { projectId: null, branchId: null, areaId: null, phrase: null, why: null };
  const lower = text.toLowerCase();
  // Projects: the full name, its key ("S-12" style keys are items, not projects), or a distinctive word.
  let best: { p: Project; phrase: string; score: number } | null = null;
  for (const p of ctx.projects) {
    if (!p?.name) continue;
    const name = p.name.toLowerCase();
    if (hasWord(lower, name)) { best = { p, phrase: p.name, score: 10 }; break; }
    for (const w of words(name)) {
      if (w.length >= 3 && !COMMON.has(w) && !STOP.has(w) && hasWord(lower, w) && (!best || best.score < 5)) best = { p, phrase: w, score: 5 };
    }
  }
  // Branches: their full name, or a distinctive word only one branch has.
  let branch: { p: Project; id: string; name: string; phrase: string } | null = null;
  const all = ctx.projects.flatMap(p => (p.branches || []).map(b => ({ p, b })));
  for (const { p, b } of all) {
    if (best && best.p.id !== p.id) continue;
    if (hasWord(lower, b.name.toLowerCase())) { branch = { p, id: b.id, name: b.name, phrase: b.name }; break; }
  }
  if (!branch) {
    const counts = new Map<string, number>();
    for (const { b } of all) for (const w of new Set(words(b.name))) counts.set(w, (counts.get(w) || 0) + 1);
    for (const { p, b } of all) {
      if (best && best.p.id !== p.id) continue;
      const w = words(b.name).find(w => w.length >= 4 && !COMMON.has(w) && !STOP.has(w) && counts.get(w) === 1 && hasWord(lower, w));
      if (w) { branch = { p, id: b.id, name: b.name, phrase: w }; break; }
    }
    // A shared word ("lumo") picks the branch that started that line of work.
    if (!branch) {
      for (const { p, b } of all) {
        if ((best && p.id !== best.p.id) || b.parentId) continue;
        const w = words(b.name).find(w => w.length >= 4 && !COMMON.has(w) && !STOP.has(w) && hasWord(lower, w));
        if (w) { branch = { p, id: b.id, name: b.name, phrase: w }; break; }
      }
    }
  }
  if (branch) {
    const p = branch.p;
    const phrase = best && best.phrase.toLowerCase() !== branch.phrase.toLowerCase() ? `${best.phrase} ${branch.phrase}` : branch.phrase;
    return { projectId: p.id, branchId: branch.id, areaId: null, phrase: best ? best.phrase : branch.phrase, why: `"${phrase}" → ${p.name} › ${branch.name}` };
  }
  if (best) return { ...none, projectId: best.p.id, phrase: best.phrase, why: `"${best.phrase}" → ${best.p.name}` };
  // Areas: the name, or the usual words for it.
  for (const a of ctx.areas) {
    if (!a?.name) continue;
    if (hasWord(lower, a.name.toLowerCase())) return { ...none, areaId: a.id, phrase: a.name, why: `"${a.name}" → ${a.name}` };
    const hit = words(a.name).flatMap(w => AREA_WORDS[w] || []).find(w => hasWord(lower, w));
    if (hit) return { ...none, areaId: a.id, phrase: null, why: `"${hit}" → ${a.name}` };
  }
  return none;
}

/** An open item this text is about: by key ("C-13"), or by sharing its main words. */
export function findSame(text: string, title: string, ctx: CaptureContext): WorkItem | null {
  const key = text.match(/\b([A-Z]{1,6}-\d+)\b/i)?.[1]?.toUpperCase();
  if (key) {
    const byKey = ctx.items.find(i => (i.key || '').toUpperCase() === key);
    if (byKey) return byKey;
  }
  const mine = new Set(keyWords(title));
  if (mine.size === 0) return null;
  let best: { item: WorkItem; score: number } | null = null;
  for (const item of ctx.items) {
    if (!item?.title || (item.labels || []).includes('alarm')) continue;
    const theirs = new Set(keyWords(item.title));
    if (theirs.size === 0) continue;
    const shared = [...mine].filter(w => theirs.has(w)).length;
    const score = shared / Math.max(theirs.size, 1);
    const enough = shared >= 2 ? score >= 0.4 : (shared === 1 && theirs.size === 1 && mine.size <= 2 && [...theirs][0].length >= 5);
    if (enough && (!best || score > best.score)) best = { item, score };
  }
  return best?.item || null;
}

/** "finish the sonar pinout for ci4" → "Finish the sonar pinout". */
function tidyTitle(title: string, phrase: string | null): string {
  let t = title;
  if (phrase) t = t.replace(new RegExp(`\\s*\\b(?:for|in|on|under|to|at)?\\s*(?:the\\s+)?${escapeRe(phrase)}(?:\\s+(?:project|branch|area))?\\b`, 'i'), ' ');
  t = t.replace(/^(?:and|also|then|plus|ok|okay|so|oh)\s+/i, '')
    .replace(/^(?:i\s+(?:need|have|want)\s+to|i\s+should|i\s+must|need\s+to|have\s+to|gotta|got\s+to)\s+/i, '')
    .replace(/\s+(?:and|also|then|for|on|at|by|to)$/i, '')
    .replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : title;
}

let seq = 0;
const nextId = () => `card-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function kindFrom(text: string, parsedKind: string): CardKind {
  if (/^\s*(?:remind\s+me|reminder)\b/i.test(text)) return 'reminder';
  if (/\b(?:as\s+a\s+habit|habit\s+of|make\s+it\s+a\s+habit)\b/i.test(text)) return 'habit';
  return parsedKind === 'event' ? 'event' : parsedKind === 'reminder' ? 'reminder' : 'task';
}

const sameKind = (kind: CardKind, entityType: string | undefined) =>
  kind === (entityType === 'reminder' || entityType === 'event' ? entityType : 'task');

/** One draft card from one piece of a message. */
export function buildCard(piece: Piece, ctx: CaptureContext, now: Date = new Date()): CaptureCard {
  const text = normalize(piece.text);
  const p = parseQuickAdd(text, now);
  const where = matchWhere(text, ctx);
  const title = tidyTitle(p.title, where.phrase);
  const same = findSame(text, title, ctx);
  const why: string[] = [];
  if (where.why) why.push(where.why);

  let { projectId, branchId, areaId } = where;
  // The item it matched says where this belongs, when the words didn't.
  if (same && !projectId && !areaId) {
    projectId = same.projectId || null; branchId = same.branchId || null; areaId = same.areaId || null;
  }
  const personal = areaId ? true : projectId ? false : ctx.lifeContext === 'personal';
  if (p.date) why.push(`${p.dateLabel && p.dateLabel !== formatShortDate(p.date) ? `"${p.dateLabel.toLowerCase()}" → ` : ''}${formatShortDate(p.date)}${p.time ? `, ${formatTime(p.time)}` : ''}`);

  return {
    id: nextId(),
    text: piece.text,
    title,
    kind: kindFrom(text, p.entityType),
    lifeContext: same?.lifeContext || (personal ? 'personal' : 'work'),
    projectId, branchId, areaId,
    date: p.date, time: p.time,
    repeatRule: p.repeatRule, repeatLabel: p.repeatLabel,
    priority: p.priority || 'medium', priorityGiven: !!p.priority,
    tags: p.tags,
    durationMinutes: p.durationMinutes,
    location: p.location,
    match: same ? { id: same.id, key: same.key, title: same.title, isInbox: !!same.isInbox } : null,
    // A reminder that shares words with a task is usually a new step, not the same one.
    useMatch: !!same && sameKind(kindFrom(text, p.entityType), same.entityType),
    include: true,
    why,
    unsure: !projectId && !areaId,
  };
}

/** Cards for a whole message. A piece joined by "and then" takes the day of the one before. */
export function buildCards(message: string, ctx: CaptureContext, now: Date = new Date()): CaptureCard[] {
  const cards: CaptureCard[] = [];
  for (const piece of splitMessage(message)) {
    const card = buildCard(piece, ctx, now);
    const prev = cards[cards.length - 1];
    if (piece.follows && prev && !card.date && prev.date) {
      card.date = prev.date;
      card.why.push(`after "${prev.title}" → ${formatShortDate(prev.date)}`);
      if (!card.projectId && !card.areaId) {
        card.projectId = prev.projectId; card.branchId = prev.branchId; card.areaId = prev.areaId;
        card.lifeContext = prev.lifeContext; card.unsure = prev.unsure;
      }
    }
    cards.push(card);
  }
  return cards;
}

// --- What the Pi's AI said, folded back in ---

export interface AiItem {
  text: string; title: string; kind?: CardKind; context?: LifeContext;
  projectId?: string; branchId?: string; areaId?: string; sameAsId?: string; tags?: string[];
}

/** Rebuilds the cards from the AI's split, keeping what the parser read for dates and times. */
export function mergeAiItems(ai: AiItem[], ctx: CaptureContext, now: Date = new Date()): CaptureCard[] {
  const cards: CaptureCard[] = [];
  for (const it of ai) {
    const card = buildCard({ text: it.text || it.title, follows: false }, ctx, now);
    if (it.title) card.title = tidyTitle(it.title, null);
    if (it.kind && !(card.kind === 'reminder' && it.kind === 'task')) card.kind = it.kind;
    if (!card.projectId && !card.areaId && (it.projectId || it.areaId)) {
      const project = ctx.projects.find(p => p.id === it.projectId);
      const area = ctx.areas.find(a => a.id === it.areaId);
      card.projectId = project ? project.id : null;
      card.branchId = project && it.branchId ? it.branchId : null;
      card.areaId = !project && area ? area.id : null;
      const branch = project?.branches?.find(b => b.id === card.branchId);
      card.why.unshift(`Groq → ${project ? project.name + (branch ? ` › ${branch.name}` : '') : area?.name}`);
    }
    if (it.context) card.lifeContext = it.context;
    if (card.areaId) card.lifeContext = 'personal';
    else if (card.projectId) card.lifeContext = 'work';
    if (!card.match && it.sameAsId) {
      const same = ctx.items.find(i => i.id === it.sameAsId);
      if (same) { card.match = { id: same.id, key: same.key, title: same.title, isInbox: !!same.isInbox }; card.useMatch = sameKind(card.kind, same.entityType); }
    }
    card.tags = Array.from(new Set([...card.tags, ...(it.tags || [])]));
    card.unsure = !card.projectId && !card.areaId;
    // "then X" without its own day follows the one before, as in the plain split.
    const prev = cards[cards.length - 1];
    if (!card.date && prev?.date && /\b(?:then|after)\b/i.test(it.text)) card.date = prev.date;
    cards.push(card);
  }
  return cards;
}

// --- Follow-ups: "make gym high priority and a habit" ---

const EDIT_START = /^\s*(?:make|change|move|set|mark|rename|put|switch|turn|actually|no[,\s]|instead|drop|remove|delete|skip|cancel|forget|don'?t|undo|the\s+\w+\s+(?:one|card)|it\s|that\s|those\s|both\s|all\s)/i;

export function looksLikeEdit(message: string): boolean {
  return EDIT_START.test(message);
}

export interface CardChange {
  card: number; remove?: boolean; title?: string; kind?: CardKind; priority?: QuickAddPriority;
  context?: LifeContext; when?: string; projectId?: string; branchId?: string; areaId?: string;
}

/** Which cards a follow-up is about: named by a word of their title, else the last one. */
function targets(message: string, cards: CaptureCard[]): number[] {
  const lower = message.toLowerCase();
  if (/\b(?:all|everything|both|them|those)\b/.test(lower)) return cards.map((_, i) => i);
  const named = cards.map((c, i) => (keyWords(c.title).some(w => w.length >= 3 && lower.split(/[^a-z0-9]+/).some(x => stem(x) === w)) ? i : -1)).filter(i => i >= 0);
  return named.length ? named : (/\b(?:it|that|this)\b/.test(lower) && cards.length ? [cards.length - 1] : []);
}

/** A follow-up read without AI. Null when it isn't understood. */
export function localEdit(message: string, cards: CaptureCard[], ctx: CaptureContext, now: Date = new Date()): CardChange[] | null {
  const ids = targets(message, cards);
  if (!ids.length) return null;
  const text = normalize(message);
  const change: Omit<CardChange, 'card'> = {};
  if (/\b(?:drop|remove|delete|skip|cancel|forget|don'?t\s+(?:add|save))\b/i.test(text)) change.remove = true;
  const pr = text.match(/!(urgent|high|medium|low)\b/i) || text.match(/\b(urgent|important)\b/i);
  if (pr) change.priority = (pr[1].toLowerCase() === 'important' ? 'high' : pr[1].toLowerCase()) as QuickAddPriority;
  const kind = text.match(/\b(?:an?\s+)?(habit|reminder|event|task)\b/i);
  if (kind && /\b(?:make|turn|change|as|into|be|a|an)\b/i.test(text)) change.kind = kind[1].toLowerCase() as CardKind;
  if (/\bpersonal\b/i.test(text)) change.context = 'personal';
  else if (/\bwork\b/i.test(text) && !/\bwork\s+on\b/i.test(text)) change.context = 'work';
  const parsed = parseQuickAdd(text, now);
  if (parsed.date || parsed.time || parsed.repeatRule) change.when = text;
  const where = matchWhere(text, ctx);
  if (where.projectId || where.areaId) {
    // Only when it's the place being changed, not a word of the card's own title.
    const titleWords = new Set(ids.flatMap(i => keyWords(cards[i].title)));
    if (!where.phrase || !keyWords(where.phrase).every(w => titleWords.has(w))) {
      if (where.projectId) { change.projectId = where.projectId; if (where.branchId) change.branchId = where.branchId; }
      if (where.areaId) change.areaId = where.areaId;
    }
  }
  if (Object.keys(change).length === 0) return null;
  return ids.map(card => ({ card, ...change }));
}

/** Applies changes; returns the new cards and a sentence saying what changed. */
export function applyChanges(cards: CaptureCard[], changes: CardChange[], ctx: CaptureContext, now: Date = new Date()): { cards: CaptureCard[]; said: string } {
  const next = cards.map(c => ({ ...c }));
  const said: string[] = [];
  for (const ch of changes) {
    const c = next[ch.card];
    if (!c) continue;
    const bits: string[] = [];
    if (ch.remove) { c.include = false; said.push(`${c.title} is left out`); continue; }
    if (ch.title) { c.title = ch.title; bits.push(`renamed`); }
    if (ch.kind) { c.kind = ch.kind; bits.push(`a ${ch.kind}`); }
    if (ch.priority) { c.priority = ch.priority; c.priorityGiven = true; bits.push(`${ch.priority} priority`); }
    if (ch.projectId) {
      const p = ctx.projects.find(x => x.id === ch.projectId);
      if (p && (p.id !== c.projectId || (ch.branchId || null) !== c.branchId)) { c.projectId = p.id; c.branchId = ch.branchId || null; c.areaId = null; c.lifeContext = 'work'; c.unsure = false; bits.push(`in ${p.name}`); }
    }
    if (ch.areaId) {
      const a = ctx.areas.find(x => x.id === ch.areaId);
      if (a && a.id !== c.areaId) { c.areaId = a.id; c.projectId = null; c.branchId = null; c.lifeContext = 'personal'; c.unsure = false; bits.push(`in ${a.name}`); }
    }
    if (ch.context && !ch.projectId && !ch.areaId) { c.lifeContext = ch.context; bits.push(ch.context); }
    if (ch.when) {
      const p = parseQuickAdd(normalize(ch.when), now);
      if (p.date) c.date = p.date;
      if (p.time) c.time = p.time;
      if (p.repeatRule) { c.repeatRule = p.repeatRule; c.repeatLabel = p.repeatLabel; }
      if (p.date || p.time) bits.push(`on ${[p.date && formatShortDate(p.date), p.time && formatTime(p.time)].filter(Boolean).join(' at ')}`);
      if (p.repeatLabel) bits.push(p.repeatLabel.toLowerCase());
    }
    if (bits.length) said.push(`${c.title} is now ${bits.join(', ')}`);
  }
  return { cards: next, said: said.length ? `Done. ${said.join('. ')}.` : '' };
}

// --- Saving ---

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Days a week a repeat rule asks for, for a habit's weekly target. */
export function timesPerWeek(rule: string | null): number {
  if (!rule) return 7;
  if (rule.startsWith('weekly:')) return Math.max(1, rule.slice(7).split(',').length);
  if (rule === 'weekdays') return 5;
  if (rule === 'weekly') return 1;
  return 7;
}

function scope(c: CaptureCard) {
  return c.lifeContext === 'personal'
    ? { projectId: null, branchId: null, areaId: c.areaId }
    : { projectId: c.projectId, branchId: c.projectId ? c.branchId : null, areaId: null };
}

/** Fields for a new work item. */
export function newItemPayload(c: CaptureCard): Partial<WorkItem> {
  const date = c.date || (c.kind === 'reminder' || c.kind === 'event' ? todayKey() : null);
  const base: Partial<WorkItem> = {
    title: c.title,
    entityType: c.kind as any,
    type: c.kind as any,
    lifeContext: c.lifeContext,
    ...scope(c),
    priority: c.priority,
    labels: c.tags,
    location: c.location,
    repeatRule: c.repeatRule,
    estimatedMinutes: c.durationMinutes ?? undefined,
    estimated: c.durationMinutes ? `${c.durationMinutes}m` : undefined,
  } as Partial<WorkItem>;
  if (c.kind === 'reminder') {
    return { ...base, dueDate: date, startDate: date, remindAt: `${date}T${c.time || '09:00'}` };
  }
  if (c.kind === 'event') {
    const start = `${date}T${c.time || '09:00'}`;
    const end = new Date(new Date(start).getTime() + (c.durationMinutes || 60) * 60000);
    const endAt = `${todayKey(end)}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
    return { ...base, startAt: start, endAt, dueDate: date, startDate: date, reminderLeadMinutes: 10 };
  }
  return { ...base, dueDate: date, startDate: date, dueTime: date && c.time ? c.time : null, reminderLeadMinutes: date && c.time ? 0 : null };
}

/** Fields to change on the item a card matched: only what the message said. */
export function matchUpdates(c: CaptureCard, item: WorkItem): Partial<WorkItem> {
  const u: Partial<WorkItem> = {};
  if (c.date) {
    u.dueDate = c.date;
    if (!item.startDate || item.startDate > c.date) u.startDate = c.date;
    u.isInbox = false;
    if (c.time) { u.dueTime = c.time; if (item.reminderLeadMinutes == null) u.reminderLeadMinutes = 0; }
    if (item.entityType === 'reminder') u.remindAt = `${c.date}T${c.time || (item.remindAt || '').slice(11, 16) || '09:00'}`;
  }
  if (c.priorityGiven && c.priority !== item.priority) u.priority = c.priority;
  if (c.repeatRule) u.repeatRule = c.repeatRule;
  const tags = Array.from(new Set([...(item.labels || []), ...c.tags]));
  if (tags.length !== (item.labels || []).length) u.labels = tags;
  // A place chosen on the card wins over where it was.
  const s = scope(c);
  if (c.lifeContext === (item.lifeContext || 'work')) {
    if (s.projectId && s.projectId !== item.projectId) { u.projectId = s.projectId; u.branchId = s.branchId; }
    else if (s.branchId && s.branchId !== item.branchId) u.branchId = s.branchId;
    if (s.areaId && s.areaId !== item.areaId) u.areaId = s.areaId;
  }
  return u;
}
