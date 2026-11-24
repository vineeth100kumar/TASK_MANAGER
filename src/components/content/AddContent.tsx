// AddContent - the ONE Add button for a content page. Step 1 asks post or reel, step 2 shows
// that type's format guide, then the script screen takes over (script, look, when).
import { useEffect, useState } from 'react';
import { ArrowLeft, Clapperboard, GalleryHorizontal, X } from 'lucide-react';
import { openPosts } from '../../services/posts';
import { openReels } from '../../services/reels';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { FormatGuide } from './FormatGuide';
import { StepBar } from './StepBar';

export const ADD_CONTENT_EVENT = 'sage:add-content';
/** Open the Add flow for a content page. */
export function openAddContent(projectId = ''): void {
  window.dispatchEvent(new CustomEvent(ADD_CONTENT_EVENT, { detail: { projectId } }));
}

export const ADD_STEPS = ['What', 'Guide', 'Script', 'Look', 'When'];

export function AddContent() {
  const [open, setOpen] = useState<{ projectId: string } | null>(null);
  const [kind, setKind] = useState<'post' | 'reel' | null>(null);

  useEffect(() => {
    const on = (e: Event) => { setKind(null); setOpen({ projectId: (e as CustomEvent<{ projectId?: string }>).detail?.projectId || '' }); };
    window.addEventListener(ADD_CONTENT_EVENT, on);
    return () => window.removeEventListener(ADD_CONTENT_EVENT, on);
  }, []);

  const close = () => setOpen(null);
  useEscapeKey(close, Boolean(open));
  if (!open) return null;

  const go = () => {
    if (!kind) return;
    close();
    if (kind === 'post') openPosts({ projectId: open.projectId, newPost: true });
    else openReels({ projectId: open.projectId, newReel: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={close}>
      <div className="surface rounded-t-3xl sm:rounded-3xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-label="Add content">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-[17px] font-semibold">{kind ? `Add a ${kind}` : 'Add'}</h3>
          <button type="button" onClick={close} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <StepBar steps={ADD_STEPS} current={kind ? 1 : 0} />
        {!kind ? (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setKind('post')} className="flex flex-col items-center gap-2 p-5 rounded-2xl bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 font-semibold hover:opacity-80">
              <GalleryHorizontal size={28} /> Post <span className="text-[11.5px] font-normal opacity-70">carousel slides</span>
            </button>
            <button type="button" onClick={() => setKind('reel')} className="flex flex-col items-center gap-2 p-5 rounded-2xl bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 font-semibold hover:opacity-80">
              <Clapperboard size={28} /> Reel <span className="text-[11.5px] font-normal opacity-70">vertical video</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <FormatGuide kind={kind} />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setKind(null)} className="flex items-center gap-1 h-10 px-3 rounded-xl text-[13px] font-semibold text-gray-500"><ArrowLeft size={14} /> Back</button>
              <button type="button" onClick={go} className="flex-1 h-10 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[14px] font-semibold">Next: write the script</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
