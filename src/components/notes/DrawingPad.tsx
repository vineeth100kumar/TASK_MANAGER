import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Undo2, Trash2, Pen, Highlighter, Eraser } from 'lucide-react';
import { loadImage } from './noteHtml';

type Tool = 'pen' | 'marker' | 'eraser';

interface Stroke {
  tool: Tool;
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

const COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
const SIZES = [2, 5, 10];

interface DrawingPadProps {
  /** An image to draw over (annotating). Without one the pad is blank paper. */
  background?: string | null;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}

/**
 * A sketch pad for notes. Strokes are kept as points so undo is exact, drawn on
 * their own layer so the eraser never rubs out the picture underneath, and
 * flattened to one PNG when inserted.
 */
export function DrawingPad({ background, onCancel, onDone }: DrawingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bg, setBg] = useState<HTMLImageElement | null>(null);
  const [size, setSizeState] = useState<{ w: number; h: number }>({ w: 900, h: 560 });
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(SIZES[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);

  // The drawing's own size: the picture's (capped) when annotating, else a landscape page.
  useEffect(() => {
    if (!background) return;
    loadImage(background).then(img => {
      const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      setBg(img);
      setSizeState({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    }).catch(() => {});
  }, [background]);

  const paint = (ctx: CanvasRenderingContext2D, list: Stroke[]) => {
    ctx.clearRect(0, 0, size.w, size.h);
    for (const s of list) {
      if (s.points.length === 0) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = s.tool === 'marker' ? s.size * 3 : s.tool === 'eraser' ? s.size * 3 : s.size;
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.tool === 'marker' ? 0.35 : 1;
      ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.01, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
      ctx.restore();
    }
  };

  const redraw = (list = strokes) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) paint(ctx, drawing.current ? [...list, drawing.current] : list);
  };
  useEffect(() => { redraw(); }, [strokes, size]);

  const pointFor = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (size.w / rect.width), y: (e.clientY - rect.top) * (size.h / rect.height) };
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = { tool, color, size: width, points: [pointFor(e)] };
    redraw();
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    drawing.current.points.push(pointFor(e));
    redraw();
  };
  const onUp = () => {
    if (!drawing.current) return;
    const done = drawing.current;
    drawing.current = null;
    setStrokes(prev => [...prev, done]);
  };

  const insert = () => {
    const out = document.createElement('canvas');
    out.width = size.w;
    out.height = size.h;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);
    if (bg) ctx.drawImage(bg, 0, 0, size.w, size.h);
    ctx.drawImage(canvasRef.current!, 0, 0);
    onDone(out.toDataURL('image/png'));
  };

  const toolButton = (t: Tool, Icon: typeof Pen, label: string) => (
    <button type="button" onClick={() => setTool(t)} aria-pressed={tool === t} title={label}
      className={`p-2 rounded-lg transition-colors ${tool === t ? 'bg-gray-900 text-white dark:bg-white dark:text-black' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/10'}`}>
      <Icon size={16} />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 md:p-6">
      <div className="absolute inset-0 scrim" onClick={onCancel} />
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        role="dialog" aria-label={background ? 'Draw on image' : 'Drawing'}
        className="relative z-10 w-full max-w-4xl max-h-full flex flex-col gap-3 p-3 md:p-4 rounded-3xl bg-white dark:bg-[#1c1c1e] border border-black/5 dark:border-white/10 shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white pl-1">{background ? 'Draw on image' : 'New drawing'}</h3>
          <button type="button" onClick={onCancel} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {toolButton('pen', Pen, 'Pen')}
          {toolButton('marker', Highlighter, 'Highlighter')}
          {toolButton('eraser', Eraser, 'Eraser')}
          <span className="w-px h-6 bg-black/10 dark:bg-white/10 mx-1" />
          {COLORS.map(c => (
            <button key={c} type="button" onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} aria-label={`Colour ${c}`} aria-pressed={color === c}
              className={`w-6 h-6 rounded-full border border-black/10 transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-[#1c1c1e] scale-110' : ''}`}
              style={{ background: c }} />
          ))}
          <span className="w-px h-6 bg-black/10 dark:bg-white/10 mx-1" />
          {SIZES.map(s => (
            <button key={s} type="button" onClick={() => setWidth(s)} aria-label={`Size ${s}`} aria-pressed={width === s}
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${width === s ? 'bg-black/10 dark:bg-white/15' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}>
              <span className="rounded-full bg-gray-700 dark:bg-gray-200" style={{ width: s + 2, height: s + 2 }} />
            </button>
          ))}
          <span className="flex-1" />
          <button type="button" onClick={() => setStrokes(s => s.slice(0, -1))} disabled={!strokes.length} title="Undo"
            className="p-2 rounded-lg text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30"><Undo2 size={16} /></button>
          <button type="button" onClick={() => setStrokes([])} disabled={!strokes.length} title="Clear"
            className="p-2 rounded-lg text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30"><Trash2 size={16} /></button>
        </div>

        <div className="relative min-h-0 flex-1 flex items-center justify-center overflow-hidden rounded-2xl bg-gray-100 dark:bg-black/40">
          <div className="relative bg-white shadow-sm" style={{ aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, calc(62vh * ${size.w / size.h}))` }}>
            {bg && <img src={background!} alt="" className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none" />}
            <canvas ref={canvasRef} width={size.w} height={size.h} data-testid="drawing-canvas"
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              className="absolute inset-0 w-full h-full touch-none cursor-crosshair" />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10">Cancel</button>
          <button type="button" onClick={insert} disabled={!strokes.length}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {background ? 'Save drawing' : 'Insert drawing'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
