import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, PenLine, Sparkles, Maximize2, Minimize2, Check, CloudOff } from 'lucide-react';
import { api } from '../../services/api';
import { Board } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';

const ExcalidrawBoard = lazy(() => import('../canvas/ExcalidrawBoard'));

interface CanvasViewProps {
  lifeContext?: 'work' | 'personal';
  isDarkMode: boolean;
}

const ACTIVE_KEY = 'sage.activeBoard';

// Whiteboards for thinking work through: freehand drawing, notes, and flowcharts.
export function CanvasView({ lifeContext, isDarkMode }: CanvasViewProps) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [thinkOpen, setThinkOpen] = useState(false);
  // Canvas over the whole window, for when the board needs the room.
  const [focusMode, setFocusMode] = useState(false);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error' | null>(null);

  // Ctrl/Cmd+J opens and closes Think with me; Esc leaves focus mode when
  // nothing on the canvas is being edited.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setThinkOpen(open => !open);
      }
      if (e.key === 'Escape' && focusMode && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) setFocusMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode]);
  const { showToast } = useToast();

  const loadBoards = async () => {
    setBoards(await api.boards.list(lifeContext));
  };

  useEffect(() => { loadBoards(); }, [lifeContext]);
  useDataChanges(loadBoards);

  const active = boards?.find(b => b.id === activeId) || boards?.[0] || null;

  useEffect(() => {
    if (!active) return;
    setSaveState(null);
    try { localStorage.setItem(ACTIVE_KEY, active.id); } catch { /* remembered tab is optional */ }
  }, [active?.id]);

  const handleCreate = async () => {
    const board = await api.boards.create({ title: boards?.length ? `Board ${boards.length + 1}` : 'My board', lifeContext });
    setBoards(prev => [...(prev || []), board]);
    setActiveId(board.id);
    setRenamingId(board.id);
    setRenameValue(board.title);
  };

  const commitRename = async () => {
    const id = renamingId;
    setRenamingId(null);
    const title = renameValue.trim();
    if (!id || !title) return;
    setBoards(prev => prev?.map(b => b.id === id ? { ...b, title } : b) || prev);
    await api.boards.rename(id, title);
  };

  const handleDelete = async (board: Board, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${board.title}"? The drawing can't be recovered.`)) return;
    await api.boards.delete(board.id);
    if (activeId === board.id) setActiveId(null);
    await loadBoards();
    showToast('Board deleted');
  };

  return (
    <div className={focusMode ? 'fixed inset-0 z-40 flex flex-col gap-3 p-3 bg-gray-50 dark:bg-[#0b0b0c]' : 'h-full flex flex-col gap-3'}>
      <div className="flex items-center gap-1.5">
      {/* Boards scroll sideways when there are many; the actions on the right stay put. */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-0.5 -ml-1 pl-1">
        {boards?.map(board => {
          const isActive = board.id === active?.id;
          return (
            <div
              key={board.id}
              onClick={() => setActiveId(board.id)}
              onDoubleClick={() => { setRenamingId(board.id); setRenameValue(board.title); }}
              role="button"
              title="Double-click to rename"
              className={`group shrink-0 flex items-center gap-1.5 h-9 pl-3 pr-1.5 rounded-xl text-[13px] font-semibold transition-colors ${isActive ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200/80 dark:bg-white/5 dark:text-gray-400 dark:hover:bg-white/10'}`}
            >
              <PenLine size={14} className="shrink-0 opacity-70" />
              {renamingId === board.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                  onClick={e => e.stopPropagation()}
                  className="w-32 bg-transparent outline-none border-b border-current"
                />
              ) : (
                <span className="max-w-[12rem] truncate">{board.title}</span>
              )}
              {boards.length > 1 && (
                <button
                  onClick={e => handleDelete(board, e)}
                  aria-label={`Delete ${board.title}`}
                  className={`p-1 rounded-lg transition-opacity ${isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}`}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={handleCreate}
          aria-label="New board"
          className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10 transition-colors"
        >
          <Plus size={15} /> <span className="hidden sm:inline">New board</span>
        </button>
      </div>
        {active && saveState && (
          <span className={`shrink-0 hidden sm:flex items-center gap-1 text-[12px] font-medium ${saveState === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
            {saveState === 'saving' ? <><Loader2 size={12} className="animate-spin" /> Saving</> : saveState === 'saved' ? <><Check size={12} /> Saved</> : <><CloudOff size={12} /> Not saved</>}
          </span>
        )}
        {active && (
          <button
            onClick={() => setFocusMode(f => !f)}
            aria-label={focusMode ? 'Exit full screen' : 'Full screen'}
            title={focusMode ? 'Exit full screen (Esc)' : 'Full screen'}
            className={`shrink-0 h-9 w-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors`}
          >
            {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        )}
        {active && (
          <button
            onClick={() => setThinkOpen(open => !open)}
            aria-pressed={thinkOpen}
            title="Think with me (Ctrl+J)"
            className={`shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-semibold transition-colors ${thinkOpen ? 'bg-violet-600 text-white shadow-sm' : 'text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-500/10'}`}
          >
            <Sparkles size={15} /> Think<span className="hidden sm:inline"> with me</span>
          </button>
        )}
      </div>

      <div className="sage-canvas flex-1 min-h-0 rounded-3xl overflow-hidden ring-1 ring-gray-200/80 dark:ring-white/[0.08] shadow-sm bg-white dark:bg-[#121212]">
        {active ? (
          <Suspense fallback={<CanvasLoading />}>
            <ExcalidrawBoard key={active.id} board={active} isDarkMode={isDarkMode} thinkOpen={thinkOpen} onCloseThink={() => setThinkOpen(false)} onSaveState={setSaveState} />
          </Suspense>
        ) : boards ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="bg-gray-100 dark:bg-white/5 ring-8 ring-gray-50 dark:ring-white/[0.02] p-4 rounded-2xl mb-5 text-gray-500">
              <PenLine size={28} />
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white mb-1.5">A place to think</h3>
            <p className="text-[14px] text-gray-500 max-w-sm leading-relaxed">Sketch, jot notes, and draw flowcharts. Boards save as you go and sync to your other devices.</p>
            <button onClick={handleCreate} className="mt-6 px-5 py-2.5 bg-blue-600 text-white text-[14px] rounded-xl font-semibold hover:bg-blue-700 shadow-sm shadow-blue-600/20 transition-colors active:scale-[0.98] flex items-center gap-2">
              <Plus size={16} /> Start a board
            </button>
          </div>
        ) : (
          <CanvasLoading />
        )}
      </div>
    </div>
  );
}

function CanvasLoading() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400">
      <Loader2 className="animate-spin" size={24} />
      <span className="text-[13px] font-medium">Opening the canvas…</span>
    </div>
  );
}
