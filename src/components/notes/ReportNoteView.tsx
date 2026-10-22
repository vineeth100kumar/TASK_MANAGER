import { useEffect, useMemo, useState } from 'react';
import { Check, Code2, Copy, Download, Eye, FileCode, Maximize2, Minimize2, Sparkles } from 'lucide-react';
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

  const btn = 'p-2 rounded-lg text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-colors';
  const lines = body.split('\n').length;

  return (
    <div className={full ? 'fixed inset-0 z-50 flex flex-col bg-white dark:bg-[#1c1c1e]' : 'flex-1 flex flex-col min-h-0'}>
      <div className="flex items-center gap-2 px-4 md:px-8 py-2 border-b border-gray-100 dark:border-white/5">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
          {isCode ? <FileCode size={13} /> : <Sparkles size={13} />}
          {isCode ? `Code${note.language ? ` · ${note.language}` : ''}` : 'Report'}<span className="hidden sm:inline">· from {sourceName(note.source)}</span>
        </span>
        {full && <span className="text-sm font-semibold truncate dark:text-white">{note.title}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          <div className="flex p-0.5 mr-1 rounded-lg bg-black/[0.05] dark:bg-white/[0.06]" role="tablist" aria-label="Show">
            {(['view', 'source'] as const).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${tab === t ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}>
                {t === 'view' ? <Eye size={13} /> : <Code2 size={13} />}{t === 'view' ? (isCode ? 'Code' : 'Preview') : 'Edit'}
              </button>
            ))}
          </div>
          <button onClick={copy} className={btn} title="Copy" aria-label="Copy">{copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}</button>
          <button onClick={download} className={btn} title="Download" aria-label="Download"><Download size={16} /></button>
          <button onClick={() => setFull(f => !f)} className={btn} title={full ? 'Exit full screen' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {tab === 'source' ? (
        <textarea value={body} onChange={e => onChange(e.target.value, toText(e.target.value))} spellCheck={false}
          placeholder={isCode ? 'Paste code here' : 'Paste HTML here'} aria-label="Source"
          className="flex-1 min-h-0 w-full resize-none p-4 md:px-8 font-mono text-[13px] leading-relaxed bg-[#f5f5f7] dark:bg-[#111113] text-gray-800 dark:text-gray-200 outline-none" />
      ) : isCode ? (
        <div className="flex-1 min-h-0 overflow-auto p-4 md:p-8">
          <style>{`.sage-code{${themeVars(theme)}}${HIGHLIGHT_CSS.replace(/\.hl-/g, '.sage-code .hl-')}`}</style>
          <pre className="sage-code flex text-[13px] leading-relaxed rounded-2xl border border-black/5 dark:border-white/10 bg-[#f5f5f7] dark:bg-[#111113] text-gray-800 dark:text-gray-200 overflow-x-auto">
            <span aria-hidden className="select-none text-right pl-4 pr-3 py-4 text-gray-400 dark:text-gray-600 border-r border-black/5 dark:border-white/10">
              {Array.from({ length: lines }, (_, i) => <span key={i} className="block">{i + 1}</span>)}
            </span>
            <code className="block px-4 py-4 font-mono" dangerouslySetInnerHTML={{ __html: highlighted }} />
          </pre>
        </div>
      ) : body.trim() ? (
        // No allow-same-origin: the page can't reach the app, its storage or its data.
        <iframe key={`${note.id}-${theme}`} title={note.title || 'Report'} sandbox={REPORT_SANDBOX} srcDoc={srcDoc}
          referrerPolicy="no-referrer" className="flex-1 min-h-0 w-full border-0 bg-white dark:bg-[#1c1c1e]" style={{ colorScheme: theme }} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-8 text-center">
          Empty report. Open Edit and paste some HTML, or ask Claude to push one here.
        </div>
      )}
    </div>
  );
}
