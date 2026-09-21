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

/*
 * Ink and fill, named for the colour rather than for a mood.
 *
 * These were "Blueprint", "Sage", "Blush" and "Graphite" -- a vocabulary you
 * had to learn before you could pick a pen. The swatch shows the colour; the
 * name only has to say which one it is. Each swatch is painted from its own
 * value, so what the button shows is exactly what the stroke will be, which
 * a Tailwind class name could not promise once the palette was repointed.
 */
const PRESET_COLORS = [
  { label: 'Black', value: '#1c1917' },
  { label: 'Amber', value: '#b45309' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Green', value: '#15803d' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Grey', value: '#4b5563' },
];

const PRESET_FILLS: { label: string; value: string | null }[] = [
  { label: 'No fill', value: null },
  { label: 'Sand', value: 'rgba(254, 243, 199, 0.65)' },
  { label: 'Amber', value: 'rgba(253, 230, 138, 0.65)' },
  { label: 'Pink', value: 'rgba(254, 202, 202, 0.65)' },
  { label: 'Green', value: 'rgba(209, 250, 229, 0.65)' },
  { label: 'Blue', value: 'rgba(219, 234, 254, 0.65)' },
  { label: 'Grey', value: 'rgba(226, 232, 240, 0.65)' },
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

  /*
   * The bar sits on the app's own surface, not on a hand-mixed cream that
   * only looked right on one of the two editions.
   */
  const barBg = 'bg-surface/95 border border-hairline text-ink rounded-surface shadow-lift-2';
  const barBtn = 'w-8 h-8 grid place-items-center rounded-control text-ink-2 hover:text-ink hover:bg-sunken transition-colors';

  return (
    <div
      style={{
        position: 'absolute',
        left: `${leftPos}px`,
        top: `${topPos}px`,
        zIndex: 60,
      }}
      className={`flex items-center gap-0.5 px-1.5 py-1 backdrop-blur-xl transition-all animate-in fade-in zoom-in-95 duration-100 ease-settle ${barBg}`}
    >
      {/* 1. In-Place Text Editing (if text element selected) */}
      {hasText && firstText && onEditText && (
        <button
          type="button"
          onClick={() => onEditText(firstText)}
          className="h-8 flex items-center gap-1.5 px-2 text-meta text-ink hover:bg-sunken rounded-control transition-colors border-r border-hairline pr-2 mr-1"
          title="Edit this text"
        >
          <Edit3 size={13} className="text-ink-2" />
          <span>Edit</span>
        </button>
      )}

      {/* 1b. In-Place Shape Text Box Editing (if shape element selected) */}
      {!hasText && firstShape && onEditShapeText && (
        <button
          type="button"
          onClick={() => onEditShapeText(firstShape)}
          className="h-8 flex items-center gap-1.5 px-2 text-meta text-ink hover:bg-sunken rounded-control transition-colors border-r border-hairline pr-2 mr-1"
          title={firstShape.text ? 'Edit the text in this shape' : 'Put text in this shape'}
        >
          <Type size={13} className="text-ink-2" />
          <span>{firstShape.text ? 'Edit text' : 'Add text'}</span>
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
          className={`${barBtn} ${showColorPicker ? 'bg-sunken text-ink' : ''}`}
          title="Pen colour"
        >
          <Palette size={14} />
        </button>

        {showColorPicker && (
          <div
            className={`absolute left-0 bottom-full mb-2 p-1.5 flex items-center gap-1.5 z-[70] ${barBg}`}
          >
            {PRESET_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => handleChangeColor(c.value)}
                style={{ backgroundColor: c.value }}
                className="w-6 h-6 rounded-full border border-hairline hover:scale-110 transition-transform duration-200 ease-spring"
                title={c.label}
                aria-label={c.label}
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
            className={`${barBtn} ${showFillPicker ? 'bg-sunken text-ink' : ''}`}
            title="Fill colour"
          >
            <Droplet size={14} />
          </button>

          {showFillPicker && (
            <div
              className={`absolute left-0 bottom-full mb-2 p-1.5 flex items-center gap-1.5 z-[70] ${barBg}`}
            >
              {PRESET_FILLS.map((f, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleChangeFill(f.value)}
                  style={f.value ? { backgroundColor: f.value } : undefined}
                  className={`w-6 h-6 rounded-control hover:scale-110 transition-transform duration-200 ease-spring ${
                    f.value ? 'border border-hairline' : 'border border-dashed border-ink-3'
                  }`}
                  title={f.label}
                  aria-label={f.label}
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
        className={barBtn}
        title="Smaller"
      >
        <Minus size={13} />
      </button>
      <button
        type="button"
        onClick={() => handleAdjustSize(1)}
        className={barBtn}
        title="Bigger"
      >
        <Plus size={13} />
      </button>

      <div className="w-px h-4 bg-hairline mx-0.5" />

      {/* 5. Layer Controls */}
      <button
        type="button"
        onClick={onBringToFront}
        className={barBtn}
        title="Bring to the front"
      >
        <ArrowUp size={13} />
      </button>
      <button
        type="button"
        onClick={onSendToBack}
        className={barBtn}
        title="Send to the back"
      >
        <ArrowDown size={13} />
      </button>

      {/* 6. Duplicate */}
      <button
        type="button"
        onClick={onDuplicateElements}
        className={barBtn}
        title="Duplicate"
      >
        <Copy size={13} />
      </button>

      <div className="w-px h-4 bg-hairline mx-0.5" />

      {/* 7. Delete */}
      <button
        type="button"
        onClick={onDeleteElements}
        className="w-8 h-8 grid place-items-center rounded-control text-danger-600 dark:text-danger-400 hover:bg-danger-500/10 transition-colors"
        title="Delete"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
};
