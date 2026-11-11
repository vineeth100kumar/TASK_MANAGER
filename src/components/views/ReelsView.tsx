// ReelsView - Reels: vertical videos made on the Pi from a pasted script and a voice-over.
// The list, the New reel screen and one reel's page, with the project filter when it is
// opened from a project that uses Auto Content.
import { useCallback, useEffect, useState } from 'react';
import { Archive, CheckCircle2, LoaderCircle, Mic, Plus, TriangleAlert } from 'lucide-react';
import ClapperIcon from '../icons/ClapperIcon';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import { REEL_EVENT, Reel, ReelMakerStatus, formatSeconds, posterUrl, reelsApi, reelsAvailable } from '../../services/reels';
import { NewReelScreen } from '../reels/NewReelScreen';
import { ReelPage } from '../reels/ReelPage';
import { timeAgo } from '../../services/radar';

type Screen = { name: 'list' } | { name: 'new' } | { name: 'reel'; id: string } | { name: 'edit'; reel: Reel };

export function ReelsView({ projectId = '', focus }: { projectId?: string; focus?: { reelId?: string; newReel?: boolean; nonce: number } | null }) {
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [status, setStatus] = useState<ReelMakerStatus | null>(null);
  const [error, setError] = useState('');
  const [archived, setArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await reelsApi.list(projectId, archived);
      setReels(data.reels);
      setStatus(data.status);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [projectId, archived]);

  useEffect(() => { if (reelsAvailable()) load(); }, [load]);
  useEffect(() => {
    // Events come in bursts while the Pi works, so wait for a quiet moment and load once.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    window.addEventListener(REEL_EVENT, onEvent);
    return () => { clearTimeout(timer); window.removeEventListener(REEL_EVENT, onEvent); };
  }, [load]);
  useEffect(() => {
    if (!focus) return;
    if (focus.reelId) setScreen({ name: 'reel', id: focus.reelId });
    else if (focus.newReel) setScreen({ name: 'new' });
    else setScreen({ name: 'list' });
  }, [focus]);

  const back = () => { setScreen({ name: 'list' }); load(); };

  if (!reelsAvailable()) {
    return <p className="max-w-xl mx-auto text-[14px] text-gray-500">Reels are made on your Raspberry Pi, and this copy of Sage isn't connected to one.</p>;
  }
  if (screen.name === 'new') {
    return <NewReelScreen status={status} projectId={projectId} onCancel={back} onMade={r => setScreen({ name: 'reel', id: r.id })} />;
  }
  if (screen.name === 'edit') {
    const r = screen.reel;
    return <NewReelScreen status={status} edit={{ id: r.id, script: r.script || '', style: r.style }} onCancel={() => setScreen({ name: 'reel', id: r.id })} onMade={x => setScreen({ name: 'reel', id: x.id })} />;
  }
  if (screen.name === 'reel') {
    return (
      <ReelPage reelId={screen.id} onBack={back} onDeleted={back}
        onEdit={reel => reelsApi.get(reel.id).then(d => setScreen({ name: 'edit', reel: d.reel })).catch(() => setScreen({ name: 'edit', reel }))} />
    );
  }

  const projects = api.sync.getState().projects.filter(Boolean) as Project[];
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name || '';
  const filtered = projectId ? projectName(projectId) : '';

  const line = (r: Reel) => {
    if (r.archived) return 'Archived · script kept';
    if (r.status === 'done') return `${formatSeconds(r.seconds)} · ${r.scenes} slides${r.review === 'approved' ? ' · Approved' : ''}`;
    if (r.status === 'failed') return 'Failed';
    if (r.status === 'waiting') return 'Needs your voice-over';
    if (r.status === 'queued') return r.queuePosition && r.queuePosition > 1 ? `In the queue · ${r.queuePosition} in line` : 'Waiting for its turn';
    return `Making ${Math.round(r.progress.percent)}%`;
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-gray-900 dark:text-white">Reels{filtered ? ` · ${filtered}` : ''}</h2>
          <p className="text-[12.5px] text-gray-500">Paste a script, add a voice, and the Pi makes the video, then emails you.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setArchived(a => !a)} className={`h-10 px-3.5 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 ${archived ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200' : 'bg-black/[0.06] dark:bg-white/10 text-gray-600 dark:text-gray-300'}`}>
            <Archive size={15} /> {archived ? 'Archived' : 'Archive'}
          </button>
          <button onClick={() => setScreen({ name: 'new' })} className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[14px] font-semibold active:scale-95 transition">
            <Plus size={16} /> New reel
          </button>
        </div>
      </div>

      {status && !status.ready && (
        <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-3.5 text-[13px] text-amber-900 dark:text-amber-200 flex gap-2.5">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" /><div><b>The reel maker isn't ready.</b> {status.problems.join(' ')}</div>
        </div>
      )}
      {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

      {reels === null && !error && <div className="skeleton h-40 rounded-3xl" />}
      {reels && reels.length === 0 && archived && (
        <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-8 text-center space-y-3">
          <Archive size={28} className="mx-auto text-gray-400" />
          <p className="text-[15px] font-semibold text-gray-900 dark:text-white">Nothing archived</p>
          <p className="text-[13px] text-gray-500">Rejected reels land here. The script is kept, so you can bring one back and remake its video.</p>
        </div>
      )}
      {reels && reels.length === 0 && !archived && (
        <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-8 text-center space-y-3">
          <ClapperIcon size={28} data-nav="reels" className="icon-play mx-auto text-purple-500" />
          <p className="text-[15px] font-semibold text-gray-900 dark:text-white">No reels yet</p>
          <p className="text-[13px] text-gray-500">Paste a script (or try the example) and get a vertical video with a voice-over and word-by-word captions.</p>
          <button onClick={() => setScreen({ name: 'new' })} className="h-10 px-5 rounded-xl bg-purple-600 text-white text-[14px] font-semibold">Make the first one</button>
        </div>
      )}
      <ul className="space-y-2">
        {(reels || []).map(r => (
          <li key={r.id}>
            <button onClick={() => setScreen({ name: 'reel', id: r.id })} className="w-full text-left surface-item rounded-2xl p-3.5 flex items-center gap-3 active:scale-[0.99] transition-transform">
              {r.status === 'done' && r.media ? (
                <img src={posterUrl(r)} alt="" loading="lazy" decoding="async" width={40} height={71}
                  className="w-10 h-[71px] rounded-lg object-cover shrink-0 bg-black/[0.06] dark:bg-white/10" />
              ) : (
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${r.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' : r.status === 'waiting' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'}`}>
                  {r.status === 'failed' ? <TriangleAlert size={18} /> : r.status === 'waiting' ? <Mic size={18} /> : r.status === 'done' ? <CheckCircle2 size={18} /> : <LoaderCircle size={18} className="animate-spin" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold text-gray-900 dark:text-white truncate">{r.title}</span>
                <span className="block text-[12px] text-gray-500 truncate">
                  {line(r)}{r.posted ? ' · Posted' : ''}{projectName(r.projectId) && !projectId ? ` · ${projectName(r.projectId)}` : ''} · {timeAgo(r.createdAt)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
