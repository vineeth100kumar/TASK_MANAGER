import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, SearchCheck, ListTree, ArrowUp, Loader2, Copy, RotateCcw, Wand2, Check, Undo2 } from 'lucide-react';
import { aiEngine, ThinkEngine, ThinkMode, ThinkTurn } from '../../services/aiEngine';
import { piBackendUrl } from '../../services/piBackend';
import { EditOp, RefMap, cleanOps } from './boardEdits';

interface ThinkPanelProps {
  boardTitle: string;
  // The board as it is right now: a text outline and a PNG (base64, may be null).
  // forEdit gives numbered shapes and the refs behind the numbers instead.
  getSnapshot: (forEdit?: boolean) => Promise<{ outline: string; imagePng: string | null; refs?: RefMap }>;
  describeEdits: (ops: EditOp[], refs: RefMap) => string[];
  // Applies edits; returns a function that puts the board back, or null.
  applyEdits: (ops: EditOp[], refs: RefMap) => (() => void) | null;
  onClose: () => void;
}

// Changes the AI wants to make, waiting for Apply or Discard.
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

const ACTIONS: Array<{ mode: ThinkMode; label: string; icon: typeof SearchCheck }> = [
  { mode: 'review', label: 'Check my thinking', icon: SearchCheck },
  { mode: 'summarize', label: 'Summarize', icon: ListTree },
  { mode: 'edit', label: 'Improve it', icon: Wand2 },
];

// A side panel that reads the board and talks it through with you.
export function ThinkPanel({ boardTitle, getSnapshot, describeEdits, applyEdits, onClose }: ThinkPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  // What typing does: ask about the board, or ask for changes to it.
  const [inputMode, setInputMode] = useState<'ask' | 'edit'>('ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<ThinkEngine | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<{ controller: AbortController; timedOut: boolean } | null>(null);

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

  const run = async (mode: ThinkMode, label: string, question?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const history = turns.map(({ role, text }) => ({ role, text }));
    setTurns(prev => [...prev, { role: 'user', text: question || label, label }]);
    const request = { controller: new AbortController(), timedOut: false };
    abortRef.current = request;
    const timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, TIMEOUT_MS);
    try {
      const { outline, imagePng, refs } = await getSnapshot(mode === 'edit');
      const answer = await aiEngine.canvasThink({ mode, boardTitle, outline, imagePng, question, history }, request.controller.signal);
      setEngine(answer.engine);
      let proposal: Proposal | undefined;
      if (mode === 'edit' && refs) {
        const ops = cleanOps(answer.ops, refs);
        if (ops.length) proposal = { ops, refs, lines: describeEdits(ops, refs), status: 'pending' };
      }
      setTurns(prev => [...prev, { role: 'assistant', text: answer.text, engine: answer.engine, proposal }]);
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
    }
  };

  const ask = () => {
    const q = input.trim();
    if (!q) return;
    setInput('');
    run(inputMode, q, q);
  };

  const setProposal = (index: number, changes: Partial<Proposal>) =>
    setTurns(prev => prev.map((t, i) => (i === index && t.proposal ? { ...t, proposal: { ...t.proposal, ...changes } } : t)));

  const apply = (index: number) => {
    const p = turns[index]?.proposal;
    if (!p) return;
    const undo = applyEdits(p.ops, p.refs);
    if (undo) setProposal(index, { status: 'applied', undo });
    else setError("Couldn't reach the board to make the changes.");
  };

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
            <p>Draw your idea out, then ask me to look it over. I read the whole board: shapes, labels, arrows and sketches.</p>
            <p>I'll point out gaps and shaky steps, sum it up, or answer questions about it.</p>
            <p>I can also change the board for you: press Improve it, or pick "Change the board" and say what you want. You'll see the changes before anything is added.</p>
          </div>
        ) : null}

        {turns.map((turn, i) => turn.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-br-md bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-[13px] font-medium">
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
                    <span className="flex items-center gap-1 font-semibold text-violet-700 dark:text-violet-300"><Check size={13} /> Applied</span>
                    <button onClick={() => { turn.proposal?.undo?.(); setProposal(i, { status: 'undone', undo: undefined }); }} className="flex items-center gap-1 font-semibold hover:text-gray-800 dark:hover:text-gray-200">
                      <Undo2 size={12} /> Undo
                    </button>
                  </div>
                )}
                {turn.proposal.status === 'discarded' && <p className="text-[12px] text-gray-500">Discarded.</p>}
                {turn.proposal.status === 'undone' && <p className="text-[12px] text-gray-500">Undone. The board is back how it was.</p>}
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
            <span className="flex-1">Reading your board…{elapsed >= 5 ? ` ${elapsed}s` : ''}</span>
            <button onClick={() => abortRef.current?.controller.abort()} className="text-[12px] font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
          </div>
        )}
        {error && <p className="text-[13px] text-red-600 dark:text-red-400 leading-relaxed">{error}</p>}
      </div>

      {hasPi && (
        <div className="shrink-0 border-t border-gray-200/70 dark:border-white/[0.08] p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                disabled={busy}
                onClick={() => run(mode, label)}
                className="flex-auto flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-semibold bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20 disabled:opacity-50 transition-colors"
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 text-[12px] font-semibold">
            {(['ask', 'edit'] as const).map(m => (
              <button
                key={m}
                onClick={() => setInputMode(m)}
                className={`px-2.5 py-1 rounded-lg transition-colors ${inputMode === m ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'}`}
              >
                {m === 'ask' ? 'Ask' : 'Change the board'}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
              rows={1}
              placeholder={inputMode === 'ask' ? 'Ask about this board…' : 'e.g. add what happens if I don\'t find a job'}
              className="field flex-1 resize-none max-h-28"
            />
            <button onClick={ask} disabled={busy || !input.trim()} aria-label="Ask" className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
              <ArrowUp size={17} />
            </button>
          </div>
          {engine === 'local' && (
            <p className="text-[11px] text-gray-400 leading-snug">Using the Pi's small built-in model, which only reads text and misses a lot. Add a Groq key in Settings, under Server & Reset, for fast, sharper answers.</p>
          )}
        </div>
      )}
    </aside>
  );
}
