// PostPage - one post: progress while the Pi draws it, then the slides, the
// caption and the ways to get it onto Instagram.
//
// Phone: Share sends every slide to the share sheet in one tap (the caption is
// copied first, because Instagram ignores a caption that comes with shared
// pictures). PC: Send to my phone emails the link, a QR code opens it on the
// phone, and the ZIP holds the slides and caption.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, Download, LoaderCircle, Mail, Pencil, RefreshCw, Send, Share2, Smartphone, Trash2,
} from 'lucide-react';
import {
  MakerStatus, POST_EVENT, Post, canShareFiles, copyText, fetchBlob, fileName, postLink, postsApi, qrPath, saveBlob, sharePath, slidePath, zipPath,
} from '../../services/posts';
import { useToast } from '../../context/ToastContext';

interface Props {
  postId: string;
  onBack: () => void;
  onEdit: (post: Post) => void;
  onDeleted: () => void;
}

export function PostPage({ postId, onBack, onEdit, onDeleted }: Props) {
  const { showToast } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [status, setStatus] = useState<MakerStatus | null>(null);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState('');
  const loadedFor = useRef('');

  const load = useCallback(async () => {
    try {
      const data = await postsApi.get(postId);
      setPost(data.post);
      setStatus(data.status);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [postId]);

  useEffect(() => { setPost(null); loadedFor.current = ''; load(); }, [load]);
  useEffect(() => {
    const onEvent = (e: Event) => { if ((e as CustomEvent).detail?.id === postId) load(); };
    window.addEventListener(POST_EVENT, onEvent);
    return () => window.removeEventListener(POST_EVENT, onEvent);
  }, [postId, load]);
  // A backstop for a missed live event while it is being drawn.
  const running = post?.status === 'queued' || post?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [running, load]);

  // Slides arrive as files, ready before Share is tapped (the share sheet must be opened inside the tap).
  const stamp = post ? `${post.id}:${post.finishedAt}:${post.slideCount}` : '';
  useEffect(() => {
    if (!post || post.status !== 'done' || loadedFor.current === stamp) return;
    loadedFor.current = stamp;
    let alive = true;
    (async () => {
      try {
        const blobs = await Promise.all(post.slides.map((_, i) => fetchBlob(slidePath(post.id, i + 1))));
        // Share sends JPEGs: Instagram shows up in the share sheet for them, where it can miss big PNGs.
        const jpegs = await Promise.all(post.slides.map((_, i) => fetchBlob(sharePath(post.id, i + 1))));
        if (!alive) return;
        setFiles(jpegs.map((b, i) => new File([b], fileName(post, i + 1, 'jpg'), { type: 'image/jpeg' })));
        setUrls(old => { old.forEach(URL.revokeObjectURL); return blobs.map(b => URL.createObjectURL(b)); });
      } catch (e: any) {
        if (alive) setError(e.message || "Couldn't load the slides");
      }
    })();
    return () => { alive = false; };
  }, [post, stamp]);
  useEffect(() => () => { urls.forEach(URL.revokeObjectURL); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The QR code opens this post on a phone (PC only; it needs a public link).
  useEffect(() => {
    if (!post || post.status !== 'done' || !status?.qr || !status.link) { setQr(''); return; }
    let url = '';
    fetchBlob(qrPath(post.id)).then(b => { url = URL.createObjectURL(b); setQr(url); }).catch(() => setQr(''));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [post?.id, post?.status, status?.qr, status?.link]); // eslint-disable-line react-hooks/exhaustive-deps

  const shareable = useMemo(() => files.length > 0 && canShareFiles(files), [files]);

  const share = async () => {
    if (!post) return;
    const caption = post.caption || '';
    // Instagram drops the caption of shared pictures, so it goes to the clipboard first.
    const copied = caption ? await copyText(caption) : false;
    try {
      // Files only: any title or text makes some apps, Instagram included, drop out of the list.
      await navigator.share({ files });
      showToast(copied ? 'Shared. Paste the caption in Instagram (it is copied).' : 'Shared');
    } catch (e: any) {
      if (e?.name !== 'AbortError') showToast("Couldn't open the share sheet. Download the ZIP instead.", 'error');
    }
  };
  const copyCaption = async () => {
    if (!post?.caption) return;
    showToast((await copyText(post.caption)) ? 'Caption copied' : "Couldn't copy. Press and hold the text.", 'info');
  };
  const download = async () => {
    if (!post) return;
    setBusy('zip');
    try { saveBlob(await fetchBlob(zipPath(post.id)), `${fileName(post, 0).replace(/-00\.png$/, '')}.zip`); }
    catch (e: any) { showToast(e.message || "Couldn't download", 'error'); }
    finally { setBusy(''); }
  };
  const sendToPhone = async () => {
    if (!post) return;
    setBusy('send');
    try { setPost(await postsApi.send(post.id)); showToast(`Emailed to ${status?.emailTo || 'you'}`); }
    catch (e: any) { showToast(e.message || "Couldn't send the email", 'error'); }
    finally { setBusy(''); }
  };
  const togglePosted = async () => {
    if (!post) return;
    setBusy('posted');
    try { setPost(await postsApi.setPosted(post.id, !post.posted)); showToast(post.posted ? 'Moved back to Ready' : 'Marked as posted'); }
    catch (e: any) { showToast(e.message || "Couldn't update", 'error'); }
    finally { setBusy(''); }
  };
  const again = async () => {
    if (!post) return;
    setBusy('again');
    try { setPost(await postsApi.rerender(post.id, {})); loadedFor.current = ''; }
    catch (e: any) { showToast(e.message || "Couldn't start again", 'error'); }
    finally { setBusy(''); }
  };
  const remove = async () => {
    if (!post || !window.confirm('Delete this post and its slides?')) return;
    try { await postsApi.remove(post.id); onDeleted(); } catch (e: any) { showToast(e.message || "Couldn't delete", 'error'); }
  };

  if (error && !post) {
    return <div className="max-w-3xl mx-auto"><Back onBack={onBack} /><p className="text-[14px] text-red-600">{error}</p></div>;
  }
  if (!post) return <div className="max-w-3xl mx-auto"><Back onBack={onBack} /><div className="skeleton h-64 rounded-3xl" /></div>;

  const pct = post.progress.total ? Math.round((post.progress.done / post.progress.total) * 100) : 0;
  const done = post.status === 'done';

  return (
    <div className="max-w-3xl mx-auto pb-44 md:pb-6">
      <Back onBack={onBack} />
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-tight text-gray-900 dark:text-white break-words">{post.title}</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            {post.slideCount || post.progress.total} slides · {post.format === 'square' ? 'Square' : 'Portrait'}
            {post.seconds ? ` · made in ${Math.round(post.seconds)}s` : ''}
            {post.posted ? ' · Posted' : ''}
          </p>
        </div>
        {done && (
          <span className={`shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold ${post.audit === 'fail' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200'}`}>
            {post.audit === 'fail' ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />} Audit {post.audit === 'fail' ? 'needs a look' : 'passed'}
          </span>
        )}
      </div>

      {running && (
        <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-5 space-y-4" aria-live="polite">
          <div className="flex items-center gap-2">
            <LoaderCircle size={18} className="animate-spin text-purple-500" />
            <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white">{post.status === 'queued' ? 'Waiting for its turn' : 'Drawing your slides'}</h3>
            <span className="text-[12px] text-gray-400 ml-auto tabular-nums">{post.progress.done} of {post.progress.total}</span>
          </div>
          <div className="h-2 rounded-full bg-black/[0.06] dark:bg-white/10 overflow-hidden">
            <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
          </div>
          <ul className="text-[12.5px] text-gray-500 space-y-0.5 font-mono max-h-40 overflow-y-auto">
            {(post.log || []).slice(-6).map((l, i) => <li key={i} className="truncate">{l.text}</li>)}
          </ul>
          <p className="text-[12.5px] text-gray-500 flex items-center gap-1.5"><Mail size={14} /> {status?.emailReady && status.emailOn ? `We'll email ${status.emailTo} when it's ready. You can close this page.` : 'Keep this page open.'}</p>
        </div>
      )}

      {post.status === 'failed' && (
        <div className="rounded-3xl border border-red-300/60 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-5 space-y-3">
          <div className="flex items-start gap-2 text-red-800 dark:text-red-200"><AlertTriangle size={18} className="shrink-0 mt-0.5" /><div><b>It didn't work.</b> <span className="text-[14px]">{post.error || 'The slide maker stopped.'}</span></div></div>
          <div className="flex gap-2">
            <button onClick={again} disabled={busy === 'again'} className="h-9 px-4 rounded-xl bg-red-600 text-white text-[13px] font-semibold flex items-center gap-1.5"><RefreshCw size={14} /> Try again</button>
            <button onClick={() => onEdit(post)} className="h-9 px-4 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold">Edit script</button>
          </div>
        </div>
      )}

      {done && (
        <>
          {post.audit === 'fail' && post.auditNote && (
            <div className="mb-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200 p-3.5 text-[13px]"><b>The audit flagged:</b> {post.auditNote}</div>
          )}

          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 pb-2 snap-x" aria-label="Slides">
            {post.slides.map((_, i) => (
              <div key={i} className="snap-start shrink-0 w-[62%] sm:w-[34%] md:w-[30%]">
                {urls[i]
                  ? <img src={urls[i]} alt={`Slide ${i + 1}`} className={`w-full rounded-2xl border border-black/10 dark:border-white/10 ${post.format === 'square' ? 'aspect-square' : 'aspect-[4/5]'} object-cover`} />
                  : <div className={`skeleton w-full rounded-2xl ${post.format === 'square' ? 'aspect-square' : 'aspect-[4/5]'}`} />}
                <div className="text-[11px] text-gray-400 text-center mt-1 tabular-nums">{i + 1}</div>
              </div>
            ))}
          </div>

          <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4 mt-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-gray-400">Caption</h3>
              <button onClick={copyCaption} className="flex items-center gap-1 text-[12.5px] font-semibold text-purple-600 dark:text-purple-300"><Copy size={13} /> Copy</button>
            </div>
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-gray-800 dark:text-gray-100 select-text">{post.caption || 'No caption in this script.'}</p>
          </div>

          {/* Phone: the big buttons sit at the bottom, under the thumb. */}
          <div className="fixed md:static bottom-[calc(4rem+env(safe-area-inset-bottom))] inset-x-0 z-20 md:z-auto p-3 md:p-0 md:mt-4 bg-white/90 dark:bg-[#141416]/90 md:bg-transparent backdrop-blur-xl md:backdrop-blur-none border-t md:border-0 border-black/5 dark:border-white/10 pb-3 md:pb-0">
            <div className="max-w-3xl mx-auto space-y-2">
              {shareable ? (
                <button onClick={share} className="w-full h-12 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition">
                  <Share2 size={18} /> Share {files.length} slides to Instagram
                </button>
              ) : (
                <button onClick={download} disabled={busy === 'zip'} className="w-full h-12 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition">
                  {busy === 'zip' ? <LoaderCircle size={18} className="animate-spin" /> : <Download size={18} />} Download slides + caption (ZIP)
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={copyCaption} className="h-10 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center justify-center gap-1.5"><Copy size={14} /> Copy caption</button>
                <button onClick={togglePosted} disabled={busy === 'posted'} className={`h-10 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 ${post.posted ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' : 'bg-black/[0.06] dark:bg-white/10'}`}>
                  <Check size={14} /> {post.posted ? 'Posted' : 'Mark posted'}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4 space-y-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-gray-400">More ways to get it</h3>
              <div className="flex flex-wrap gap-2">
                {shareable && <button onClick={download} disabled={busy === 'zip'} className="h-9 px-3.5 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center gap-1.5"><Download size={14} /> ZIP</button>}
                <button onClick={sendToPhone} disabled={busy === 'send'} className="h-9 px-3.5 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center gap-1.5">
                  {busy === 'send' ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />} Send to my phone
                </button>
                <button onClick={() => onEdit(post)} className="h-9 px-3.5 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center gap-1.5"><Pencil size={14} /> Edit script</button>
                <button onClick={remove} className="h-9 px-3.5 rounded-xl text-red-600 text-[13px] font-semibold flex items-center gap-1.5 hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 size={14} /> Delete</button>
              </div>
              {shareable && <p className="text-[12px] text-gray-400">Instagram not in the share sheet? Pick <b>Save Image</b> (or Save to Photos) there, then add the photos from Instagram's + button. The caption is already copied.</p>}
              {!status?.secureLink && <p className="text-[12px] text-gray-400">The share button needs the https link to Sage (your tunnel). On the home network use the ZIP.</p>}
              {post.emailed && <p className="text-[12px] text-gray-400 flex items-center gap-1.5"><Mail size={13} /> Emailed to {status?.emailTo}</p>}
              {post.emailError && !post.emailed && <p className="text-[12px] text-amber-700 dark:text-amber-300">Email: {post.emailError}</p>}
            </div>
            {qr && (
              <div className="hidden md:flex surface rounded-3xl border border-black/5 dark:border-white/5 p-4 flex-col items-center gap-2">
                <img src={qr} alt="QR code that opens this post on your phone" className="w-28 h-28 rounded-lg bg-white" />
                <span className="text-[12px] text-gray-500 flex items-center gap-1"><Smartphone size={12} /> Scan to open on phone</span>
                <a className="sr-only" href={postLink(post, status)}>Link</a>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="flex items-center gap-1.5 mb-3 text-[13px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">
      <ArrowLeft size={15} /> Posts
    </button>
  );
}
