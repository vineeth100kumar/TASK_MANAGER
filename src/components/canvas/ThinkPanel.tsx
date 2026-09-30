import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, SearchCheck, ListTree, ArrowUp, Loader2, Copy, RotateCcw, Wand2, Check, Undo2, LayoutGrid, Paperclip, FileText, MousePointerClick } from 'lucide-react';
import { aiEngine, ThinkDetail, ThinkEngine, ThinkMode, ThinkTurn } from '../../services/aiEngine';
import { piBackendUrl } from '../../services/piBackend';
import { EdgeMap, EditOp, RefMap, cleanOps, repairFlow, scopeOps } from './boardEdits';
import { cleanMarkdown, markdownChart } from './markdownChart';

interface Snapshot {
  outline: string;
  imagePng: string | null;
  refs?: RefMap;
  selected?: string[];
  edges?: EdgeMap;
  edgeLabels?: Record<string, string>;
}

interface ThinkPanelProps {
  boardId: string;
  // How many shapes are selected on the board right now.
  selectedCount: number;
  boardTitle: string;
  // The board as it is right now: a text outline and a PNG (base64, may be null).
  // forEdit gives numbered shapes and the refs behind the numbers instead;
  // useSelection false reads it as if nothing were selected.
  getSnapshot: (forEdit?: boolean, useSelection?: boolean) => Promise<Snapshot>;
  describeEdits: (ops: EditOp[], refs: RefMap) => string[];
  // Applies edits; returns a function that puts the board back, or null.
  applyEdits: (ops: EditOp[], refs: RefMap, keepFocus?: boolean) => Promise<(() => void) | null>;
  onClose: () => void;
}

// Changes the AI made or wants to make.
interface Proposal {
  ops: EditOp[];
  refs: RefMap;
  lines: string[];
  scoped?: boolean; // made to a selection
  status: 'pending' | 'applied' | 'discarded' | 'undone';
  undo?: () => void;
}

interface Turn extends ThinkTurn {
  label?: string; // what to show for a button press instead of the full prompt
  engine?: ThinkEngine; // which AI wrote an answer
  proposal?: Proposal;
}

const ENGINE_NAMES: Record<ThinkEngine, string> = { groq: 'Groq', claude: 'Claude', local: "the Pi's small model" };

// Groq and Claude answer in seconds; the Pi's local model can take minutes.
// Past this the request is dropped rather than leaving the panel waiting forever.
const TIMEOUT_MS = 150_000;

// Shortcuts shown above the chat box. Everything typed goes to the editor,
// which answers questions and makes changes alike.
const ACTIONS: Array<{ mode: ThinkMode; label: string; icon: typeof SearchCheck; request?: string; whole?: boolean }> = [
  { mode: 'review', label: 'Check my thinking', icon: SearchCheck },
  { mode: 'summarize', label: 'Summarize', icon: ListTree },
  { mode: 'edit', label: 'Improve it', icon: Wand2 },
  { mode: 'edit', label: 'Tidy layout', icon: LayoutGrid, request: 'Tidy the layout so it reads top to bottom.', whole: true },
];

const AUTO_APPLY_KEY = 'sage.canvasAutoApply';
const DETAIL_KEY = 'sage.canvasDetail';
// An attached Markdown file goes with the next message as its source. Bigger
// files are cut to this so the request stays quick and cheap.
const MAX_FILE_CHARS = 40_000;
const MAX_FILE_BYTES = 2_000_000;
const FILE_PROMPT = 'Turn this file into a flowchart.';
// Asks about a file that want a chart back, so a chart drawn straight from the
// file is a fair stand-in when the AI can't make one.
const wantsChart = (q: string) => q === FILE_PROMPT || /\b(chart|flow|diagram|draw|map|visuali[sz]e)/i.test(q);
interface Attached { name: string; text: string }
const DETAILS: Array<{ value: ThinkDetail; label: string; hint: string }> = [
  { value: 'simple', label: 'Simple', hint: 'A short chain of the big steps' },
  { value: 'moderate', label: 'Moderate', hint: 'The main steps with a few branches' },
  { value: 'complex', label: 'Complex', hint: 'Full detail with decisions, branches and loops' },
];
// Each board keeps its own conversation in this browser, so closing the panel
// or switching boards doesn't lose it. Undo only lasts for this visit.
const chatKey = (boardId: string) => `sage.canvasChat.${boardId}`;
const loadChat = (boardId: string): Turn[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(chatKey(boardId)) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
};
// The file a board's chart was drawn from stays with its conversation, so
// later questions and edits can check details against it.
const sourceKey = (boardId: string) => `sage.canvasSource.${boardId}`;
const loadSource = (boardId: string): Attached | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(sourceKey(boardId)) || 'null');
    return saved && typeof saved.name === 'string' && typeof saved.text === 'string' ? saved : null;
  } catch { return null; }
};
const readDetail = (): ThinkDetail => {
  try {
    const saved = localStorage.getItem(DETAIL_KEY);
    return DETAILS.some(d => d.value === saved) ? saved as ThinkDetail : 'moderate';
  } catch { return 'moderate'; }
};
const readAutoApply = () => {
  try { return localStorage.getItem(AUTO_APPLY_KEY) !== 'off'; } catch { return true; }
};

// What the AI is told happened to its earlier changes, so "undo that" and
// "make it bigger" have something to refer to.
const historyText = (t: Turn) => {
  if (t.role !== 'assistant' || !t.proposal) return t.text;
  const what = { pending: 'proposed, not applied yet', applied: 'applied', discarded: 'discarded by me', undone: 'undone' }[t.proposal.status];
  return `${t.text}\n[Changes ${what}: ${t.proposal.lines.join('; ')}]`;
};

// A chat beside the board: ask about it, or tell it what to change.
export function ThinkPanel({ boardId, selectedCount, boardTitle, getSnapshot, describeEdits, applyEdits, onClose }: ThinkPanelProps) {
  const [turns, setTurns] = useState<Turn[]>(() => loadChat(boardId));
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const [input, setInput] = useState('');
  const [autoApply, setAutoApply] = useState(readAutoApply);
  const [detail, setDetail] = useState(readDetail);
  const [attached, setAttached] = useState<Attached | null>(null);
  const [source, setSource] = useState<Attached | null>(() => loadSource(boardId));
  useEffect(() => {
    try {
      if (source) localStorage.setItem(sourceKey(boardId), JSON.stringify(source));
      else localStorage.removeItem(sourceKey(boardId));
    } catch { /* storage full or blocked: it just isn't kept */ }
  }, [source, boardId]);
  const fileRef = useRef<HTMLInputElement>(null);
  // With shapes selected, changes stay inside the selection unless you switch
  // to the whole board; picking something else turns selection mode back on.
  const [wholeBoard, setWholeBoard] = useState(false);
  useEffect(() => setWholeBoard(false), [selectedCount]);
  const scoped = selectedCount > 0 && !wholeBoard && !attached;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<ThinkEngine | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<{ controller: AbortController; timedOut: boolean } | null>(null);

  useEffect(() => {
    try {
      // Keep the last 40 turns; functions (undo) don't survive storage anyway.
      const keep = turns.slice(-40).map(t => (t.proposal ? { ...t, proposal: { ...t.proposal, undo: undefined } } : t));
      if (keep.length) localStorage.setItem(chatKey(boardId), JSON.stringify(keep));
      else localStorage.removeItem(chatKey(boardId));
    } catch { /* storage full or blocked: the chat just isn't kept */ }
  }, [turns, boardId]);

  // Ready to type as soon as the panel opens.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Seconds spent waiting, so a slow answer doesn't look frozen.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // Drop an in-flight request when the panel closes.
  useEffect(() => () => abortRef.current?.controller.abort(), []);
  const hasPi = Boolean(piBackendUrl());

  useEffect(() => {
    if (hasPi) aiEngine.canvasThinkEngine().then(setEngine).catch(() => setEngine(null));
  }, [hasPi]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const toggleAutoApply = () => {
    const next = !autoApply;
    setAutoApply(next);
    try { localStorage.setItem(AUTO_APPLY_KEY, next ? 'on' : 'off'); } catch { /* storage blocked */ }
  };

  const chooseDetail = (next: ThinkDetail) => {
    setDetail(next);
    try { localStorage.setItem(DETAIL_KEY, next); } catch { /* storage blocked */ }
  };

  // Only the newest applied change can be undone: undoing puts the board back
  // to just before it, which would also drop anything applied after.
  const lastApplied = () => {
    for (let i = turnsRef.current.length - 1; i >= 0; i--) {
      const p = turnsRef.current[i].proposal;
      if (p?.status === 'applied') return p.undo ? i : -1;
    }
    return -1;
  };

  const setProposal = (index: number, changes: Partial<Proposal>) =>
    setTurns(prev => prev.map((t, i) => (i === index && t.proposal ? { ...t, proposal: { ...t.proposal, ...changes } } : t)));

  const undoTurn = (index: number) => {
    turnsRef.current[index]?.proposal?.undo?.();
    setProposal(index, { status: 'undone', undo: undefined });
  };

  const apply = async (index: number, proposal = turnsRef.current[index]?.proposal) => {
    if (!proposal) return;
    const undo = await applyEdits(proposal.ops, proposal.refs, proposal.scoped);
    if (undo) setProposal(index, { status: 'applied', undo });
    else setError("Couldn't reach the board to make the changes.");
  };

  const pickFile = async (file?: File) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) { setError('Pick a Markdown (.md) file.'); return; }
    if (file.size > MAX_FILE_BYTES) { setError(`${file.name} is too big. Try a file under 2 MB.`); return; }
    try {
      const text = (await file.text()).trim();
      if (!text) { setError(`${file.name} is empty.`); return; }
      const clean = cleanMarkdown(text);
      setAttached({ name: file.name, text: clean.slice(0, MAX_FILE_CHARS) });
      setError(clean.length > MAX_FILE_CHARS ? `${file.name} is long, so I'll only read the first part of it.` : null);
      inputRef.current?.focus();
    } catch {
      setError(`Couldn't read ${file.name}.`);
    }
  };

  // whole: this one works on the whole board even with shapes selected.
  const run = async (mode: ThinkMode, label: string, question?: string, whole = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const file = attached;
    setAttached(null);
    const inScope = mode === 'edit' && scoped && !whole;
    const history = turnsRef.current.map(t => ({ role: t.role, text: historyText(t) }));
    const shown = question || label;
    setTurns(prev => [...prev, { role: 'user', text: file ? `${shown}\n\nAttached: ${file.name}` : shown, label: file ? undefined : label }]);
    const request = { controller: new AbortController(), timedOut: false };
    abortRef.current = request;
    const timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, TIMEOUT_MS);
    let snap: Snapshot | null = null;
    // A plain chart of the attached file, for when the AI can't draw one.
    const fromFile = () => (file && snap?.refs && wantsChart(shown) ? cleanOps(markdownChart(file.text, detail, file.name).ops, snap.refs) : []);
    try {
      snap = await getSnapshot(mode === 'edit', !(mode === 'edit' && (wholeBoard || file || whole)));
      const { outline, imagePng, refs, selected = [], edges = {}, edgeLabels = {} } = snap;
      const scope = inScope && selected.length ? selected : undefined;
      // A new file is the thing to chart; otherwise the board's source file
      // comes along for reference.
      const doc = file ? { document: file.text, documentName: file.name, documentRole: 'new' as const }
        : source ? { document: source.text, documentName: source.name, documentRole: 'source' as const } : {};
      const answer = await aiEngine.canvasThink({ mode, boardTitle, outline, imagePng, question, history, detail, scope, ...doc }, request.controller.signal);
      setEngine(answer.engine);
      let ops = mode === 'edit' && refs ? cleanOps(answer.ops, refs) : [];
      let held = 0;
      if (scope && refs) ({ ops, held } = scopeOps(ops, scope, edges, refs));
      if (refs && ops[0]?.op !== 'undo_last') ops = repairFlow(ops, edges, refs, edgeLabels);
      let answerText = answer.text;
      if (file && !ops.some(o => o.op === 'add_node')) {
        const backup = fromFile();
        if (backup.length) {
          ops = backup;
          answerText = `The AI didn't send back a chart, so I drew this straight from the headings and lists in ${file.name}. Ask me to improve it, or select part of it to work on.`;
        }
      }
      if (file && ops.some(o => o.op === 'add_node')) setSource(file);
      if (held) answerText += `\n\nI left ${held === 1 ? 'one change' : `${held} changes`} outside your selection alone.`;

      if (ops[0]?.op === 'undo_last') {
        const last = lastApplied();
        const undone = last >= 0 ? turnsRef.current[last].proposal!.lines : null;
        if (last >= 0) undoTurn(last);
        setTurns(prev => [...prev, {
          role: 'assistant',
          engine: answer.engine,
          text: undone ? `${answer.text || 'Done.'}\n\nTook back: ${undone.join('; ')}.` : 'There was nothing of mine to undo.',
        }]);
        return;
      }

      const proposal: Proposal | undefined = ops.length && refs
        ? { ops, refs, lines: describeEdits(ops, refs), status: 'pending', scoped: Boolean(scope) }
        : undefined;
      const index = turnsRef.current.length;
      // The AI described changes that didn't point at anything on the board.
      const lost = mode === 'edit' && !ops.length && Array.isArray(answer.ops) && answer.ops.length > 0;
      const text = lost ? `${answerText}\n\nI couldn't match those changes to the board, so nothing changed. Try naming the boxes you mean.` : answerText;
      setTurns(prev => [...prev, { role: 'assistant', text, engine: answer.engine, proposal }]);
      // Like a spreadsheet copilot: make the change straight away, with Undo
      // beside it. Turn that off to review each change first.
      if (proposal && autoApply) setTimeout(() => apply(index, proposal), 0);
    } catch (e: any) {
      const backup = e?.name === 'AbortError' && !request.timedOut ? [] : fromFile();
      if (backup.length && snap?.refs) {
        // The AI couldn't be reached; the file still becomes a chart.
        const proposal: Proposal = { ops: backup, refs: snap.refs, lines: describeEdits(backup, snap.refs), status: 'pending' };
        const index = turnsRef.current.length;
        setTurns(prev => [...prev, { role: 'assistant', text: `I couldn't reach the AI, so I drew this straight from the headings and lists in ${file!.name}.`, proposal }]);
        setSource(file);
        if (autoApply) setTimeout(() => apply(index, proposal), 0);
        return;
      }
      if (e?.name === 'AbortError') {
        if (request.timedOut) setError("No answer after 2½ minutes, so I stopped waiting. The Pi may be busy; try again in a moment.");
      } else {
        setError(e?.message || 'Something went wrong.');
      }
      setTurns(prev => prev.slice(0, -1));
      if (file) setAttached(file);
    } finally {
      clearTimeout(timer);
      if (abortRef.current === request) abortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const send = () => {
    const q = input.trim() || (attached ? FILE_PROMPT : '');
    if (!q) return;
    setInput('');
    run('edit', q, q);
  };

  const newest = lastApplied();

  return (
    <aside className="flex flex-col h-full bg-white dark:bg-[#161618] text-gray-900 dark:text-gray-100">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200/70 dark:border-white/[0.08] shrink-0">
        <Sparkles size={16} className="text-violet-500" />
        <span className="text-[14px] font-semibold flex-1">Think with me</span>
        {turns.length > 0 && (
          <button onClick={() => { setTurns([]); setError(null); setSource(null); }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-white/5 dark:hover:text-gray-200" aria-label="Start over" title="Start over">
            <RotateCcw size={15} />
          </button>
        )}
        <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-white/5 dark:hover:text-gray-200" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
        {!hasPi ? (
          <p className="text-[13px] text-gray-500 leading-relaxed">The thinking partner runs on your Pi server, and this copy of the app isn't connected to one.</p>
        ) : turns.length === 0 && !busy ? (
          <div className="text-[13px] text-gray-500 leading-relaxed space-y-2">
            <p>I work on this board with you. Ask me about it, or tell me what to change and I'll change it.</p>
            <ul className="space-y-1 text-gray-600 dark:text-gray-400">
              <li>"Add a step after Applied: wait for a reply"</li>
              <li>"Turn this into a yes/no decision" (select a shape first)</li>
              <li>"Make it bigger and colour it green"</li>
              <li>"Undo that"</li>
            </ul>
          </div>
        ) : null}

        {turns.map((turn, i) => turn.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-br-md bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-[13px] font-medium whitespace-pre-wrap">
              {turn.label || turn.text}
            </div>
          </div>
        ) : (
          <div key={i} className="group">
            <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{turn.text}</div>
            {turn.proposal && (
              <div className="mt-2 rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/60 dark:bg-violet-500/10 p-3 space-y-2">
                <ul className="text-[12.5px] leading-snug space-y-1">
                  {turn.proposal.lines.map((line, j) => <li key={j}>• {line}</li>)}
                </ul>
                {turn.proposal.status === 'pending' && (
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => apply(i)} className="flex items-center gap-1 h-8 px-3 rounded-lg text-[12.5px] font-semibold bg-violet-600 text-white hover:bg-violet-700">
                      <Check size={13} /> Apply to board
                    </button>
                    <button onClick={() => setProposal(i, { status: 'discarded' })} className="h-8 px-3 rounded-lg text-[12.5px] font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5">
                      Discard
                    </button>
                  </div>
                )}
                {turn.proposal.status === 'applied' && (
                  <div className="flex items-center gap-3 text-[12px] text-gray-500">
                    <span className="flex items-center gap-1 font-semibold text-violet-700 dark:text-violet-300"><Check size={13} /> Done</span>
                    {i === newest && turn.proposal.undo && (
                      <button onClick={() => undoTurn(i)} className="flex items-center gap-1 font-semibold hover:text-gray-800 dark:hover:text-gray-200">
                        <Undo2 size={12} /> Undo
                      </button>
                    )}
                  </div>
                )}
                {turn.proposal.status === 'discarded' && <p className="text-[12px] text-gray-500">Discarded.</p>}
                {turn.proposal.status === 'undone' && <p className="text-[12px] text-gray-500">Undone.</p>}
              </div>
            )}
            <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400">
              {turn.engine && <span>Answered by {ENGINE_NAMES[turn.engine]}</span>}
              <button
                onClick={() => navigator.clipboard?.writeText(turn.text)}
                className="flex items-center gap-1 font-semibold hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Copy size={11} /> Copy
              </button>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[13px] text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            <span className="flex-1">Working on your board…{elapsed >= 5 ? ` ${elapsed}s` : ''}</span>
            <button onClick={() => abortRef.current?.controller.abort()} className="text-[12px] font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
          </div>
        )}
        {error && <p className="text-[13px] text-red-600 dark:text-red-400 leading-relaxed">{error}</p>}
      </div>

      {hasPi && (
        <div className="shrink-0 border-t border-gray-200/70 dark:border-white/[0.08] p-3 space-y-2">
          {/* One scrolling row on phones, so the answers above keep their room. */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible">
            {ACTIONS.map(({ mode, label: name, icon: Icon, request, whole }) => {
              const label = scoped && name === 'Improve it' ? 'Improve selection' : name;
              return (
              <button
                key={name}
                disabled={busy}
                onClick={() => run(mode, label, request, whole)}
                className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20 disabled:opacity-50 transition-colors"
              >
                <Icon size={13} /> {label}
              </button>
              );
            })}
          </div>
          {/* What the next message works with: a selection, a file, the board's source. */}
          <div className="flex flex-wrap gap-1.5 empty:hidden">
            {selectedCount > 0 && !attached && (
              <div className="flex items-center gap-1.5 w-fit max-w-full h-7 pl-2 pr-1 rounded-lg bg-violet-50 dark:bg-violet-500/10 text-[12px] text-violet-800 dark:text-violet-200">
                <MousePointerClick size={13} className="shrink-0" />
                <span className="truncate">{scoped ? `Working on ${selectedCount === 1 ? '1 selected shape' : `${selectedCount} selected shapes`}` : 'Working on the whole board'}</span>
                <button onClick={() => setWholeBoard(!wholeBoard)} className="shrink-0 h-5 px-1.5 rounded font-semibold text-violet-600 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-500/20">
                  {scoped ? 'Whole board' : 'Just the selection'}
                </button>
              </div>
            )}
            {source && !attached && (
              <div className="flex items-center gap-1.5 w-fit max-w-full h-7 pl-2 pr-1 rounded-lg bg-gray-100 dark:bg-white/[0.06] text-[12px] text-gray-600 dark:text-gray-300">
                <FileText size={13} className="shrink-0 text-violet-600 dark:text-violet-300" />
                <span className="truncate">Checking against {source.name}</span>
                <button onClick={() => setSource(null)} aria-label={`Stop using ${source.name}`} title="Stop using this file" className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  <X size={12} />
                </button>
              </div>
            )}
            {attached && (
              <div className="flex items-center gap-1.5 w-fit max-w-full h-7 pl-2 pr-1 rounded-lg bg-gray-100 dark:bg-white/[0.06] text-[12px] text-gray-700 dark:text-gray-200">
                <FileText size={13} className="shrink-0 text-violet-600 dark:text-violet-300" />
                <span className="truncate">{attached.name}</span>
                <button onClick={() => setAttached(null)} aria-label={`Remove ${attached.name}`} className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden" onChange={e => pickFile(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Attach a Markdown file" title="Attach a Markdown (.md) file to turn into a chart" className="h-10 w-8 shrink-0 flex items-center justify-center rounded-xl text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-white/[0.06] disabled:opacity-40 transition-colors">
              <Paperclip size={17} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={2}
              placeholder={attached ? 'Say what to do, or just send' : scoped ? 'What should change in the selection?' : 'Ask, or tell me what to change…'}
              className="field flex-1 resize-none max-h-32 h-10 md:h-auto"
            />
            <button onClick={send} disabled={busy || (!input.trim() && !attached)} aria-label="Send" className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
              <ArrowUp size={17} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[11.5px] text-gray-500 select-none cursor-pointer min-w-0">
              <input type="checkbox" checked={autoApply} onChange={toggleAutoApply} className="accent-violet-600" />
              <span className="truncate">Make changes right away<span className="hidden lg:inline"> (untick to review each one first)</span></span>
            </label>
            {/* How much the AI draws when it makes or fills in a chart. */}
            <div role="radiogroup" aria-label="Chart detail" className="shrink-0 flex rounded-lg bg-gray-100 dark:bg-white/[0.06] p-0.5">
              {DETAILS.map(d => (
                <button
                  key={d.value}
                  role="radio"
                  aria-checked={detail === d.value}
                  title={d.hint}
                  onClick={() => chooseDetail(d.value)}
                  className={`h-6 px-2 rounded-md text-[11.5px] font-semibold transition-colors ${detail === d.value ? 'bg-white text-violet-700 shadow-sm dark:bg-white/15 dark:text-violet-200' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          {engine === 'local' && (
            <p className="text-[11px] text-gray-400 leading-snug">Using the Pi's small built-in model, which only reads text and misses a lot. Add a Groq key in Settings, under Server & Reset, for fast, sharper answers.</p>
          )}
        </div>
      )}
    </aside>
  );
}
