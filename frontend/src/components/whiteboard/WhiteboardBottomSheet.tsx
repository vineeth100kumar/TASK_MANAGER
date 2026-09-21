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
        className="relative z-50 bg-surface rounded-t-surface border-t border-hairline p-5 space-y-4 shadow-lift-3 animate-in slide-in-from-bottom duration-200 ease-settle"
      >
        {/* Drag Handle */}
        <div className="w-12 h-1 bg-hairline rounded-full mx-auto" />

        <div className="flex items-center justify-between border-b border-hairline pb-2">
          <h3 className="text-lead font-semibold text-ink">Tools</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 grid place-items-center rounded-control text-ink-3 hover:text-ink hover:bg-sunken transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tool Grid */}
        <div className="grid grid-cols-4 gap-2.5">
          <button
            onClick={() => selectAndClose('highlighter')}
            className={`p-3 rounded-control flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'highlighter'
                ? 'bg-accent-500/12 border-accent-500/40 text-accent-600 dark:text-accent-400 font-medium'
                : 'bg-sunken border-hairline text-ink-2 hover:text-ink'
            }`}
          >
            <Highlighter className="w-5 h-5" />
            <span className="text-caption">Highlighter</span>
          </button>

          <button
            onClick={() => selectAndClose('shape')}
            className={`p-3 rounded-control flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'shape'
                ? 'bg-accent-500/12 border-accent-500/40 text-accent-600 dark:text-accent-400 font-medium'
                : 'bg-sunken border-hairline text-ink-2 hover:text-ink'
            }`}
          >
            <Square className="w-5 h-5" />
            <span className="text-caption">Shapes</span>
          </button>

          <button
            onClick={() => selectAndClose('text')}
            className={`p-3 rounded-control flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'text'
                ? 'bg-accent-500/12 border-accent-500/40 text-accent-600 dark:text-accent-400 font-medium'
                : 'bg-sunken border-hairline text-ink-2 hover:text-ink'
            }`}
          >
            <Type className="w-5 h-5" />
            <span className="text-caption">Text</span>
          </button>

          <button
            onClick={() => selectAndClose('sticky')}
            className={`p-3 rounded-control flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'sticky'
                ? 'bg-accent-500/12 border-accent-500/40 text-accent-600 dark:text-accent-400 font-medium'
                : 'bg-sunken border-hairline text-ink-2 hover:text-ink'
            }`}
          >
            <StickyNote className="w-5 h-5" />
            <span className="text-caption">Note</span>
          </button>

          <button
            onClick={() => selectAndClose('laser')}
            className={`p-3 rounded-control flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'laser'
                ? 'bg-danger-500/12 border-danger-500/40 text-danger-600 dark:text-danger-400 font-medium'
                : 'bg-sunken border-hairline text-ink-2 hover:text-ink'
            }`}
          >
            <Zap className="w-5 h-5" />
            <span className="text-caption">Laser</span>
          </button>

          <button
            onClick={() => selectAndClose('hand')}
            className={`p-3 rounded-control flex flex-col items-center gap-1.5 border transition-all ${
              activeTool === 'hand'
                ? 'bg-accent-500/12 border-accent-500/40 text-accent-600 dark:text-accent-400 font-medium'
                : 'bg-sunken border-hairline text-ink-2 hover:text-ink'
            }`}
          >
            <Hand className="w-5 h-5" />
            <span className="text-caption">Pan</span>
          </button>

          {onTriggerImageUpload && (
            <button
              onClick={() => {
                onTriggerImageUpload();
                onClose();
              }}
              className="p-3 rounded-control flex flex-col items-center gap-1.5 border bg-sunken border-hairline text-ink-2 hover:text-ink hover:bg-sunken"
            >
              <ImageIcon className="w-5 h-5" />
              <span className="text-caption">Image</span>
            </button>
          )}

          <button
            onClick={() => {
              if (canUndo) onUndo();
            }}
            disabled={!canUndo}
            className="p-3 rounded-control flex flex-col items-center gap-1.5 border bg-sunken border-hairline text-ink-2 hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
          >
            <Undo2 className="w-5 h-5" />
            <span className="text-caption">Undo</span>
          </button>

          <button
            onClick={() => {
              if (canRedo) onRedo();
            }}
            disabled={!canRedo}
            className="p-3 rounded-control flex flex-col items-center gap-1.5 border bg-sunken border-hairline text-ink-2 hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
          >
            <Redo2 className="w-5 h-5" />
            <span className="text-caption">Redo</span>
          </button>
        </div>

        {/* Clear Action */}
        <div className="pt-2 border-t border-hairline">
          <button
            onClick={() => {
              onClear();
              onClose();
            }}
            className="w-full h-11 rounded-control border border-danger-500/30 bg-danger-500/10 text-danger-600 dark:text-danger-400 text-meta font-medium flex items-center justify-center gap-2 hover:bg-danger-500/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear the board</span>
          </button>
        </div>
      </div>
    </div>
  );
};
