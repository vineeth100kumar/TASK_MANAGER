import React, { useState, useRef, useEffect } from 'react';
import {
  MousePointer,
  Pen,
  Highlighter,
  Eraser,
  Square,
  Circle,
  Diamond,
  ArrowUpRight,
  Minus,
  StickyNote,
  Type,
  Hand,
  Undo2,
  Redo2,
  Trash2,
  ChevronUp
} from 'lucide-react';
import { WhiteboardTool, ShapeType, StickyColor } from '../../types';

interface WhiteboardToolbarProps {
  activeTool: WhiteboardTool;
  setActiveTool: (tool: WhiteboardTool) => void;
  activeColor: string;
  setActiveColor: (color: string) => void;
  activeSize: number;
  setActiveSize: (size: number) => void;
  activeShape: ShapeType;
  setActiveShape: (shape: ShapeType) => void;
  highlighterColor: string;
  setHighlighterColor: (color: string) => void;
  highlighterSize: number;
  setHighlighterSize: (size: number) => void;
  onAddSticky: (color: StickyColor) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onClear: () => void;
}

const PEN_COLORS = [
  '#ffffff', // White
  '#09090b', // Deep Dark
  '#3b82f6', // Electric Blue
  '#06b6d4', // Cyan
  '#22c55e', // Emerald
  '#eab308', // Amber
  '#f97316', // Orange
  '#ef4444', // Coral Red
  '#a855f7', // Violet
  '#ec4899', // Pink
];

const PEN_SIZES = [
  { label: 'Fine', size: 2 },
  { label: 'Medium', size: 4 },
  { label: 'Bold', size: 8 },
  { label: 'Thick', size: 14 },
];

const HIGHLIGHTER_COLORS = [
  '#facc15', // Neon Yellow
  '#4ade80', // Mint Green
  '#38bdf8', // Sky Blue
  '#f472b6', // Neon Pink
  '#fb923c', // Tangerine
  '#c084fc', // Lilac
];

const HIGHLIGHTER_SIZES = [
  { label: 'Small', size: 14 },
  { label: 'Medium', size: 22 },
  { label: 'Chisel', size: 34 },
];

const STICKY_COLORS: { color: StickyColor; hex: string; name: string }[] = [
  { color: 'yellow', hex: '#fef08a', name: 'Yellow' },
  { color: 'blue', hex: '#bae6fd', name: 'Blue' },
  { color: 'green', hex: '#bbf7d0', name: 'Green' },
  { color: 'pink', hex: '#fbcfe8', name: 'Pink' },
  { color: 'purple', hex: '#e9d5ff', name: 'Purple' },
  { color: 'orange', hex: '#fed7aa', name: 'Orange' },
];

export const WhiteboardToolbar: React.FC<WhiteboardToolbarProps> = ({
  activeTool,
  setActiveTool,
  activeColor,
  setActiveColor,
  activeSize,
  setActiveSize,
  activeShape,
  setActiveShape,
  highlighterColor,
  setHighlighterColor,
  highlighterSize,
  setHighlighterSize,
  onAddSticky,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onClear,
}) => {
  const [showPenFlyout, setShowPenFlyout] = useState(false);
  const [showHighlighterFlyout, setShowHighlighterFlyout] = useState(false);
  const [showShapeFlyout, setShowShapeFlyout] = useState(false);
  const [showStickyFlyout, setShowStickyFlyout] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);

  // Close flyouts on outside click
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowPenFlyout(false);
        setShowHighlighterFlyout(false);
        setShowShapeFlyout(false);
        setShowStickyFlyout(false);
      }
    };
    window.addEventListener('mousedown', handleDown);
    return () => window.removeEventListener('mousedown', handleDown);
  }, []);

  const selectPen = () => {
    if (activeTool === 'pen') {
      setShowPenFlyout((prev) => !prev);
    } else {
      setActiveTool('pen');
      setShowPenFlyout(false);
    }
    setShowHighlighterFlyout(false);
    setShowShapeFlyout(false);
    setShowStickyFlyout(false);
  };

  const selectHighlighter = () => {
    if (activeTool === 'highlighter') {
      setShowHighlighterFlyout((prev) => !prev);
    } else {
      setActiveTool('highlighter');
      setShowHighlighterFlyout(false);
    }
    setShowPenFlyout(false);
    setShowShapeFlyout(false);
    setShowStickyFlyout(false);
  };

  const selectShapeTool = () => {
    if (activeTool === 'shape') {
      setShowShapeFlyout((prev) => !prev);
    } else {
      setActiveTool('shape');
      setShowShapeFlyout(false);
    }
    setShowPenFlyout(false);
    setShowHighlighterFlyout(false);
    setShowStickyFlyout(false);
  };

  const renderShapeIcon = (type: ShapeType) => {
    switch (type) {
      case 'rectangle':
        return <Square size={17} />;
      case 'circle':
        return <Circle size={17} />;
      case 'diamond':
        return <Diamond size={17} />;
      case 'arrow':
        return <ArrowUpRight size={17} />;
      case 'line':
        return <Minus size={17} />;
    }
  };

  return (
    <div
      ref={toolbarRef}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center select-none"
    >
      {/* ================= PEN FLYOUT ================= */}
      {showPenFlyout && activeTool === 'pen' && (
        <div className="mb-3 p-3 bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl flex flex-col gap-3 min-w-[260px] animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Ink Color</span>
            <div
              className="w-3.5 h-3.5 rounded-full border border-zinc-700 shadow-sm"
              style={{ backgroundColor: activeColor }}
            />
          </div>
          <div className="grid grid-cols-5 gap-2">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActiveColor(c)}
                className={`w-7 h-7 rounded-full transition-transform flex items-center justify-center ${
                  activeColor === c ? 'scale-110 ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <div className="h-px bg-zinc-800 my-0.5" />
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Thickness</span>
            <span className="text-zinc-500">{activeSize}px</span>
          </div>
          <div className="flex items-center justify-around gap-2">
            {PEN_SIZES.map((s) => (
              <button
                key={s.size}
                type="button"
                onClick={() => setActiveSize(s.size)}
                className={`flex-1 py-1.5 rounded-lg flex flex-col items-center gap-1.5 transition-colors ${
                  activeSize === s.size ? 'bg-zinc-800 text-blue-400 border border-zinc-700' : 'text-zinc-400 hover:bg-zinc-800/50'
                }`}
              >
                <div
                  className="rounded-full bg-current"
                  style={{ width: s.size * 1.5, height: s.size * 1.5 }}
                />
                <span className="text-[10px] font-medium">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ================= HIGHLIGHTER FLYOUT ================= */}
      {showHighlighterFlyout && activeTool === 'highlighter' && (
        <div className="mb-3 p-3 bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl flex flex-col gap-3 min-w-[260px] animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Highlighter Ink</span>
            <div
              className="w-3.5 h-3.5 rounded-full border border-zinc-700 shadow-sm"
              style={{ backgroundColor: highlighterColor }}
            />
          </div>
          <div className="grid grid-cols-6 gap-2">
            {HIGHLIGHTER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setHighlighterColor(c)}
                className={`w-7 h-7 rounded-full transition-transform flex items-center justify-center ${
                  highlighterColor === c ? 'scale-110 ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <div className="h-px bg-zinc-800 my-0.5" />
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
            <span>Chisel Width</span>
            <span className="text-zinc-500">{highlighterSize}px</span>
          </div>
          <div className="flex items-center justify-around gap-2">
            {HIGHLIGHTER_SIZES.map((s) => (
              <button
                key={s.size}
                type="button"
                onClick={() => setHighlighterSize(s.size)}
                className={`flex-1 py-1.5 rounded-lg flex flex-col items-center gap-1.5 transition-colors ${
                  highlighterSize === s.size ? 'bg-zinc-800 text-amber-400 border border-zinc-700' : 'text-zinc-400 hover:bg-zinc-800/50'
                }`}
              >
                <div
                  className="rounded-full bg-current"
                  style={{ width: Math.min(s.size, 16), height: 6 }}
                />
                <span className="text-[10px] font-medium">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ================= SHAPES FLYOUT ================= */}
      {showShapeFlyout && (
        <div className="mb-3 p-2 bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
          {(['rectangle', 'circle', 'diamond', 'arrow', 'line'] as ShapeType[]).map((shape) => (
            <button
              key={shape}
              type="button"
              onClick={() => {
                setActiveShape(shape);
                setActiveTool('shape');
                setShowShapeFlyout(false);
              }}
              className={`p-2 rounded-xl transition-all ${
                activeShape === shape && activeTool === 'shape'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
              title={shape.charAt(0).toUpperCase() + shape.slice(1)}
            >
              {renderShapeIcon(shape)}
            </button>
          ))}
        </div>
      )}

      {/* ================= STICKY NOTE COLOR PICKER ================= */}
      {showStickyFlyout && (
        <div className="mb-3 p-2.5 bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <span className="text-xs text-zinc-400 font-medium px-1">Note Color:</span>
          {STICKY_COLORS.map((item) => (
            <button
              key={item.color}
              type="button"
              onClick={() => {
                onAddSticky(item.color);
                setShowStickyFlyout(false);
              }}
              className="w-7 h-7 rounded-lg shadow-sm border border-black/20 hover:scale-110 active:scale-95 transition-transform flex items-center justify-center font-bold text-xs"
              style={{ backgroundColor: item.hex }}
              title={`Add ${item.name} Note`}
            />
          ))}
        </div>
      )}

      {/* ================= MAIN FLOATING DOCK ================= */}
      <div className="flex items-center gap-1 px-2.5 py-2 bg-zinc-900/90 backdrop-blur-xl border border-zinc-800/80 rounded-2xl shadow-2xl">
        {/* SELECT */}
        <button
          type="button"
          onClick={() => {
            setActiveTool('select');
            setShowPenFlyout(false);
            setShowHighlighterFlyout(false);
            setShowShapeFlyout(false);
            setShowStickyFlyout(false);
          }}
          className={`p-2.5 rounded-xl transition-all relative ${
            activeTool === 'select'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
          title="Select / Move (V)"
        >
          <MousePointer size={18} />
        </button>

        {/* PEN */}
        <button
          type="button"
          onClick={selectPen}
          className={`p-2.5 rounded-xl transition-all relative flex items-center gap-1 ${
            activeTool === 'pen'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
          title="Pen (P) - Click again for colors & thickness"
        >
          <Pen size={18} />
          <div
            className="w-2 h-2 rounded-full ring-1 ring-black/40"
            style={{ backgroundColor: activeColor }}
          />
          {activeTool === 'pen' && <ChevronUp size={12} className="opacity-70" />}
        </button>

        {/* HIGHLIGHTER */}
        <button
          type="button"
          onClick={selectHighlighter}
          className={`p-2.5 rounded-xl transition-all relative flex items-center gap-1 ${
            activeTool === 'highlighter'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
          title="Highlighter (H) - Translucent chisel inking"
        >
          <Highlighter size={18} />
          <div
            className="w-2 h-2 rounded-full ring-1 ring-black/40"
            style={{ backgroundColor: highlighterColor }}
          />
          {activeTool === 'highlighter' && <ChevronUp size={12} className="opacity-70" />}
        </button>

        {/* ERASER */}
        <button
          type="button"
          onClick={() => {
            setActiveTool('eraser');
            setShowPenFlyout(false);
            setShowHighlighterFlyout(false);
            setShowShapeFlyout(false);
            setShowStickyFlyout(false);
          }}
          className={`p-2.5 rounded-xl transition-all ${
            activeTool === 'eraser'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
          title="Stroke Eraser (E) - Tap any stroke to erase"
        >
          <Eraser size={18} />
        </button>

        {/* SHAPES */}
        <button
          type="button"
          onClick={selectShapeTool}
          className={`p-2.5 rounded-xl transition-all relative flex items-center gap-1 ${
            activeTool === 'shape'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
          title="Shapes (S) - Click for circle, rectangle, arrow..."
        >
          {renderShapeIcon(activeShape)}
          <ChevronUp size={12} className="opacity-70" />
        </button>

        {/* STICKY NOTES */}
        <button
          type="button"
          onClick={() => {
            setShowStickyFlyout((prev) => !prev);
            setShowPenFlyout(false);
            setShowHighlighterFlyout(false);
            setShowShapeFlyout(false);
          }}
          className={`p-2.5 rounded-xl transition-all ${
            showStickyFlyout
              ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
          title="Sticky Note (N) - Colorful brainstorming cards"
        >
          <StickyNote size={18} />
        </button>

        {/* TEXT */}
        <button
          type="button"
          onClick={() => {
            setActiveTool('text');
            setShowPenFlyout(false);
            setShowHighlighterFlyout(false);
            setShowShapeFlyout(false);
            setShowStickyFlyout(false);
          }}
          className={`p-2.5 rounded-xl transition-all ${
            activeTool === 'text'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
          title="Text Label (T)"
        >
          <Type size={18} />
        </button>

        {/* HAND / PAN */}
        <button
          type="button"
          onClick={() => {
            setActiveTool('hand');
            setShowPenFlyout(false);
            setShowHighlighterFlyout(false);
            setShowShapeFlyout(false);
            setShowStickyFlyout(false);
          }}
          className={`p-2.5 rounded-xl transition-all ${
            activeTool === 'hand'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
          title="Pan Canvas (Space / Hand)"
        >
          <Hand size={18} />
        </button>

        <div className="w-px h-6 bg-zinc-800 mx-1" />

        {/* UNDO */}
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-2.5 rounded-xl transition-all ${
            canUndo ? 'text-zinc-300 hover:bg-zinc-800 hover:text-white' : 'text-zinc-600 cursor-not-allowed'
          }`}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={18} />
        </button>

        {/* REDO */}
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className={`p-2.5 rounded-xl transition-all ${
            canRedo ? 'text-zinc-300 hover:bg-zinc-800 hover:text-white' : 'text-zinc-600 cursor-not-allowed'
          }`}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={18} />
        </button>

        {/* CLEAR ALL */}
        <button
          type="button"
          onClick={onClear}
          className="p-2.5 rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          title="Clear Whiteboard"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
};
