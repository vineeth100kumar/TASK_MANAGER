import React from 'react';
import {
  Highlighter,
  Square,
  Type,
  Hand,
  Undo2,
  Redo2,
  Trash2,
  Zap,
  Image as ImageIcon,
  StickyNote,
  X,
} from 'lucide-react';
import { WhiteboardTool, ShapeType } from '../../types';

export interface WhiteboardBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  activeTool: WhiteboardTool;
  setActiveTool: (tool: WhiteboardTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onClear: () => void;
  onTriggerImageUpload?: () => void;
  edition?: 'day' | 'night';
}

export const WhiteboardBottomSheet: React.FC<WhiteboardBottomSheetProps> = ({
  isOpen,
  onClose,
  activeTool,
  setActiveTool,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onClear,
  onTriggerImageUpload,
  edition = 'day',
}) => {
  if (!isOpen) return null;

  const selectAndClose = (tool: WhiteboardTool) => {
    setActiveTool(tool);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Semi-transparent backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Slide-up sheet */}
      <div
        style={{ paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))' }}
        className="relative z-50 clipping clipping-white rounded-t-3xl border-t-2 border-ink-base/20 dark:border-paper-light/20 p-5 space-y-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
      >
        {/* Drag Handle */}
        <div className="w-12 h-1 bg-ink-base/20 dark:bg-paper-light/20 rounded-full mx-auto" />

        <div className="flex items-center justify-between border-b border-ink-base/10 dark:border-paper-light/10 pb-2">
          <div>
            <span className="text-[9px] font-ledger uppercase tracking-widest text-ink-muted dark:text-stone-400">
              DRAFTING STUDIO • EXPANDED TOOLS
            </span>
            <h3 className="text-sm font-editorial font-bold text-ink-base dark:text-paper-light">
              Studio Instrument Palette
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-muted dark:text-stone-400 hover:text-ink-base dark:hover:text-stone-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tool Grid */}
        <div className="grid grid-cols-4 gap-2.5">
          <button
            onClick={() => selectAndClose('highlighter')}
            className={`p-3 rounded flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'highlighter'
                ? 'bg-amber-500/15 border-amber-600/40 text-amber-700 dark:text-amber-300 font-bold'
                : 'bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300'
            }`}
          >
            <Highlighter className="w-5 h-5" />
            <span className="text-[10px] font-ledger uppercase">Highlighter</span>
          </button>

          <button
            onClick={() => selectAndClose('shape')}
            className={`p-3 rounded flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'shape'
                ? 'bg-amber-500/15 border-amber-600/40 text-amber-700 dark:text-amber-300 font-bold'
                : 'bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300'
            }`}
          >
            <Square className="w-5 h-5" />
            <span className="text-[10px] font-ledger uppercase">Shapes</span>
          </button>

          <button
            onClick={() => selectAndClose('text')}
            className={`p-3 rounded flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'text'
                ? 'bg-amber-500/15 border-amber-600/40 text-amber-700 dark:text-amber-300 font-bold'
                : 'bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300'
            }`}
          >
            <Type className="w-5 h-5" />
            <span className="text-[10px] font-ledger uppercase">Text</span>
          </button>

          <button
            onClick={() => selectAndClose('sticky')}
            className={`p-3 rounded flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'sticky'
                ? 'bg-amber-500/15 border-amber-600/40 text-amber-700 dark:text-amber-300 font-bold'
                : 'bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300'
            }`}
          >
            <StickyNote className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <span className="text-[10px] font-ledger uppercase">Note</span>
          </button>

          <button
            onClick={() => selectAndClose('laser')}
            className={`p-3 rounded flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'laser'
                ? 'bg-rose-500/15 border-rose-600/40 text-rose-700 dark:text-rose-300 font-bold'
                : 'bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300'
            }`}
          >
            <Zap className="w-5 h-5 text-rose-500" />
            <span className="text-[10px] font-ledger uppercase">Laser</span>
          </button>

          <button
            onClick={() => selectAndClose('hand')}
            className={`p-3 rounded flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'hand'
                ? 'bg-amber-500/15 border-amber-600/40 text-amber-700 dark:text-amber-300 font-bold'
                : 'bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300'
            }`}
          >
            <Hand className="w-5 h-5" />
            <span className="text-[10px] font-ledger uppercase">Pan Hand</span>
          </button>

          {onTriggerImageUpload && (
            <button
              onClick={() => {
                onTriggerImageUpload();
                onClose();
              }}
              className="p-3 rounded flex flex-col items-center gap-1.5 border bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300 hover:bg-paper-aged"
            >
              <ImageIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span className="text-[10px] font-ledger uppercase">Add Image</span>
            </button>
          )}

          <button
            onClick={() => {
              if (canUndo) onUndo();
            }}
            disabled={!canUndo}
            className="p-3 rounded flex flex-col items-center gap-1.5 border bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300 disabled:opacity-40"
          >
            <Undo2 className="w-5 h-5" />
            <span className="text-[10px] font-ledger uppercase">Undo</span>
          </button>

          <button
            onClick={() => {
              if (canRedo) onRedo();
            }}
            disabled={!canRedo}
            className="p-3 rounded flex flex-col items-center gap-1.5 border bg-paper-aged/50 dark:bg-stone-800/60 border-ink-base/15 dark:border-stone-700 text-ink-base dark:text-stone-300 disabled:opacity-40"
          >
            <Redo2 className="w-5 h-5" />
            <span className="text-[10px] font-ledger uppercase">Redo</span>
          </button>
        </div>

        {/* Clear Action */}
        <div className="pt-2 border-t border-ink-base/10 dark:border-paper-light/10">
          <button
            onClick={() => {
              onClear();
              onClose();
            }}
            className="w-full py-2.5 rounded border border-rose-600/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 font-ledger uppercase text-xs font-bold flex items-center justify-center gap-2 hover:bg-rose-500/20"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear Board Canvas</span>
          </button>
        </div>
      </div>
    </div>
  );
};
