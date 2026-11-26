// DuplexDialog - Back to back on a printer with no duplex unit, one sheet at a time.
//
// The Pi prints one side and waits. This dialog tells you what to do with the
// paper and sends the next side only when you press the button. Closing it keeps
// the job on the Pi, so Printer drop can bring it back.

import { useEffect, useState } from 'react';
import { Printer, Loader2, RotateCw, X, Check, FlipVertical2 } from 'lucide-react';
import { duplexApi, type DuplexJob } from '../../services/printing';
import { useToast } from '../../context/ToastContext';

interface Props {
  job: DuplexJob;
  /** Print the first side the moment the dialog opens (a job just made). */
  autoStart?: boolean;
  onClose: () => void;
}

export function DuplexDialog({ job: first, autoStart, onClose }: Props) {
  const { showToast } = useToast();
  const [job, setJob] = useState<DuplexJob>(first);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<DuplexJob>) => {
    setBusy(true);
    try { setJob(await fn()); }
    catch (e: any) { showToast(e?.message || "The printer didn't take that", 'error'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (autoStart && first.stage === 'start') act(() => duplexApi.next(first.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stop = async () => {
    try { await duplexApi.stop(job.id); } catch { /* already gone */ }
    onClose();
  };

  const finished = job.finished;
  const label = job.stage === 'start' ? 'Print sheet 1' : job.next || 'Continue';
  const primary = 'h-11 px-5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition disabled:opacity-60 flex items-center justify-center gap-2';
  const quiet = 'h-9 px-3 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 transition disabled:opacity-50 flex items-center gap-1.5';

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="duplex-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-5 shadow-xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0"><Printer size={17} /></div>
          <div className="min-w-0 flex-1">
            <h3 id="duplex-title" className="text-base font-semibold text-gray-900 dark:text-white truncate">Back to back</h3>
            <p className="text-xs text-gray-500 truncate">{job.title} · {job.printer}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={16} /></button>
        </div>

        <div className="flex items-center gap-1.5" aria-label={`Sheet ${Math.min(job.sheet, job.sheets)} of ${job.sheets}`}>
          {Array.from({ length: Math.min(job.sheets, 24) }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${finished || i + 1 < job.sheet ? 'bg-blue-600' : i + 1 === job.sheet ? 'bg-blue-400' : 'bg-black/10 dark:bg-white/15'}`} />
          ))}
        </div>

        <div className="rounded-xl bg-gray-50 dark:bg-white/5 p-4 text-sm text-gray-800 dark:text-gray-100 flex gap-3">
          {finished ? <Check size={18} className="text-green-500 shrink-0 mt-0.5" /> : job.stage === 'flip' ? <FlipVertical2 size={18} className="text-amber-500 shrink-0 mt-0.5" /> : <Printer size={18} className="text-blue-500 shrink-0 mt-0.5" />}
          <p>{job.message}{!finished && job.sheets > 1 ? <span className="block text-xs text-gray-500 mt-1">Sheet {job.sheet} of {job.sheets}</span> : null}</p>
        </div>
        {job.error && <p className="text-xs text-red-600 dark:text-red-400">{job.error}</p>}

        {finished ? (
          <button className={primary + ' w-full'} onClick={onClose}>Done</button>
        ) : (
          <>
            <button className={primary + ' w-full'} disabled={busy} onClick={() => act(() => duplexApi.next(job.id))}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}{label}
            </button>
            <div className="flex items-center justify-between">
              <button className={quiet} disabled={busy || job.stage === 'start'} onClick={() => act(() => duplexApi.again(job.id))}><RotateCw size={13} />Print that side again</button>
              <button className={quiet} disabled={busy} onClick={stop}>Stop</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
