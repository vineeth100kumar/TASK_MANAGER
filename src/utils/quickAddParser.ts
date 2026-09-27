/**
 * quickAddParser.ts
 *
 * Lightweight, fully client-side natural-language parsing for the Quick
 * Capture bar. Deliberately not the Ollama-backed /api/parse-task endpoint:
 * that call needs the Raspberry Pi backend to be configured and reachable,
 * and quick-add has to work instantly (and offline) on every keystroke.
 *
 * Supported inline tokens (Todoist-style, stripped from the title once
 * recognized):
 *   #tag            -> adds a tag/label
 *   @location       -> sets location (shown for events)
 *   !urgent|high|medium|low  -> priority
 *   ~30m / ~2h / ~1h30m      -> duration / estimate
 *   today, tomorrow, mon..sun, next <weekday>, in N day(s)/week(s),
 *   a date like 12/25 or 2026-01-05        -> due date
 *   3pm, 15:30, at 3:30pm                  -> time of day
 *   every day|daily|weekly|monthly|yearly|weekday(s)|every <weekday>
 *                                           -> recurrence
 *   leading "remind me (to)?"               -> entityType = reminder
 *   words like meeting/call/lunch/dinner/appointment/with + a time/@location
 *                                           -> entityType = event
 */

export type QuickAddEntityType = 'task' | 'event' | 'reminder';
export type QuickAddPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface QuickAddResult {
  title: string;
  entityType: QuickAddEntityType;
  priority: QuickAddPriority | null;
  date: string | null; // YYYY-MM-DD
  dateLabel: string | null;
  time: string | null; // HH:mm
  tags: string[];
  location: string | null;
  repeatRule: string | null;
  repeatLabel: string | null;
  durationMinutes: number | null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ABBR: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextWeekday(from: Date, targetDow: number, forceNextWeek = false): Date {
  const d = new Date(from);
  let diff = (targetDow - d.getDay() + 7) % 7;
  if (diff === 0 && !forceNextWeek) diff = 0; // "today" if same day, unless "next X" was said
  else if (diff === 0 && forceNextWeek) diff = 7;
  if (forceNextWeek && diff < 7 && diff !== 0) {
    // "next monday" when today isn't monday still means the coming one, which diff already gives.
  }
  d.setDate(d.getDate() + diff);
  return d;
}

/** Strip a matched token (with any immediately surrounding whitespace) out of the working text. */
function strip(text: string, match: RegExpMatchArray): string {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  return (text.slice(0, start) + ' ' + text.slice(end)).replace(/\s+/g, ' ').trim();
}

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  let text = input;
  const tags: string[] = [];
  let location: string | null = null;
  let priority: QuickAddPriority | null = null;
  let date: string | null = null;
  let dateLabel: string | null = null;
  let time: string | null = null;
  let repeatRule: string | null = null;
  let repeatLabel: string | null = null;
  let durationMinutes: number | null = null;
  let entityType: QuickAddEntityType = 'task';

  // --- Reminder prefix: "remind me to X" / "remind me about X" ---
  const remindMatch = text.match(/^\s*remind me\s*(to|about)?\s*/i);
  if (remindMatch) {
    entityType = 'reminder';
    text = text.slice(remindMatch[0].length);
  }

  // --- Recurrence ---
  let m: RegExpMatchArray | null;
  if ((m = text.match(/\bevery\s+weekday[s]?\b/i))) {
    repeatRule = 'weekdays'; repeatLabel = 'Every weekday'; text = strip(text, m);
  } else if ((m = text.match(/\bevery\s+(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)[a-z]*\b/i))) {
    const abbr = m[1].toLowerCase();
    repeatRule = `weekly:${WEEKDAY_ABBR[abbr]}`;
    repeatLabel = `Every ${WEEKDAYS[WEEKDAY_ABBR[abbr]]}`;
    text = strip(text, m);
  } else if ((m = text.match(/\b(daily|every day)\b/i))) {
    repeatRule = 'daily'; repeatLabel = 'Daily'; text = strip(text, m);
  } else if ((m = text.match(/\b(weekly|every week)\b/i))) {
    repeatRule = 'weekly'; repeatLabel = 'Weekly'; text = strip(text, m);
  } else if ((m = text.match(/\b(monthly|every month)\b/i))) {
    repeatRule = 'monthly'; repeatLabel = 'Monthly'; text = strip(text, m);
  } else if ((m = text.match(/\b(yearly|annually|every year)\b/i))) {
    repeatRule = 'yearly'; repeatLabel = 'Yearly'; text = strip(text, m);
  }

  // --- Duration: ~30m, ~2h, ~1h30m ---
  if ((m = text.match(/~\s*(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/i))) {
    const hours = parseInt(m[1], 10);
    const mins = m[2] ? parseInt(m[2], 10) : 0;
    durationMinutes = hours * 60 + mins;
    text = strip(text, m);
  } else if ((m = text.match(/~\s*(\d+)\s*m(?:in(?:ute)?s?)?/i))) {
    durationMinutes = parseInt(m[1], 10);
    text = strip(text, m);
  }

  // --- Tags: #tag (repeatable) ---
  const tagRe = /#([a-z0-9][\w-]*)/gi;
  text = text.replace(tagRe, (_all, tag) => {
    tags.push(tag.toLowerCase());
    return '';
  }).replace(/\s+/g, ' ').trim();

  // --- Location: @location (rest of a token, up to next special char) ---
  if ((m = text.match(/@([\w][\w .'-]*)/))) {
    location = m[1].trim();
    text = strip(text, m);
    entityType = entityType === 'reminder' ? entityType : 'event';
  }

  // --- Priority: !urgent / !high / !medium / !low ---
  if ((m = text.match(/!(urgent|high|medium|med|low)\b/i))) {
    const p = m[1].toLowerCase();
    priority = (p === 'med' ? 'medium' : p) as QuickAddPriority;
    text = strip(text, m);
  } else if ((m = text.match(/\b(urgent|asap)\b/i))) {
    priority = 'urgent'; text = strip(text, m);
  } else if ((m = text.match(/\bimportant\b/i))) {
    priority = 'high'; text = strip(text, m);
  }

  // --- Time of day: "at 3pm", "3:30pm", "15:00" ---
  if ((m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)) ||
      (m = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)) ||
      (m = text.match(/\b(\d{1,2})\s*(am|pm)\b/i))) {
    let hour = parseInt(m[1], 10);
    let minute = m[2] && /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : 0;
    const meridiem = (m[3] || m[2] || '').toString().toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      time = `${pad(hour)}:${pad(minute)}`;
      text = strip(text, m);
    }
  }

  // --- Date ---
  const lower = text.toLowerCase();
  if ((m = text.match(/\btoday\b/i))) {
    date = toDateString(now); dateLabel = 'Today'; text = strip(text, m);
  } else if ((m = text.match(/\btomorrow\b/i))) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    date = toDateString(d); dateLabel = 'Tomorrow'; text = strip(text, m);
  } else if ((m = text.match(/\bin\s+(\d+)\s+day[s]?\b/i))) {
    const d = new Date(now); d.setDate(d.getDate() + parseInt(m[1], 10));
    date = toDateString(d); dateLabel = `In ${m[1]} day${m[1] === '1' ? '' : 's'}`; text = strip(text, m);
  } else if ((m = text.match(/\bin\s+(\d+)\s+week[s]?\b/i))) {
    const d = new Date(now); d.setDate(d.getDate() + parseInt(m[1], 10) * 7);
    date = toDateString(d); dateLabel = `In ${m[1]} week${m[1] === '1' ? '' : 's'}`; text = strip(text, m);
  } else if ((m = text.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    const dow = WEEKDAYS.indexOf(m[1].toLowerCase());
    const d = nextWeekday(now, dow, true);
    date = toDateString(d); dateLabel = `Next ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`; text = strip(text, m);
  } else if ((m = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    const dow = WEEKDAYS.indexOf(m[1].toLowerCase());
    const d = nextWeekday(now, dow, false);
    date = toDateString(d); dateLabel = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); text = strip(text, m);
  } else if ((m = text.match(/\bnext week\b/i))) {
    const d = new Date(now);
    const daysUntilMon = (8 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMon);
    date = toDateString(d); dateLabel = 'Next Monday'; text = strip(text, m);
  } else if ((m = text.match(/\bweekend\b/i))) {
    const d = new Date(now);
    const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    date = toDateString(d); dateLabel = 'Saturday'; text = strip(text, m);
  } else if ((m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    date = m[0]; dateLabel = m[0]; text = strip(text, m);
  } else if ((m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) {
      date = toDateString(d); dateLabel = `${month}/${day}`; text = strip(text, m);
    }
  }

  // --- Event inference: meeting/call/lunch/etc, or has a time/location and isn't a reminder ---
  if (entityType !== 'reminder') {
    if (/\b(meeting|call with|lunch|dinner|coffee with|appointment|interview|flight|catch up|standup|1:1|sync)\b/i.test(lower) || location) {
      entityType = 'event';
    }
  }

  const title = text.trim().replace(/^[,.\s]+|[,.\s]+$/g, '') || input.trim();

  return {
    title,
    entityType,
    priority,
    date,
    dateLabel,
    time,
    tags,
    location,
    repeatRule,
    repeatLabel,
    durationMinutes,
  };
}
