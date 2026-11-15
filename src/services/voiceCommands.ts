// voiceCommands.ts - Turns what you say into a LUMO action.
//
// Speech comes from the browser's own microphone (the phone's on a phone, the
// laptop's on a laptop). Saying "Sage" first means a command follows. This file
// is the plain-rules half: text in, a command out, no network and no AI, so it
// is quick and testable. Start small: alarms and timers for the LUMO clock.

import { LumoAlarm, lumoApi, clockText } from './lumo';
import { piBackendUrl, piHeaders } from './piBackend';

export type VoiceCommand =
  | { kind: 'alarm_set'; time: string; days: number[]; label: string }
  | { kind: 'alarm_cancel' | 'alarm_off' | 'alarm_on'; time: string | null; all: boolean }
  | { kind: 'ring'; action: 'stop' | 'snooze' }
  | { kind: 'timer_start'; seconds: number }
  | { kind: 'timer'; action: 'pause' | 'resume' | 'cancel' }
  | { kind: 'timer_add'; seconds: number };

export interface VoiceResult { ok: boolean; say: string }

// ---- wake word -------------------------------------------------------------

// What speech recognition writes when someone says "Sage": the real word, its
// sound-alikes, and the usual mishearings (accents included).
const WAKE_WORDS = new Set([
  'sage', "sage's", 'sages', 'sedge', 'saj', 'sayj', 'sej', 'sayge', 'saige', 'saeg', 'sagay',
  'sayage', 'sheikh', 'sage.', 'say', 'says', "say's", 'stage', 'sagen', 'sagg', 'sag', 'sach',
  'sa', 'sedj', 'saage', 'sayg', 'siege', 'sagë',
]);
// Said before "Sage": still counts as the wake word being first.
const LEAD_INS = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'oh', 'um', 'uh', 'so', 'yo', 'hey,', 'ok,']);

// What follows "Sage": the command text, or null when the wake word wasn't said.
// `''` means "Sage" alone: a command is coming next. The word may follow a lead-in
// ("hey", "okay") and be spelled any of the ways the recogniser mishears it.
export function afterWakeWord(text: string): string | null {
  const words = text.trim().split(/\s+/);
  for (let i = 0; i < Math.min(words.length, 3); i++) {
    const w = words[i].toLowerCase().replace(/^[^a-zë']+|[^a-zë']+$/g, '');
    if (WAKE_WORDS.has(w)) {
      // "say" and "stage" are real words: only a wake word when nothing but lead-ins come before them.
      if (/^(say|says|stage|sa|sag|siege)$/.test(w) && i > 1) return null;
      return words.slice(i + 1).join(' ').replace(/^[\s,.:!-]+/, '').trim();
    }
    if (!LEAD_INS.has(w)) return null;
  }
  return null;
}

// ---- numbers and time ------------------------------------------------------

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
};

// "twenty five" -> 25, "seven thirty" -> "7 30", "a" / "an" -> 1.
function numberWords(s: string): string {
  const words = s.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const tens = ONES[w];
    if (tens !== undefined && tens >= 20 && tens % 10 === 0 && ONES[words[i + 1]] !== undefined && ONES[words[i + 1]] >= 1 && ONES[words[i + 1]] <= 9) {
      out.push(String(tens + ONES[words[i + 1]])); i++;
    } else if (tens !== undefined) out.push(String(tens));
    else out.push(w);
  }
  return out.join(' ');
}

function clean(raw: string): string {
  let t = ` ${raw.toLowerCase()} `
    .replace(/[,!?]/g, ' ')
    .replace(/\ba\.m\.?/g, 'am').replace(/\bp\.m\.?/g, 'pm')
    .replace(/\bo'?clock\b/g, ' ')
    .replace(/\b(\d{1,2})\s*(am|pm)\b/g, '$1 $2')
    .replace(/\s+/g, ' ');
  t = numberWords(t.trim());
  return ` ${t} `;
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

// The next time the clock face h:m comes round, when no am/pm was said.
function nextOccurrence(h: number, m: number, now: Date): number {
  const mins = (hh: number) => hh * 60 + m;
  const cur = now.getHours() * 60 + now.getMinutes();
  if (h > 12 || h === 0) return h % 24; // 24-hour already
  const candidates = [h % 12, (h % 12) + 12];
  const ahead = candidates.map(c => ((mins(c) - cur) + 1440) % 1440 || 1440);
  return candidates[ahead[0] <= ahead[1] ? 0 : 1];
}

// "7 30 pm", "7:30", "half past six", "quarter to 8", "in 20 minutes", "noon" -> "19:30".
export function parseClock(t: string, now = new Date()): string | null {
  const rel = t.match(/\bin (\d+|an|a) ?(hour|hr|minute|min)s?(?: and (?:a )?(half|\d+ ?(?:minute|min)s?))?/);
  if (rel) {
    const n = rel[1] === 'a' || rel[1] === 'an' ? 1 : Number(rel[1]);
    let mins = /^h/.test(rel[2]) ? n * 60 : n;
    if (rel[3]) mins += rel[3] === 'half' ? 30 : parseInt(rel[3], 10);
    const d = new Date(now.getTime() + mins * 60000);
    return hhmm(d.getHours(), d.getMinutes());
  }
  if (/\bnoon\b|\bmidday\b/.test(t)) return '12:00';
  if (/\bmidnight\b/.test(t)) return '00:00';
  let m: RegExpMatchArray | null = t.match(/\bhalf past (\d{1,2})\b/);
  if (m) return fix(Number(m[1]), 30, t, now);
  m = t.match(/\bquarter (past|to) (\d{1,2})\b/);
  if (m) return m[1] === 'past' ? fix(Number(m[2]), 15, t, now) : fix((Number(m[2]) + 11) % 12 || 12, 45, t, now);
  const re = /\b(\d{1,2})(?:[: .](\d{2}))? ?(am|pm)?\b/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(t))) {
    const after = t.slice(re.lastIndex).trimStart();
    if (/^(min|hour|hr|sec|day|week|time|alarm)/.test(after) && !hit[3] && !hit[2]) continue;
    if (hit[2] === undefined && hit[3] === undefined && !/\b(at|for|to|wake me up|alarm)\s*$/.test(t.slice(0, hit.index))) continue;
    const h = Number(hit[1]), min = hit[2] ? Number(hit[2]) : 0;
    if (h > 24 || min > 59) continue;
    if (hit[3]) return hhmm(h % 12 + (hit[3] === 'pm' ? 12 : 0), min);
    return fix(h, min, t, now);
  }
  return null;
}

// "morning" / "evening" / "night" settle am/pm; otherwise the next time it comes round.
function fix(h: number, m: number, t: string, now: Date): string {
  if (h > 12) return hhmm(h % 24, m);
  if (/\b(morning|am)\b/.test(t)) return hhmm(h % 12, m);
  if (/\b(afternoon|evening|tonight|night|pm)\b/.test(t)) return hhmm((h % 12) + 12, m);
  return hhmm(nextOccurrence(h, m, now), m);
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function parseDays(t: string): number[] {
  if (/\bevery ?day\b|\bdaily\b|\beach day\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  if (/\bweekdays?\b|\bwork ?days?\b|\bmonday (?:to|through|till) friday\b/.test(t)) return [0, 1, 2, 3, 4];
  if (/\bweekends?\b/.test(t)) return [5, 6];
  const out: number[] = [];
  DAYS.forEach((d, i) => { if (new RegExp(`\\b${d}s?\\b|\\b${d.slice(0, 3)}\\b`).test(t) && /\b(every|each|on|and)\b/.test(t)) out.push(i); });
  return out;
}

// Spoken length: "10 minutes", "1 hour 30 minutes", "an hour and a half", "half an hour", "90 seconds".
export function parseDuration(t: string): number | null {
  if (/\bhalf an? hour\b/.test(t)) return 1800;
  if (/\bquarter of an hour\b/.test(t)) return 900;
  let total = 0, found = false;
  const re = /(\d+(?:\.\d+)?|an?|half) ?(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(?: and a half)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const qty = m[1] === 'a' || m[1] === 'an' ? 1 : m[1] === 'half' ? 0.5 : Number(m[1]);
    const unit = m[2][0];
    const secs = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
    total += qty * secs + (/and a half/.test(m[0]) ? secs / 2 : 0);
    found = true;
  }
  if (!found) {
    const bare = t.match(/\b(?:for|of) (\d+)\b/);   // "timer for 10" means minutes
    if (bare) return Number(bare[1]) * 60;
    return null;
  }
  return Math.round(total);
}

// ---- the command -----------------------------------------------------------

export function parseVoice(raw: string, now = new Date()): VoiceCommand | null {
  const t = clean(raw);
  const has = (re: RegExp) => re.test(t);

  // The clock is ringing right now: stop / snooze.
  if (has(/\bsnooze\b/)) return { kind: 'ring', action: 'snooze' };
  if (has(/\b(stop|dismiss|silence|quiet|shut up)\b/) && !has(/\btimer\b/)) return { kind: 'ring', action: 'stop' };

  if (has(/\btimers?\b/) || (has(/\b(start|set)\b/) && parseDuration(t) && !has(/\balarm|wake\b/))) {
    if (has(/\b(cancel|delete|remove|clear|stop|reset|end|kill)\b/)) return { kind: 'timer', action: 'cancel' };
    if (has(/\bpause\b|\bhold\b/)) return { kind: 'timer', action: 'pause' };
    if (has(/\b(resume|continue|restart|carry on|unpause)\b/)) return { kind: 'timer', action: 'resume' };
    const secs = parseDuration(t);
    if (has(/\badd\b|\bextend\b|\bmore\b|\bextra\b/) && secs) return { kind: 'timer_add', seconds: secs };
    if (secs) return { kind: 'timer_start', seconds: secs };
    return null;
  }

  if (has(/\b(alarms?|wake me)\b/)) {
    const all = has(/\b(all|every|my) alarms\b/) && !has(/\bevery (day|weekday)\b/);
    const time = parseClock(t, now);
    if (has(/\b(cancel|delete|remove|clear|get rid of)\b/)) return { kind: 'alarm_cancel', time, all };
    if (has(/\b(turn off|switch off|disable|stop|pause|skip)\b/)) return { kind: 'alarm_off', time, all };
    if (has(/\b(turn on|switch on|enable|resume)\b/)) return { kind: 'alarm_on', time, all };
    if (time) {
      const label = raw.match(/\b(?:called|named|labell?ed|label)\s+(.+?)(?:\s+(?:at|for|every|on)\b.*)?$/i)?.[1]?.trim() || '';
      return { kind: 'alarm_set', time, days: parseDays(t), label };
    }
    return null;
  }
  return null;
}

// ---- doing it --------------------------------------------------------------

const say = (s: number): string => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = [h && `${h} hour${h > 1 ? 's' : ''}`, m && `${m} minute${m > 1 ? 's' : ''}`, sec && `${sec} second${sec > 1 ? 's' : ''}`].filter(Boolean);
  return parts.join(' ') || '0 seconds';
};

// Alarms that match a spoken time (all of them when none was said).
function pick(alarms: LumoAlarm[], time: string | null): LumoAlarm[] {
  if (!time) return alarms;
  const same = alarms.filter(a => a.time === time);
  if (same.length) return same;
  // "cancel the 7 alarm" with no am/pm: either side of the day is fine.
  const [h, m] = time.split(':').map(Number);
  return alarms.filter(a => { const [ah, am] = a.time.split(':').map(Number); return am === m && ah % 12 === h % 12; });
}

export async function runVoice(cmd: VoiceCommand, hour24 = false): Promise<VoiceResult> {
  const at = (t: string) => clockText(t, hour24) + (hour24 ? '' : ` ${Number(t.split(':')[0]) >= 12 ? 'PM' : 'AM'}`);
  try {
    switch (cmd.kind) {
      case 'alarm_set': {
        const a = await lumoApi.createAlarm({ time: cmd.time, days: cmd.days, label: cmd.label || 'Alarm', enabled: true });
        return { ok: true, say: `Alarm set for ${at(a.time)}.` };
      }
      case 'alarm_cancel': case 'alarm_off': case 'alarm_on': {
        const all = await lumoApi.alarms();
        const hit = pick(all, cmd.time);
        if (!hit.length) return { ok: false, say: cmd.time ? `I couldn't find an alarm at ${at(cmd.time)}.` : 'You have no alarms.' };
        if (!cmd.time && !cmd.all && hit.length > 1) return { ok: false, say: 'Which alarm? Say the time, like "cancel the 7 AM alarm".' };
        if (cmd.kind === 'alarm_cancel') {
          for (const a of hit) await lumoApi.deleteAlarm(a.id);
          return { ok: true, say: hit.length === 1 ? `Cancelled the ${at(hit[0].time)} alarm.` : `Cancelled ${hit.length} alarms.` };
        }
        const on = cmd.kind === 'alarm_on';
        for (const a of hit) await lumoApi.updateAlarm(a.id, { enabled: on });
        return { ok: true, say: hit.length === 1 ? `The ${at(hit[0].time)} alarm is ${on ? 'on' : 'off'}.` : `${hit.length} alarms ${on ? 'on' : 'off'}.` };
      }
      case 'ring': {
        const st = await lumoApi.status();
        if (!st.state?.ringing) return { ok: false, say: 'Nothing is ringing.' };
        await lumoApi.ringing(cmd.action);
        return { ok: true, say: cmd.action === 'snooze' ? 'Snoozed.' : 'Stopped.' };
      }
      case 'timer_start':
        await lumoApi.timer('start', cmd.seconds);
        return { ok: true, say: `Timer set for ${say(cmd.seconds)}.` };
      case 'timer_add':
        await lumoApi.timer('add', cmd.seconds);
        return { ok: true, say: `Added ${say(cmd.seconds)}.` };
      case 'timer':
        await lumoApi.timer(cmd.action);
        return { ok: true, say: cmd.action === 'cancel' ? 'Timer cancelled.' : cmd.action === 'pause' ? 'Timer paused.' : 'Timer running.' };
    }
  } catch (e: any) {
    return { ok: false, say: e?.message || 'LUMO did not answer.' };
  }
}

// Herald (the Pi's soundbar voice) confirms a command that was carried out, in
// Alfred/Jarvis words Groq writes. Returns what it said, or null when the Pi has
// no speaker, so the caller can speak it in the browser instead.
export async function heraldConfirms(what: string): Promise<string | null> {
  try {
    const res = await fetch(`${piBackendUrl()}/api/speaker/announce`, {
      method: 'POST', headers: piHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ what }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.text === 'string' ? data.text : null;
  } catch {
    return null;
  }
}
