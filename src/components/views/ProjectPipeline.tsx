// ProjectPipeline - a content project's pipeline: ideas and scripts (tasks), then the
// posts and reels made from them, through Drafting, Ready, Scheduled and Posted.
// Drag a finished post or reel between Ready, Scheduled and Posted; dropping on
// Scheduled asks for a date and time.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CalendarClock, CheckCircle2, Clapperboard, GalleryHorizontal, Lightbulb, LoaderCircle, PenLine, Plus, Send, TriangleAlert, X } from 'lucide-react';
import { Post, postsApi, postsAvailable, POST_EVENT, openPosts } from '../../services/posts';
import { Reel, reelsApi, reelsAvailable, REEL_EVENT, openReels } from '../../services/reels';
import { stageOf, projectTypeInfo } from '../../services/projectTypes';
import { api } from '../../services/api';
import type { Project, WorkItem } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { openAddContent } from '../content/AddContent';
import { ColumnId, Piece, columnOf, drawAtText, toLocalInput, toPiece, whenText } from '../../services/contentPieces';

const COLUMNS: { id: ColumnId; label: string; icon: typeof Lightbulb; tint: string; drop: boolean }[] = [
  { id: 'idea', label: 'Idea', icon: Lightbulb, tint: 'text-amber-500', drop: false },
  { id: 'script', label: 'Script', icon: PenLine, tint: 'text-blue-500', drop: false },
  { id: 'drafting', label: 'Drafting', icon: LoaderCircle, tint: 'text-violet-500', drop: false },
  { id: 'ready', label: 'Ready', icon: CheckCircle2, tint: 'text-emerald-500', drop: true },
  { id: 'scheduled', label: 'Scheduled', icon: CalendarClock, tint: 'text-sky-500', drop: true },
  { id: 'posted', label: 'Posted', icon: Send, tint: 'text-gray-500', drop: true },
  { id: 'dropped', label: "Won't post", icon: Ban, tint: 'text-gray-400', drop: true },
];

export function ProjectPipeline({ projectId, onSelectTask }: { projectId: string; onSelectTask: (id: string) => void }) {
  const { showToast } = useToast();
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [tasks, setTasks] = useState<WorkItem[]>([]);
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState<Piece | null>(null);
  const [over, setOver] = useState<ColumnId | null>(null);
  const [picking, setPicking] = useState<{ piece: Piece; value: string } | null>(null);

  const project = (api.sync.getState().projects.filter(Boolean) as Project[]).find(p => p.id === projectId);
  const statuses = projectTypeInfo(project).statuses;

  const readTasks = useCallback(() => {
    const all = api.workItems.snapshot(projectId) as WorkItem[];
    setTasks(all.filter(t => t.projectId === projectId && t.status !== 'done' && !(t as any).postId && !(t as any).reelId));
  }, [projectId]);

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

  useEffect(() => { load(); readTasks(); }, [load, readTasks]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    window.addEventListener(POST_EVENT, onEvent);
    window.addEventListener(REEL_EVENT, onEvent);
    return () => { clearTimeout(timer); window.removeEventListener(POST_EVENT, onEvent); window.removeEventListener(REEL_EVENT, onEvent); };
  }, [load]);
  useDataChanges(readTasks);

  const byColumn = useMemo(() => {
    const out: Record<ColumnId, Piece[]> = { idea: [], script: [], drafting: [], ready: [], scheduled: [], posted: [], dropped: [] };
    for (const p of pieces || []) out[columnOf(p)].push(p);
    out.scheduled.sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));
    return out;
  }, [pieces]);

  const ideas = tasks.filter(t => stageOf(t, statuses).id === 'idea' || t.status === 'todo');
  const scripts = tasks.filter(t => !ideas.includes(t));

  const call = async (piece: Piece, fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); showToast(ok); await load(); } catch (e: any) { showToast(e.message || 'Could not change that', 'error'); }
  };
  const schedule = (piece: Piece, at: string | null) =>
    piece.kind === 'post' ? postsApi.schedule(piece.id, at) : reelsApi.schedule(piece.id, at);
  const setPosted = (piece: Piece, posted: boolean) =>
    piece.kind === 'post' ? postsApi.setPosted(piece.id, posted) : reelsApi.setPosted(piece.id, posted);

  const skip = (piece: Piece, undo: boolean) =>
    piece.kind === 'post' ? postsApi.skip(piece.id, undo) : reelsApi.skip(piece.id, undo);

  const moveTo = async (piece: Piece, to: ColumnId) => {
    const from = columnOf(piece);
    if (from === to || !COLUMNS.find(c => c.id === to)?.drop || from === 'drafting') return;
    if (to === 'dropped') { await call(piece, () => skip(piece, false), "Dropped. No reminders; the files are kept."); return; }
    if (from === 'dropped') {
      // Bring it back first, then do what was asked.
      try { await skip(piece, true); } catch (e: any) { showToast(e.message || 'Could not bring it back', 'error'); return; }
      if (to === 'ready') { showToast('Back to Ready'); await load(); return; }
      piece = { ...piece, wontPost: false, scheduledFor: null };
    }
    if (piece.status === 'planned' && to !== 'scheduled') { showToast('Not drawn yet. Draw it now, or change its time.', 'info'); return; }
    if (to === 'scheduled') { setPicking({ piece, value: toLocalInput(piece.scheduledFor) }); return; }
    if (to === 'posted') { await call(piece, () => setPosted(piece, true), 'Marked as posted'); return; }
    // Ready: take it off the schedule and un-post it if it was posted.
    await call(piece, async () => {
      if (piece.posted) await setPosted(piece, false);
      if (piece.scheduledFor) await schedule(piece, null);
    }, 'Back to Ready');
  };

  const confirmPick = async () => {
    if (!picking) return;
    const when = new Date(picking.value);
    if (isNaN(when.getTime())) { showToast('Pick a date and time', 'error'); return; }
    const { piece } = picking;
    setPicking(null);
    await call(piece, async () => {
      if (piece.posted) await setPosted(piece, false);
      await schedule(piece, when.toISOString());
    }, `Scheduled for ${whenText(when.toISOString())}`);
  };

  const drawNow = (p: Piece) => call(p, () => (p.kind === 'post' ? postsApi.rerender(p.id, {}) : reelsApi.remake(p.id, {})), 'Started');
  const open = (p: Piece) => (p.kind === 'post' ? openPosts({ postId: p.id }) : openReels({ reelId: p.id }));

  const renderCard = (p: Piece) => {
    const col = columnOf(p);
    const Icon = p.kind === 'post' ? GalleryHorizontal : Clapperboard;
    return (
      <div key={p.kind + p.id} draggable={col !== 'drafting'} onDragStart={e => { setDragged(p); e.dataTransfer.setData('text/plain', p.id); }}
        onDragEnd={() => { setDragged(null); setOver(null); }}
        className={`surface-item p-3 rounded-2xl ${col === 'drafting' ? '' : 'cursor-grab active:cursor-grabbing'} ${dragged?.id === p.id ? 'is-dragging' : ''}`}>
        <button type="button" onClick={() => open(p)} className="w-full text-left">
          <div className="flex items-center gap-1.5 mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
            <Icon size={12} /> {p.kind}
            {col === 'drafting' && (p.status === 'failed'
              ? <span className="flex items-center gap-1 text-red-500"><TriangleAlert size={11} /> failed</span>
              : <span className="flex items-center gap-1 text-violet-500"><LoaderCircle size={11} className="animate-spin" /> {p.status === 'waiting' ? 'needs voice' : 'drawing'}</span>)}
          </div>
          <h4 className="text-[14px] font-semibold leading-snug line-clamp-2">{p.title}</h4>
          {p.scheduledFor && col === 'scheduled' && <p className="mt-1.5 text-[11.5px] font-semibold text-sky-600 dark:text-sky-400">Post {whenText(p.scheduledFor)}{p.status !== 'planned' && ' · reminder set'}</p>}
        </button>
        {col === 'scheduled' && p.status === 'planned' && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[11.5px] text-gray-500">Script saved. Draws {p.scheduledFor ? drawAtText(p.scheduledFor) : 'later'}, reminder at post time.</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setPicking({ piece: p, value: toLocalInput(p.scheduledFor) })} className="h-7 px-2.5 rounded-full text-[12px] font-semibold bg-black/[0.05] dark:bg-white/10">Change date</button>
              <button type="button" onClick={() => drawNow(p)} className="h-7 px-2.5 rounded-full text-[12px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">{p.kind === 'post' ? 'Draw now' : 'Make now'}</button>
              <button type="button" onClick={() => moveTo(p, 'dropped')} className="h-7 px-2.5 rounded-full text-[12px] font-semibold text-gray-500 hover:bg-black/[0.05] dark:hover:bg-white/10">Won't post</button>
            </div>
          </div>
        )}
        {col === 'scheduled' && p.status !== 'planned' && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setPicking({ piece: p, value: toLocalInput(p.scheduledFor) })} className="h-7 px-2.5 rounded-full text-[12px] font-semibold bg-black/[0.05] dark:bg-white/10">Change date</button>
            <button type="button" onClick={() => moveTo(p, 'posted')} className="h-7 px-2.5 rounded-full text-[12px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Mark posted</button>
            <button type="button" onClick={() => moveTo(p, 'dropped')} className="h-7 px-2.5 rounded-full text-[12px] font-semibold text-gray-500 hover:bg-black/[0.05] dark:hover:bg-white/10">Won't post</button>
          </div>
        )}
        {col === 'ready' && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => moveTo(p, 'scheduled')} className="flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"><CalendarClock size={12} /> Schedule</button>
            <button type="button" onClick={() => moveTo(p, 'posted')} className="h-7 px-2.5 rounded-full text-[12px] font-semibold bg-black/[0.05] dark:bg-white/10">Mark posted</button>
            <button type="button" onClick={() => moveTo(p, 'dropped')} className="h-7 px-2.5 rounded-full text-[12px] font-semibold text-gray-500 hover:bg-black/[0.05] dark:hover:bg-white/10">Won't post</button>
          </div>
        )}
        {col === 'dropped' && (
          <button type="button" onClick={() => moveTo(p, 'ready')} className="mt-2 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-black/[0.05] dark:bg-white/10">Bring back</button>
        )}
      </div>
    );
  };

  const taskCard = (t: WorkItem) => (
    <button key={t.id} type="button" onClick={() => onSelectTask(t.id)} className="surface-item p-3 rounded-2xl text-left">
      <h4 className="text-[14px] font-semibold leading-snug line-clamp-2">{t.title}</h4>
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button type="button" onClick={() => openAddContent(projectId)} className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[13px] font-semibold"><Plus size={14} /> Add</button>
        <span className="ml-auto flex items-center gap-1 text-[12px] text-gray-500">Edit made ones:
          <button type="button" onClick={() => openPosts({ projectId })} className="flex items-center gap-1 h-7 px-2.5 rounded-full font-semibold bg-black/[0.05] dark:bg-white/10"><GalleryHorizontal size={12} /> Posts</button>
          <button type="button" onClick={() => openReels({ projectId })} className="flex items-center gap-1 h-7 px-2.5 rounded-full font-semibold bg-black/[0.05] dark:bg-white/10"><Clapperboard size={12} /> Reels</button>
        </span>
      </div>
      {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}
      {<div className="flex gap-4 overflow-x-auto pb-12 min-h-[60vh] items-start snap-x">
        {COLUMNS.map(col => {
          const list = col.id === 'idea' ? ideas : col.id === 'script' ? scripts : byColumn[col.id];
          const count = list.length;
          return (
            <div key={col.id} className="flex flex-col w-[250px] shrink-0 snap-start"
              onDragOver={e => { if (col.drop && dragged) { e.preventDefault(); setOver(col.id); } }}
              onDrop={e => { e.preventDefault(); const p = dragged; setDragged(null); setOver(null); if (p) moveTo(p, col.id); }}>
              <div className="flex items-center gap-2 mb-2 px-2 py-2">
                <div className={`p-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] ${col.tint}`}><col.icon size={14} strokeWidth={2.2} /></div>
                <h3 className="font-semibold text-[14px]">{col.label}</h3>
                <span className="text-[11px] font-semibold tabular-nums bg-black/[0.05] dark:bg-white/[0.07] px-2 py-0.5 rounded-full text-gray-500">{count}</span>
              </div>
              <div className={`flex flex-col gap-2.5 surface p-2.5 rounded-3xl min-h-[150px] border ${over === col.id ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/10' : 'border-black/5 dark:border-white/5'}`}>
                {col.id === 'idea' && ideas.map(taskCard)}
                {col.id === 'script' && scripts.map(taskCard)}
                {col.id !== 'idea' && col.id !== 'script' && byColumn[col.id].map(renderCard)}
                {count === 0 && <p className="text-[12px] text-gray-400 px-1 py-3 text-center">{pieces === null && col.id !== 'idea' && col.id !== 'script' ? 'Loading…' : 'Empty'}</p>}
              </div>
            </div>
          );
        })}
      </div>}

      {picking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPicking(null)}>
          <div className="surface rounded-3xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()} role="dialog" aria-label="Schedule">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-semibold">Schedule {picking.piece.kind}</h3>
                <p className="text-[12.5px] text-gray-500 line-clamp-2">{picking.piece.title}</p>
              </div>
              <button type="button" onClick={() => setPicking(null)} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            {picking.piece.status !== 'planned' && <p className="text-[12.5px] text-gray-500">You get a reminder at this time (push, email and Herald) and once more next morning if it is not marked posted.</p>}
            <input type="datetime-local" value={picking.value} onChange={e => setPicking({ ...picking, value: e.target.value })}
              className="w-full h-11 px-3 rounded-xl bg-black/[0.05] dark:bg-white/10 text-[14px]" />
            <div className="flex gap-2">
              <button type="button" onClick={confirmPick} className="flex-1 h-10 rounded-xl bg-sky-600 text-white text-[14px] font-semibold">Schedule</button>
              {picking.piece.scheduledFor && picking.piece.status !== 'planned' && (
                <button type="button" onClick={() => { const p = picking.piece; setPicking(null); moveTo(p, 'ready'); }} className="h-10 px-4 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[14px] font-semibold">Unschedule</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
