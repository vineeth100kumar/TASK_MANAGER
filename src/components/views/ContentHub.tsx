// ContentHub - one home for content: a tab bar over the Calendar, Posts and Reels,
// so there is a single "Content" door in the sidebar instead of three.
import { CalendarClock, GalleryHorizontal, Clapperboard } from 'lucide-react';
import { PostsView, ReelsView } from './lazyViews';
import { ContentWeekView } from './ContentWeekView';

type Tab = 'contentweek' | 'posts' | 'reels';

const TABS: { id: Tab; label: string; icon: typeof CalendarClock }[] = [
  { id: 'contentweek', label: 'Calendar', icon: CalendarClock },
  { id: 'posts', label: 'Posts', icon: GalleryHorizontal },
  { id: 'reels', label: 'Reels', icon: Clapperboard },
];

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  postsProject: string;
  postsFocus: { postId?: string; newPost?: boolean; nonce: number } | null;
  reelsProject: string;
  reelsFocus: { reelId?: string; newReel?: boolean; nonce: number } | null;
}

export function ContentHub({ tab, onTab, postsProject, postsFocus, reelsProject, reelsFocus }: Props) {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-1 mb-4 p-0.5 rounded-xl bg-black/[0.05] dark:bg-white/10 w-fit" role="tablist" aria-label="Content">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)}
            className={`flex items-center gap-1.5 h-9 px-3.5 rounded-[10px] text-[13px] font-semibold ${tab === t.id ? 'bg-white dark:bg-[#2c2c2e] shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'contentweek' && <ContentWeekView />}
      {tab === 'posts' && <PostsView projectId={postsProject} focus={postsFocus} />}
      {tab === 'reels' && <ReelsView projectId={reelsProject} focus={reelsFocus} />}
    </div>
  );
}
