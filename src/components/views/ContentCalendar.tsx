// ContentCalendar - a week of scheduled posts and reels. For one content project, for no
// project (NO_PROJECT), or (no projectId) for every project. Drag a card to another day to move it (the time of day is
// kept); drag one from "Ready, not scheduled" onto a day to schedule it at 9:00.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Clapperboard, GalleryHorizontal } from 'lucide-react';
import { Post, postsApi, postsAvailable, POST_EVENT, openPosts } from '../../services/posts';
import { Reel, reelsApi, reelsAvailable, REEL_EVENT, openReels } from '../../services/reels';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { Piece, columnOf, inScope, isApproved, moveToDay, scopeProjectId, toLocalInput, toPiece, weekStart, whenText } from '../../services/contentPieces';

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const timeText = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function ContentCalendar({ projectId = '' }: { projectId?: string }) {
  const { showToast } = useToast();
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [error, setError] = useState('');
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [view, setView] = useState<'week' | 'month'>('week');
  const [month, setMonth] = useState(() => new Date());
  const [dragged, setDragged] = useState<Piece | null>(null);
  const [over, setOver] = useState('');
  const [picking, setPicking] = useState<{ piece: Piece; value: string } | null>(null);

  const projects = (api.sync.getState().projects.filter(Boolean) as Project[]);
  const nameOf = (id: string | null) => projects.find(p => p.id === id)?.name || '';

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        postsAvailable() ? postsApi.list(scopeProjectId(projectId), false).then(d => d.posts) : Promise.resolve([] as Post[]),
        reelsAvailable() ? reelsApi.list(scopeProjectId(projectId), false).then(d => d.reels) : Promise.resolve([] as Reel[]),
      ]);
      setPieces([...p.map(x => toPiece('post', x)), ...r.map(x => toPiece('reel', x))].filter(x => !x.archived && inScope(x.projectId, projectId)));
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    window.addEventListener(POST_EVENT, onEvent);
    window.addEventListener(REEL_EVENT, onEvent);
    return () => { clearTimeout(timer); window.removeEventListener(POST_EVENT, onEvent); window.removeEventListener(REEL_EVENT, onEvent); };
  }, [load]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; }), [start]);
  const today = dayKey(new Date());

  // Month grid: Monday-first, only the weeks the month needs.
  const monthCells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((lead + total) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i - lead + 1));
  }, [month]);

  // Week plans upcoming (approved, not yet posted); Month audits (approved, posted too).
  const approved = (pieces || []).filter(isApproved);
  const byDay = useMemo(() => {
    const map = new Map<string, Piece[]>();
    for (const p of pieces || []) {
      if (!p.scheduledFor) continue;
      // Week: approved and not yet posted (planning). Month: the same, plus everything posted (audit).
      const show = view === 'week' ? (isApproved(p) && !p.posted) : (isApproved(p) || p.posted);
      if (!show) continue;
      const k = dayKey(new Date(p.scheduledFor));
      map.set(k, [...(map.get(k) || []), p]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));
    return map;
  }, [pieces, view]);
  const unscheduled = approved.filter(p => columnOf(p) === 'ready');
  const weekCount = days.reduce((n, d) => n + (byDay.get(dayKey(d)) || []).filter(p => !p.posted).length, 0);
  const monthCount = monthCells.reduce((n, d) => n + (d.getMonth() === month.getMonth() ? (byDay.get(dayKey(d)) || []).length : 0), 0);

  const schedule = async (p: Piece, at: string) => {
    try {
      await (p.kind === 'post' ? postsApi.schedule(p.id, at) : reelsApi.schedule(p.id, at));
      showToast(`Scheduled for ${whenText(at)}`);
      await load();
    } catch (e: any) {
      showToast(e.message || 'Could not schedule that', 'error');
    }
  };

  // The datetime-local value for a given day, keeping the piece's own time, else 9:00.
  const dayValue = (day: Date, from: string | null) => {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
    if (from) { const f = new Date(from); d.setHours(f.getHours(), f.getMinutes()); }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const drop = async (day: Date) => {
    const p = dragged;
    setDragged(null); setOver('');
    if (!p || p.posted) return;
    // Already has a time: just move the day, keep the time. No time yet: ask for it, no 9 AM guess.
    if (p.scheduledFor) await schedule(p, moveToDay(day, p.scheduledFor));
    else setPicking({ piece: p, value: dayValue(day, null) });
  };

  const confirmPick = async () => {
    if (!picking) return;
    const when = new Date(picking.value);
    if (isNaN(when.getTime())) { showToast('Pick a date and time', 'error'); return; }
    const { piece } = picking;
    setPicking(null);
    await schedule(piece, when.toISOString());
  };

  const open = (p: Piece) => (p.kind === 'post' ? openPosts({ postId: p.id }) : openReels({ reelId: p.id }));
  const range = `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  const card = (p: Piece) => {
    const Icon = p.kind === 'post' ? GalleryHorizontal : Clapperboard;
    return (
      <div key={p.kind + p.id} draggable={!p.posted}
        onDragStart={e => { setDragged(p); e.dataTransfer.setData('text/plain', p.id); }} onDragEnd={() => { setDragged(null); setOver(''); }}
        className={`surface-item p-2.5 rounded-xl ${p.posted ? 'opacity-50' : 'cursor-grab active:cursor-grabbing'}`}>
        <button type="button" onClick={() => open(p)} className="block text-left w-full">
          <span className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
            <Icon size={11} /> {p.kind}{p.scheduledFor ? ` · ${timeText(p.scheduledFor)}` : ''}{p.posted ? ' · posted' : ''}
          </span>
          <span className="block mt-1 text-[13px] font-semibold leading-snug line-clamp-2">{p.title}</span>
          {!projectId && nameOf(p.projectId) && <span className="block mt-0.5 text-[11px] text-gray-500 truncate">{nameOf(p.projectId)}</span>}
        </button>
        {!p.posted && (
          <button type="button" onClick={() => setPicking({ piece: p, value: toLocalInput(p.scheduledFor) })}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline">
            <CalendarClock size={11} /> {p.scheduledFor ? 'Change time' : 'Set time'}
          </button>
        )}
      </div>
    );
  };

  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Month cell: a tiny read-only chip. Posted shows a dot; upcoming shows its time.
  const miniCard = (p: Piece) => {
    const tint = p.kind === 'post' ? 'text-pink-600 dark:text-pink-300' : 'text-rose-600 dark:text-rose-300';
    return (
      <button key={p.kind + p.id} type="button" onClick={() => open(p)} title={`${p.title}${p.scheduledFor ? ' · ' + timeText(p.scheduledFor) : ''}`}
        className={`w-full flex items-center gap-1 text-left text-[10.5px] font-semibold px-1 py-[2px] rounded truncate ${p.posted ? 'text-gray-400 line-through' : tint}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.kind === 'post' ? 'bg-pink-500' : 'bg-rose-500'} ${p.posted ? 'opacity-40' : ''}`} />
        <span className="truncate">{p.title}</span>
      </button>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {view === 'week' ? (<>
          <button type="button" aria-label="Previous week" onClick={() => setStart(s => { const d = new Date(s); d.setDate(d.getDate() - 7); return d; })} className="h-9 w-9 rounded-xl bg-black/[0.05] dark:bg-white/10 flex items-center justify-center"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setStart(weekStart(new Date()))} className="h-9 px-3 rounded-xl bg-black/[0.05] dark:bg-white/10 text-[13px] font-semibold">This week</button>
          <button type="button" aria-label="Next week" onClick={() => setStart(s => { const d = new Date(s); d.setDate(d.getDate() + 7); return d; })} className="h-9 w-9 rounded-xl bg-black/[0.05] dark:bg-white/10 flex items-center justify-center"><ChevronRight size={16} /></button>
          <h3 className="text-[15px] font-semibold ml-1">{range}</h3>
          <span className="text-[12.5px] text-gray-500">{weekCount ? `${weekCount} to post` : 'Nothing scheduled this week'}</span>
        </>) : (<>
          <button type="button" aria-label="Previous month" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="h-9 w-9 rounded-xl bg-black/[0.05] dark:bg-white/10 flex items-center justify-center"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setMonth(new Date())} className="h-9 px-3 rounded-xl bg-black/[0.05] dark:bg-white/10 text-[13px] font-semibold">This month</button>
          <button type="button" aria-label="Next month" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="h-9 w-9 rounded-xl bg-black/[0.05] dark:bg-white/10 flex items-center justify-center"><ChevronRight size={16} /></button>
          <h3 className="text-[15px] font-semibold ml-1">{monthLabel}</h3>
          <span className="text-[12.5px] text-gray-500">{monthCount ? `${monthCount} this month` : 'Nothing this month'}</span>
        </>)}
        <div className="flex rounded-xl bg-black/[0.05] dark:bg-white/10 p-0.5 ml-auto" role="group" aria-label="Calendar view">
          {(['week', 'month'] as const).map(v => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`h-8 px-3 rounded-[10px] text-[12.5px] font-semibold capitalize ${view === v ? 'bg-white dark:bg-[#2c2c2e] shadow-sm' : 'text-gray-500'}`}>{v}</button>
          ))}
        </div>
      </div>
      {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

      {view === 'week' ? (<>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-7">
          {days.map(d => {
            const k = dayKey(d);
            const list = byDay.get(k) || [];
            return (
              <div key={k} onDragOver={e => { if (dragged) { e.preventDefault(); setOver(k); } }} onDrop={e => { e.preventDefault(); drop(d); }}
                className={`rounded-2xl p-2 min-h-[120px] md:min-h-[260px] surface border ${over === k ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/10' : k === today ? 'border-sky-300 dark:border-sky-500/50' : 'border-black/5 dark:border-white/5'}`}>
                <p className={`text-[12px] font-semibold mb-2 px-1 ${k === today ? 'text-sky-600 dark:text-sky-400' : 'text-gray-500'}`}>
                  {d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                </p>
                <div className="flex flex-col gap-2">{list.map(card)}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-5">
          <h4 className="flex items-center gap-1.5 text-[13px] font-semibold mb-2"><CalendarClock size={14} className="text-emerald-500" /> Ready, not scheduled <span className="text-gray-400 tabular-nums">{unscheduled.length}</span></h4>
          {unscheduled.length === 0
            ? <p className="text-[12.5px] text-gray-400">Nothing waiting. Approved posts and reels with no date show up here; drag one onto a day.</p>
            : <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">{unscheduled.map(card)}</div>}
        </div>
      </>) : (
        <div className="surface-item rounded-2xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-black/5 dark:border-white/5">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="py-2 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-[0.08em]">{d[0]}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthCells.map((d, i) => {
              const k = dayKey(d);
              const list = byDay.get(k) || [];
              const inMonth = d.getMonth() === month.getMonth();
              return (
                <div key={i} className={`min-h-[84px] p-1 border-b border-r border-black/5 dark:border-white/5 ${(i + 1) % 7 === 0 ? 'border-r-0' : ''} ${inMonth ? '' : 'opacity-40'}`}>
                  <p className={`text-[11px] font-semibold mb-1 px-1 ${k === today ? 'text-sky-600 dark:text-sky-400' : 'text-gray-400'}`}>{d.getDate()}</p>
                  <div className="flex flex-col gap-1">{list.map(miniCard)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setPicking(null)}>
          <div className="w-full max-w-xs surface rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h4 className="text-[14px] font-semibold">When should it post?</h4>
            <p className="text-[12.5px] text-gray-500 line-clamp-2">{picking.piece.title}</p>
            <input type="datetime-local" value={picking.value} autoFocus
              onChange={e => setPicking({ ...picking, value: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') confirmPick(); }}
              className="field w-full" />
            <p className="text-[12px] text-gray-500">You get a reminder at this time (push, email and Herald) and once more next morning if it is not marked posted.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPicking(null)} className="h-9 px-3 rounded-xl text-[13px] font-semibold bg-black/[0.05] dark:bg-white/10">Cancel</button>
              <button type="button" onClick={confirmPick} className="h-9 px-3 rounded-xl text-[13px] font-semibold bg-sky-600 text-white">Set time</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
