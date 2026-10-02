/**
 * quickAddParser.ts
 *
 * Lightweight, fully client-side natural-language parsing for the title
 * field of the Add Item form (CreateTaskModal). It runs on every keystroke,
 * so it has to be instant and work offline.
 *
 * Supported inline tokens (Todoist-style, stripped from the title once
 * recognized, together with a connector like "by" or "on" in front):
 *   #tag                     -> adds a tag (#42 is left alone)
 *   @location                -> sets location (email addresses are left alone)
 *   !urgent|high|medium|low|important  -> priority
 *   ~30m / ~2h / ~1h30m      -> duration / estimate
 *   today, tonight, tomorrow, mon..sun, this/next <weekday>, this weekend,
 *   next week, in N days/weeks, in N minutes/hours, oct 15, 15 october,
 *   12/25, 2026-01-05, the 1st                -> due date
 *   3pm, 15:30, at 3:30, noon, midnight, this morning/afternoon/evening
 *                                             -> time of day ("at 5" alone means 5 pm)
 *   every day|weekday|week|month|year, every <weekday>[, <weekday>...],
 *   mon wed fri, every N days|weeks|months, every other week,
 *   every month on the 1st, last day of every month  -> recurrence
 *   leading "remind me (to)?"                -> entityType = reminder
 *   meeting/lunch/dinner/appointment/... with a time, or @location
 *                                             -> suggests an event
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
  // The time was a bare hour ("at 5") read as am or pm by guess; timeToken is
  // the text it came from, so the form can offer to flip it.
  timeGuessed: boolean;
  timeToken: string | null;
  tags: string[];
  location: string | null;
  repeatRule: string | null;
  repeatLabel: string | null;
  durationMinutes: number | null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_WORD = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// Words that only introduce a date or time ("by friday", "on the 1st"), dropped along with it.
const CONNECTOR = '(?:(?:by|on|at|for|before|due|this|from|until|starting)\\s+)?';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayIndex(word: string): number {
  return WEEKDAYS.findIndex(d => d.startsWith(word.toLowerCase().slice(0, 3)));
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function shortDate(d: Date): string {
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()][0].toUpperCase()}${MONTHS[d.getMonth()].slice(1)}`;
}

/** Strip a matched token (with any immediately surrounding whitespace) out of the working text. */
function strip(text: string, match: RegExpMatchArray): string {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  return (text.slice(0, start) + ' ' + text.slice(end)).replace(/\s+/g, ' ').trim();
}

function validDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

/** A month/day with no year means the next time it comes round, not one already past. */
function upcoming(month: number, day: number, now: Date, year?: number): Date | null {
  if (year) return validDate(year, month, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = validDate(now.getFullYear(), month, day);
  if (d && d < today) return validDate(now.getFullYear() + 1, month, day);
  return d || validDate(now.getFullYear() + 1, month, day);
}

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  let text = input;
  const tags: string[] = [];
  let location: string | null = null;
  let priority: QuickAddPriority | null = null;
  let date: string | null = null;
  let dateLabel: string | null = null;
  let time: string | null = null;
  let timeGuessed = false;
  let timeToken: string | null = null;
  let repeatRule: string | null = null;
  let repeatLabel: string | null = null;
  let durationMinutes: number | null = null;
  let entityType: QuickAddEntityType = 'task';
  let m: RegExpMatchArray | null;

  const setDate = (d: Date, label: string) => {
    date = toDateString(d);
    dateLabel = label;
  };

  // --- Reminder prefix: "remind me to X" / "remind me about X" ---
  const remindMatch = text.match(/^\s*remind me\s*(to|about)?\s*/i);
  if (remindMatch) {
    entityType = 'reminder';
    text = text.slice(remindMatch[0].length);
  }

  // Email addresses are kept whole, so their @ isn't read as a place.
  const emails: string[] = [];
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (addr) => {
    emails.push(addr);
    return `\u0000${emails.length - 1}\u0000`;
  });
  // "@ 5pm" means "at 5pm".
  text = text.replace(/@\s*(?=\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b)/gi, 'at ');

  // --- Recurrence ---
  if ((m = text.match(/\bevery\s+weekday[s]?\b/i))) {
    repeatRule = 'weekdays'; repeatLabel = 'Every weekday'; text = strip(text, m);
  } else if ((m = text.match(new RegExp(`\\b(?:every\\s+)?${DAY_WORD}s?\\b(?:\\s*(?:,|and|&)?\\s*${DAY_WORD}s?\\b)+`, 'i')))) {
    // Two or more days: "mon wed fri", "every tue and thu".
    const days = Array.from(new Set((m[0].match(new RegExp(DAY_WORD, 'gi')) || []).map(dayIndex))).sort();
    repeatRule = `weekly:${days.join(',')}`;
    repeatLabel = `Every ${days.map(d => SHORT_DAYS[d]).join(', ')}`;
    text = strip(text, m);
  } else if ((m = text.match(new RegExp(`\\bevery\\s+${DAY_WORD}s?\\b`, 'i')))) {
    const day = dayIndex(m[1]);
    repeatRule = `weekly:${day}`;
    repeatLabel = `Every ${WEEKDAYS[day][0].toUpperCase()}${WEEKDAYS[day].slice(1)}`;
    text = strip(text, m);
  } else if ((m = text.match(/\bevery\s+other\s+(day|week|month)\b/i))) {
    repeatRule = `every:2:${m[1].toLowerCase()}s`; repeatLabel = `Every 2 ${m[1].toLowerCase()}s`; text = strip(text, m);
  } else if ((m = text.match(/\bevery\s+(\d+)\s+(day|week|month)s?\b/i))) {
    const n = parseInt(m[1], 10);
    repeatRule = `every:${n}:${m[2].toLowerCase()}s`;
    repeatLabel = n === 1 ? `Every ${m[2].toLowerCase()}` : `Every ${n} ${m[2].toLowerCase()}s`;
    text = strip(text, m);
  } else if ((m = text.match(/\b(?:on\s+)?(?:the\s+)?last\s+day\s+of\s+(?:every|each|the)\s+month\b/i)) ||
             (m = text.match(/\b(?:every|each)\s+month\s+on\s+the\s+last\s+day\b/i))) {
    repeatRule = 'monthly:last'; repeatLabel = 'Last day of the month';
    setDate(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'Month end');
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
    durationMinutes = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    text = strip(text, m);
  } else if ((m = text.match(/~\s*(\d+)\s*m(?:in(?:ute)?s?)?/i))) {
    durationMinutes = parseInt(m[1], 10);
    text = strip(text, m);
  }

  // --- Tags: #tag (repeatable). A bare number like #42 is an issue, not a tag. ---
  text = text.replace(/(^|\s)#([a-z][\w-]*)/gi, (_all, lead, tag) => {
    tags.push(tag.toLowerCase());
    return lead;
  }).replace(/\s+/g, ' ').trim();

  // --- Priority ---
  if ((m = text.match(/!(urgent|high|medium|med|low)\b/i))) {
    const p = m[1].toLowerCase();
    priority = (p === 'med' ? 'medium' : p) as QuickAddPriority;
    text = strip(text, m);
  } else if ((m = text.match(/!important\b|!!+/i))) {
    priority = 'high'; text = strip(text, m);
  } else if ((m = text.match(/\b(urgent|asap)\b/i))) {
    priority = 'urgent'; text = strip(text, m);
  } else if ((m = text.match(/\bimportant\b/i))) {
    priority = 'high'; text = strip(text, m);
  }

  // --- Relative moments: "in 2 hours", "in 30 minutes", "in an hour" ---
  if ((m = text.match(/\bin\s+(\d+|an?|half an)\s+(minute|min|hour|hr)s?\b/i))) {
    const amount = /^half/i.test(m[1]) ? 0.5 : /^an?$/i.test(m[1]) ? 1 : parseInt(m[1], 10);
    const minutes = Math.round(amount * (/^h/i.test(m[2]) ? 60 : 1));
    const at = new Date(now.getTime() + minutes * 60000);
    setDate(at, toDateString(at) === toDateString(now) ? 'Today' : 'Tomorrow');
    time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    text = strip(text, m);
  }

  // --- Time of day ---
  if (!time) {
    if ((m = text.match(new RegExp(`\\b${CONNECTOR}(noon|midday|midnight)\\b`, 'i')))) {
      time = /midnight/i.test(m[1]) ? '00:00' : '12:00';
      text = strip(text, m);
    } else if ((m = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$|[,.!?])/i)) ||
               (m = text.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})()\b/i)) ||
               (m = text.match(/\bat\s+(\d{1,2})()()\b(?!\s*(?:\/|-|%|st|nd|rd|th|minutes?|mins?|hours?|days?|weeks?))/i))) {
      let hour = parseInt(m[1], 10);
      const minute = m[2] ? parseInt(m[2], 10) : 0;
      const meridiem = (m[3] || '').replace(/\./g, '').toLowerCase();
      if (meridiem === 'pm' && hour < 12) hour += 12;
      else if (meridiem === 'am' && hour === 12) hour = 0;
      else if (!meridiem && hour >= 1 && hour <= 7) {
        // "at 5": people mean the afternoon far more often than 5 in the morning.
        hour += 12;
        timeGuessed = true;
      } else if (!meridiem && hour >= 8 && hour <= 11) {
        timeGuessed = true;
      }
      if (hour <= 23 && minute <= 59) {
        time = `${pad(hour)}:${pad(minute)}`;
        timeToken = m[0].trim();
        text = strip(text, m);
      } else {
        timeGuessed = false;
      }
    } else if ((m = text.match(/\b(?:this|in the)\s+(morning|afternoon|evening)\b/i)) ||
               (m = text.match(/(?<=\btomorrow\s+)(morning|afternoon|evening)\b/i))) {
      time = { morning: '09:00', afternoon: '14:00', evening: '18:00' }[m[1].toLowerCase() as 'morning'];
      text = strip(text, m);
    }
  }

  // --- Date ---
  if (!date) {
    if ((m = text.match(new RegExp(`\\b${CONNECTOR}today\\b`, 'i')))) {
      setDate(now, 'Today'); text = strip(text, m);
    } else if ((m = text.match(new RegExp(`\\b${CONNECTOR}tonight\\b`, 'i')))) {
      setDate(now, 'Tonight'); text = strip(text, m);
      if (!time) time = '20:00';
    } else if ((m = text.match(new RegExp(`\\b${CONNECTOR}tomorrow\\b`, 'i')))) {
      const d = new Date(now); d.setDate(d.getDate() + 1);
      setDate(d, 'Tomorrow'); text = strip(text, m);
    } else if ((m = text.match(new RegExp(`\\b${CONNECTOR}in\\s+(\\d+|a)\\s+(day|week|month)s?\\b`, 'i')))) {
      const n = m[1].toLowerCase() === 'a' ? 1 : parseInt(m[1], 10);
      const d = new Date(now);
      if (/^m/i.test(m[2])) d.setMonth(d.getMonth() + n);
      else d.setDate(d.getDate() + n * (/^w/i.test(m[2]) ? 7 : 1));
      setDate(d, `In ${n} ${m[2].toLowerCase()}${n === 1 ? '' : 's'}`); text = strip(text, m);
    } else if ((m = text.match(new RegExp(`\\b${CONNECTOR}(?:this\\s+)?weekend\\b`, 'i')))) {
      const d = new Date(now);
      d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
      setDate(d, d.getDay() === now.getDay() ? 'Today' : 'Saturday'); text = strip(text, m);
    } else if ((m = text.match(new RegExp(`\\b${CONNECTOR}next\\s+week\\b`, 'i')))) {
      const d = new Date(now);
      d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
      setDate(d, 'Next Monday'); text = strip(text, m);
    } else if ((m = text.match(new RegExp(`\\b${CONNECTOR}(this|next)\\s+${DAY_WORD}\\b`, 'i'))) ||
               (m = text.match(new RegExp(`\\b${CONNECTOR}()(sunday|monday|tuesday|wednesday|thursday|friday|saturday|mon|tues?|wed|thu|thurs?|fri)\\b`, 'i'))) ||
               // "sat" and "sun" are also words, so only with a connector or at the very end.
               (m = text.match(new RegExp(`\\b(?:(?:by|on|this|until|before)\\s+)?()(sat|sun)$`, 'i'))) ||
               (m = text.match(new RegExp(`\\b(?:by|on|this|until|before)\\s+()(sat|sun)\\b`, 'i')))) {
      const target = dayIndex(m[2]);
      const d = new Date(now);
      let diff = (target - d.getDay() + 7) % 7;
      // Today's own weekday means today, unless "next" was said or the time has passed.
      const passed = time && diff === 0 && time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if (diff === 0 && (m[1]?.toLowerCase() === 'next' || passed)) diff = 7;
      d.setDate(d.getDate() + diff);
      const name = WEEKDAYS[target][0].toUpperCase() + WEEKDAYS[target].slice(1);
      setDate(d, diff === 0 ? 'Today' : m[1]?.toLowerCase() === 'next' ? `Next ${name}` : name);
      text = strip(text, m);
    } else if ((m = text.match(/\b(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/))) {
      const d = validDate(+m[1], +m[2], +m[3]);
      if (d) { setDate(d, shortDate(d)); text = strip(text, m); }
    } else if ((m = text.match(new RegExp(`\\b${CONNECTOR}${MONTH_WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'))) ||
               (m = text.match(new RegExp(`\\b${CONNECTOR}(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORD}\\b(?:,?\\s+(\\d{4}))?`, 'i')))) {
      const monthFirst = isNaN(parseInt(m[1], 10));
      const month = MONTHS.indexOf((monthFirst ? m[1] : m[2]).slice(0, 3).toLowerCase()) + 1;
      const day = parseInt(monthFirst ? m[2] : m[1], 10);
      const d = upcoming(month, day, now, m[3] ? parseInt(m[3], 10) : undefined);
      if (d) { setDate(d, shortDate(d)); text = strip(text, m); }
    } else if ((m = text.match(/\b(?:by|on|due)?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b(?!\s*(?:cups?|batch|tsp|tbsp|inch|of\b))/i))) {
      let year = m[3] ? parseInt(m[3], 10) : undefined;
      if (year && year < 100) year += 2000;
      const d = upcoming(parseInt(m[1], 10), parseInt(m[2], 10), now, year);
      if (d) { setDate(d, shortDate(d)); text = strip(text, m); }
    } else if ((m = text.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i))) {
      // "on the 1st": the next 1st; with "every month" it also sets the day it repeats on.
      const day = parseInt(m[1], 10);
      let d = validDate(now.getFullYear(), now.getMonth() + 1, day);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (!d || d < today) d = validDate(now.getFullYear(), now.getMonth() + 2, day) || new Date(now.getFullYear(), now.getMonth() + 2, 0);
      if (day >= 1 && day <= 31) {
        setDate(d, `The ${ordinal(day)}`); text = strip(text, m);
        if (repeatRule === 'monthly') repeatLabel = `Monthly on the ${ordinal(day)}`;
      }
    }
  }

  // A weekly rule starts on its next such day when no date was given.
  if (!date && repeatRule?.startsWith('weekly:')) {
    const days = repeatRule.slice(7).split(',').map(Number);
    const d = new Date(now);
    const passed = time && time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (passed) d.setDate(d.getDate() + 1);
    while (!days.includes(d.getDay())) d.setDate(d.getDate() + 1);
    date = toDateString(d);
  }

  // A time with no day means the next time that clock time comes round.
  if (!date && time) {
    const d = new Date(now);
    if (time <= `${pad(now.getHours())}:${pad(now.getMinutes())}`) d.setDate(d.getDate() + 1);
    setDate(d, toDateString(d) === toDateString(now) ? 'Today' : 'Tomorrow');
  }

  // Every weekday starts on a weekday.
  if (date && repeatRule === 'weekdays') {
    const d = new Date(`${date}T00:00`);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    setDate(d, shortDate(d));
  }

  // --- Location: @location (after dates/times, so "@office tomorrow 9am" keeps the date) ---
  if ((m = text.match(/@([\w][\w .'-]*)/))) {
    location = m[1].trim();
    text = strip(text, m);
    entityType = entityType === 'reminder' ? entityType : 'event';
  }

  // --- Event suggestion: an appointment-like word with a time, or a place ---
  if (entityType !== 'reminder' && time &&
      /\b(meeting|call with|lunch|dinner|breakfast|coffee with|appointment|appt|interview|flight|standup|catch up with)\b/i.test(text)) {
    entityType = 'event';
  }

  // Put email addresses back, then drop connectors and stray symbols left at the edges.
  text = text.replace(/\u0000(\d+)\u0000/g, (_all, i) => emails[Number(i)]);
  // "remind me in 2 hours to stretch": the "to" ends up in front.
  if (entityType === 'reminder') text = text.replace(/^\s*(?:to|about)\s+/i, '');
  text = text
    .replace(/\s+[@!]+(?=\s|$)/g, '')
    .replace(/(?:\s+(?:by|on|at|for|before|due|this|next|from|until|in|the))+\s*$/i, '')
    .replace(/^\s*(?:on|at|by)\s+/i, '');

  const title = text.trim().replace(/^[,.\s]+|[,.\s]+$/g, '') || input.trim();

  return {
    title,
    entityType,
    priority,
    date,
    dateLabel,
    time,
    timeGuessed,
    timeToken,
    tags,
    location,
    repeatRule,
    repeatLabel,
    durationMinutes,
  };
}

/** The same text with a guessed time's am/pm made explicit the other way round ("at 5" -> "at 5am"). */
export function flipGuessedTime(input: string, result: QuickAddResult): string {
  if (!result.timeGuessed || !result.timeToken || !result.time) return input;
  const isPm = parseInt(result.time, 10) >= 12;
  return input.replace(result.timeToken, `${result.timeToken}${isPm ? 'am' : 'pm'}`);
}

/** "Sat 3 Oct" for a YYYY-MM-DD string. */
export function formatShortDate(dateKey: string): string {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return shortDate(new Date(y, mo - 1, d));
}
