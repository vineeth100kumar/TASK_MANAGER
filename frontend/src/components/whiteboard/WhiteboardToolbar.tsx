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
  Zap,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  MoreHorizontal
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
  activeFillColor?: string | null;
  setActiveFillColor?: (color: string | null) => void;
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
  onTriggerImageUpload?: () => void;
  onOpenMoreSheet?: () => void;
  edition?: 'day' | 'night';
}

const PEN_COLORS = [
  '#1A1814', // Newsprint Ink
  '#B3261E', // Red
  '#1A4A1A', // Forest Green
  '#8B5E00', // Amber
  '#003366', // Deep Navy
  '#5A5650', // Slate Gray
  '#FFFFFF', // White
  '#9333EA', // Violet
];

const PEN_SIZES = [
  { label: 'Fine (2pt)', size: 2 },
  { label: 'Medium (4pt)', size: 4 },
  { label: 'Bold (8pt)', size: 8 },
  { label: 'Chisel (14pt)', size: 14 },
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
  { label: 'Narrow', size: 14 },
  { label: 'Medium', size: 22 },
  { label: 'Broad', size: 34 },
];

const STICKY_COLORS: { color: StickyColor; hex: string; name: string }[] = [
  { color: 'yellow', hex: '#fef08a', name: 'Canary Yellow' },
  { color: 'blue', hex: '#bae6fd', name: 'Blueprint Cyan' },
  { color: 'green', hex: '#bbf7d0', name: 'Mint Green' },
  { color: 'pink', hex: '#fbcfe8', name: 'Rose Coral' },
  { color: 'purple', hex: '#e9d5ff', name: 'Lilac' },
  { color: 'orange', hex: '#fed7aa', name: 'Manila Buff' },
];

const FILL_COLORS = [
  '#FFFFFF',
  '#fef08a',
  '#bbf7d0',
  '#bae6fd',
  '#fbcfe8',
  '#e9d5ff',
  '#1e293b',
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
  activeFillColor = null,
  setActiveFillColor,
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
  onTriggerImageUpload,
  onOpenMoreSheet,
  edition = 'day',
}) => {
  const [showPenFlyout, setShowPenFlyout] = useState(false);
  const [showHighlighterFlyout, setShowHighlighterFlyout] = useState(false);
  const [showShapeFlyout, setShowShapeFlyout] = useState(false);
  const [showStickyFlyout, setShowStickyFlyout] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 640 : false);

  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  const selectShape = () => {
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

  const selectSticky = () => {
    if (activeTool === 'sticky') {
      setShowStickyFlyout((prev) => !prev);
    } else {
      setActiveTool('sticky');
      setShowStickyFlyout(true);
    }
    setShowPenFlyout(false);
    setShowHighlighterFlyout(false);
    setShowShapeFlyout(false);
  };

  const isNight = edition === 'night';
  const containerClass = isNight
    ? 'bg-[#141418] border-hairline text-ink'
    : 'bg-paper-white border-ink-primary text-ink-primary';

  const btnHoverClass = isNight
    ? 'hover:bg-sunken text-ink-2'
    : 'hover:bg-paper-aged text-ink-primary';

  const btnActiveClass = isNight
    ? 'bg-amber-600/30 text-amber-400 border-amber-600/60 font-bold'
    : 'bg-ink-primary text-paper-white border-ink-primary font-bold';

  const bottomStyle = {
    bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))'
  };

  if (isCollapsed) {
    return (
      <div style={bottomStyle} className="fixed left-1/2 -translate-x-1/2 z-30">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className={`flex items-center gap-2 px-3 py-1.5 border shadow-xl rounded-control text-meta font-bold ${containerClass}`}
          title="Expand Drafting Rack"
        >
          <Pen size={14} className="text-amber-500" />
          <span>Drafting Rack</span>
          <ChevronUp size={14} />
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------
  // MOBILE COMPACT TOOLBAR (< 640px)
  // -------------------------------------------------------------
  if (isMobile) {
    return (
      <div
        ref={toolbarRef}
        style={bottomStyle}
        className={`fixed left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 p-1.5 border shadow-lg rounded-control select-none ${containerClass}`}
      >
        {/* Select */}
        <button
          type="button"
          onClick={() => {
            setActiveTool('select');
            setShowPenFlyout(false);
            setShowStickyFlyout(false);
          }}
          className={`p-2 rounded-control border transition-colors ${
            activeTool === 'select' ? btnActiveClass : `border-transparent ${btnHoverClass}`
          }`}
          title="Select (V)"
        >
          <MousePointer size={18} />
        </button>

        {/* Pen */}
        <div className="relative">
          <button
            type="button"
            onClick={selectPen}
            className={`p-2 rounded-control border flex items-center gap-1 transition-colors ${
              activeTool === 'pen' ? btnActiveClass : `border-transparent ${btnHoverClass}`
            }`}
            title="Pen (P)"
          >
            <Pen size={18} />
            <div
              className="w-2.5 h-2.5 rounded-control border border-black/30 shadow-sm"
              style={{ backgroundColor: activeColor }}
            />
          </button>

          {showPenFlyout && (
            <div
              className={`absolute bottom-12 left-0 p-3 border shadow-lg rounded-control w-52 space-y-3 z-40 ${containerClass}`}
            >
              <div>
                <div className="text-caption font-bold mb-1.5 text-ink-muted">
                  Ink Color
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {PEN_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => {
                        setActiveColor(hex);
                        setShowPenFlyout(false);
                      }}
                      className={`h-6 rounded-control border border-black/20 flex items-center justify-center transition-transform ${
                        activeColor === hex ? 'scale-110 ring-2 ring-amber-500' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-caption font-bold mb-1.5 text-ink-muted">
                  Line Width
                </div>
                <div className="grid grid-cols-2 gap-1 text-caption">
                  {PEN_SIZES.map((s) => (
                    <button
                      key={s.size}
                      type="button"
                      onClick={() => {
                        setActiveSize(s.size);
                        setShowPenFlyout(false);
                      }}
                      className={`px-2 py-1 border rounded-control text-center ${
                        activeSize === s.size ? btnActiveClass : `border-transparent ${btnHoverClass}`
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Eraser */}
        <button
          type="button"
          onClick={() => {
            setActiveTool('eraser');
            setShowPenFlyout(false);
            setShowStickyFlyout(false);
          }}
          className={`p-2 rounded-control border transition-colors ${
            activeTool === 'eraser' ? btnActiveClass : `border-transparent ${btnHoverClass}`
          }`}
          title="Eraser (E)"
        >
          <Eraser size={18} />
        </button>

        {/* Sticky Note */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowStickyFlyout((prev) => !prev);
              setShowPenFlyout(false);
            }}
            className={`p-2 rounded-control border transition-colors ${
              showStickyFlyout ? btnActiveClass : `border-transparent ${btnHoverClass}`
            }`}
            title="Sticky Note"
          >
            <StickyNote size={18} />
          </button>

          {showStickyFlyout && (
            <div
              className={`absolute bottom-12 left-0 p-2.5 border shadow-lg rounded-control w-48 space-y-2 z-40 ${containerClass}`}
            >
              <div className="text-caption font-bold text-ink-muted">
                Select Note Color
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {STICKY_COLORS.map((sc) => (
                  <button
                    key={sc.color}
                    type="button"
                    onClick={() => {
                      onAddSticky(sc.color);
                      setShowStickyFlyout(false);
                    }}
                    className="h-8 rounded-control border border-black/30 shadow-sm flex items-center justify-center hover:scale-105 active:scale-95 transition-transform text-caption font-bold text-black/70"
                    style={{ backgroundColor: sc.hex }}
                    title={sc.name}
                  >
                    {sc.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={`w-[1px] h-6 mx-0.5 ${isNight ? 'bg-hairline' : 'bg-ink-rule'}`} />

        {/* More Instruments (...) */}
        <button
          type="button"
          onClick={onOpenMoreSheet}
          className={`p-2 rounded-control border border-transparent transition-colors ${btnHoverClass}`}
          title="More Instruments"
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------
  // DESKTOP FULL INSTRUMENT RACK (>= 640px)
  // -------------------------------------------------------------
  return (
    <div
      ref={toolbarRef}
      style={bottomStyle}
      className={`fixed left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 p-1.5 border shadow-lg rounded-control select-none transition-all ${containerClass}`}
    >
      {/* 1. SELECT TOOL */}
      <button
        type="button"
        onClick={() => {
          setActiveTool('select');
          setShowPenFlyout(false);
          setShowHighlighterFlyout(false);
          setShowShapeFlyout(false);
          setShowStickyFlyout(false);
        }}
        className={`p-2 rounded-control border transition-colors ${
          activeTool === 'select' ? btnActiveClass : `border-transparent ${btnHoverClass}`
        }`}
        title="Select & Move (V)"
      >
        <MousePointer size={16} />
      </button>

      {/* 2. HAND / PAN TOOL */}
      <button
        type="button"
        onClick={() => {
          setActiveTool('hand');
          setShowPenFlyout(false);
          setShowHighlighterFlyout(false);
          setShowShapeFlyout(false);
          setShowStickyFlyout(false);
        }}
        className={`p-2 rounded-control border transition-colors ${
          activeTool === 'hand' ? btnActiveClass : `border-transparent ${btnHoverClass}`
        }`}
        title="Pan Canvas (H / Space+Drag)"
      >
        <Hand size={16} />
      </button>

      <div className={`w-[1px] h-6 mx-0.5 ${isNight ? 'bg-hairline' : 'bg-ink-rule'}`} />

      {/* 3. PEN TOOL */}
      <div className="relative">
        <button
          type="button"
          onClick={selectPen}
          className={`p-2 rounded-control border flex items-center gap-1 transition-colors ${
            activeTool === 'pen' ? btnActiveClass : `border-transparent ${btnHoverClass}`
          }`}
          title="Drafting Pen (P)"
        >
          <Pen size={16} />
          <div
            className="w-2.5 h-2.5 rounded-control border border-black/30 shadow-sm"
            style={{ backgroundColor: activeColor }}
          />
        </button>

        {/* Pen Customizer Flyout */}
        {showPenFlyout && (
          <div
            className={`absolute bottom-12 left-0 p-3 border shadow-lg rounded-control w-56 space-y-3 z-40 ${containerClass}`}
          >
            <div>
              <div className="text-caption font-bold mb-1.5 text-ink-muted">
                Ink Color
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {PEN_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => {
                      setActiveColor(hex);
                      setShowPenFlyout(false);
                    }}
                    className={`h-6 rounded-control border border-black/20 flex items-center justify-center transition-transform ${
                      activeColor === hex ? 'scale-110 ring-2 ring-amber-500' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-caption font-bold mb-1.5 text-ink-muted">
                Line Width
              </div>
              <div className="grid grid-cols-2 gap-1 text-caption">
                {PEN_SIZES.map((s) => (
                  <button
                    key={s.size}
                    type="button"
                    onClick={() => {
                      setActiveSize(s.size);
                      setShowPenFlyout(false);
                    }}
                    className={`px-2 py-1 border rounded-control text-center ${
                      activeSize === s.size ? btnActiveClass : `border-transparent ${btnHoverClass}`
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. LASER POINTER TOOL */}
      <button
        type="button"
        onClick={() => {
          setActiveTool('laser');
          setShowPenFlyout(false);
          setShowHighlighterFlyout(false);
          setShowShapeFlyout(false);
          setShowStickyFlyout(false);
        }}
        className={`p-2 rounded-control border transition-colors ${
          activeTool === 'laser'
            ? 'bg-rose-600 text-white border-rose-600 font-bold shadow-sm animate-pulse'
            : `border-transparent ${btnHoverClass}`
        }`}
        title="Laser Pointer (L) - Temporary Fading Trace"
      >
        <Zap size={16} />
      </button>

      {/* 5. HIGHLIGHTER TOOL */}
      <div className="relative">
        <button
          type="button"
          onClick={selectHighlighter}
          className={`p-2 rounded-control border flex items-center gap-1 transition-colors ${
            activeTool === 'highlighter' ? btnActiveClass : `border-transparent ${btnHoverClass}`
          }`}
          title="Marker & Highlighter (M)"
        >
          <Highlighter size={16} />
          <div
            className="w-2.5 h-2.5 rounded-control border border-black/30 shadow-sm"
            style={{ backgroundColor: highlighterColor }}
          />
        </button>

        {/* Highlighter Flyout */}
        {showHighlighterFlyout && (
          <div
            className={`absolute bottom-12 left-0 p-3 border shadow-lg rounded-control w-52 space-y-3 z-40 ${containerClass}`}
          >
            <div>
              <div className="text-caption font-bold mb-1.5 text-ink-muted">
                Marker Ink
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {HIGHLIGHTER_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => {
                      setHighlighterColor(hex);
                      setShowHighlighterFlyout(false);
                    }}
                    className={`h-6 rounded-control border border-black/20 flex items-center justify-center transition-transform ${
                      highlighterColor === hex ? 'scale-110 ring-2 ring-amber-500' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-caption font-bold mb-1.5 text-ink-muted">
                Tip Width
              </div>
              <div className="grid grid-cols-3 gap-1 text-caption">
                {HIGHLIGHTER_SIZES.map((s) => (
                  <button
                    key={s.size}
                    type="button"
                    onClick={() => {
                      setHighlighterSize(s.size);
                      setShowHighlighterFlyout(false);
                    }}
                    className={`px-1.5 py-1 border rounded-control text-center ${
                      highlighterSize === s.size ? btnActiveClass : `border-transparent ${btnHoverClass}`
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 6. ERASER TOOL */}
      <button
        type="button"
        onClick={() => {
          setActiveTool('eraser');
          setShowPenFlyout(false);
          setShowHighlighterFlyout(false);
          setShowShapeFlyout(false);
          setShowStickyFlyout(false);
        }}
        className={`p-2 rounded-control border transition-colors ${
          activeTool === 'eraser' ? btnActiveClass : `border-transparent ${btnHoverClass}`
        }`}
        title="Precision Eraser (E)"
      >
        <Eraser size={16} />
      </button>

      <div className={`w-[1px] h-6 mx-0.5 ${isNight ? 'bg-hairline' : 'bg-ink-rule'}`} />

      {/* 7. SHAPES TOOL */}
      <div className="relative">
        <button
          type="button"
          onClick={selectShape}
          className={`p-2 rounded-control border flex items-center gap-1 transition-colors ${
            activeTool === 'shape' ? btnActiveClass : `border-transparent ${btnHoverClass}`
          }`}
          title="Geometric Drafting Shapes (U)"
        >
          {activeShape === 'rectangle' && <Square size={16} />}
          {activeShape === 'circle' && <Circle size={16} />}
          {activeShape === 'diamond' && <Diamond size={16} />}
          {activeShape === 'arrow' && <ArrowUpRight size={16} />}
          {activeShape === 'line' && <Minus size={16} />}
        </button>

        {/* Shapes Flyout with Shape Types & Fill Color */}
        {showShapeFlyout && (
          <div
            className={`absolute bottom-12 left-0 p-3 border shadow-lg rounded-control space-y-3 z-40 w-56 ${containerClass}`}
          >
            <div>
              <div className="text-caption font-bold mb-1.5 text-ink-muted">
                Shape Type
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveShape('rectangle');
                    setShowShapeFlyout(false);
                  }}
                  className={`p-2 rounded-control border ${
                    activeShape === 'rectangle' ? btnActiveClass : `border-transparent ${btnHoverClass}`
                  }`}
                  title="Rectangle"
                >
                  <Square size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveShape('circle');
                    setShowShapeFlyout(false);
                  }}
                  className={`p-2 rounded-control border ${
                    activeShape === 'circle' ? btnActiveClass : `border-transparent ${btnHoverClass}`
                  }`}
                  title="Circle / Ellipse"
                >
                  <Circle size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveShape('diamond');
                    setShowShapeFlyout(false);
                  }}
                  className={`p-2 rounded-control border ${
                    activeShape === 'diamond' ? btnActiveClass : `border-transparent ${btnHoverClass}`
                  }`}
                  title="Diamond / Decision"
                >
                  <Diamond size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveShape('arrow');
                    setShowShapeFlyout(false);
                  }}
                  className={`p-2 rounded-control border ${
                    activeShape === 'arrow' ? btnActiveClass : `border-transparent ${btnHoverClass}`
                  }`}
                  title="Flow Arrow"
                >
                  <ArrowUpRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveShape('line');
                    setShowShapeFlyout(false);
                  }}
                  className={`p-2 rounded-control border ${
                    activeShape === 'line' ? btnActiveClass : `border-transparent ${btnHoverClass}`
                  }`}
                  title="Straight Line"
                >
                  <Minus size={16} />
                </button>
              </div>
            </div>

            {/* Shape Fill Color Selection */}
            {setActiveFillColor && (
              <div className="pt-2 border-t border-ink-base/15 dark:border-stone-700">
                <div className="flex items-center justify-between text-caption font-bold mb-1 text-ink-muted">
                  <span>Fill Tone</span>
                  <button
                    type="button"
                    onClick={() => setActiveFillColor(null)}
                    className={activeFillColor === null ? "text-amber-600 dark:text-amber-400 font-bold text-caption" : "text-ink-muted text-caption"}
                  >
                    None
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {FILL_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setActiveFillColor(c)}
                      className={`w-5 h-5 rounded-control border transition-transform ${
                        activeFillColor === c ? 'ring-2 ring-amber-500 border-black/40 scale-110' : 'border-black/20 hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 8. STICKY NOTE TOOL */}
      <div className="relative">
        <button
          type="button"
          onClick={selectSticky}
          className={`p-2 rounded-control border transition-colors ${
            activeTool === 'sticky' || showStickyFlyout ? btnActiveClass : `border-transparent ${btnHoverClass}`
          }`}
          title="Add note (S)"
        >
          <StickyNote size={16} />
        </button>

        {/* Sticky Palette Flyout */}
        {showStickyFlyout && (
          <div
            className={`absolute bottom-12 left-0 p-2.5 border shadow-lg rounded-control w-48 space-y-2 z-40 ${containerClass}`}
          >
            <div className="text-caption font-bold text-ink-muted">
              Select Note Color
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {STICKY_COLORS.map((sc) => (
                <button
                  key={sc.color}
                  type="button"
                  onClick={() => {
                    onAddSticky(sc.color);
                    setShowStickyFlyout(false);
                    setActiveTool('select');
                  }}
                  className="h-8 rounded-control border border-black/30 shadow-sm flex items-center justify-center hover:scale-105 active:scale-95 transition-transform text-caption font-bold text-black/70"
                  style={{ backgroundColor: sc.hex }}
                  title={sc.name}
                >
                  {sc.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 9. TEXT TOOL */}
      <button
        type="button"
        onClick={() => {
          setActiveTool('text');
          setShowPenFlyout(false);
          setShowHighlighterFlyout(false);
          setShowShapeFlyout(false);
          setShowStickyFlyout(false);
        }}
        className={`p-2 rounded-control border transition-colors ${
          activeTool === 'text' ? btnActiveClass : `border-transparent ${btnHoverClass}`
        }`}
        title="Typeset Text (T)"
      >
        <Type size={16} />
      </button>

      {/* 10. INSERT IMAGE BUTTON */}
      {onTriggerImageUpload && (
        <button
          type="button"
          onClick={onTriggerImageUpload}
          className={`p-2 rounded-control border border-transparent transition-colors ${btnHoverClass}`}
          title="Insert Image (Paste / Upload)"
        >
          <ImageIcon size={16} />
        </button>
      )}

      <div className={`w-[1px] h-6 mx-0.5 ${isNight ? 'bg-hairline' : 'bg-ink-rule'}`} />

      {/* 11. UNDO / REDO */}
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className={`p-2 rounded-control border border-transparent transition-colors ${
          canUndo ? btnHoverClass : 'opacity-25 cursor-not-allowed'
        }`}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className={`p-2 rounded-control border border-transparent transition-colors ${
          canRedo ? btnHoverClass : 'opacity-25 cursor-not-allowed'
        }`}
        title="Redo (Ctrl+Y)"
      >
        <Redo2 size={16} />
      </button>

      {/* 12. CLEAR BOARD */}
      <button
        type="button"
        onClick={onClear}
        className={`p-2 rounded-control border border-transparent transition-colors text-rose-600 hover:bg-rose-950/20`}
        title="Clear Drawing Board"
      >
        <Trash2 size={16} />
      </button>

      {/* 13. MINIMIZE TOOLBAR BUTTON */}
      <button
        type="button"
        onClick={() => setIsCollapsed(true)}
        className={`p-2 rounded-control border border-transparent text-ink-muted hover:text-ink-primary`}
        title="Minimize Drafting Rack"
      >
        <ChevronDown size={16} />
      </button>
    </div>
  );
};
