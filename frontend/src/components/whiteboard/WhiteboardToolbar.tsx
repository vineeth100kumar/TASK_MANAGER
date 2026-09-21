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
  { color: 'blue', hex: '#bae6fd', name: 'Blue' },
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

  /*
   * One set of classes for both editions.
   *
   * The toolbar used to carry two hand-mixed themes -- a near-black for night
   * and a cream for day -- which meant every state had to be written twice and
   * the selected tool was a different idea in each: an accent wash at night, a
   * full inverted block by day. It is the app's surface now, and the selected
   * tool is the accent, once.
   */
  const containerClass = 'bg-surface/95 backdrop-blur-xl border border-hairline text-ink';
  const btnHoverClass = 'text-ink-2 hover:text-ink hover:bg-sunken';
  const btnActiveClass = 'bg-accent-500 text-white border-accent-500';

  const bottomStyle = {
    bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))'
  };

  if (isCollapsed) {
    return (
      <div style={bottomStyle} className="fixed left-1/2 -translate-x-1/2 z-30">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className={`h-10 flex items-center gap-2 px-3.5 shadow-lift-2 rounded-control text-meta font-medium ${containerClass}`}
          title="Show the tools"
        >
          <Pen size={14} className="text-accent-500" />
          <span>Tools</span>
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
                <div className="text-caption mb-1.5 text-ink-3">
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
                        activeColor === hex ? 'scale-110 ring-2 ring-accent-500' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-caption mb-1.5 text-ink-3">
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
              <div className="text-caption text-ink-3">
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

        <div className={`w-[1px] h-6 mx-0.5 bg-hairline`} />

        {/* More tools */}
        <button
          type="button"
          onClick={onOpenMoreSheet}
          className={`p-2 rounded-control border border-transparent transition-colors ${btnHoverClass}`}
          title="More tools"
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

      <div className={`w-[1px] h-6 mx-0.5 bg-hairline`} />

      {/* 3. PEN TOOL */}
      <div className="relative">
        <button
          type="button"
          onClick={selectPen}
          className={`p-2 rounded-control border flex items-center gap-1 transition-colors ${
            activeTool === 'pen' ? btnActiveClass : `border-transparent ${btnHoverClass}`
          }`}
          title="Pen (P)"
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
              <div className="text-caption mb-1.5 text-ink-3">
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
                      activeColor === hex ? 'scale-110 ring-2 ring-accent-500' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-caption mb-1.5 text-ink-3">
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
            ? 'bg-danger-600 text-white border-danger-600 shadow-sm'
            : `border-transparent ${btnHoverClass}`
        }`}
        title="Laser pointer (L). The trace fades on its own."
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
              <div className="text-caption mb-1.5 text-ink-3">
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
                      highlighterColor === hex ? 'scale-110 ring-2 ring-accent-500' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-caption mb-1.5 text-ink-3">
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

      <div className={`w-[1px] h-6 mx-0.5 bg-hairline`} />

      {/* 7. SHAPES TOOL */}
      <div className="relative">
        <button
          type="button"
          onClick={selectShape}
          className={`p-2 rounded-control border flex items-center gap-1 transition-colors ${
            activeTool === 'shape' ? btnActiveClass : `border-transparent ${btnHoverClass}`
          }`}
          title="Shapes (U)"
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
              <div className="text-caption mb-1.5 text-ink-3">
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
              <div className="pt-2 border-t border-hairline">
                <div className="flex items-center justify-between text-caption mb-1 text-ink-3">
                  <span>Fill Tone</span>
                  <button
                    type="button"
                    onClick={() => setActiveFillColor(null)}
                    className={activeFillColor === null ? "text-accent-600 dark:text-accent-400 font-medium text-caption" : "text-ink-3 text-caption"}
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
                        activeFillColor === c ? 'ring-2 ring-accent-500 border-hairline scale-110' : 'border-black/20 hover:scale-105'
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
            <div className="text-caption text-ink-3">
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

      <div className={`w-[1px] h-6 mx-0.5 bg-hairline`} />

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
        className="p-2 rounded-control border border-transparent transition-colors text-danger-600 dark:text-danger-400 hover:bg-danger-500/10"
        title="Clear Drawing Board"
      >
        <Trash2 size={16} />
      </button>

      {/* 13. MINIMIZE TOOLBAR BUTTON */}
      <button
        type="button"
        onClick={() => setIsCollapsed(true)}
        className={"p-2 rounded-control border border-transparent text-ink-3 hover:text-ink hover:bg-sunken transition-colors"}
        title="Hide the tools"
      >
        <ChevronDown size={16} />
      </button>
    </div>
  );
};
