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

const pad = (n: number) => String(n).padStart(2, '0');
export const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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
  leadMinutes: number | null; // remind this long before (0 = at the time)
  description: string;
  subtasks: string[];
  done: boolean;
}

// Typed shortcuts the parser doesn't know, spelled out first.
const SLANG: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\b(tmrw|tmrow|tmr|tmw|tomoz|tomo|2moro|tomorow|tommorow|tommorrow)\b/gi, 'tomorrow'],
  [/\b(tonite|2nite)\b/gi, 'tonight'],
  [/\b2day\b/gi, 'today'],
  [/\b(urgent|high|medium|low)\s+(priority|prio|pri)\b/gi, '!$1'],
  [/\b(priority|prio)\s+(urgent|high|medium|low)\b/gi, '!$2'],
  // "6.45 pm" and "at 6.45" are times, written the British way.
  [/\b(\d{1,2})\.([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi, (_m: string, h: string, mm: string, ap: string) => `${h}:${mm}${ap.replace(/\./g, '').toLowerCase()}`],
  [/\b(at|by|@|from|until|till)\s+(\d{1,2})\.([0-5]\d)\b/gi, '$1 $2:$3'],
  [/\b(\d{1,2}(?::\d{2})?)\s+(am|pm)\b/gi, '$1$2'],
  [/\b(?:on\s+)?(sat|sun)(?=\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b)/gi, 'on $1'],
];

export function normalize(text: string): string {
  return SLANG.reduce((t, [re, to]) => t.replace(re, to as any), text);
}

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'half an': 0.5, half: 0.5 };
const LEAD_RE = /\b(\d+(?:\.\d+)?|an?|one|two|three|five|ten|fifteen|twenty|thirty|half(?:\s+an?)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)?\s+(?:before|earlier|ahead|prior|in\s+advance|early)\b/i;

/** "10 before", "half an hour before", "1 day early": minutes of warning, and the text without it. */
export function extractLead(text: string): { text: string; lead: number | null } {
  if (/\b(?:no|without|don'?t\s+(?:need\s+a\s+)?)\s*(?:reminders?|alerts?|notifications?)\b/i.test(text)) return { text, lead: null };
  if (/\b(?:remind\s+me\s+)?(?:at\s+the\s+time|on\s+time|right\s+then)\b/i.test(text) && /\bremind/i.test(text)) {
    return { text: text.replace(/\s*\b(?:at\s+the\s+time|on\s+time|right\s+then)\b/i, ' ').replace(/\s+/g, ' ').trim(), lead: 0 };
  }
  const m = text.match(LEAD_RE);
  if (!m) return { text, lead: null };
  const raw = m[1].toLowerCase();
  const n = NUM_WORDS[raw.replace(/\s+/g, ' ')] ?? parseFloat(raw);
  const unit = (m[2] || 'm').toLowerCase();
  const mult = unit.startsWith('d') ? 1440 : unit.startsWith('h') ? 60 : 1;
  // "half" alone means half an hour.
  const minutes = Math.round(n * (raw.startsWith('half') && !m[2] ? 60 : mult));
  return { text: text.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), lead: minutes > 0 && minutes <= 7 * 1440 ? minutes : null };
}

/** "10 min before", "1 h before", "at the time". */
export function leadLabel(minutes: number | null): string {
  if (minutes == null) return 'No reminder';
  if (minutes === 0) return 'At the time';
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'} before`;
  if (minutes % 60 === 0) return `${minutes / 60} h before`;
  return `${minutes} min before`;
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

export const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
export const stem = (w: string) => w.replace(/(ings?|ed|es|s)$/, '').slice(0, 7);
export const keyWords = (s: string) => words(s).filter(w => !STOP.has(w) && w.length > 1).map(stem);
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const hasWord = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`, 'i').test(text);

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
    .replace(/(.)\s*\b(?:and\s+|,\s*)?(?:please\s+)?remind\s+me\b(?:\s+(?:about\s+it|of\s+it))?\s*/i, '$1 ')
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
  const lead = extractLead(normalize(piece.text));
  const text = lead.text;
  const p = parseQuickAdd(text, now);
  // Only a time: today, or tomorrow once that time has gone.
  if (p.time && !p.date) {
    const d = new Date(now);
    if (p.time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`) d.setDate(d.getDate() + 1);
    p.date = todayKey(d);
    p.dateLabel = d.getDate() === now.getDate() ? 'Today' : 'Tomorrow';
  }
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
    leadMinutes: lead.lead,
    description: '',
    subtasks: [],
    done: false,
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

/** Groq sometimes rewrites the words and drops "at 6.45 pm"; keep the day, time, repeat and lead the parser already read. */
function borrowTiming(card: CaptureCard, it: AiItem, count: number, local: CaptureCard[]) {
  // A parser card that holds several of the AI's items can't say whose time it is.
  if (!local.length || local.length < count) return;
  let src: CaptureCard | undefined = count === 1 && local.length === 1 ? local[0] : undefined;
  if (!src) {
    const mine = new Set(keyWords(`${it.text || ''} ${it.title || ''}`));
    let best = 0;
    for (const c of local) {
      const hits = keyWords(c.text).filter(w => mine.has(w)).length;
      if (hits > best) { best = hits; src = c; }
    }
  }
  if (!src) return;
  if (!card.date && src.date) { card.date = src.date; card.why = card.why.concat(src.why.filter(w => !card.why.includes(w))); }
  if (!card.time && src.time) card.time = src.time;
  if (!card.repeatRule && src.repeatRule) { card.repeatRule = src.repeatRule; card.repeatLabel = src.repeatLabel; }
  if (card.leadMinutes == null && src.leadMinutes != null) card.leadMinutes = src.leadMinutes;
  if (!card.priorityGiven && src.priorityGiven) { card.priority = src.priority; card.priorityGiven = true; }
  card.tags = Array.from(new Set([...card.tags, ...src.tags]));
}

/** Rebuilds the cards from the AI's split, keeping what the parser read for dates and times. */
export function mergeAiItems(ai: AiItem[], ctx: CaptureContext, now: Date = new Date(), local: CaptureCard[] = []): CaptureCard[] {
  const cards: CaptureCard[] = [];
  for (const it of ai) {
    const card = buildCard({ text: it.text || it.title, follows: false }, ctx, now);
    borrowTiming(card, it, ai.length, local);
    // Clean the AI's title the same way, so an echoed "remind me ... at 6.45 pm" loses its timing words.
    if (it.title) card.title = buildCard({ text: it.title, follows: false }, ctx, now).title || tidyTitle(it.title, null);
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

// --- Saving ---

/** Days a week a repeat rule asks for, for a habit's weekly target. */
export function timesPerWeek(rule: string | null): number {
  if (!rule) return 7;
  if (rule.startsWith('weekly:')) return Math.max(1, rule.slice(7).split(',').length);
  if (rule === 'weekdays') return 5;
  if (rule === 'weekly') return 1;
  return 7;
}

export function scope(c: Pick<CaptureCard, 'lifeContext' | 'projectId' | 'branchId' | 'areaId'>) {
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
  if (c.done) (base as any).status = 'done';
  if (c.description) base.description = c.description;
  if (c.kind === 'reminder') {
    // The reminder fires at its time, or the lead before it ("10 min before").
    return { ...base, dueDate: date, startDate: date, dueTime: c.time || '09:00', reminderLeadMinutes: c.leadMinutes ?? 0 };
  }
  if (c.kind === 'event') {
    const start = `${date}T${c.time || '09:00'}`;
    const end = new Date(new Date(start).getTime() + (c.durationMinutes || 60) * 60000);
    const endAt = `${todayKey(end)}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
    return { ...base, startAt: start, endAt, dueDate: date, startDate: date, reminderLeadMinutes: c.leadMinutes ?? 10 };
  }
  return { ...base, dueDate: date, startDate: date, dueTime: date && c.time ? c.time : null, reminderLeadMinutes: date ? (c.leadMinutes ?? (c.time ? 0 : null)) : null };
}

/** Fields to change on the item a card matched: only what the message said. */
export function matchUpdates(c: CaptureCard, item: WorkItem): Partial<WorkItem> {
  const u: Partial<WorkItem> = {};
  if (c.date) {
    u.dueDate = c.date;
    if (!item.startDate || item.startDate > c.date) u.startDate = c.date;
    u.isInbox = false;
    if (c.time) { u.dueTime = c.time; if (item.reminderLeadMinutes == null) u.reminderLeadMinutes = 0; }
    if (item.entityType === 'reminder' && item.reminderLeadMinutes == null) u.remindAt = `${c.date}T${c.time || (item.remindAt || '').slice(11, 16) || '09:00'}`;
  }
  if (c.leadMinutes != null) u.reminderLeadMinutes = c.leadMinutes;
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
