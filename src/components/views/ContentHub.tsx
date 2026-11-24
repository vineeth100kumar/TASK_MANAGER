// ContentHub - one home for content: a project filter and the one Add button over a tab bar
// (Dashboard, Posts, Reels). The Dashboard is the numbers and the calendar in one view; Posts
// and Reels stay for opening and editing what was made. Everything below follows the filter.
import { useMemo } from 'react';
import { LayoutDashboard, GalleryHorizontal, Clapperboard, Plus } from 'lucide-react';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import { NO_PROJECT, scopeProjectId } from '../../services/contentPieces';
import { openAddContent } from '../content/AddContent';
import { Select } from '../common/Select';
import { PostsView, ReelsView } from './lazyViews';
import { ContentDashboard } from './ContentDashboard';

type Tab = 'contentweek' | 'posts' | 'reels';

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'contentweek', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'posts', label: 'Posts', icon: GalleryHorizontal },
  { id: 'reels', label: 'Reels', icon: Clapperboard },
];

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  /** '' is every project, NO_PROJECT is none, otherwise a project id. */
  scope: string;
  onScope: (scope: string) => void;
  postsFocus: { postId?: string; newPost?: boolean; nonce: number } | null;
  reelsFocus: { reelId?: string; newReel?: boolean; nonce: number } | null;
}

export function ContentHub({ tab, onTab, scope, onScope, postsFocus, reelsFocus }: Props) {
  // The same projects New post lists: content projects with Use Auto Content on.
  const projects = (api.sync.getState().projects.filter(Boolean) as Project[]).filter(p => p.type === 'content' && p.autoContent);
  const options = useMemo(() => projects.map(p => ({ id: p.id, name: p.name })), [projects.map(p => p.id + p.name).join('|')]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-black/[0.05] dark:bg-white/10 w-fit" role="tablist" aria-label="Content">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)}
              className={`flex items-center gap-1.5 h-9 px-3.5 rounded-[10px] text-[13px] font-semibold ${tab === t.id ? 'bg-white dark:bg-[#2c2c2e] shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`}>
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Select value={scope} onChange={onScope} className="field !h-9 !py-0 text-[13px]" aria-label="Project">
            <option value="">All projects</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value={NO_PROJECT}>No project</option>
          </Select>
          <button type="button" onClick={() => openAddContent(scopeProjectId(scope))}
            className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[13.5px] font-semibold active:scale-95 transition">
            <Plus size={15} /> Add
          </button>
        </div>
      </div>
      {tab === 'contentweek' && <ContentDashboard scope={scope} onScope={onScope} />}
      {tab === 'posts' && <PostsView projectId={scope} focus={postsFocus} />}
      {tab === 'reels' && <ReelsView projectId={scope} focus={reelsFocus} />}
    </div>
  );
}
