import React, { useState, useRef } from 'react';
import { Trash2, Zap, CheckCircle2, GripHorizontal } from 'lucide-react';
import { StickyElement, StickyColor } from '../../types';
import { TapeStrip } from '../newspaper/TapeStrip';

interface StickyNoteOverlayProps {
  sticky: StickyElement;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updated: Partial<StickyElement>) => void;
  onDelete: () => void;
  onConvertToTask: (sticky: StickyElement) => void;
  zoom: number;
}

const COLOR_MAP: Record<StickyColor, { bg: string; border: string; text: string; header: string; tapeHex: string }> = {
  yellow: {
    bg: '#FEF9C3',
    border: '#EAB308',
    text: '#1C1917',
    header: '#FEF08A',
    tapeHex: 'rgba(254, 240, 138, 0.65)',
  },
  blue: {
    bg: '#E0F2FE',
    border: '#0284C7',
    text: '#0C4A6E',
    header: '#BAE6FD',
    tapeHex: 'rgba(186, 230, 253, 0.65)',
  },
  green: {
    bg: '#DCFCE7',
    border: '#16A34A',
    text: '#14532D',
    header: '#BBF7D0',
    tapeHex: 'rgba(187, 247, 208, 0.65)',
  },
  pink: {
    bg: '#FCE7F3',
    border: '#DB2777',
    text: '#701A75',
    header: '#FBCFE8',
    tapeHex: 'rgba(251, 207, 232, 0.65)',
  },
  purple: {
    bg: '#F3E8FF',
    border: '#9333EA',
    text: '#581C87',
    header: '#E9D5FF',
    tapeHex: 'rgba(233, 213, 255, 0.65)',
  },
  orange: {
    bg: '#FFEDD5',
    border: '#EA580C',
    text: '#7C2D12',
    header: '#FED7AA',
    tapeHex: 'rgba(254, 215, 170, 0.65)',
  },
};

const STICKY_COLORS: { color: StickyColor; hex: string; name: string }[] = [
  { color: 'yellow', hex: '#fef08a', name: 'Canary Yellow' },
  { color: 'blue', hex: '#bae6fd', name: 'Blueprint Cyan' },
  { color: 'green', hex: '#bbf7d0', name: 'Mint Green' },
  { color: 'pink', hex: '#fbcfe8', name: 'Rose Coral' },
  { color: 'purple', hex: '#e9d5ff', name: 'Lilac' },
  { color: 'orange', hex: '#fed7aa', name: 'Manila Buff' },
];

export const StickyNoteOverlay: React.FC<StickyNoteOverlayProps> = ({
  sticky,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onConvertToTask,
  zoom,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; origX: number; origY: number; origW: number; origH: number }>({
    startX: 0,
    startY: 0,
    origX: sticky.x,
    origY: sticky.y,
    origW: sticky.width,
    origH: sticky.height,
  });

  const palette = COLOR_MAP[sticky.color] || COLOR_MAP.yellow;

  // Handle Dragging
  const handleDragStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    onSelect();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: sticky.x,
      origY: sticky.y,
      origW: sticky.width,
      origH: sticky.height,
    };
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = (e.clientX - dragStartRef.current.startX) / zoom;
    const dy = (e.clientY - dragStartRef.current.startY) / zoom;
    onUpdate({
      x: Math.round(dragStartRef.current.origX + dx),
      y: Math.round(dragStartRef.current.origY + dy),
    });
  };

  const handleDragEnd = (e: React.PointerEvent) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
      setIsDragging(false);
    }
  };

  // Handle Resizing
  const handleResizeStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
    onSelect();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: sticky.x,
      origY: sticky.y,
      origW: sticky.width,
      origH: sticky.height,
    };
  };

  const handleResizeMove = (e: React.PointerEvent) => {
    if (!isResizing) return;
    const dx = (e.clientX - dragStartRef.current.startX) / zoom;
    const dy = (e.clientY - dragStartRef.current.startY) / zoom;
    const newW = Math.max(160, Math.round(dragStartRef.current.origW + dx));
    const newH = Math.max(140, Math.round(dragStartRef.current.origH + dy));
    onUpdate({
      width: newW,
      height: newH,
    });
  };

  const handleResizeEnd = (e: React.PointerEvent) => {
    if (isResizing) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
      setIsResizing(false);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${sticky.x}px`,
        top: `${sticky.y}px`,
        width: `${sticky.width}px`,
        height: `${sticky.height}px`,
        backgroundColor: palette.bg,
        borderColor: isSelected ? '#1A1814' : palette.border,
        boxShadow: isSelected
          ? '0 12px 28px -4px rgba(0,0,0,0.35), 0 0 0 2px #1A1814'
          : '0 6px 16px -2px rgba(0,0,0,0.2), 0 1px 3px rgba(0,0,0,0.1)',
        transform: isDragging ? 'scale(1.02)' : 'rotate(-0.6deg)',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="rounded-[1px] border border-black/25 flex flex-col pointer-events-auto transition-transform select-none group relative"
    >
      {/* Decorative Scotch Tape Anchor */}
      <TapeStrip
        rotate={-2}
        className="-top-2 left-1/2 -translate-x-1/2 z-20 shadow-sm"
        width={42}
        height={13}
      />

      {/* Top Header Drag Handle */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        className="h-6 flex items-center justify-between px-2 cursor-grab active:cursor-grabbing border-b border-black/10"
        style={{ backgroundColor: palette.header }}
      >
        <div className="flex items-center gap-1.5">
          <GripHorizontal size={13} style={{ color: palette.text, opacity: 0.5 }} />
          <span className="font-ledger text-[8px] uppercase tracking-wider text-black/40 font-bold">
            NOTE DISPATCH
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {STICKY_COLORS.map((sc) => (
            <button
              key={sc.color}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ color: sc.color });
              }}
              className={`w-2.5 h-2.5 rounded-[1px] border border-black/30 transition-transform ${
                sticky.color === sc.color ? 'scale-125 ring-1 ring-black/60' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: sc.hex }}
              title={sc.name}
            />
          ))}
        </div>
      </div>

      {/* Note Content Area */}
      <div className="flex-1 p-2.5 flex flex-col">
        <textarea
          value={sticky.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="Draft thoughts, priorities or brainstorm notes..."
          style={{
            color: palette.text,
            caretColor: palette.text,
          }}
          className="w-full flex-1 resize-none bg-transparent border-none outline-none font-editorial text-sm font-semibold leading-snug placeholder:opacity-40 select-text"
        />
      </div>

      {/* Bottom Action Bar */}
      <div
        className="h-7 px-2 flex items-center justify-between border-t border-black/10"
        style={{ backgroundColor: palette.header }}
      >
        {/* Convert to Task Button */}
        {sticky.convertedTaskId ? (
          <div
            className="flex items-center gap-1 text-[9px] font-ledger uppercase font-bold text-emerald-900 bg-emerald-200/80 px-1.5 py-0.5 border border-emerald-600/40 rounded-[1px]"
            title="Filed as official Task on the docket"
          >
            <CheckCircle2 size={11} />
            <span>On Docket</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onConvertToTask(sticky);
            }}
            className="flex items-center gap-1 text-[9px] font-ledger uppercase font-bold px-1.5 py-0.5 rounded-[1px] bg-black/10 hover:bg-black/20 active:scale-95 transition-all border border-black/15"
            style={{ color: palette.text }}
            title="Convert this note into a docket task"
          >
            <Zap size={10} className="fill-current text-amber-700" />
            <span>Dispatch Task</span>
          </button>
        )}

        <div className="flex items-center gap-1">
          {/* Delete Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded-[1px] text-black/40 hover:text-rose-700 hover:bg-black/10 transition-colors"
            title="Delete Sticky Note"
          >
            <Trash2 size={12} />
          </button>

          {/* Resize Corner */}
          <div
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            className="w-3.5 h-3.5 cursor-nwse-resize flex items-center justify-center opacity-40 hover:opacity-100"
            title="Resize note"
          >
            <div className="w-1.5 h-1.5 border-r border-b border-black/70" />
          </div>
        </div>
      </div>
    </div>
  );
};
