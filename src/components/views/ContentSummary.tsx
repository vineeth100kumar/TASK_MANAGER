// ContentSummary - one line on a content project's page: how its posts and reels stand, and a
// nudge when nothing is scheduled to go live this week.
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, TriangleAlert } from 'lucide-react';
import { postsApi, postsAvailable, POST_EVENT } from '../../services/posts';
import { reelsApi, reelsAvailable, REEL_EVENT } from '../../services/reels';
import { ContentCounts, countPieces, toPiece } from '../../services/contentPieces';

export function ContentSummary({ projectId, onOpen }: { projectId: string; onOpen: () => void }) {
  const [counts, setCounts] = useState<ContentCounts | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        postsAvailable() ? postsApi.list(projectId, false).then(d => d.posts) : Promise.resolve([]),
        reelsAvailable() ? reelsApi.list(projectId, false).then(d => d.reels) : Promise.resolve([]),
      ]);
      setCounts(countPieces([...p.map(x => toPiece('post', x)), ...r.map(x => toPiece('reel', x))]));
    } catch {
      setCounts(null);
    }
  }, [projectId]);

  useEffect(() => { setCounts(null); load(); }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    window.addEventListener(POST_EVENT, onEvent);
    window.addEventListener(REEL_EVENT, onEvent);
    return () => { clearTimeout(timer); window.removeEventListener(POST_EVENT, onEvent); window.removeEventListener(REEL_EVENT, onEvent); };
  }, [load]);

  if (!counts) return null;
  const parts = [
    counts.drafting && `${counts.drafting} drafting`,
    counts.ready && `${counts.ready} ready`,
    counts.scheduled && `${counts.scheduled} scheduled`,
    counts.posted && `${counts.posted} posted`,
  ].filter(Boolean);
  const empty = counts.weekScheduled === 0;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
      <span className="flex items-center gap-1.5 text-gray-500"><CalendarClock size={13} /> {parts.length ? parts.join(' · ') : 'No posts or reels yet'}</span>
      <button type="button" onClick={onOpen}
        className={`flex items-center gap-1 h-7 px-2.5 rounded-full font-semibold ${empty ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'}`}>
        {empty ? <><TriangleAlert size={12} /> Nothing scheduled this week</> : <>{counts.weekScheduled} to post this week</>}
      </button>
    </div>
  );
}
