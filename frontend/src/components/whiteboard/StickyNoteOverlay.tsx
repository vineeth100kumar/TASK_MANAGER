import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Zap, CheckCircle2, GripHorizontal } from 'lucide-react';
import { StickyElement, StickyColor } from '../../types';

interface StickyNoteOverlayProps {
  sticky: StickyElement;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updated: Partial<StickyElement>) => void;
  onDelete: () => void;
  onConvertToTask: (sticky: StickyElement) => void;
  zoom: number;
}

const COLOR_MAP: Record<StickyColor, { bg: string; border: string; text: string; header: string }> = {
  yellow: {
    bg: '#fef08a',
    border: '#fde047',
    text: '#713f12',
    header: '#fef9c3',
  },
  blue: {
    bg: '#bae6fd',
    border: '#7dd3fc',
    text: '#0c4a6e',
    header: '#e0f2fe',
  },
  green: {
    bg: '#bbf7d0',
    border: '#86efac',
    text: '#14532d',
    header: '#dcfce7',
  },
  pink: {
    bg: '#fbcfe8',
    border: '#f472b6',
    text: '#701a75',
    header: '#fdf2f8',
  },
  purple: {
    bg: '#e9d5ff',
    border: '#c084fc',
    text: '#581c87',
    header: '#f3e8ff',
  },
  orange: {
    bg: '#fed7aa',
    border: '#fb923c',
    text: '#7c2d12',
    header: '#ffedd5',
  },
};

const STICKY_COLORS: { color: StickyColor; hex: string }[] = [
  { color: 'yellow', hex: '#fef08a' },
  { color: 'blue', hex: '#bae6fd' },
  { color: 'green', hex: '#bbf7d0' },
  { color: 'pink', hex: '#fbcfe8' },
  { color: 'purple', hex: '#e9d5ff' },
  { color: 'orange', hex: '#fed7aa' },
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
        borderColor: isSelected ? '#3b82f6' : palette.border,
        boxShadow: isSelected
          ? '0 12px 28px -4px rgba(0,0,0,0.4), 0 0 0 2px #3b82f6'
          : '0 8px 20px -4px rgba(0,0,0,0.25)',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="rounded-xl border flex flex-col pointer-events-auto transition-shadow select-none group"
    >
      {/* Top Header Drag Handle */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        className="h-6 flex items-center justify-between px-2 cursor-grab active:cursor-grabbing rounded-t-xl"
        style={{ backgroundColor: palette.header }}
      >
        <GripHorizontal size={14} style={{ color: palette.text, opacity: 0.5 }} />
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {STICKY_COLORS.map((sc) => (
            <button
              key={sc.color}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ color: sc.color });
              }}
              className={`w-2.5 h-2.5 rounded-full border border-black/20 transition-transform ${
                sticky.color === sc.color ? 'scale-125 ring-1 ring-black/40' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: sc.hex }}
              title={sc.color}
            />
          ))}
        </div>
      </div>

      {/* Note Content Area */}
      <div className="flex-1 p-2.5 flex flex-col">
        <textarea
          value={sticky.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="Type your thought or brainstorm idea..."
          style={{
            color: palette.text,
            caretColor: palette.text,
          }}
          className="w-full flex-1 resize-none bg-transparent border-none outline-none font-sans text-sm font-medium leading-relaxed placeholder:opacity-50 select-text"
        />
      </div>

      {/* Bottom Action Bar */}
      <div
        className="h-8 px-2 flex items-center justify-between border-t border-black/5 rounded-b-xl"
        style={{ backgroundColor: palette.header }}
      >
        {/* Convert to Task Button */}
        {sticky.convertedTaskId ? (
          <div
            className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-md"
            title="Converted into a Sage Task"
          >
            <CheckCircle2 size={12} />
            <span>Task Created</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onConvertToTask(sticky);
            }}
            className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-black/10 hover:bg-black/20 active:scale-95 transition-all"
            style={{ color: palette.text }}
            title="Convert this sticky note into a Sage Task"
          >
            <Zap size={11} className="fill-current" />
            <span>Convert to Task</span>
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
            className="p-1 rounded text-black/40 hover:text-rose-600 hover:bg-black/10 transition-colors"
            title="Delete Sticky Note"
          >
            <Trash2 size={13} />
          </button>

          {/* Resize Corner */}
          <div
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            className="w-3.5 h-3.5 cursor-nwse-resize flex items-center justify-center opacity-40 hover:opacity-100"
            title="Resize"
          >
            <div className="w-1.5 h-1.5 border-r-2 border-b-2 border-black/60" />
          </div>
        </div>
      </div>
    </div>
  );
};
