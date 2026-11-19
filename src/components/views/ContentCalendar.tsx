// ContentCalendar - a week of scheduled posts and reels. For one content project, or (no
// projectId) for every project. Drag a card to another day to move it (the time of day is
// kept); drag one from "Ready, not scheduled" onto a day to schedule it at 9:00.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Clapperboard, GalleryHorizontal } from 'lucide-react';
import { Post, postsApi, postsAvailable, POST_EVENT, openPosts } from '../../services/posts';
import { Reel, reelsApi, reelsAvailable, REEL_EVENT, openReels } from '../../services/reels';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { Piece, columnOf, moveToDay, toPiece, weekStart, whenText } from '../../services/contentPieces';

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const timeText = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function ContentCalendar({ projectId = '' }: { projectId?: string }) {
  const { showToast } = useToast();
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [error, setError] = useState('');
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [dragged, setDragged] = useState<Piece | null>(null);
  const [over, setOver] = useState('');

  const projects = (api.sync.getState().projects.filter(Boolean) as Project[]);
  const nameOf = (id: string | null) => projects.find(p => p.id === id)?.name || '';

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        postsAvailable() ? postsApi.list(projectId, false).then(d => d.posts) : Promise.resolve([] as Post[]),
        reelsAvailable() ? reelsApi.list(projectId, false).then(d => d.reels) : Promise.resolve([] as Reel[]),
      ]);
      setPieces([...p.map(x => toPiece('post', x)), ...r.map(x => toPiece('reel', x))].filter(x => !x.archived));
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

  const byDay = useMemo(() => {
    const map = new Map<string, Piece[]>();
    for (const p of pieces || []) {
      if (!p.scheduledFor) continue;
      const k = dayKey(new Date(p.scheduledFor));
      map.set(k, [...(map.get(k) || []), p]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));
    return map;
  }, [pieces]);
  const unscheduled = (pieces || []).filter(p => columnOf(p) === 'ready');
  const weekCount = days.reduce((n, d) => n + (byDay.get(dayKey(d)) || []).filter(p => !p.posted).length, 0);

  const drop = async (day: Date) => {
    const p = dragged;
    setDragged(null); setOver('');
    if (!p || p.posted) return;
    const at = moveToDay(day, p.scheduledFor);
    try {
      await (p.kind === 'post' ? postsApi.schedule(p.id, at) : reelsApi.schedule(p.id, at));
      showToast(`Scheduled for ${whenText(at)}`);
      await load();
    } catch (e: any) {
      showToast(e.message || 'Could not schedule that', 'error');
    }
  };

  const open = (p: Piece) => (p.kind === 'post' ? openPosts({ postId: p.id }) : openReels({ reelId: p.id }));
  const range = `${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

  const card = (p: Piece) => {
    const Icon = p.kind === 'post' ? GalleryHorizontal : Clapperboard;
    return (
      <button key={p.kind + p.id} type="button" draggable={!p.posted} onClick={() => open(p)}
        onDragStart={e => { setDragged(p); e.dataTransfer.setData('text/plain', p.id); }} onDragEnd={() => { setDragged(null); setOver(''); }}
        className={`surface-item p-2.5 rounded-xl text-left w-full ${p.posted ? 'opacity-50' : 'cursor-grab active:cursor-grabbing'}`}>
        <span className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
          <Icon size={11} /> {p.kind}{p.scheduledFor ? ` · ${timeText(p.scheduledFor)}` : ''}{p.posted ? ' · posted' : ''}
        </span>
        <span className="block mt-1 text-[13px] font-semibold leading-snug line-clamp-2">{p.title}</span>
        {!projectId && nameOf(p.projectId) && <span className="block mt-0.5 text-[11px] text-gray-500 truncate">{nameOf(p.projectId)}</span>}
      </button>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button type="button" aria-label="Previous week" onClick={() => setStart(s => { const d = new Date(s); d.setDate(d.getDate() - 7); return d; })} className="h-9 w-9 rounded-xl bg-black/[0.05] dark:bg-white/10 flex items-center justify-center"><ChevronLeft size={16} /></button>
        <button type="button" onClick={() => setStart(weekStart(new Date()))} className="h-9 px-3 rounded-xl bg-black/[0.05] dark:bg-white/10 text-[13px] font-semibold">This week</button>
        <button type="button" aria-label="Next week" onClick={() => setStart(s => { const d = new Date(s); d.setDate(d.getDate() + 7); return d; })} className="h-9 w-9 rounded-xl bg-black/[0.05] dark:bg-white/10 flex items-center justify-center"><ChevronRight size={16} /></button>
        <h3 className="text-[15px] font-semibold ml-1">{range}</h3>
        <span className="text-[12.5px] text-gray-500">{weekCount ? `${weekCount} to post` : 'Nothing scheduled this week'}</span>
      </div>
      {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}
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
          ? <p className="text-[12.5px] text-gray-400">Nothing waiting. Finished posts and reels with no date show up here; drag one onto a day.</p>
          : <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">{unscheduled.map(card)}</div>}
      </div>
    </div>
  );
}
