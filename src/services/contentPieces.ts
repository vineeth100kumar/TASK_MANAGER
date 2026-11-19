// contentPieces - the shape the Pipeline and the Week calendar share: a post or reel as one
// "piece", the column it sits in, and the date helpers.
import type { Post } from './posts';
import type { Reel } from './reels';

export type Kind = 'post' | 'reel';
export type Piece = { kind: Kind; id: string; title: string; status: string; scheduledFor: string | null; posted: boolean; archived: boolean; projectId: string | null; createdAt: string };
export type ColumnId = 'idea' | 'script' | 'drafting' | 'ready' | 'scheduled' | 'posted';

/** The Pi starts drawing a planned piece this long before its slot (content_schedule.py, LEAD_MINUTES). */
export const LEAD_MINUTES = 60;

const DRAFTING = new Set(['waiting', 'queued', 'running', 'failed']);

export function columnOf(p: Piece): ColumnId {
  if (DRAFTING.has(p.status)) return 'drafting';
  if (p.posted) return 'posted';
  return p.scheduledFor ? 'scheduled' : 'ready';
}

export const toPiece = (kind: Kind, x: Post | Reel): Piece => ({
  kind, id: x.id, title: x.title, status: x.status, scheduledFor: x.scheduledFor || null,
  posted: x.posted, archived: Boolean(x.archived), projectId: x.projectId, createdAt: x.createdAt,
});

/** "Mon 24 Nov, 9:00 AM" from an ISO time, in the viewer's time zone. */
export function whenText(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** The value a datetime-local input wants (local time, no zone) for an ISO time. */
export function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 24 * 3600_000);
  if (!iso) d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


/** Monday of the week that holds `d`, at local midnight. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

/** The ISO time for `day`, keeping `from`'s time of day (9:00 when it has none). */
export function moveToDay(day: Date, from: string | null): string {
  const out = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
  if (from) {
    const f = new Date(from);
    out.setHours(f.getHours(), f.getMinutes(), 0, 0);
  }
  return out.toISOString();
}


/** When the Pi will start drawing a planned piece: an hour before its slot. */
export function drawAtText(iso: string): string {
  const d = new Date(new Date(iso).getTime() - LEAD_MINUTES * 60_000);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export interface ContentCounts { drafting: number; ready: number; scheduled: number; posted: number; weekScheduled: number }

/** How a project's posts and reels stand: per column, and how many are due to go live in the week of `now` (Monday to Sunday). */
export function countPieces(pieces: Piece[], now: Date = new Date()): ContentCounts {
  const out: ContentCounts = { drafting: 0, ready: 0, scheduled: 0, posted: 0, weekScheduled: 0 };
  const from = weekStart(now).getTime();
  const to = from + 7 * 24 * 3600_000;
  for (const p of pieces) {
    if (p.archived) continue;
    const col = columnOf(p);
    if (col === 'drafting' || col === 'ready' || col === 'scheduled' || col === 'posted') out[col] += 1;
    if (col === 'scheduled' && p.scheduledFor) {
      const t = new Date(p.scheduledFor).getTime();
      if (t >= from && t < to) out.weekScheduled += 1;
    }
  }
  return out;
}
