// DropView - Drop: share an HTML report or a small site as a temporary link,
// like Netlify Drop.
//
// Drag an .html file, a folder or a .zip onto the zone (or click to pick, or
// paste), pick how long the link lives, and copy it. The Pi serves each drop
// at /d/<slug>/ without the password until it expires (raspberry_pi/drop.py).

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Clock, Copy, ExternalLink, Eye, FileCode, FileText, FolderOpen, Globe, Infinity as InfinityIcon, Link2, Loader2, Power, Send, Server, Trash2, UploadCloud } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  DEFAULT_HOURS, Drop, DropFile, EXPIRY_CHOICES, dropApi, dropAvailable, dropLink,
  filesFromDataTransfer, filesFromInput, sizeText, timeLeft,
} from '../../services/drop';

const HOURS_KEY = 'sage-drop-hours';

export function DropView() {
  const { showToast } = useToast();
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [maxMb, setMaxMb] = useState(50);
  const [error, setError] = useState('');
  const [hours, setHoursState] = useState<number>(() => {
    try { return Number(localStorage.getItem(HOURS_KEY)) || DEFAULT_HOURS; } catch { return DEFAULT_HOURS; }
  });
  const setHours = (h: number) => {
    setHoursState(h);
    try { localStorage.setItem(HOURS_KEY, String(h)); } catch { /* storage unavailable */ }
  };
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  // What the Pi is doing with the drop right now, for the status bar.
  const [status, setStatus] = useState<{ stage: 'reading' | 'uploading' | 'saving' | 'done' | 'warning' | 'error'; text: string; percent: number } | null>(null);
  const [fresh, setFresh] = useState<Drop | null>(null);
  // Things the Pi noticed that would make the shared page look wrong (say, an unbuilt project).
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copied, setCopied] = useState('');
  const [, tick] = useState(0);
  // Clipboard: share a piece of text as a temporary link.
  const [clipText, setClipText] = useState('');
  const [clipBusy, setClipBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await dropApi.list();
      setDrops(data.drops);
      setBase(data.base);
      setMaxMb(data.maxMb);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, []);

  useEffect(() => {
    if (!dropAvailable()) return;
    load();
    // Time left counts down, and expired drops fall off the list.
    const timer = setInterval(() => { tick(n => n + 1); load(); }, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const copy = async (drop: Drop) => {
    try {
      await navigator.clipboard.writeText(dropLink(drop, base));
      setCopied(drop.id);
      setTimeout(() => setCopied(c => (c === drop.id ? '' : c)), 1600);
    } catch {
      showToast("Couldn't copy. Select the link and copy it yourself.", 'error');
    }
  };

  const send = useCallback(async (files: DropFile[], label: string) => {
    if (!files.length) { setStatus(null); return; }
    const total = files.reduce((n, f) => n + f.file.size, 0);
    if (total > maxMb * 1024 * 1024) {
      showToast(`That's ${sizeText(total)}. A drop can be up to ${maxMb} MB.`, 'error');
      return;
    }
    setBusy(label);
    const size = sizeText(total);
    setStatus({ stage: 'reading', text: `Reading ${files.length} file${files.length === 1 ? '' : 's'} (${size})`, percent: 0 });
    try {
      const { drop, base: b, warnings: warned } = await dropApi.create(files, hours, '', 'upload', (sent, all) => {
        const percent = Math.round((sent / all) * 100);
        setStatus(percent >= 100
          ? { stage: 'saving', text: 'Uploaded. The Pi is saving your files and making the link…', percent: 100 }
          : { stage: 'uploading', text: `Uploading ${label}: ${sizeText(Math.round(total * sent / all))} of ${size}`, percent });
      });
      setBase(b);
      setFresh(drop);
      setWarnings(warned || []);
      setDrops(list => [drop, ...(list || []).filter(d => d.id !== drop.id)]);
      let copiedNow = false;
      try {
        await navigator.clipboard.writeText(dropLink(drop, b));
        setCopied(drop.id);
        copiedNow = true;
        setTimeout(() => setCopied(c => (c === drop.id ? '' : c)), 1600);
      } catch { /* the Copy button is right there */ }
      if (warned?.length) {
        // Stays until dismissed: the link works but the page would come up blank.
        setStatus({ stage: 'warning', text: warned[0], percent: 100 });
      } else {
        setStatus({ stage: 'done', text: `Link is live${copiedNow ? ' and copied' : ''}: ${drop.name}, ${drop.files} file${drop.files === 1 ? '' : 's'}`, percent: 100 });
        setTimeout(() => setStatus(s => (s?.stage === 'done' ? null : s)), 6000);
      }
    } catch (e: any) {
      setStatus({ stage: 'error', text: e.message || "Couldn't share that", percent: 0 });
      showToast(e.message || "Couldn't share that", 'error');
    } finally {
      setBusy('');
    }
  }, [hours, maxMb, showToast]);

  // Paste a file, or a page of HTML copied from anywhere.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        e.preventDefault();
        send(files.map(file => ({ file, path: file.name })), 'pasted files');
        return;
      }
      const html = e.clipboardData?.getData('text/plain') || '';
      if (/^\s*</.test(html) && /<\/?(html|body|div|h1|p|style|svg|table|section)\b/i.test(html)) {
        e.preventDefault();
        send([{ file: new Blob([html], { type: 'text/html' }), path: 'index.html' }], 'pasted HTML');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [send]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (busy) return;
    try {
      setStatus({ stage: 'reading', text: 'Reading what you dropped…', percent: 0 });
      const files = await filesFromDataTransfer(e.dataTransfer);
      send(files, files.length === 1 ? files[0].path : `${files.length} files`);
    } catch {
      showToast("Couldn't read what was dropped", 'error');
    }
  };

  const remove = async (drop: Drop) => {
    try {
      await dropApi.remove(drop.id);
      setDrops(list => (list || []).filter(d => d.id !== drop.id));
      if (fresh?.id === drop.id) { setFresh(null); setWarnings([]); }
      showToast('Link deleted');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const apply = (updated: Drop) => {
    setDrops(list => (list || []).map(d => (d.id === updated.id ? updated : d)));
    if (fresh?.id === updated.id) setFresh(updated);
  };

  const togglePermanent = async (drop: Drop) => {
    try {
      apply(await dropApi.setPermanent(drop.id, !drop.permanent));
      showToast(drop.permanent ? 'Link now expires again' : 'Link kept permanently');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const toggleEnabled = async (drop: Drop) => {
    try {
      apply(await dropApi.setEnabled(drop.id, drop.disabled));
      showToast(drop.disabled ? 'Link turned back on' : 'Link turned off');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const shareClip = async () => {
    const text = clipText.trim();
    if (!text || clipBusy) return;
    setClipBusy(true);
    try {
      const { drop, base: b } = await dropApi.clip(clipText, hours);
      setBase(b);
      setFresh(drop);
      setWarnings([]);
      setDrops(list => [drop, ...(list || []).filter(d => d.id !== drop.id)]);
      setClipText('');
      let copiedNow = false;
      try { await navigator.clipboard.writeText(dropLink(drop, b)); setCopied(drop.id); copiedNow = true; setTimeout(() => setCopied(c => (c === drop.id ? '' : c)), 1600); } catch { /* button is right there */ }
      setStatus({ stage: 'done', text: `Text link is live${copiedNow ? ' and copied' : ''}`, percent: 100 });
      setTimeout(() => setStatus(s => (s?.stage === 'done' ? null : s)), 6000);
    } catch (e: any) {
      showToast(e.message || "Couldn't share that text", 'error');
    } finally {
      setClipBusy(false);
    }
  };

  if (!dropAvailable()) {
    return (
      <div className="max-w-md mx-auto text-center py-20 space-y-3">
        <div className="surface-item p-4 rounded-2xl inline-flex text-gray-500"><Server size={28} /></div>
        <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Drop runs on the Pi</h3>
        <p className="text-[14px] text-gray-500">Links are served by Sage's Pi server, so Drop works when the app is opened from the Pi.</p>
      </div>
    );
  }

  const live = (drops || []).filter(d => d.permanent || d.expiresAt > Date.now() / 1000);

  return (
    <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl">
        <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2">
          <span className={`inline-block w-2 h-2 rounded-full ${base ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]' : 'bg-amber-500'}`} />
          <span>{base ? 'Public links on' : 'Home network only'}</span>
        </div>
        <h1 className="text-display text-[28px] md:text-[44px] font-semibold leading-[1.05] pb-1">Drop</h1>
        <p className="text-[14.5px] text-gray-500 dark:text-gray-400 mt-1">
          Share an HTML report or a site sample as a link that switches itself off.
        </p>
        {error && (
          <p className="mt-3 text-[12.5px] font-medium text-red-600 dark:text-red-400 flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Can't reach the Pi right now ({error}).
          </p>
        )}
        {!error && drops && !base && (
          <p className="mt-3 text-[12.5px] font-medium text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            The Pi has no public link yet, so these links only open on your home network. Turn on the tunnel (Settings &gt; Server &amp; Reset) to share them with anyone.
          </p>
        )}
      </div>

      <div
        onDragEnter={e => { e.preventDefault(); depth.current += 1; setOver(true); }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) setOver(false); }}
        onDrop={onDrop}
        onClick={() => !busy && fileInput.current?.click()}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fileInput.current?.click(); } }}
        role="button" tabIndex={0} aria-label="Drop a file, folder or zip to share, or press to pick one"
        className={`drop-zone relative rounded-3xl border-2 border-dashed cursor-pointer transition-all duration-200 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/30
          ${over ? 'border-blue-500 bg-blue-500/[0.07] scale-[1.01]' : 'border-gray-300 dark:border-white/15 bg-white/60 dark:bg-white/[0.02] hover:border-blue-400 hover:bg-blue-500/[0.03]'}`}>
        <div className="flex flex-col items-center justify-center text-center px-6 py-14 md:py-20 gap-3">
          <motion.span animate={over ? { y: -6, scale: 1.08 } : busy ? { y: 0, scale: 1 } : { y: [0, -4, 0] }}
            transition={over || busy ? { type: 'spring', stiffness: 400, damping: 20 } : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            className={`grid place-items-center w-16 h-16 rounded-2xl ${over ? 'bg-blue-600 text-white' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
            {busy ? <Loader2 size={30} className="animate-spin" /> : <UploadCloud size={30} />}
          </motion.span>
          <div>
            <p className="text-[18px] md:text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white">
              {busy ? `Sharing ${busy}…` : over ? 'Let go to share it' : 'Drag and drop your report or site here'}
            </p>
            <p className="text-[13.5px] text-gray-500 mt-1.5">
              An .html file, a folder or a .zip, up to {maxMb} MB. Or{' '}
              <span className="text-blue-600 dark:text-blue-400 font-semibold underline-offset-2 hover:underline">browse to upload</span>
              , or paste HTML.
            </p>
          </div>
          <button type="button" onClick={e => { e.stopPropagation(); if (!busy) folderInput.current?.click(); }}
            className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 transition">
            <FolderOpen size={14} /> Pick a folder
          </button>
        </div>
      </div>

      {status && (
        <div role="status" aria-live="polite"
          className={`rounded-2xl px-4 py-3 space-y-2 ring-1 ${status.stage === 'error' ? 'bg-red-500/10 ring-red-500/30' : status.stage === 'warning' ? 'bg-amber-500/10 ring-amber-500/30' : status.stage === 'done' ? 'bg-emerald-500/10 ring-emerald-500/30' : 'bg-blue-500/[0.07] ring-blue-500/20'}`}>
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-gray-800 dark:text-gray-100">
            {status.stage === 'error' ? <AlertTriangle size={15} className="text-red-500 shrink-0" />
              : status.stage === 'warning' ? <AlertTriangle size={15} className="text-amber-500 shrink-0" />
              : status.stage === 'done' ? <Check size={15} className="text-emerald-600 shrink-0" />
              : <Loader2 size={15} className="animate-spin text-blue-600 shrink-0" />}
            <span className="min-w-0 flex-1">{status.text}</span>
            {(status.stage === 'uploading') && <span className="tabular-nums text-gray-500">{status.percent}%</span>}
            {(status.stage === 'error' || status.stage === 'warning' || status.stage === 'done') && (
              <button onClick={() => setStatus(null)} className="text-[12px] font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Dismiss</button>
            )}
          </div>
          {status.stage !== 'error' && status.stage !== 'warning' && (
            <div className="h-1.5 rounded-full bg-black/[0.07] dark:bg-white/10 overflow-hidden" aria-hidden>
              <div className={`h-full rounded-full transition-[width] duration-200 ${status.stage === 'done' ? 'bg-emerald-500' : 'bg-blue-600'} ${status.stage === 'saving' || status.stage === 'reading' ? 'animate-pulse' : ''}`}
                style={{ width: `${status.stage === 'saving' || status.stage === 'done' ? 100 : Math.max(status.percent, status.stage === 'reading' ? 8 : 2)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Outside the zone, so their own clicks don't bubble up and open the file picker instead. */}
      <input ref={fileInput} type="file" multiple hidden accept=".html,.htm,.zip,text/html,application/zip,*/*"
        onChange={e => { const f = filesFromInput(e.target.files); e.target.value = ''; send(f, f.length === 1 ? f[0].path : `${f.length} files`); }} />
      <input ref={folderInput} type="file" hidden {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={e => { const f = filesFromInput(e.target.files); e.target.value = ''; send(f, f[0]?.path.split('/')[0] || 'folder'); }} />

      <div className="flex items-center justify-center gap-2 flex-wrap">
        <span className="text-[13px] text-gray-500 flex items-center gap-1.5"><Clock size={14} /> Link lasts</span>
        <div className="flex p-1 rounded-xl bg-black/[0.04] dark:bg-white/5" role="radiogroup" aria-label="Link lasts">
          {EXPIRY_CHOICES.map(c => (
            <button key={c.hours} role="radio" aria-checked={hours === c.hours} onClick={() => setHours(c.hours)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors whitespace-nowrap ${hours === c.hours ? 'bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Clipboard: share a piece of text as a temporary link. */}
      <div className="rounded-3xl p-4 md:p-5 surface-item space-y-3">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0"><FileText size={18} /></span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white leading-tight">Share some text</h2>
            <p className="text-[12.5px] text-gray-500">A note, a snippet, a list — anyone with the link reads it and can copy it. Text links are always temporary.</p>
          </div>
        </div>
        <textarea value={clipText} onChange={e => setClipText(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); shareClip(); } }}
          placeholder="Paste or type the text you want to share…" rows={4}
          className="w-full resize-y rounded-2xl bg-white dark:bg-black/30 ring-1 ring-black/10 dark:ring-white/10 px-3.5 py-3 text-[14px] text-gray-800 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500/40 placeholder:text-gray-400" />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[12px] text-gray-400">Switches off in {timeLeft(Date.now() / 1000 + hours * 3600)} · ⌘/Ctrl+Enter</span>
          <button onClick={shareClip} disabled={!clipText.trim() || clipBusy}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-[14px] flex items-center gap-1.5 active:scale-[0.98] transition">
            {clipBusy ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />} {clipBusy ? 'Sharing…' : 'Share as link'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {fresh && (
          <motion.div key={fresh.id} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
            className="rounded-3xl p-4 md:p-5 bg-emerald-500/10 ring-1 ring-emerald-500/30 space-y-3">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-gray-900 dark:text-white">
              <span className="grid place-items-center w-7 h-7 rounded-full bg-emerald-500 text-white"><Check size={16} /></span>
              Your link is live{copied === fresh.id ? ' and copied' : ''}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input readOnly value={dropLink(fresh, base)} onFocus={e => e.target.select()} aria-label="Share link"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-white dark:bg-black/30 ring-1 ring-black/10 dark:ring-white/10 font-mono text-[13px] text-gray-800 dark:text-gray-100 outline-none" />
              <button onClick={() => copy(fresh)} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[14px] flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition">
                {copied === fresh.id ? <Check size={16} /> : <Copy size={16} />} {copied === fresh.id ? 'Copied' : 'Copy'}
              </button>
              <a href={dropLink(fresh, base)} target="_blank" rel="noreferrer noopener"
                className="px-4 py-2.5 rounded-xl surface-item font-semibold text-[14px] text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
                <ExternalLink size={16} /> Open
              </a>
            </div>
            {warnings.map(w => (
              <p key={w} className="text-[12.5px] font-medium text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
              </p>
            ))}
            <p className="text-[12.5px] text-gray-500">
              {fresh.name} · {fresh.files} file{fresh.files === 1 ? '' : 's'} · {sizeText(fresh.bytes)} · switches off in {timeLeft(fresh.expiresAt)}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500 px-1">Live links{live.length ? ` · ${live.length}` : ''}</h2>
        {drops === null && !error ? (
          <div className="skeleton h-20" aria-busy="true" />
        ) : !live.length ? (
          <p className="text-[14px] text-gray-500 px-1 py-4">Nothing shared right now. Links you make show here until they switch off.</p>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {live.map(d => (
                <motion.li key={d.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }}
                  className={`surface-item rounded-2xl p-3 md:p-4 flex items-center gap-x-3 gap-y-2.5 flex-wrap sm:flex-nowrap ${d.disabled ? 'opacity-70' : ''}`}>
                  <span className={`grid place-items-center w-10 h-10 rounded-xl shrink-0 ${d.kind === 'clip' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : d.files > 1 ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
                    {d.kind === 'clip' ? <FileText size={18} /> : d.files > 1 ? <Globe size={18} /> : <FileCode size={18} />}
                  </span>
                  <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-auto">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[14.5px] font-semibold text-gray-900 dark:text-white truncate">{d.name}</span>
                      {d.permanent && <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"><InfinityIcon size={11} /> Permanent</span>}
                      {d.disabled && <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold bg-gray-500/15 text-gray-600 dark:text-gray-300">Off</span>}
                    </div>
                    <div className="text-[12.5px] text-gray-500 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                      {d.permanent ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><InfinityIcon size={12} /> Never expires</span>
                      ) : (
                        <span className={`flex items-center gap-1 ${d.expiresAt - Date.now() / 1000 < 3600 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                          <Clock size={12} /> {timeLeft(d.expiresAt)} left
                        </span>
                      )}
                      <span className="flex items-center gap-1"><Eye size={12} /> {d.views} view{d.views === 1 ? '' : 's'}</span>
                      {d.kind === 'clip'
                        ? <span className="truncate max-w-[14rem]">{d.preview ? `“${d.preview.replace(/\s+/g, ' ').trim().slice(0, 48)}”` : 'text'}</span>
                        : <span>{d.files} file{d.files === 1 ? '' : 's'} · {sizeText(d.bytes)}</span>}
                      {d.source === 'note' && <span>from Notes</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 w-full sm:w-auto sm:ml-auto">
                    <button onClick={() => copy(d)} title="Copy link"
                      className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/15 active:scale-95 transition">
                      {copied === d.id ? <Check size={15} /> : <Link2 size={15} />}{copied === d.id ? 'Copied' : 'Copy link'}
                    </button>
                    <a href={dropLink(d, base)} target="_blank" rel="noreferrer noopener" title="Open" aria-label="Open"
                      className="grid place-items-center w-9 h-9 rounded-xl text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white transition"><ExternalLink size={16} /></a>
                    {d.kind !== 'clip' && (
                      <button onClick={() => togglePermanent(d)}
                        title={d.permanent ? 'Make it expire again (1 day)' : 'Keep this link permanently'}
                        aria-label={d.permanent ? 'Make temporary' : 'Make permanent'} aria-pressed={d.permanent}
                        className={`grid place-items-center w-9 h-9 rounded-xl transition ${d.permanent ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'}`}>
                        <InfinityIcon size={16} />
                      </button>
                    )}
                    <button onClick={() => toggleEnabled(d)}
                      title={d.disabled ? 'Turn the link back on' : 'Turn the link off (keeps the files)'}
                      aria-label={d.disabled ? 'Turn on' : 'Turn off'} aria-pressed={!d.disabled}
                      className={`grid place-items-center w-9 h-9 rounded-xl transition ${d.disabled ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/15' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'}`}>
                      <Power size={16} />
                    </button>
                    <button onClick={() => remove(d)} title="Delete this link for good" aria-label="Delete link"
                      className="grid place-items-center w-9 h-9 rounded-xl text-gray-500 hover:bg-red-500/10 hover:text-red-600 transition"><Trash2 size={16} /></button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        <p className="text-[12px] text-gray-400 px-1 pt-1">
          Anyone with a link can open it until it switches off, or you turn it off or delete it. Permanent links stay until you remove them. Nothing else in Sage is shared, and pages run in a sandbox, so their scripts can't reach Sage.
        </p>
      </section>
    </div>
  );
}
