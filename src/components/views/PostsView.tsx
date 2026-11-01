// PostsView - Posts: slides made on the Pi from a pasted script.
// The list, the New post screen and one post's page, with the project filter
// when it is opened from a project that uses Auto Content.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ImagePlus, LoaderCircle, Plus, TriangleAlert } from 'lucide-react';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import { MakerStatus, POST_EVENT, Post, postsApi, postsAvailable } from '../../services/posts';
import { NewPostScreen } from '../posts/NewPostScreen';
import { PostPage } from '../posts/PostPage';
import { timeAgo } from '../../services/radar';

type Screen = { name: 'list' } | { name: 'new' } | { name: 'post'; id: string } | { name: 'edit'; post: Post };

export function PostsView({ projectId = '', focus }: { projectId?: string; focus?: { postId?: string; newPost?: boolean; nonce: number } | null }) {
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [status, setStatus] = useState<MakerStatus | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await postsApi.list(projectId);
      setPosts(data.posts);
      setStatus(data.status);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [projectId]);

  useEffect(() => { if (postsAvailable()) load(); }, [load]);
  useEffect(() => {
    const onEvent = () => load();
    window.addEventListener(POST_EVENT, onEvent);
    return () => window.removeEventListener(POST_EVENT, onEvent);
  }, [load]);
  useEffect(() => {
    if (!focus) return;
    if (focus.postId) setScreen({ name: 'post', id: focus.postId });
    else if (focus.newPost) setScreen({ name: 'new' });
    else setScreen({ name: 'list' });
  }, [focus]);

  const back = () => { setScreen({ name: 'list' }); load(); };

  if (!postsAvailable()) {
    return <p className="max-w-xl mx-auto text-[14px] text-gray-500">Posts are made on your Raspberry Pi, and this copy of Sage isn't connected to one.</p>;
  }
  if (screen.name === 'new') {
    return <NewPostScreen status={status} projectId={projectId} onCancel={back} onMade={id => setScreen({ name: 'post', id })} />;
  }
  if (screen.name === 'edit') {
    const p = screen.post;
    return <NewPostScreen status={status} edit={{ id: p.id, script: p.script || '', style: p.style, format: p.format }} onCancel={() => setScreen({ name: 'post', id: p.id })} onMade={id => setScreen({ name: 'post', id })} />;
  }
  if (screen.name === 'post') {
    return (
      <PostPage postId={screen.id} onBack={back} onDeleted={back}
        onEdit={post => postsApi.get(post.id).then(d => setScreen({ name: 'edit', post: d.post })).catch(() => setScreen({ name: 'edit', post }))} />
    );
  }

  const projects = api.sync.getState().projects.filter(Boolean) as Project[];
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name || '';
  const filtered = projectId ? projectName(projectId) : '';

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-gray-900 dark:text-white">Posts{filtered ? ` · ${filtered}` : ''}</h2>
          <p className="text-[12.5px] text-gray-500">Paste a script and the Pi draws the carousel, then emails you.</p>
        </div>
        <button onClick={() => setScreen({ name: 'new' })} className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[14px] font-semibold shrink-0 active:scale-95 transition">
          <Plus size={16} /> New post
        </button>
      </div>

      {status && !status.ready && (
        <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-3.5 text-[13px] text-amber-900 dark:text-amber-200 flex gap-2.5">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" /><div><b>The slide maker isn't ready.</b> {status.problems.join(' ')}</div>
        </div>
      )}
      {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

      {posts === null && !error && <div className="skeleton h-40 rounded-3xl" />}
      {posts && posts.length === 0 && (
        <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-8 text-center space-y-3">
          <ImagePlus size={28} className="mx-auto text-purple-500" />
          <p className="text-[15px] font-semibold text-gray-900 dark:text-white">No posts yet</p>
          <p className="text-[13px] text-gray-500">Paste a script (or try the example) and get Instagram slides in about 30 seconds.</p>
          <button onClick={() => setScreen({ name: 'new' })} className="h-10 px-5 rounded-xl bg-purple-600 text-white text-[14px] font-semibold">Make the first one</button>
        </div>
      )}
      <ul className="space-y-2">
        {(posts || []).map(p => (
          <li key={p.id}>
            <button onClick={() => setScreen({ name: 'post', id: p.id })} className="w-full text-left surface-item rounded-2xl p-3.5 flex items-center gap-3 active:scale-[0.99] transition-transform">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${p.status === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : p.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'}`}>
                {p.status === 'done' ? <CheckCircle2 size={18} /> : p.status === 'failed' ? <TriangleAlert size={18} /> : <LoaderCircle size={18} className="animate-spin" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold text-gray-900 dark:text-white truncate">{p.title}</span>
                <span className="block text-[12px] text-gray-500 truncate">
                  {p.status === 'done' ? `${p.slideCount} slides` : p.status === 'failed' ? 'Failed' : `Drawing ${p.progress.done}/${p.progress.total}`}
                  {p.posted ? ' · Posted' : ''}{projectName(p.projectId) && !projectId ? ` · ${projectName(p.projectId)}` : ''} · {timeAgo(p.createdAt)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
