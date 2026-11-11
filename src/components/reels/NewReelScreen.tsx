// NewReelScreen - paste or upload a reel script, pick a look, and have the Pi make the video.
// The script is checked as you type (line numbers, scenes, how long it will run, which voice),
// and Make is pinned to the bottom of a phone so it is always under the thumb.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ClipboardPaste, FileUp, LoaderCircle, Mail, Mic, Sparkles, Wand2 } from 'lucide-react';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import { EXAMPLE_REEL, ReelCheck, downloadReelFormat, ReelMakerStatus, STYLE_LABELS, VOICE_PICKS, formatSeconds, reelsApi, withVoice } from '../../services/reels';
import { useToast } from '../../context/ToastContext';
import { Select } from '../common/Select';
import type { Reel } from '../../services/reels';

interface Props {
  status: ReelMakerStatus | null;
  projectId?: string;
  /** Editing a finished reel: Make makes it again with the new script. */
  edit?: { id: string; script: string; style: string } | null;
  onMade: (reel: Reel) => void;
  onCancel: () => void;
}

export function NewReelScreen({ status, projectId = '', edit = null, onMade, onCancel }: Props) {
  const { showToast } = useToast();
  const [script, setScript] = useState(edit?.script || '');
  const [style, setStyle] = useState(edit?.style || '');
  // "script" = keep what the script says; "mine" = own recording; any voice id overrides it
  const [voice, setVoice] = useState('script');
  const [project, setProject] = useState(projectId);
  const [check, setCheck] = useState<ReelCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const projects = useMemo(
    () => (api.sync.getState().projects.filter(Boolean) as Project[]).filter(p => p.type === 'content' && p.autoContent),
    [],
  );

  // The script sent to the Pi, with the voice pick applied on top
  const scriptForPi = useMemo(() => withVoice(script, voice), [script, voice]);

  // Check a moment after typing stops.
  useEffect(() => {
    if (!scriptForPi.trim()) { setCheck(null); return; }
    setChecking(true);
    const timer = setTimeout(() => {
      reelsApi.check(scriptForPi).then(setCheck).catch(() => setCheck(null)).finally(() => setChecking(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [scriptForPi]);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setScript(text); else showToast('The clipboard is empty', 'info');
    } catch {
      showToast('Your browser blocked the clipboard. Long-press in the box and paste.', 'info');
    }
  };
  const upload = async (f?: File | null) => {
    if (!f) return;
    if (f.size > 200_000) { showToast('That file is too big for a script.', 'error'); return; }
    setScript(await f.text());
  };

  const effectiveStyle = style || check?.style || 'grid_pill';
  const ownVoice = Boolean(check?.needsRecording);
  const voiceBlocked = Boolean(check && !ownVoice && status && !status.voiceReady);
  const blocked = !status?.ready || !script.trim() || (check ? !check.ok : false) || busy || voiceBlocked;
  const errors = check?.issues.filter(i => i.severity === 'ERROR') || [];
  const warnings = check?.issues.filter(i => i.severity !== 'ERROR') || [];

  const make = async () => {
    setBusy(true);
    try {
      const reel = edit
        ? await reelsApi.remake(edit.id, { script: scriptForPi, style: effectiveStyle })
        : await reelsApi.create({ script: scriptForPi, style: effectiveStyle, projectId: project });
      onMade(reel);
    } catch (e: any) {
      showToast(e.message || "Couldn't start the reel", 'error');
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-28 md:pb-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[20px] font-semibold tracking-tight text-gray-900 dark:text-white">{edit ? 'Edit script' : 'New reel'}</h2>
        <button type="button" onClick={onCancel} className="text-[13px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">Cancel</button>
      </div>

      {status && !status.ready && (
        <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-3.5 text-[13px] text-amber-900 dark:text-amber-200 flex gap-2.5">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div><b>The reel maker isn't ready on this Pi.</b> {status.problems.join(' ')}</div>
        </div>
      )}
      {status?.ready && !status.voiceReady && (
        <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-3.5 text-[13px] text-amber-900 dark:text-amber-200 flex gap-2.5">
          <Mic size={16} className="shrink-0 mt-0.5" />
          <div><b>The built-in voice isn't set up.</b> {status.voiceProblem} You can still make reels with your own recording: put <code>voice: mine</code> in the script.</div>
        </div>
      )}

      <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={paste} className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-purple-600 text-white text-[13px] font-semibold active:scale-95 transition-transform">
            <ClipboardPaste size={15} /> Paste
          </button>
          <button type="button" onClick={() => file.current?.click()} className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-black/[0.05] dark:bg-white/10 text-[13px] font-semibold text-gray-800 dark:text-gray-100">
            <FileUp size={15} /> Upload .md / .txt
          </button>
          {!script.trim() && (
            <button type="button" onClick={() => setScript(EXAMPLE_REEL)} className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">
              <Sparkles size={15} /> Try an example
            </button>
          )}
          <button type="button" title="Download the script format guide (REEL_FORMAT.md)"
            onClick={() => downloadReelFormat().catch(() => showToast("Couldn't download the format guide.", 'error'))}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">
            <BookOpen size={15} /> Format guide
          </button>
          <input ref={file} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        <textarea
          value={script}
          onChange={e => setScript(e.target.value)}
          placeholder={'Paste your reel script here.\n\n---\nautocontent: reel\nvoice: af_heart\n---\n\n## cover\nheadline: Your hook\nsay: The words the voice says.'}
          aria-label="Reel script"
          spellCheck={false}
          className="field font-mono text-[13px] leading-relaxed min-h-[260px] md:min-h-[340px] resize-y"
        />
        <div className="flex items-center justify-between text-[12px] text-gray-400">
          <span>{script.length.toLocaleString()} / {(status?.maxScript || 60000).toLocaleString()} characters</span>
          {checking && <span className="flex items-center gap-1"><LoaderCircle size={12} className="animate-spin" /> Checking</span>}
        </div>

        {check && (
          <div className="space-y-3" aria-live="polite">
            {check.scenes.length > 0 && (
              <div className="rounded-2xl bg-black/[0.03] dark:bg-white/5 p-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-gray-600 dark:text-gray-300">
                  <span className="font-semibold">About {formatSeconds(check.seconds)}</span>
                  <span className="inline-flex items-center gap-1"><Mic size={12} /> {ownVoice ? 'Your own recording' : `Voice: ${check.voice}`}</span>
                  <span>{check.captions ? 'Word-by-word captions' : 'No captions'}</span>
                </div>
                <ol className="space-y-1">
                  {check.scenes.map(s => (
                    <li key={s.n} className="flex items-baseline gap-2 text-[12.5px]">
                      <b className="tabular-nums text-gray-400 w-4 shrink-0">{s.n}</b>
                      <span className="shrink-0 font-semibold text-gray-700 dark:text-gray-200">{s.type}</span>
                      <span className="truncate text-gray-500" title={s.say}>{s.words ? `${s.words} words · ${s.motion}` : 'no narration'}{s.title ? ` · ${s.title}` : ''}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {check.scenes.length === 0 && <span className="text-[13px] text-gray-500">No slides found yet.</span>}
            {errors.length > 0 && (
              <ul className="space-y-1.5">
                {errors.map((i, k) => (
                  <li key={k} className="rounded-xl bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-200 px-3 py-2 text-[13px]">
                    {i.line ? <b className="tabular-nums">Line {i.line}: </b> : null}{i.message}
                    {i.hint && <div className="text-[12px] opacity-80 mt-0.5">{i.hint}</div>}
                  </li>
                ))}
              </ul>
            )}
            {warnings.length > 0 && (
              <details className="text-[13px] text-amber-800 dark:text-amber-200">
                <summary className="cursor-pointer font-semibold">{warnings.length} warning{warnings.length > 1 ? 's' : ''}</summary>
                <ul className="mt-1.5 space-y-1">
                  {warnings.map((i, k) => <li key={k}>{i.line ? <b className="tabular-nums">Line {i.line}: </b> : null}{i.message}</li>)}
                </ul>
              </details>
            )}
            {check.ok && errors.length === 0 && <div className="text-[13px] text-emerald-700 dark:text-emerald-400 font-semibold">Script OK: {check.scenes.length} slides</div>}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="field-label mb-1.5">Style</label>
            <Select value={effectiveStyle} onChange={setStyle} className="field w-full" aria-label="Style">
              {(status?.styles || ['grid_pill', 'beige_grain']).map(s => <option key={s} value={s}>{STYLE_LABELS[s] || s}</option>)}
            </Select>
          </div>
          <div>
            <label className="field-label mb-1.5">Voice</label>
            <Select value={voice} onChange={setVoice} className="field w-full" aria-label="Voice">
              <option value="script">From the script</option>
              {VOICE_PICKS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              <option value="mine">Your own recording</option>
            </Select>
          </div>
          {!edit && (
            <div className="sm:col-span-2">
              <label className="field-label mb-1.5">Project</label>
              <Select value={project} onChange={setProject} className="field w-full" aria-label="Project">
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
          )}
        </div>
        {!edit && projects.length === 0 && (
          <p className="text-[12px] text-gray-400">To keep reels as tasks, edit a Content project and switch on <b>Use Auto Content</b>.</p>
        )}
      </div>

      <div className="fixed md:static bottom-[calc(4rem+env(safe-area-inset-bottom))] inset-x-0 z-20 md:z-auto p-3 md:p-0 md:mt-4 bg-white/90 dark:bg-[#141416]/90 md:bg-transparent backdrop-blur-xl md:backdrop-blur-none border-t md:border-0 border-black/5 dark:border-white/10 pb-3 md:pb-0">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
          <button type="button" disabled={blocked} onClick={make}
            className="flex-1 md:flex-none md:min-w-[200px] flex items-center justify-center gap-2 h-12 md:h-11 px-6 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[15px] disabled:opacity-40 shadow-sm shadow-purple-600/20 active:scale-[0.98] transition">
            {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Wand2 size={18} />} {edit ? 'Make again' : ownVoice ? 'Next: record your voice' : 'Make reel'}
          </button>
          <p className="text-[12.5px] text-gray-500 flex items-start gap-1.5">
            <Mail size={14} className="shrink-0 mt-0.5" />
            {status?.emailReady && status.emailOn
              ? <span>A few minutes. We'll email {status.emailTo || 'you'} when it's done, so you can close this page. Add music in Instagram.</span>
              : <span>A few minutes. Email is off or not set up, so keep this page open (Settings &gt; Notifications).</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
