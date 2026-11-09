// ReelPage - one reel: the recording step when it uses your own voice, progress while the Pi
// makes the video, then the player, the caption and the ways to get it onto Instagram.
//
// Phone: Share hands the video to the share sheet (the caption is copied first, because Instagram
// ignores a caption that comes with a shared file). PC: Send to my phone emails the link, a QR code
// opens it on the phone, and Download saves the .mp4. The video is a plain file on the Pi, so the
// <video> element streams, seeks and caches it by itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowLeft, Check, CheckCircle2, Copy, Download, FileAudio, LoaderCircle, Mail, Mic, Pencil, RefreshCw, Send, Share2, Smartphone, Square, ThumbsUp, Trash2,
} from 'lucide-react';
import {
  REEL_EVENT, Reel, ReelMakerStatus, ReviewAction, canShareVideo, fileName, formatSeconds, posterUrl, qrPath, reelLink, reelsApi, uploadVoice, videoUrl,
} from '../../services/reels';
import { copyText, fetchBlob } from '../../services/posts';
import { useToast } from '../../context/ToastContext';

interface Props {
  reelId: string;
  onBack: () => void;
  onEdit: (reel: Reel) => void;
  onDeleted: () => void;
}

/** The lines the author has to read, from the script's say: lines. */
export function narration(script: string): string[] {
  return script.split('\n')
    .map(l => l.match(/^\s*(?:say|vo|narration|speak)\s*:\s*(.+)$/i)?.[1]?.trim() || '')
    .filter(Boolean);
}

export function ReelPage({ reelId, onBack, onEdit, onDeleted }: Props) {
  const { showToast } = useToast();
  const [reel, setReel] = useState<Reel | null>(null);
  const [status, setStatus] = useState<ReelMakerStatus | null>(null);
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await reelsApi.get(reelId);
      setReel(data.reel);
      setStatus(data.status);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [reelId]);

  useEffect(() => { setReel(null); load(); }, [load]);
  useEffect(() => {
    // Events come in bursts while the Pi works, so wait for a quiet moment and load once.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = (e: Event) => {
      if ((e as CustomEvent).detail?.id !== reelId) return;
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    window.addEventListener(REEL_EVENT, onEvent);
    return () => { clearTimeout(timer); window.removeEventListener(REEL_EVENT, onEvent); };
  }, [reelId, load]);
  // A backstop for a missed live event while it is being made.
  const running = reel?.status === 'queued' || reel?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [running, load]);

  // The QR code opens this reel on a phone (PC only; it needs a public link).
  useEffect(() => {
    if (!reel || reel.status !== 'done' || !status?.link) { setQr(''); return; }
    let url = '';
    fetchBlob(qrPath(reel.id)).then(b => { url = URL.createObjectURL(b); setQr(url); }).catch(() => setQr(''));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [reel?.id, reel?.status, status?.link]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phones only: fetch the .mp4 ahead of the tap, because the share sheet must open inside it.
  const stamp = reel?.media ? `${reel.id}:${reel.media.v}` : '';
  useEffect(() => {
    setFile(null);
    if (!reel?.media || reel.status !== 'done' || !phoneCanShare()) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(videoUrl(reel), { priority: 'low' } as RequestInit);
        if (!res.ok) throw new Error(String(res.status));
        const f = new File([await res.blob()], fileName(reel), { type: 'video/mp4' });
        if (alive && canShareVideo(f)) setFile(f);
      } catch { /* Share falls back to Download */ }
    }, 800);
    return () => { alive = false; clearTimeout(timer); };
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    if (!reel || !file) return;
    const copied = reel.caption ? await copyText(reel.caption) : false;
    try {
      await navigator.share({ files: [file] });
      showToast(copied ? 'Shared. Paste the caption in Instagram (it is copied).' : 'Shared');
    } catch (e: any) {
      if (e?.name !== 'AbortError') showToast("Couldn't open the share sheet. Download the video instead.", 'error');
    }
  };
  const copyCaption = async () => {
    if (!reel?.caption) return;
    showToast((await copyText(reel.caption)) ? 'Caption copied' : "Couldn't copy. Press and hold the text.", 'info');
  };
  const sendToPhone = async () => {
    if (!reel) return;
    setBusy('send');
    try { setReel(await reelsApi.send(reel.id)); showToast(`Emailed to ${status?.emailTo || 'you'}`); }
    catch (e: any) { showToast(e.message || "Couldn't send the email", 'error'); }
    finally { setBusy(''); }
  };
  const togglePosted = async () => {
    if (!reel) return;
    setBusy('posted');
    try { setReel(await reelsApi.setPosted(reel.id, !reel.posted)); showToast(reel.posted ? 'Moved back to Ready' : 'Marked as posted'); }
    catch (e: any) { showToast(e.message || "Couldn't update", 'error'); }
    finally { setBusy(''); }
  };
  const again = async () => {
    if (!reel) return;
    setBusy('again');
    try { setReel(await reelsApi.remake(reel.id, {})); }
    catch (e: any) { showToast(e.message || "Couldn't start again", 'error'); }
    finally { setBusy(''); }
  };
  const review = async (action: ReviewAction) => {
    if (!reel) return;
    setBusy(action);
    try {
      const updated = await reelsApi.review(reel.id, action);
      if (action === 'reject') { showToast('Moved to the archive. The script is kept.'); onDeleted(); return; }
      setReel(updated);
      showToast(action === 'approve' ? 'Approved — ready to post' : 'Back to pending');
    } catch (e: any) { showToast(e.message || "Couldn't update", 'error'); }
    finally { setBusy(''); }
  };
  const restore = async () => {
    if (!reel) return;
    setBusy('restore');
    try { setReel(await reelsApi.restore(reel.id)); showToast('Restored — remaking the video'); }
    catch (e: any) { showToast(e.message || "Couldn't restore", 'error'); }
    finally { setBusy(''); }
  };
  const remove = async () => {
    if (!reel || !window.confirm('Delete this reel and its video?')) return;
    try { await reelsApi.remove(reel.id); onDeleted(); } catch (e: any) { showToast(e.message || "Couldn't delete", 'error'); }
  };

  if (error && !reel) {
    return <div className="max-w-3xl mx-auto"><Back onBack={onBack} /><p className="text-[14px] text-red-600">{error}</p></div>;
  }
  if (!reel) return <div className="max-w-3xl mx-auto"><Back onBack={onBack} /><div className="skeleton h-64 rounded-3xl" /></div>;

  const done = reel.status === 'done';

  return (
    <div className="max-w-3xl mx-auto pb-44 md:pb-6">
      <Back onBack={onBack} />
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-tight text-gray-900 dark:text-white break-words">{reel.title}</h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            {reel.scenes} slides · {done && reel.seconds ? formatSeconds(reel.seconds) : `about ${formatSeconds(reel.estimate)}`}
            {' · '}{reel.needsRecording ? 'your voice' : `voice ${reel.voice}`}
            {reel.madeIn ? ` · made in ${Math.round(reel.madeIn)}s` : ''}
            {reel.posted ? ' · Posted' : ''}
          </p>
        </div>
        {reel.archived ? (
          <span className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-gray-300">
            <Archive size={13} /> Archived
          </span>
        ) : reel.review === 'approved' ? (
          <span className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
            <ThumbsUp size={13} /> Approved
          </span>
        ) : done ? (
          <span className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
            <CheckCircle2 size={13} /> Ready
          </span>
        ) : null}
      </div>

      {reel.archived && (
        <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-5 space-y-3">
          <div className="flex items-start gap-2 text-gray-700 dark:text-gray-200">
            <Archive size={18} className="shrink-0 mt-0.5" />
            <div><b>This reel is archived.</b> <span className="text-[14px]">The video was removed to save space, but the script is kept. Restore it to make the video again.</span></div>
          </div>
          <div className="flex gap-2">
            <button onClick={restore} disabled={busy === 'restore'} className="h-9 px-4 rounded-xl bg-purple-600 text-white text-[13px] font-semibold flex items-center gap-1.5">
              {busy === 'restore' ? <LoaderCircle size={14} className="animate-spin" /> : <ArchiveRestore size={14} />} Restore &amp; remake
            </button>
            <button onClick={() => onEdit(reel)} className="h-9 px-4 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold">Edit script</button>
            <button onClick={remove} className="h-9 px-3 rounded-xl text-red-600 text-[13px] font-semibold">Delete</button>
          </div>
        </div>
      )}

      {reel.status === 'waiting' && (
        <RecordStep reel={reel} status={status} onUploaded={r => setReel(r)} onEdit={() => onEdit(reel)} />
      )}

      {running && (
        <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-5 space-y-4" aria-live="polite">
          <div className="flex items-center gap-2">
            <LoaderCircle size={18} className="animate-spin text-purple-500" />
            <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white">
              {reel.status === 'queued'
                ? (reel.queuePosition && reel.queuePosition > 1 ? `In the queue — ${ordinal(reel.queuePosition)} in line` : 'Waiting for its turn')
                : 'Making your reel'}
            </h3>
            <span className="text-[12px] text-gray-400 ml-auto tabular-nums">{Math.round(reel.progress.percent)}%</span>
          </div>
          <div className="h-2 rounded-full bg-black/[0.06] dark:bg-white/10 overflow-hidden">
            <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${Math.max(4, reel.progress.percent)}%` }} />
          </div>
          {reel.progress.stage && <p className="text-[13px] text-gray-600 dark:text-gray-300">{reel.progress.stage}</p>}
          <ul className="text-[12.5px] text-gray-500 space-y-0.5 font-mono max-h-32 overflow-y-auto">
            {(reel.log || []).slice(-5).map((l, i) => <li key={i} className="truncate">{l.text}</li>)}
          </ul>
          <p className="text-[12.5px] text-gray-500 flex items-center gap-1.5"><Mail size={14} /> {status?.emailReady && status.emailOn ? `We'll email ${status.emailTo} when it's ready. You can close this page.` : 'Keep this page open.'}</p>
        </div>
      )}

      {reel.status === 'failed' && (
        <div className="rounded-3xl border border-red-300/60 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-5 space-y-3">
          <div className="flex items-start gap-2 text-red-800 dark:text-red-200"><AlertTriangle size={18} className="shrink-0 mt-0.5" /><div><b>It didn't work.</b> <span className="text-[14px]">{reel.error || 'The reel maker stopped.'}</span></div></div>
          <div className="flex gap-2">
            <button onClick={again} disabled={busy === 'again'} className="h-9 px-4 rounded-xl bg-red-600 text-white text-[13px] font-semibold flex items-center gap-1.5"><RefreshCw size={14} /> Try again</button>
            <button onClick={() => onEdit(reel)} className="h-9 px-4 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold">Edit script</button>
            <button onClick={remove} className="h-9 px-3 rounded-xl text-red-600 text-[13px] font-semibold">Delete</button>
          </div>
        </div>
      )}

      {done && !reel.archived && (
        <>
          {reel.warnings && reel.warnings.length > 0 && (
            <div className="mb-4 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200 p-3.5 text-[13px] space-y-1">
              <b>Worth a look:</b>
              <ul className="list-disc pl-5">{reel.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          <div className="flex justify-center">
            {reel.media ? <video
              key={stamp}
              src={videoUrl(reel)}
              poster={posterUrl(reel)}
              controls
              playsInline
              preload="metadata"
              className="w-full max-w-[340px] aspect-[9/16] rounded-3xl bg-black border border-black/10 dark:border-white/10"
            /> : <p className="text-[13px] text-gray-500">The video file is missing on the Pi. Press Make again.</p>}
          </div>

          <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4 mt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-gray-400">Caption</h3>
              <button onClick={copyCaption} className="flex items-center gap-1 text-[12.5px] font-semibold text-purple-600 dark:text-purple-300"><Copy size={13} /> Copy</button>
            </div>
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-gray-800 dark:text-gray-100 select-text">{reel.caption || 'No caption in this script.'}</p>
            <p className="text-[12px] text-gray-400 mt-3">Add your trending music in Instagram: the video carries the voice only.</p>
          </div>

          {/* Phone: the big buttons sit at the bottom, under the thumb. */}
          <div className="fixed md:static bottom-[calc(4rem+env(safe-area-inset-bottom))] inset-x-0 z-20 md:z-auto p-3 md:p-0 md:mt-4 bg-white/90 dark:bg-[#141416]/90 md:bg-transparent backdrop-blur-xl md:backdrop-blur-none border-t md:border-0 border-black/5 dark:border-white/10 pb-3 md:pb-0">
            <div className="max-w-3xl mx-auto space-y-2">
              {file ? (
                <button onClick={share} className="w-full h-12 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition">
                  <Share2 size={18} /> Share reel to Instagram
                </button>
              ) : (
                <a href={videoUrl(reel, fileName(reel))} download={fileName(reel)} className="w-full h-12 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition">
                  <Download size={18} /> Download reel (.mp4)
                </a>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={copyCaption} className="h-10 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center justify-center gap-1.5"><Copy size={14} /> Copy caption</button>
                <button onClick={togglePosted} disabled={busy === 'posted'} className={`h-10 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 ${reel.posted ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' : 'bg-black/[0.06] dark:bg-white/10'}`}>
                  <Check size={14} /> {reel.posted ? 'Posted' : 'Mark posted'}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4 space-y-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-gray-400">More ways to get it</h3>
              <div className="flex flex-wrap gap-2">
                {file && <a href={videoUrl(reel, fileName(reel))} download={fileName(reel)} className="h-9 px-3.5 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center gap-1.5"><Download size={14} /> Download</a>}
                <button onClick={sendToPhone} disabled={busy === 'send'} className="h-9 px-3.5 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center gap-1.5">
                  {busy === 'send' ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />} Send to my phone
                </button>
                <button onClick={() => onEdit(reel)} className="h-9 px-3.5 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center gap-1.5"><Pencil size={14} /> Edit script</button>
                <button onClick={again} disabled={busy === 'again'} className="h-9 px-3.5 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center gap-1.5"><RefreshCw size={14} /> Make again</button>
                <button onClick={remove} className="h-9 px-3.5 rounded-xl text-red-600 text-[13px] font-semibold flex items-center gap-1.5 hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 size={14} /> Delete</button>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 border-t border-black/5 dark:border-white/10">
                {reel.review !== 'approved' ? (
                  <button onClick={() => review('approve')} disabled={busy === 'approve'} className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold flex items-center gap-1.5">
                    {busy === 'approve' ? <LoaderCircle size={14} className="animate-spin" /> : <ThumbsUp size={14} />} Approve
                  </button>
                ) : (
                  <button onClick={() => review('reset')} disabled={busy === 'reset'} className="h-9 px-3.5 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center gap-1.5"><ThumbsUp size={14} /> Approved · undo</button>
                )}
                <button onClick={() => review('reject')} disabled={busy === 'reject'} className="h-9 px-3.5 rounded-xl text-amber-700 dark:text-amber-300 text-[13px] font-semibold flex items-center gap-1.5 hover:bg-amber-50 dark:hover:bg-amber-500/10">
                  {busy === 'reject' ? <LoaderCircle size={14} className="animate-spin" /> : <Archive size={14} />} Reject (archive)
                </button>
              </div>
              {!status?.secureLink && <p className="text-[12px] text-gray-400">The share button needs the https link to Sage (your tunnel). On the home network use Download.</p>}
              {reel.emailed && <p className="text-[12px] text-gray-400 flex items-center gap-1.5"><Mail size={13} /> Emailed to {status?.emailTo}</p>}
              {reel.emailError && !reel.emailed && <p className="text-[12px] text-amber-700 dark:text-amber-300">Email: {reel.emailError}</p>}
            </div>
            {qr && (
              <div className="hidden md:flex surface rounded-3xl border border-black/5 dark:border-white/5 p-4 flex-col items-center gap-2">
                <img src={qr} alt="QR code that opens this reel on your phone" className="w-28 h-28 rounded-lg bg-white" />
                <span className="text-[12px] text-gray-500 flex items-center gap-1"><Smartphone size={12} /> Scan to open on phone</span>
                <a className="sr-only" href={reelLink(reel, status)}>Link</a>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Record the voice-over here (with the lines to read), or send a recording you already have. */
function RecordStep({ reel, status, onUploaded, onEdit }: { reel: Reel; status: ReelMakerStatus | null; onUploaded: (r: Reel) => void; onEdit: () => void }) {
  const { showToast } = useToast();
  const lines = narration(reel.script || '');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState<number | null>(null);
  const [take, setTake] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canRecord = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => () => { stream.current?.getTracks().forEach(t => t.stop()); }, []);
  useEffect(() => {
    if (!recording) return;
    const t0 = Date.now();
    const timer = setInterval(() => setSeconds((Date.now() - t0) / 1000), 250);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => () => { if (take) URL.revokeObjectURL(take.url); }, [take]);

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
      stream.current = s;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => {
        s.getTracks().forEach(t => t.stop());
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunks.current, { type });
        const ext = type.includes('mp4') ? 'm4a' : 'webm';
        setTake({ blob, name: `voice.${ext}`, url: URL.createObjectURL(blob) });
      };
      recorder.current = rec;
      setSeconds(0);
      setTake(null);
      rec.start();
      setRecording(true);
    } catch {
      showToast("Couldn't use the microphone. Allow it in the browser, or upload a recording instead.", 'error');
    }
  };
  const stop = () => { recorder.current?.stop(); setRecording(false); };

  const send = async (blob: Blob, name: string) => {
    setSending(0);
    try { onUploaded(await uploadVoice(reel.id, blob, name, setSending)); }
    catch (e: any) { showToast(e.message || "Couldn't send the recording", 'error'); setSending(null); }
  };

  return (
    <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Mic size={18} className="text-purple-500" />
        <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white">Your voice-over</h3>
        <span className="text-[12px] text-gray-400 ml-auto">about {formatSeconds(reel.estimate)}</span>
      </div>
      <p className="text-[13px] text-gray-600 dark:text-gray-300">
        Read the script below in one go, at your own pace. The slides will follow your words. Leave a short pause between slides.
      </p>

      {lines.length > 0 && (
        <ol className="rounded-2xl bg-black/[0.03] dark:bg-white/5 p-4 space-y-2.5 max-h-72 overflow-y-auto text-[15px] leading-relaxed text-gray-800 dark:text-gray-100 select-text">
          {lines.map((l, i) => <li key={i}><b className="text-purple-500 tabular-nums mr-2">{i + 1}</b>{l}</li>)}
        </ol>
      )}

      {sending !== null ? (
        <div className="space-y-2" aria-live="polite">
          <div className="h-2 rounded-full bg-black/[0.06] dark:bg-white/10 overflow-hidden"><div className="h-full bg-purple-500 transition-all" style={{ width: `${Math.max(4, sending * 100)}%` }} /></div>
          <p className="text-[12.5px] text-gray-500">Sending to the Pi{sending >= 1 ? ' and checking it' : ''}...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {canRecord && !take && (
            recording ? (
              <button onClick={stop} className="w-full h-12 rounded-2xl bg-red-600 text-white font-semibold text-[15px] flex items-center justify-center gap-2">
                <Square size={16} fill="currentColor" /> Stop <span className="tabular-nums opacity-80">{formatSeconds(seconds)}</span>
              </button>
            ) : (
              <button onClick={start} className="w-full h-12 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[15px] flex items-center justify-center gap-2">
                <Mic size={18} /> Record here
              </button>
            )
          )}
          {take && (
            <div className="space-y-2">
              <audio src={take.url} controls className="w-full" />
              <div className="flex gap-2">
                <button onClick={() => send(take.blob, take.name)} className="flex-1 h-11 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[14px]">Use this recording</button>
                <button onClick={() => { setTake(null); start(); }} className="h-11 px-4 rounded-2xl bg-black/[0.06] dark:bg-white/10 text-[14px] font-semibold">Record again</button>
              </div>
            </div>
          )}
          {!recording && !take && (
            <button onClick={() => input.current?.click()} className="w-full h-11 rounded-2xl bg-black/[0.06] dark:bg-white/10 text-[14px] font-semibold flex items-center justify-center gap-2">
              <FileAudio size={16} /> Upload a recording
            </button>
          )}
          <input ref={input} type="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.mp4,.mov" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) send(f, f.name); }} />
          <p className="text-[12px] text-gray-400">
            Up to {status?.maxVoiceMb || 150} MB. A phone voice memo works. {!canRecord && 'Recording here needs the https link to Sage.'}
          </p>
          <button onClick={onEdit} className="text-[12.5px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">Edit the script</button>
        </div>
      )}
    </div>
  );
}

/** 1 -> "1st", 2 -> "2nd", for the queue line. */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** A phone whose browser can hand files to the share sheet. */
function phoneCanShare(): boolean {
  try {
    return typeof navigator.canShare === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch { return false; }
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="flex items-center gap-1.5 mb-3 text-[13px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">
      <ArrowLeft size={15} /> Reels
    </button>
  );
}
