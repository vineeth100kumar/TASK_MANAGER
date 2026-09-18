import React, { useState } from 'react';
import {
  WhiteboardElement,
  ShapeElement,
  TextElement,
  StrokeElement,
  ImageElement,
  ViewState,
} from '../../types';
import {
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Edit3,
  Type,
  Palette,
  Droplet,
  Minus,
  Plus,
} from 'lucide-react';

const PRESET_COLORS = [
  { label: 'Ink Black', value: '#1c1917', bg: 'bg-[#1c1917]' },
  { label: 'Amber', value: '#b45309', bg: 'bg-amber-700' },
  { label: 'Crimson', value: '#dc2626', bg: 'bg-red-600' },
  { label: 'Blueprint', value: '#2563eb', bg: 'bg-blue-600' },
  { label: 'Sage', value: '#15803d', bg: 'bg-emerald-700' },
  { label: 'Violet', value: '#7c3aed', bg: 'bg-purple-600' },
  { label: 'Graphite', value: '#4b5563', bg: 'bg-stone-600' },
];

const PRESET_FILLS = [
  { label: 'None', value: null, bg: 'bg-transparent border border-dashed border-stone-400' },
  { label: 'Sand', value: 'rgba(254, 243, 199, 0.65)', bg: 'bg-amber-100' },
  { label: 'Amber', value: 'rgba(253, 230, 138, 0.65)', bg: 'bg-amber-200' },
  { label: 'Blush', value: 'rgba(254, 202, 202, 0.65)', bg: 'bg-red-100' },
  { label: 'Sage', value: 'rgba(209, 250, 229, 0.65)', bg: 'bg-emerald-100' },
  { label: 'Blueprint', value: 'rgba(219, 234, 254, 0.65)', bg: 'bg-blue-100' },
  { label: 'Slate', value: 'rgba(226, 232, 240, 0.65)', bg: 'bg-stone-200' },
];

function getElementBBox(el: WhiteboardElement): { x: number; y: number; w: number; h: number } | null {
  if (el.type === 'shape' || el.type === 'sticky' || el.type === 'image') {
    const minX = Math.min(el.x, el.x + el.width);
    const minY = Math.min(el.y, el.y + el.height);
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    return { x: minX, y: minY, w, h };
  }
  if (el.type === 'text') {
    const lines = el.text.split('\n');
    return { x: el.x, y: el.y, w: el.width || 180, h: lines.length * el.fontSize * 1.35 };
  }
  if (el.type === 'stroke') {
    if (el.points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    el.points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    return { x: minX, y: minY, w: Math.max(10, maxX - minX), h: Math.max(10, maxY - minY) };
  }
  return null;
}

export interface WhiteboardFloatingBarProps {
  selectedElements: WhiteboardElement[];
  viewState: ViewState;
  onUpdateElements: (updated: WhiteboardElement[]) => void;
  onDeleteElements: () => void;
  onDuplicateElements: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onEditText?: (textEl: TextElement) => void;
  onEditShapeText?: (shapeEl: ShapeElement) => void;
  edition?: 'day' | 'night';
}

export const WhiteboardFloatingBar: React.FC<WhiteboardFloatingBarProps> = ({
  selectedElements,
  viewState,
  onUpdateElements,
  onDeleteElements,
  onDuplicateElements,
  onBringToFront,
  onSendToBack,
  onEditText,
  onEditShapeText,
  edition = 'day',
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFillPicker, setShowFillPicker] = useState(false);

  if (selectedElements.length === 0) return null;

  // Calculate composite selection bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  selectedElements.forEach((el) => {
    const b = getElementBBox(el);
    if (b) {
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
  });

  if (minX === Infinity) return null;

  const screenX = minX * viewState.zoom + viewState.panX;
  const screenY = minY * viewState.zoom + viewState.panY;
  const screenW = (maxX - minX) * viewState.zoom;
  const screenH = (maxY - minY) * viewState.zoom;

  // Determine vertical position: above selection if room, else below
  const showAbove = screenY > 80;
  const topPos = showAbove ? Math.max(12, screenY - 52) : screenY + screenH + 14;
  const leftPos = Math.max(16, Math.min(window.innerWidth - 380, screenX + screenW / 2 - 160));

  const hasShape = selectedElements.some((el) => el.type === 'shape');
  const hasText = selectedElements.some((el) => el.type === 'text');
  const firstText = selectedElements.find((el): el is TextElement => el.type === 'text');
  const firstShape = selectedElements.find(
    (el): el is ShapeElement => el.type === 'shape' && el.shapeType !== 'line' && el.shapeType !== 'arrow'
  );

  // Handlers for in-place property changes
  const handleChangeColor = (newColor: string) => {
    const updated = selectedElements.map((el) => {
      if (el.type === 'stroke' || el.type === 'shape' || el.type === 'text') {
        return { ...el, color: newColor };
      }
      return el;
    });
    onUpdateElements(updated);
    setShowColorPicker(false);
  };

  const handleChangeFill = (newFill: string | null) => {
    const updated = selectedElements.map((el) => {
      if (el.type === 'shape') {
        return { ...el, fillColor: newFill ?? undefined };
      }
      return el;
    });
    onUpdateElements(updated);
    setShowFillPicker(false);
  };

  const handleAdjustSize = (delta: number) => {
    const updated = selectedElements.map((el) => {
      if (el.type === 'stroke') {
        return { ...el, size: Math.max(1, Math.min(48, el.size + delta * 2)) };
      }
      if (el.type === 'shape') {
        return { ...el, strokeWidth: Math.max(1, Math.min(32, el.strokeWidth + delta)) };
      }
      if (el.type === 'text') {
        return { ...el, fontSize: Math.max(12, Math.min(72, el.fontSize + delta * 4)) };
      }
      return el;
    });
    onUpdateElements(updated);
  };

  const isNight = edition === 'night';
  const barBg = isNight
    ? 'bg-[#1C1B18]/95 border-amber-900/40 text-ink'
    : 'bg-[#FBF8F1]/95 border-amber-900/20 text-ink-primary';

  return (
    <div
      style={{
        position: 'absolute',
        left: `${leftPos}px`,
        top: `${topPos}px`,
        zIndex: 60,
      }}
      className={`flex items-center gap-1 px-2 py-1 border shadow-lg backdrop-blur-md transition-all animate-in fade-in zoom-in-95 duration-100 ${barBg}`}
    >
      {/* 1. In-Place Text Editing (if text element selected) */}
      {hasText && firstText && onEditText && (
        <button
          type="button"
          onClick={() => onEditText(firstText)}
          className="flex items-center gap-1 px-2 py-1 text-meta font-bold hover:bg-amber-600/20 transition-colors border-r border-amber-900/10 pr-2 mr-1"
          title="Edit Text"
        >
          <Edit3 size={13} className="text-amber-600" />
          <span>Edit</span>
        </button>
      )}

      {/* 1b. In-Place Shape Text Box Editing (if shape element selected) */}
      {!hasText && firstShape && onEditShapeText && (
        <button
          type="button"
          onClick={() => onEditShapeText(firstShape)}
          className="flex items-center gap-1 px-2 py-1 text-meta font-bold hover:bg-amber-600/20 transition-colors border-r border-amber-900/10 pr-2 mr-1"
          title={firstShape.text ? 'Edit Shape Text' : 'Add Text to Shape'}
        >
          <Type size={13} className="text-amber-600" />
          <span>{firstShape.text ? 'Edit Text' : 'Add Text'}</span>
        </button>
      )}

      {/* 2. Color Swatch Trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowColorPicker((prev) => !prev);
            setShowFillPicker(false);
          }}
          className={`p-1.5 hover:bg-amber-600/20 transition-colors rounded-control ${showColorPicker ? 'bg-amber-600/20 text-amber-600' : ''}`}
          title="Change Color"
        >
          <Palette size={14} />
        </button>

        {showColorPicker && (
          <div
            className={`absolute left-0 bottom-full mb-2 p-1.5 border shadow-lg flex items-center gap-1.5 z-70 ${barBg}`}
          >
            {PRESET_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => handleChangeColor(c.value)}
                className={`w-5 h-5 rounded-full ${c.bg} border border-stone-300 hover:scale-110 transition-transform`}
                title={c.label}
              />
            ))}
          </div>
        )}
      </div>

      {/* 3. Shape Fill Tone Trigger (if shapes selected) */}
      {hasShape && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowFillPicker((prev) => !prev);
              setShowColorPicker(false);
            }}
            className={`p-1.5 hover:bg-amber-600/20 transition-colors rounded-control ${showFillPicker ? 'bg-amber-600/20 text-amber-600' : ''}`}
            title="Change Fill Tone"
          >
            <Droplet size={14} />
          </button>

          {showFillPicker && (
            <div
              className={`absolute left-0 bottom-full mb-2 p-1.5 border shadow-lg flex items-center gap-1.5 z-70 ${barBg}`}
            >
              {PRESET_FILLS.map((f, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleChangeFill(f.value)}
                  className={`w-5 h-5 rounded-[2px] ${f.bg} hover:scale-110 transition-transform`}
                  title={f.label}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. Stroke / Font Size Adjusters */}
      <button
        type="button"
        onClick={() => handleAdjustSize(-1)}
        className="p-1.5 hover:bg-amber-600/20 transition-colors rounded-control"
        title="Decrease Size"
      >
        <Minus size={13} />
      </button>
      <button
        type="button"
        onClick={() => handleAdjustSize(1)}
        className="p-1.5 hover:bg-amber-600/20 transition-colors rounded-control"
        title="Increase Size"
      >
        <Plus size={13} />
      </button>

      <div className="w-[1px] h-4 bg-amber-900/20 dark:bg-amber-500/20 mx-0.5" />

      {/* 5. Layer Controls */}
      <button
        type="button"
        onClick={onBringToFront}
        className="p-1.5 hover:bg-amber-600/20 transition-colors rounded-control"
        title="Bring to Front"
      >
        <ArrowUp size={13} />
      </button>
      <button
        type="button"
        onClick={onSendToBack}
        className="p-1.5 hover:bg-amber-600/20 transition-colors rounded-control"
        title="Send to Back"
      >
        <ArrowDown size={13} />
      </button>

      {/* 6. Duplicate */}
      <button
        type="button"
        onClick={onDuplicateElements}
        className="p-1.5 hover:bg-amber-600/20 transition-colors rounded-control"
        title="Duplicate (Ctrl+D)"
      >
        <Copy size={13} />
      </button>

      <div className="w-[1px] h-4 bg-amber-900/20 dark:bg-amber-500/20 mx-0.5" />

      {/* 7. Delete */}
      <button
        type="button"
        onClick={onDeleteElements}
        className="p-1.5 hover:bg-red-500/20 text-red-600 dark:text-red-400 transition-colors rounded-control"
        title="Delete (Backspace / Del)"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
};
