import { useEffect, useMemo, useState } from 'react';
import { Check, Code2, Copy, Download, Eye, FileCode, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { Note } from '../../services/types';
import { REPORT_SANDBOX, buildReportDocument, highlightCode, themeVars, HIGHLIGHT_CSS, FrameTheme } from './reportFrame';

/** Follows the app's light/dark switch (the `dark` class on <html>). */
function useAppTheme(): FrameTheme {
  const read = (): FrameTheme => document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const [theme, setTheme] = useState<FrameTheme>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

const SOURCE_NAMES: Record<string, string> = { claude: 'Claude', gemini: 'Gemini', chatgpt: 'ChatGPT', openai: 'ChatGPT', you: 'You' };
const sourceName = (s?: string | null) => (s ? SOURCE_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1) : 'You');

interface ReportNoteViewProps {
  note: Note;
  body: string;
  onChange: (body: string, text: string) => void;
}

/**
 * An HTML report or a code note. Reports show in a sandboxed frame dressed in
 * Sage's theme; code shows highlighted with line numbers. Both have a Source
 * tab where the text can be read, copied or edited.
 */
export function ReportNoteView({ note, body, onChange }: ReportNoteViewProps) {
  const isCode = note.kind === 'code';
  const theme = useAppTheme();
  const [tab, setTab] = useState<'view' | 'source'>('view');
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const srcDoc = useMemo(() => (isCode || tab !== 'view' ? '' : buildReportDocument(body, theme)), [body, theme, isCode, tab]);
  const highlighted = useMemo(() => (isCode ? highlightCode(body, note.language) : ''), [body, isCode, note.language]);

  useEffect(() => { setTab('view'); setFull(false); }, [note.id]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  const download = () => {
    const ext = isCode ? (note.language || 'txt') : 'html';
    const blob = new Blob([body], { type: isCode ? 'text/plain' : 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(note.title || 'note').replace(/[^\w .-]+/g, '').trim() || 'note'}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const toText = (src: string) => isCode ? src : (new DOMParser().parseFromString(src, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();

  const btn = 'grid place-items-center w-8 h-8 rounded-[10px] text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white active:scale-95 transition';
  const lines = body.split('\n').length;
  const size = body.length < 1024 ? `${body.length} B` : `${(body.length / 1024).toFixed(body.length < 10240 ? 1 : 0)} KB`;
  const accent = isCode ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : 'text-blue-600 dark:text-blue-400 bg-blue-500/10';

  return (
    <div className={full ? 'fixed inset-0 z-50 flex flex-col bg-[#f5f5f7] dark:bg-[#0a0a0b]' : 'flex-1 flex flex-col min-h-0 bg-[#f5f5f7]/60 dark:bg-black/20'}>
      <div className="flex items-center gap-2.5 px-4 md:px-6 py-2.5 bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur border-b border-black/5 dark:border-white/5">
        <span className={`grid place-items-center w-8 h-8 rounded-[10px] shrink-0 ${accent}`}>
          {isCode ? <FileCode size={16} /> : <Sparkles size={16} />}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">
            {full ? note.title : isCode ? (note.language ? note.language.toUpperCase() : 'Code') : 'HTML report'}
          </div>
          <div className="text-[11px] text-gray-500 truncate">
            from {sourceName(note.source)} · {isCode ? `${lines} line${lines === 1 ? '' : 's'}` : size}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative flex p-0.5 mr-1 rounded-xl bg-black/[0.05] dark:bg-white/[0.06]" role="tablist" aria-label="Show">
            {(['view', 'source'] as const).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors ${tab === t ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                {tab === t && <motion.span layoutId="report-tab-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-[10px] bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 dark:ring-white/5" />}
                <span className="relative flex items-center gap-1.5">
                  {t === 'view' ? <Eye size={13} /> : <Code2 size={13} />}
                  <span className="hidden sm:inline">{t === 'view' ? (isCode ? 'Code' : 'Preview') : 'Edit'}</span>
                </span>
              </button>
            ))}
          </div>
          <button onClick={copy} className={btn} title={copied ? 'Copied' : 'Copy'} aria-label="Copy">{copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}</button>
          <button onClick={download} className={btn} title="Download" aria-label="Download"><Download size={16} /></button>
          <button onClick={() => setFull(f => !f)} className={btn} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col p-2 md:p-4">
        <div className="flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden bg-white dark:bg-[#1c1c1e] ring-1 ring-black/5 dark:ring-white/5 shadow-sm">
          {tab === 'source' ? (
            <>
              <textarea value={body} onChange={e => onChange(e.target.value, toText(e.target.value))} spellCheck={false} autoFocus={!body}
                placeholder={isCode ? 'Paste or type code…' : 'Paste HTML from any AI…'} aria-label="Source"
                className="flex-1 min-h-0 w-full resize-none p-4 md:p-5 font-mono text-[13px] leading-relaxed bg-transparent text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none" />
              <div className="px-4 py-1.5 text-[11px] text-gray-400 border-t border-black/5 dark:border-white/5 flex justify-between">
                <span>{lines} line{lines === 1 ? '' : 's'} · {size}</span><span>Saves as you type</span>
              </div>
            </>
          ) : !body.trim() ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <span className={`grid place-items-center w-12 h-12 rounded-2xl ${accent}`}>{isCode ? <FileCode size={22} /> : <Sparkles size={22} />}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{isCode ? 'No code yet' : 'No report yet'}</p>
                <p className="text-xs text-gray-500 mt-1 max-w-xs">Paste it in yourself, or ask Claude (or any AI on the Sage connector) to push one here.</p>
              </div>
              <button onClick={() => setTab('source')} className="mt-1 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95 transition">
                {isCode ? 'Paste code' : 'Paste HTML'}
              </button>
            </div>
          ) : isCode ? (
            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
              <style>{`.sage-code{${themeVars(theme)}}${HIGHLIGHT_CSS.replace(/\.hl-/g, '.sage-code .hl-')}`}</style>
              <pre className="sage-code flex min-w-max text-[13px] leading-[1.7] text-gray-800 dark:text-gray-200">
                <span aria-hidden className="sticky left-0 select-none text-right pl-4 pr-3 py-4 text-gray-300 dark:text-gray-600 bg-white dark:bg-[#1c1c1e] border-r border-black/5 dark:border-white/5">
                  {Array.from({ length: lines }, (_, i) => <span key={i} className="block">{i + 1}</span>)}
                </span>
                <code className="block px-5 py-4 font-mono" dangerouslySetInnerHTML={{ __html: highlighted }} />
              </pre>
            </div>
          ) : (
            // No allow-same-origin: the page can't reach the app, its storage or its data.
            <iframe key={`${note.id}-${theme}`} title={note.title || 'Report'} sandbox={REPORT_SANDBOX} srcDoc={srcDoc}
              referrerPolicy="no-referrer" className="flex-1 min-h-0 w-full border-0 bg-white dark:bg-[#1c1c1e]" style={{ colorScheme: theme }} />
          )}
        </div>
      </div>
    </div>
  );
}
