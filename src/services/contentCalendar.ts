// contentCalendar - scheduled posts and reels as lightweight calendar chips, so the
// main Calendar and Today can show them next to tasks. One loader, shared by both.
import { useCallback, useEffect, useState } from 'react';
import { Post, postsApi, postsAvailable, POST_EVENT, openPosts } from './posts';
import { Reel, reelsApi, reelsAvailable, REEL_EVENT, openReels } from './reels';
import { toPiece, columnOf, isApproved } from './contentPieces';

/** A scheduled post/reel shaped like a calendar item (entityType 'post' | 'reel'). */
export interface ContentChip {
  id: string;            // "post:<id>" — unique, won't clash with task ids
  contentKind: 'post' | 'reel';
  contentId: string;
  title: string;
  entityType: 'post' | 'reel';
  dueDate: string;       // YYYY-MM-DD, local day of the slot
  dueTime: string;       // HH:MM, local
  status: string;        // 'done' when already posted (shown greyed)
  posted: boolean;
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const localTime = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const chipOf = (kind: 'post' | 'reel', x: Post | Reel): ContentChip | null => {
  const piece = toPiece(kind, x);
  if (!piece.scheduledFor || !isApproved(piece)) return null;
  // The main Calendar and Today are for planning: upcoming approved content, not past posts.
  if (piece.posted) return null;
  const col = columnOf(piece);
  if (col !== 'scheduled') return null;
  return {
    id: `${kind}:${piece.id}`,
    contentKind: kind, contentId: piece.id,
    title: piece.title, entityType: kind,
    dueDate: localDay(piece.scheduledFor), dueTime: localTime(piece.scheduledFor),
    status: piece.posted ? 'done' : 'open', posted: piece.posted,
  };
};

/** Open the post or reel a content chip points at. */
export const openChip = (chip: { contentKind: 'post' | 'reel'; contentId: string }) =>
  chip.contentKind === 'post' ? openPosts({ postId: chip.contentId }) : openReels({ reelId: chip.contentId });

/** Load every scheduled post and reel as calendar chips; refreshes on post/reel events. */
export function useScheduledContent(): ContentChip[] {
  const [chips, setChips] = useState<ContentChip[]>([]);

  const load = useCallback(async () => {
    if (!postsAvailable() && !reelsAvailable()) { setChips([]); return; }
    try {
      const [p, r] = await Promise.all([
        postsAvailable() ? postsApi.list('', false).then(d => d.posts) : Promise.resolve([] as Post[]),
        reelsAvailable() ? reelsApi.list('', false).then(d => d.reels) : Promise.resolve([] as Reel[]),
      ]);
      const out = [
        ...p.map(x => chipOf('post', x)),
        ...r.map(x => chipOf('reel', x)),
      ].filter(Boolean) as ContentChip[];
      setChips(out);
    } catch {
      // Pi unreachable: leave the calendar as it is, no chips.
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    window.addEventListener(POST_EVENT, onEvent);
    window.addEventListener(REEL_EVENT, onEvent);
    return () => { clearTimeout(timer); window.removeEventListener(POST_EVENT, onEvent); window.removeEventListener(REEL_EVENT, onEvent); };
  }, [load]);

  return chips;
}
