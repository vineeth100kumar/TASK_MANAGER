import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, SearchCheck, ListTree, ArrowUp, Loader2, Copy, RotateCcw, Wand2, Check, Undo2, LayoutGrid } from 'lucide-react';
import { aiEngine, ThinkEngine, ThinkMode, ThinkTurn } from '../../services/aiEngine';
import { piBackendUrl } from '../../services/piBackend';
import { EditOp, RefMap, cleanOps } from './boardEdits';

interface ThinkPanelProps {
  boardId: string;
  boardTitle: string;
  // The board as it is right now: a text outline and a PNG (base64, may be null).
  // forEdit gives numbered shapes and the refs behind the numbers instead.
  getSnapshot: (forEdit?: boolean) => Promise<{ outline: string; imagePng: string | null; refs?: RefMap }>;
  describeEdits: (ops: EditOp[], refs: RefMap) => string[];
  // Applies edits; returns a function that puts the board back, or null.
  applyEdits: (ops: EditOp[], refs: RefMap) => (() => void) | null;
  onClose: () => void;
}

// Changes the AI made or wants to make.
interface Proposal {
  ops: EditOp[];
  refs: RefMap;
  lines: string[];
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
const ACTIONS: Array<{ mode: ThinkMode; label: string; icon: typeof SearchCheck; request?: string }> = [
  { mode: 'review', label: 'Check my thinking', icon: SearchCheck },
  { mode: 'summarize', label: 'Summarize', icon: ListTree },
  { mode: 'edit', label: 'Improve it', icon: Wand2 },
  { mode: 'edit', label: 'Tidy layout', icon: LayoutGrid, request: 'Tidy the layout so it reads top to bottom.' },
];

const AUTO_APPLY_KEY = 'sage.canvasAutoApply';
// Each board keeps its own conversation in this browser, so closing the panel
// or switching boards doesn't lose it. Undo only lasts for this visit.
const chatKey = (boardId: string) => `sage.canvasChat.${boardId}`;
const loadChat = (boardId: string): Turn[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(chatKey(boardId)) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
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
export function ThinkPanel({ boardId, boardTitle, getSnapshot, describeEdits, applyEdits, onClose }: ThinkPanelProps) {
  const [turns, setTurns] = useState<Turn[]>(() => loadChat(boardId));
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const [input, setInput] = useState('');
  const [autoApply, setAutoApply] = useState(readAutoApply);
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

  const apply = (index: number, proposal = turnsRef.current[index]?.proposal) => {
    if (!proposal) return;
    const undo = applyEdits(proposal.ops, proposal.refs);
    if (undo) setProposal(index, { status: 'applied', undo });
    else setError("Couldn't reach the board to make the changes.");
  };

  const run = async (mode: ThinkMode, label: string, question?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const history = turnsRef.current.map(t => ({ role: t.role, text: historyText(t) }));
    setTurns(prev => [...prev, { role: 'user', text: question || label, label }]);
    const request = { controller: new AbortController(), timedOut: false };
    abortRef.current = request;
    const timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, TIMEOUT_MS);
    try {
      const { outline, imagePng, refs } = await getSnapshot(mode === 'edit');
      const answer = await aiEngine.canvasThink({ mode, boardTitle, outline, imagePng, question, history }, request.controller.signal);
      setEngine(answer.engine);
      const ops = mode === 'edit' && refs ? cleanOps(answer.ops, refs) : [];

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
        ? { ops, refs, lines: describeEdits(ops, refs), status: 'pending' }
        : undefined;
      const index = turnsRef.current.length;
      setTurns(prev => [...prev, { role: 'assistant', text: answer.text, engine: answer.engine, proposal }]);
      // Like a spreadsheet copilot: make the change straight away, with Undo
      // beside it. Turn that off to review each change first.
      if (proposal && autoApply) setTimeout(() => apply(index, proposal), 0);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        if (request.timedOut) setError("No answer after 2½ minutes, so I stopped waiting. The Pi may be busy; try again in a moment.");
      } else {
        setError(e?.message || 'Something went wrong.');
      }
      setTurns(prev => prev.slice(0, -1));
    } finally {
      clearTimeout(timer);
      if (abortRef.current === request) abortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const send = () => {
    const q = input.trim();
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
          <button onClick={() => { setTurns([]); setError(null); }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-white/5 dark:hover:text-gray-200" aria-label="Start over" title="Start over">
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
          <div className="flex flex-wrap gap-1.5">
            {ACTIONS.map(({ mode, label, icon: Icon, request }) => (
              <button
                key={label}
                disabled={busy}
                onClick={() => run(mode, label, request)}
                className="flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20 disabled:opacity-50 transition-colors"
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={2}
              placeholder="Ask, or tell me what to change…"
              className="field flex-1 resize-none max-h-32"
            />
            <button onClick={send} disabled={busy || !input.trim()} aria-label="Send" className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
              <ArrowUp size={17} />
            </button>
          </div>
          <label className="flex items-center gap-2 text-[11.5px] text-gray-500 select-none cursor-pointer">
            <input type="checkbox" checked={autoApply} onChange={toggleAutoApply} className="accent-violet-600" />
            Make changes right away (untick to review each one first)
          </label>
          {engine === 'local' && (
            <p className="text-[11px] text-gray-400 leading-snug">Using the Pi's small built-in model, which only reads text and misses a lot. Add a Groq key in Settings, under Server & Reset, for fast, sharper answers.</p>
          )}
        </div>
      )}
    </aside>
  );
}
