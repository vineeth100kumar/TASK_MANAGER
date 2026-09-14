import React, { useRef, useEffect, useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import {
  WhiteboardElement,
  StrokeElement,
  ShapeElement,
  TextElement,
  ImageElement,
  WhiteboardTool,
  WhiteboardGridType,
  ShapeType,
  ViewState,
  Point,
} from '../../types';

export interface WhiteboardCanvasRef {
  exportToPNG: () => Promise<string>;
  exportToSVG: () => string;
  resetView: () => void;
  fitToContent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getViewState: () => ViewState;
  setViewState: (view: ViewState) => void;
}

interface WhiteboardCanvasProps {
  elements: WhiteboardElement[];
  onElementsChange: (elements: WhiteboardElement[], recordHistory?: boolean) => void;
  activeTool: WhiteboardTool;
  setActiveTool?: (tool: WhiteboardTool) => void;
  activeColor: string;
  activeSize: number;
  activeShape: ShapeType;
  activeFillColor?: string | null;
  highlighterColor: string;
  highlighterSize: number;
  viewState: ViewState;
  onViewStateChange: (view: ViewState) => void;
  selectedElementId: string | null;
  onSelectElementId: (id: string | null) => void;
  selectedElementIds?: Set<string>;
  onSelectElementIds?: (ids: Set<string>) => void;
  edition?: 'day' | 'night';
  gridType?: WhiteboardGridType;
  stylusOnly?: boolean;
  onCanvasDoubleClick?: (point: Point) => void;
}

// Distance from point P to line segment AB
function distToSegmentSquared(p: Point, v: Point, w: Point) {
  const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
  if (l2 === 0) return (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = v.x + t * (w.x - v.x);
  const projY = v.y + t * (w.y - v.y);
  return (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
}

function distToSegment(p: Point, v: Point, w: Point) {
  return Math.sqrt(distToSegmentSquared(p, v, w));
}

// Bounding box helper
function getElementBBox(el: WhiteboardElement): { x: number; y: number; w: number; h: number } | null {
  if (el.type === 'shape' || el.type === 'sticky' || el.type === 'image') {
    const minX = Math.min(el.x, el.x + el.width);
    const minY = Math.min(el.y, el.y + el.height);
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    return { x: minX, y: minY, w, h };
  }
  if (el.type === 'text') {
    return { x: el.x, y: el.y, w: el.width || 160, h: el.fontSize * 1.5 };
  }
  if (el.type === 'stroke') {
    if (el.points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    el.points.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    return { x: minX, y: minY, w: Math.max(10, maxX - minX), h: Math.max(10, maxY - minY) };
  }
  return null;
}

export const WhiteboardCanvas = forwardRef<WhiteboardCanvasRef, WhiteboardCanvasProps>(
  (
    {
      elements,
      onElementsChange,
      activeTool,
      setActiveTool,
      activeColor,
      activeSize,
      activeShape,
      activeFillColor,
      highlighterColor,
      highlighterSize,
      viewState,
      onViewStateChange,
      selectedElementId,
      onSelectElementId,
      selectedElementIds,
      onSelectElementIds,
      edition = 'day',
      gridType = 'dots',
      stylusOnly = false,
      onCanvasDoubleClick,
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Current drawing state
    const isDrawingRef = useRef(false);
    const currentPointsRef = useRef<Point[]>([]);
    const shapeStartRef = useRef<Point | null>(null);
    const shapeCurrentRef = useRef<Point | null>(null);

    // Laser pointer points: { x, y, time }
    const laserPointsRef = useRef<{ x: number; y: number; time: number }[]>([]);
    const laserAnimRef = useRef<number | null>(null);

    // Panning & zooming state
    const isPanningRef = useRef(false);
    const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const spacePressedRef = useRef(false);

    // Two-finger pinch state
    const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
    const initialPinchDistRef = useRef<number | null>(null);
    const initialPinchZoomRef = useRef<number>(1);
    const initialPinchPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    // Momentum Pan state
    const panVelocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
    const momentumRafRef = useRef<number | null>(null);
    const lastPanTimeRef = useRef<number>(0);
    const lastPanPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const viewStateRef = useRef(viewState);
    useEffect(() => {
      viewStateRef.current = viewState;
    }, [viewState]);

    // Selection Drag & Resize refs
    const dragElementIdRef = useRef<string | null>(null);
    const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
    const resizeHandleRef = useRef<string | null>(null);
    const resizeOriginRef = useRef<{ el: ShapeElement; startPt: Point } | null>(null);

    // Lasso refs
    const lassoStartRef = useRef<Point | null>(null);
    const lassoCurrentRef = useRef<Point | null>(null);

    // Image Cache
    const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

    // Text editing inline
    const [inlineTextPos, setInlineTextPos] = useState<{ x: number; y: number } | null>(null);
    const [inlineTextVal, setInlineTextVal] = useState('');
    const textInputRef = useRef<HTMLTextAreaElement | null>(null);

    // Coordinate conversions
    const screenToWorld = useCallback(
      (sx: number, sy: number): Point => {
        return {
          x: (sx - viewState.panX) / viewState.zoom,
          y: (sy - viewState.panY) / viewState.zoom,
        };
      },
      [viewState]
    );

    const worldToScreen = useCallback(
      (wx: number, wy: number): Point => {
        return {
          x: wx * viewState.zoom + viewState.panX,
          y: wy * viewState.zoom + viewState.panY,
        };
      },
      [viewState]
    );

    // -------------------------------------------------------------
    // HIT TEST & HANDLE POSITIONS
    // -------------------------------------------------------------
    const getHandlePositions = (el: ShapeElement) => {
      const { x, y, width: w, height: h } = el;
      return [
        { id: 'nw', x, y },
        { id: 'n', x: x + w / 2, y },
        { id: 'ne', x: x + w, y },
        { id: 'e', x: x + w, y: y + h / 2 },
        { id: 'se', x: x + w, y: y + h },
        { id: 's', x: x + w / 2, y: y + h },
        { id: 'sw', x, y: y + h },
        { id: 'w', x, y: y + h / 2 },
      ];
    };

    const hitTest = useCallback((el: WhiteboardElement, p: Point): boolean => {
      if (el.type === 'shape' || el.type === 'image') {
        const minX = Math.min(el.x, el.x + el.width);
        const maxX = Math.max(el.x, el.x + el.width);
        const minY = Math.min(el.y, el.y + el.height);
        const maxY = Math.max(el.y, el.y + el.height);
        return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
      }
      if (el.type === 'text') {
        return p.x >= el.x && p.x <= el.x + (el.width || 180) && p.y >= el.y && p.y <= el.y + el.fontSize * 1.5;
      }
      if (el.type === 'stroke') {
        for (let i = 0; i < el.points.length - 1; i++) {
          if (distToSegment(p, el.points[i], el.points[i + 1]) < el.size / 2 + 6) return true;
        }
      }
      return false;
    }, []);

    // -------------------------------------------------------------
    // RENDER PASS: Infinite Grid + Elements + Lasso + Laser
    // -------------------------------------------------------------
    const renderCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      const isNight = edition === 'night';

      // 1. Clear Canvas Background
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = isNight ? '#141311' : '#F5F1E8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Apply Pan & Zoom Transform
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.translate(viewState.panX, viewState.panY);
      ctx.scale(viewState.zoom, viewState.zoom);

      // 2. Draw Drafting Grid
      if (gridType === 'dots') {
        const gridSpacing = 28;
        const startX = Math.floor((-viewState.panX / viewState.zoom) / gridSpacing) * gridSpacing - gridSpacing;
        const endX = startX + (width / viewState.zoom) + gridSpacing * 2;
        const startY = Math.floor((-viewState.panY / viewState.zoom) / gridSpacing) * gridSpacing - gridSpacing;
        const endY = startY + (height / viewState.zoom) + gridSpacing * 2;

        ctx.fillStyle = isNight ? 'rgba(255, 255, 255, 0.14)' : 'rgba(26, 24, 20, 0.16)';
        const dotRadius = Math.max(0.8, 1.1 / viewState.zoom);

        ctx.beginPath();
        for (let x = startX; x <= endX; x += gridSpacing) {
          for (let y = startY; y <= endY; y += gridSpacing) {
            ctx.moveTo(x + dotRadius, y);
            ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      } else if (gridType === 'graph') {
        const gridSpacing = 24;
        const startX = Math.floor((-viewState.panX / viewState.zoom) / gridSpacing) * gridSpacing - gridSpacing;
        const endX = startX + (width / viewState.zoom) + gridSpacing * 2;
        const startY = Math.floor((-viewState.panY / viewState.zoom) / gridSpacing) * gridSpacing - gridSpacing;
        const endY = startY + (height / viewState.zoom) + gridSpacing * 2;

        ctx.lineWidth = 0.5 / viewState.zoom;
        for (let x = startX; x <= endX; x += gridSpacing) {
          const isMajor = Math.round(x / gridSpacing) % 5 === 0;
          ctx.strokeStyle = isNight
            ? (isMajor ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.04)')
            : (isMajor ? 'rgba(26, 24, 20, 0.15)' : 'rgba(26, 24, 20, 0.06)');
          ctx.beginPath();
          ctx.moveTo(x, startY);
          ctx.lineTo(x, endY);
          ctx.stroke();
        }
        for (let y = startY; y <= endY; y += gridSpacing) {
          const isMajor = Math.round(y / gridSpacing) % 5 === 0;
          ctx.strokeStyle = isNight
            ? (isMajor ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.04)')
            : (isMajor ? 'rgba(26, 24, 20, 0.15)' : 'rgba(26, 24, 20, 0.06)');
          ctx.beginPath();
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
          ctx.stroke();
        }
      } else if (gridType === 'ruled') {
        const lineSpacing = 32;
        const startX = Math.floor((-viewState.panX / viewState.zoom) / lineSpacing) * lineSpacing - lineSpacing;
        const endX = startX + (width / viewState.zoom) + lineSpacing * 2;
        const startY = Math.floor((-viewState.panY / viewState.zoom) / lineSpacing) * lineSpacing - lineSpacing;
        const endY = startY + (height / viewState.zoom) + lineSpacing * 2;

        ctx.lineWidth = 0.6 / viewState.zoom;
        ctx.strokeStyle = isNight ? 'rgba(255, 255, 255, 0.08)' : 'rgba(26, 24, 20, 0.11)';
        ctx.beginPath();
        for (let y = startY; y <= endY; y += lineSpacing) {
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
        }
        ctx.stroke();
      }

      // 3. Draw Committed Elements
      elements.forEach((el) => {
        const isSelected = selectedElementId === el.id || (selectedElementIds ? selectedElementIds.has(el.id) : false);

        if (el.type === 'stroke') {
          drawStroke(ctx, el);
          if (isSelected) {
            const bbox = getElementBBox(el);
            if (bbox) {
              ctx.save();
              ctx.strokeStyle = '#3b82f6';
              ctx.lineWidth = 1.5 / viewState.zoom;
              ctx.setLineDash([4 / viewState.zoom, 4 / viewState.zoom]);
              ctx.strokeRect(bbox.x - 4, bbox.y - 4, bbox.w + 8, bbox.h + 8);
              ctx.restore();
            }
          }
        } else if (el.type === 'shape') {
          drawShape(ctx, el, isSelected);
        } else if (el.type === 'text') {
          drawText(ctx, el, isSelected);
        } else if (el.type === 'image') {
          drawImage(ctx, el, isSelected);
        }
      });

      // 4. Draw Active Inking Stroke (In Progress)
      if (isDrawingRef.current && currentPointsRef.current.length > 0) {
        if (activeTool === 'pen') {
          drawStroke(ctx, {
            id: 'temp_stroke',
            type: 'stroke',
            points: currentPointsRef.current,
            color: activeColor,
            size: activeSize,
          });
        } else if (activeTool === 'highlighter') {
          drawStroke(ctx, {
            id: 'temp_highlight',
            type: 'stroke',
            points: currentPointsRef.current,
            color: highlighterColor,
            size: highlighterSize,
            isHighlighter: true,
            opacity: 0.38,
          });
        }
      }

      // 5. Draw Active Shape Preview (In Progress)
      if (activeTool === 'shape' && shapeStartRef.current && shapeCurrentRef.current) {
        const p1 = shapeStartRef.current;
        const p2 = shapeCurrentRef.current;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);

        drawShape(
          ctx,
          {
            id: 'temp_shape',
            type: 'shape',
            shapeType: activeShape,
            x: activeShape === 'arrow' || activeShape === 'line' ? p1.x : x,
            y: activeShape === 'arrow' || activeShape === 'line' ? p1.y : y,
            width: activeShape === 'arrow' || activeShape === 'line' ? p2.x - p1.x : w,
            height: activeShape === 'arrow' || activeShape === 'line' ? p2.y - p1.y : h,
            color: activeColor,
            fillColor: activeFillColor ?? undefined,
            strokeWidth: activeSize,
          },
          false
        );
      }

      // 6. Draw Lasso Rectangle
      if (lassoStartRef.current && lassoCurrentRef.current) {
        const ls = lassoStartRef.current;
        const lc = lassoCurrentRef.current;
        const lx = Math.min(ls.x, lc.x);
        const ly = Math.min(ls.y, lc.y);
        const lw = Math.abs(lc.x - ls.x);
        const lh = Math.abs(lc.y - ls.y);

        ctx.save();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 / viewState.zoom;
        ctx.setLineDash([6 / viewState.zoom, 4 / viewState.zoom]);
        ctx.fillRect(lx, ly, lw, lh);
        ctx.strokeRect(lx, ly, lw, lh);
        ctx.restore();
      }

      // 7. Draw Laser Pointer Trace
      const now = Date.now();
      laserPointsRef.current = laserPointsRef.current.filter((p) => now - p.time < 1200);

      if (laserPointsRef.current.length > 1) {
        for (let i = 0; i < laserPointsRef.current.length - 1; i++) {
          const p1 = laserPointsRef.current[i];
          const p2 = laserPointsRef.current[i + 1];
          const age = now - p2.time;
          const alpha = Math.max(0, 1 - age / 1200);

          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = (8 / viewState.zoom) * alpha;
          ctx.strokeStyle = isNight
            ? `rgba(255, 69, 58, ${alpha * 0.9})`
            : `rgba(217, 38, 38, ${alpha * 0.9})`;
          ctx.shadowColor = isNight ? '#ff453a' : '#d92626';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (laserPointsRef.current.length > 0) {
        if (laserAnimRef.current) cancelAnimationFrame(laserAnimRef.current);
        laserAnimRef.current = requestAnimationFrame(renderCanvas);
      }

      ctx.restore();
    }, [
      elements,
      viewState,
      activeTool,
      activeColor,
      activeSize,
      activeShape,
      activeFillColor,
      highlighterColor,
      highlighterSize,
      selectedElementId,
      selectedElementIds,
      edition,
      gridType,
    ]);

    // -------------------------------------------------------------
    // VECTOR DRAWING PRIMITIVES (Pressure & Velocity Taper)
    // -------------------------------------------------------------
    const drawStroke = (ctx: CanvasRenderingContext2D, stroke: StrokeElement) => {
      const { points, color, size, isHighlighter, opacity } = stroke;
      if (points.length < 1) return;

      ctx.save();
      ctx.lineCap = isHighlighter ? 'square' : 'round';
      ctx.lineJoin = isHighlighter ? 'bevel' : 'round';
      ctx.strokeStyle = color;
      if (isHighlighter) ctx.globalAlpha = opacity ?? 0.38;

      if (points.length === 1) {
        const w = size * (0.4 + (points[0].pressure ?? 0.5) * 1.2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      // Per-segment variable width with quadratic bezier midpoints & velocity taper
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const pressure = ((p0.pressure ?? 0.5) + (p1.pressure ?? 0.5)) / 2;

        let velocityFactor = 1.0;
        if (p0.t && p1.t) {
          const dt = Math.max(1, p1.t - p0.t);
          const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          velocityFactor = 1.0 - Math.min(dist / dt / 2.5, 0.45);
        }

        const width = size * (0.35 + Math.min(Math.max(pressure, 0.1), 1.0) * 1.3) * velocityFactor;
        ctx.lineWidth = Math.max(0.5, width);
        ctx.beginPath();

        const prevMidX = i > 0 ? (points[i - 1].x + p0.x) / 2 : p0.x;
        const prevMidY = i > 0 ? (points[i - 1].y + p0.y) / 2 : p0.y;
        ctx.moveTo(prevMidX, prevMidY);
        ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        ctx.stroke();
      }

      ctx.restore();
    };

    const drawShape = (ctx: CanvasRenderingContext2D, shape: ShapeElement, isSelected: boolean) => {
      ctx.save();
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (shape.fillColor) {
        ctx.fillStyle = shape.fillColor;
      }

      const { x, y, width, height } = shape;

      if (shape.shapeType === 'rectangle') {
        if (shape.fillColor) ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
      } else if (shape.shapeType === 'circle') {
        const rx = Math.abs(width / 2);
        const ry = Math.abs(height / 2);
        const cx = x + width / 2;
        const cy = y + height / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        if (shape.fillColor) ctx.fill();
        ctx.stroke();
      } else if (shape.shapeType === 'diamond') {
        const cx = x + width / 2;
        const cy = y + height / 2;
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x + width, cy);
        ctx.lineTo(cx, y + height);
        ctx.lineTo(x, cy);
        ctx.closePath();
        if (shape.fillColor) ctx.fill();
        ctx.stroke();
      } else if (shape.shapeType === 'line') {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y + height);
        ctx.stroke();
      } else if (shape.shapeType === 'arrow') {
        const tox = x + width;
        const toy = y + height;
        const angle = Math.atan2(height, width);
        const headlen = 14;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tox, toy);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(tox, toy);
        ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(tox, toy);
        ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      }

      // Selection bounding box and 8 resize handles
      if (isSelected && shape.shapeType !== 'line' && shape.shapeType !== 'arrow') {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 / viewState.zoom;
        ctx.setLineDash([4 / viewState.zoom, 4 / viewState.zoom]);
        ctx.strokeRect(x - 4, y - 4, width + 8, height + 8);
        ctx.setLineDash([]);

        // 8 handle dots
        const handles = getHandlePositions(shape);
        handles.forEach((h) => {
          ctx.fillStyle = '#3b82f6';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 / viewState.zoom;
          ctx.beginPath();
          ctx.arc(h.x, h.y, 5 / viewState.zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      } else if (isSelected) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 / viewState.zoom;
        ctx.setLineDash([4 / viewState.zoom, 4 / viewState.zoom]);
        ctx.strokeRect(Math.min(x, x + width) - 4, Math.min(y, y + height) - 4, Math.abs(width) + 8, Math.abs(height) + 8);
        ctx.setLineDash([]);
      }

      ctx.restore();
    };

    const drawText = (ctx: CanvasRenderingContext2D, textEl: TextElement, isSelected: boolean) => {
      ctx.save();
      ctx.fillStyle = textEl.color;
      ctx.font = `600 ${textEl.fontSize}px 'Newsreader', serif`;
      ctx.textBaseline = 'top';

      const lines = textEl.text.split('\n');
      const lineHeight = textEl.fontSize * 1.35;

      lines.forEach((line, idx) => {
        ctx.fillText(line, textEl.x, textEl.y + idx * lineHeight);
      });

      if (isSelected) {
        const textH = lines.length * lineHeight;
        const textW = textEl.width || 180;
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 / viewState.zoom;
        ctx.setLineDash([4 / viewState.zoom, 4 / viewState.zoom]);
        ctx.strokeRect(textEl.x - 4, textEl.y - 4, textW + 8, textH + 8);
        ctx.setLineDash([]);
      }

      ctx.restore();
    };

    const drawImage = (ctx: CanvasRenderingContext2D, imgEl: ImageElement, isSelected: boolean) => {
      let img = imgCacheRef.current.get(imgEl.id);
      if (!img) {
        img = new Image();
        img.src = imgEl.dataUrl;
        img.onload = () => renderCanvas();
        imgCacheRef.current.set(imgEl.id, img);
      }

      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, imgEl.x, imgEl.y, imgEl.width, imgEl.height);
      } else {
        ctx.fillStyle = 'rgba(100, 100, 100, 0.2)';
        ctx.fillRect(imgEl.x, imgEl.y, imgEl.width, imgEl.height);
      }

      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 / viewState.zoom;
        ctx.setLineDash([4 / viewState.zoom, 4 / viewState.zoom]);
        ctx.strokeRect(imgEl.x - 4, imgEl.y - 4, imgEl.width + 8, imgEl.height + 8);
        ctx.restore();
      }
    };

    // -------------------------------------------------------------
    // ERASER HIT TEST
    // -------------------------------------------------------------
    const eraseIntersecting = (point: Point) => {
      const eraserRadius = 16 / viewState.zoom;
      let erasedAny = false;

      const remaining = elements.filter((el) => {
        if (el.type === 'stroke') {
          for (let i = 0; i < el.points.length - 1; i++) {
            const dist = distToSegment(point, el.points[i], el.points[i + 1]);
            if (dist <= eraserRadius + el.size / 2) {
              erasedAny = true;
              return false;
            }
          }
          return true;
        } else if (el.type === 'shape' || el.type === 'image') {
          if (
            point.x >= el.x - eraserRadius &&
            point.x <= el.x + el.width + eraserRadius &&
            point.y >= el.y - eraserRadius &&
            point.y <= el.y + el.height + eraserRadius
          ) {
            erasedAny = true;
            return false;
          }
          return true;
        } else if (el.type === 'text') {
          if (
            point.x >= el.x - eraserRadius &&
            point.x <= el.x + 180 + eraserRadius &&
            point.y >= el.y - eraserRadius &&
            point.y <= el.y + el.fontSize * 2 + eraserRadius
          ) {
            erasedAny = true;
            return false;
          }
          return true;
        }
        return true;
      });

      if (erasedAny) {
        onElementsChange(remaining, true);
      }
    };

    // -------------------------------------------------------------
    // POINTER EVENT HANDLERS
    // -------------------------------------------------------------
    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Cancel any running momentum pan
      if (momentumRafRef.current) cancelAnimationFrame(momentumRafRef.current);

      // Multi-touch pinch detection (anchor around midpoint)
      if (activePointersRef.current.size === 2) {
        const pts = Array.from(activePointersRef.current.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        initialPinchDistRef.current = dist;
        initialPinchZoomRef.current = viewState.zoom;
        initialPinchPanRef.current = { x: viewState.panX, y: viewState.panY };
        return;
      }

      // Palm Rejection: In stylus-only mode, single finger touch initiates pan
      if (stylusOnly && e.pointerType === 'touch') {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - viewState.panX, y: e.clientY - viewState.panY };
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        lastPanTimeRef.current = Date.now();
        return;
      }

      // Spacebar, middle mouse, or Hand tool initiates pan
      if (spacePressedRef.current || e.button === 1 || activeTool === 'hand') {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - viewState.panX, y: e.clientY - viewState.panY };
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        lastPanTimeRef.current = Date.now();
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const worldPoint = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      worldPoint.pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;
      worldPoint.t = Date.now();

      const isEraser = activeTool === 'eraser' || (e.pointerType as string) === 'eraser';
      if (isEraser) {
        eraseIntersecting(worldPoint);
      } else if (activeTool === 'laser') {
        isDrawingRef.current = true;
        laserPointsRef.current.push({ x: worldPoint.x, y: worldPoint.y, time: Date.now() });
        renderCanvas();
      } else if (activeTool === 'pen' || activeTool === 'highlighter') {
        isDrawingRef.current = true;
        currentPointsRef.current = [worldPoint];
        renderCanvas();
      } else if (activeTool === 'shape') {
        shapeStartRef.current = worldPoint;
        shapeCurrentRef.current = worldPoint;
      } else if (activeTool === 'text') {
        setInlineTextPos(worldPoint);
        setInlineTextVal('');
        setTimeout(() => textInputRef.current?.focus(), 50);
      } else if (activeTool === 'select') {
        // 1. Check if clicking on an active shape resize handle
        if (selectedElementId) {
          const sel = elements.find((el) => el.id === selectedElementId);
          if (sel && sel.type === 'shape' && sel.shapeType !== 'line' && sel.shapeType !== 'arrow') {
            const handles = getHandlePositions(sel);
            const hitH = handles.find(
              (h) => Math.hypot(worldPoint.x - h.x, worldPoint.y - h.y) < 12 / viewState.zoom
            );
            if (hitH) {
              resizeHandleRef.current = hitH.id;
              resizeOriginRef.current = { el: { ...sel }, startPt: worldPoint };
              return;
            }
          }
        }

        // 2. Hit-test elements for drag-move
        const hit = elements.slice().reverse().find((el) => hitTest(el, worldPoint));
        if (hit) {
          onSelectElementId(hit.id);
          if (onSelectElementIds) onSelectElementIds(new Set([hit.id]));
          dragElementIdRef.current = hit.id;
          if (hit.type === 'shape' || hit.type === 'text' || hit.type === 'image') {
            dragOffsetRef.current = { dx: worldPoint.x - hit.x, dy: worldPoint.y - hit.y };
          }
        } else {
          onSelectElementId(null);
          if (onSelectElementIds) onSelectElementIds(new Set());
          dragElementIdRef.current = null;
          // Start lasso multi-select
          lassoStartRef.current = worldPoint;
          lassoCurrentRef.current = worldPoint;
        }
      }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Midpoint-Anchored Two-Finger Pinch Zoom (Fix for Bug 1)
      if (activePointersRef.current.size === 2 && initialPinchDistRef.current && containerRef.current) {
        const pts = Array.from(activePointersRef.current.values());
        const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const scale = currentDist / initialPinchDistRef.current;
        const newZoom = Math.min(3.5, Math.max(0.15, initialPinchZoomRef.current * scale));

        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const rect = containerRef.current.getBoundingClientRect();
        const cx = midX - rect.left;
        const cy = midY - rect.top;

        const newPanX = cx - (cx - initialPinchPanRef.current.x) * (newZoom / initialPinchZoomRef.current);
        const newPanY = cy - (cy - initialPinchPanRef.current.y) * (newZoom / initialPinchZoomRef.current);

        onViewStateChange({
          zoom: newZoom,
          panX: newPanX,
          panY: newPanY,
        });
        return;
      }

      // Handle Pan with Velocity Tracking for Momentum
      if (isPanningRef.current) {
        const now = Date.now();
        const dt = Math.max(1, now - lastPanTimeRef.current);
        panVelocityRef.current = {
          vx: ((e.clientX - lastPanPosRef.current.x) / dt) * 16,
          vy: ((e.clientY - lastPanPosRef.current.y) / dt) * 16,
        };
        lastPanTimeRef.current = now;
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };

        onViewStateChange({
          ...viewState,
          panX: e.clientX - panStartRef.current.x,
          panY: e.clientY - panStartRef.current.y,
        });
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const worldPoint = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      worldPoint.pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;
      worldPoint.t = Date.now();

      // Shape Resize Drag
      if (resizeHandleRef.current && resizeOriginRef.current) {
        const { el, startPt } = resizeOriginRef.current;
        const dx = worldPoint.x - startPt.x;
        const dy = worldPoint.y - startPt.y;
        const h = resizeHandleRef.current;

        let { x, y, width, height } = el;
        if (h.includes('e')) width = Math.max(20, el.width + dx);
        if (h.includes('s')) height = Math.max(20, el.height + dy);
        if (h.includes('w')) {
          x = el.x + dx;
          width = Math.max(20, el.width - dx);
        }
        if (h.includes('n')) {
          y = el.y + dy;
          height = Math.max(20, el.height - dy);
        }

        const resized = elements.map((item) =>
          item.id === el.id ? { ...item, x, y, width, height } : item
        );
        onElementsChange(resized, false);
        return;
      }

      // Element Drag Move
      if (dragElementIdRef.current && activeTool === 'select') {
        const id = dragElementIdRef.current;
        const moved = elements.map((item) => {
          if (item.id !== id || (item.type !== 'shape' && item.type !== 'text' && item.type !== 'image')) {
            return item;
          }
          return {
            ...item,
            x: Math.round(worldPoint.x - dragOffsetRef.current.dx),
            y: Math.round(worldPoint.y - dragOffsetRef.current.dy),
          };
        });
        onElementsChange(moved, false);
        return;
      }

      // Lasso Multi-Select Drag
      if (lassoStartRef.current && activeTool === 'select') {
        lassoCurrentRef.current = worldPoint;
        renderCanvas();
        return;
      }

      // Tool Drawing
      const isEraser = activeTool === 'eraser' || (e.pointerType as string) === 'eraser';
      if (isEraser && (e.buttons === 1 || e.pressure > 0)) {
        eraseIntersecting(worldPoint);
      } else if (activeTool === 'laser' && isDrawingRef.current) {
        laserPointsRef.current.push({ x: worldPoint.x, y: worldPoint.y, time: Date.now() });
        renderCanvas();
      } else if (isDrawingRef.current && (activeTool === 'pen' || activeTool === 'highlighter')) {
        currentPointsRef.current.push(worldPoint);
        renderCanvas();
      } else if (activeTool === 'shape' && shapeStartRef.current) {
        shapeCurrentRef.current = worldPoint;
        renderCanvas();
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) {
        initialPinchDistRef.current = null;
      }

      // Apply Decaying Momentum Pan
      if (isPanningRef.current) {
        isPanningRef.current = false;
        const startMomentum = (panX: number, panY: number) => {
          panVelocityRef.current = {
            vx: panVelocityRef.current.vx * 0.92,
            vy: panVelocityRef.current.vy * 0.92,
          };
          if (
            Math.abs(panVelocityRef.current.vx) < 0.5 &&
            Math.abs(panVelocityRef.current.vy) < 0.5
          ) {
            return;
          }
          const nextX = panX + panVelocityRef.current.vx;
          const nextY = panY + panVelocityRef.current.vy;
          onViewStateChange({ ...viewStateRef.current, panX: nextX, panY: nextY });
          momentumRafRef.current = requestAnimationFrame(() => startMomentum(nextX, nextY));
        };
        momentumRafRef.current = requestAnimationFrame(() =>
          startMomentum(viewState.panX, viewState.panY)
        );
        return;
      }

      // Commit Resize
      if (resizeHandleRef.current) {
        onElementsChange(elements, true);
        resizeHandleRef.current = null;
        resizeOriginRef.current = null;
        return;
      }

      // Commit Drag Move
      if (dragElementIdRef.current) {
        onElementsChange(elements, true);
        dragElementIdRef.current = null;
        return;
      }

      // Commit Lasso Selection
      if (lassoStartRef.current && lassoCurrentRef.current) {
        const ls = lassoStartRef.current;
        const lc = lassoCurrentRef.current;
        const lx = Math.min(ls.x, lc.x);
        const ly = Math.min(ls.y, lc.y);
        const lw = Math.abs(lc.x - ls.x);
        const lh = Math.abs(lc.y - ls.y);

        if (lw > 8 || lh > 8) {
          const selected = new Set<string>();
          elements.forEach((el) => {
            const b = getElementBBox(el);
            if (b && b.x < lx + lw && b.x + b.w > lx && b.y < ly + lh && b.y + b.h > ly) {
              selected.add(el.id);
            }
          });
          if (onSelectElementIds) onSelectElementIds(selected);
          if (selected.size === 1) {
            onSelectElementId(Array.from(selected)[0]);
          } else if (selected.size === 0) {
            onSelectElementId(null);
          }
        }
        lassoStartRef.current = null;
        lassoCurrentRef.current = null;
        renderCanvas();
        return;
      }

      if (activeTool === 'laser') {
        isDrawingRef.current = false;
        return;
      }

      if (isDrawingRef.current && (activeTool === 'pen' || activeTool === 'highlighter')) {
        isDrawingRef.current = false;
        if (currentPointsRef.current.length > 0) {
          const newStroke: StrokeElement = {
            id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'stroke',
            points: [...currentPointsRef.current],
            color: activeTool === 'pen' ? activeColor : highlighterColor,
            size: activeTool === 'pen' ? activeSize : highlighterSize,
            isHighlighter: activeTool === 'highlighter',
            opacity: activeTool === 'highlighter' ? 0.38 : 1,
          };
          onElementsChange([...elements, newStroke], true);
        }
        currentPointsRef.current = [];
        renderCanvas();
      } else if (activeTool === 'shape' && shapeStartRef.current && shapeCurrentRef.current) {
        const p1 = shapeStartRef.current;
        const p2 = shapeCurrentRef.current;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);

        if (w > 3 || h > 3) {
          const newShape: ShapeElement = {
            id: `shape_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'shape',
            shapeType: activeShape,
            x: activeShape === 'arrow' || activeShape === 'line' ? p1.x : x,
            y: activeShape === 'arrow' || activeShape === 'line' ? p1.y : y,
            width: activeShape === 'arrow' || activeShape === 'line' ? p2.x - p1.x : w,
            height: activeShape === 'arrow' || activeShape === 'line' ? p2.y - p1.y : h,
            color: activeColor,
            fillColor: activeFillColor ?? undefined,
            strokeWidth: activeSize,
          };
          onElementsChange([...elements, newShape], true);
        }

        shapeStartRef.current = null;
        shapeCurrentRef.current = null;
        renderCanvas();
      }
    };

    // Wheel zoom & pan
    const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
        const newZoom = Math.min(3.5, Math.max(0.15, viewState.zoom * zoomFactor));

        const newPanX = mouseX - (mouseX - viewState.panX) * (newZoom / viewState.zoom);
        const newPanY = mouseY - (mouseY - viewState.panY) * (newZoom / viewState.zoom);

        onViewStateChange({
          panX: newPanX,
          panY: newPanY,
          zoom: newZoom,
        });
      } else {
        onViewStateChange({
          ...viewState,
          panX: viewState.panX - e.deltaX,
          panY: viewState.panY - e.deltaY,
        });
      }
    };

    // Prevent iOS Safari page scrolling while gesturing on whiteboard (Fix for Bug 3)
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const preventScroll = (e: TouchEvent) => {
        if (e.touches.length >= 2) {
          e.preventDefault();
        } else if (e.touches.length === 1 && activeTool !== 'hand' && !spacePressedRef.current) {
          e.preventDefault();
        }
      };

      canvas.addEventListener('touchstart', preventScroll, { passive: false });
      canvas.addEventListener('touchmove', preventScroll, { passive: false });
      return () => {
        canvas.removeEventListener('touchstart', preventScroll);
        canvas.removeEventListener('touchmove', preventScroll);
      };
    }, [activeTool]);

    // Spacebar listener for temporary pan hand
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (
          e.code === 'Space' &&
          !e.repeat &&
          document.activeElement?.tagName !== 'INPUT' &&
          document.activeElement?.tagName !== 'TEXTAREA'
        ) {
          spacePressedRef.current = true;
          if (containerRef.current) containerRef.current.style.cursor = 'grab';
        }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          spacePressedRef.current = false;
          if (containerRef.current) containerRef.current.style.cursor = 'default';
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }, []);

    // Canvas Resize listener
    useEffect(() => {
      const handleResize = () => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = container.clientWidth * dpr;
        canvas.height = container.clientHeight * dpr;
        renderCanvas();
      };

      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [renderCanvas]);

    useEffect(() => {
      renderCanvas();
    }, [renderCanvas]);

    // Multi-line Text Submission
    const handleTextSubmit = () => {
      if (inlineTextPos && inlineTextVal.trim()) {
        const newText: TextElement = {
          id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: 'text',
          x: inlineTextPos.x,
          y: inlineTextPos.y,
          text: inlineTextVal.trim(),
          fontSize: Math.max(16, activeSize * 4.5),
          color: activeColor,
        };
        onElementsChange([...elements, newText], true);
      }
      setInlineTextPos(null);
      setInlineTextVal('');
    };

    // Double-click to create sticky or text
    const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const worldPoint = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (onCanvasDoubleClick) {
        onCanvasDoubleClick(worldPoint);
      }
    };

    // -------------------------------------------------------------
    // EXPORT UTILITIES (PNG / SVG)
    // -------------------------------------------------------------
    useImperativeHandle(ref, () => ({
      exportToPNG: async (): Promise<string> => {
        const offscreen = document.createElement('canvas');
        const offCtx = offscreen.getContext('2d');
        if (!offCtx) return '';

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        elements.forEach((el) => {
          if (el.type === 'stroke') {
            el.points.forEach((p) => {
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
            });
          } else if (el.type === 'shape' || el.type === 'sticky' || el.type === 'image') {
            minX = Math.min(minX, el.x);
            minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + el.width);
            maxY = Math.max(maxY, el.y + el.height);
          } else if (el.type === 'text') {
            minX = Math.min(minX, el.x);
            minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + 180);
            maxY = Math.max(maxY, el.y + 40);
          }
        });

        const padding = 60;
        if (minX === Infinity) {
          minX = 0;
          minY = 0;
          maxX = 1200;
          maxY = 800;
        }

        const outW = Math.max(800, maxX - minX + padding * 2);
        const outH = Math.max(600, maxY - minY + padding * 2);
        const isNight = edition === 'night';

        offscreen.width = outW * 2;
        offscreen.height = outH * 2;
        offCtx.scale(2, 2);

        // Background
        offCtx.fillStyle = isNight ? '#141311' : '#F5F1E8';
        offCtx.fillRect(0, 0, outW, outH);

        // Grid
        if (gridType !== 'blank') {
          offCtx.fillStyle = isNight ? 'rgba(255, 255, 255, 0.1)' : 'rgba(26, 24, 20, 0.12)';
          for (let x = 0; x <= outW; x += 28) {
            for (let y = 0; y <= outH; y += 28) {
              offCtx.beginPath();
              offCtx.arc(x, y, 1, 0, Math.PI * 2);
              offCtx.fill();
            }
          }
        }

        offCtx.save();
        offCtx.translate(-minX + padding, -minY + padding);

        elements.forEach((el) => {
          if (el.type === 'stroke') drawStroke(offCtx, el);
          if (el.type === 'shape') drawShape(offCtx, el, false);
          if (el.type === 'text') drawText(offCtx, el, false);
          if (el.type === 'image') drawImage(offCtx, el, false);
          if (el.type === 'sticky') {
            offCtx.save();
            offCtx.fillStyle = '#fef08a';
            offCtx.beginPath();
            offCtx.rect(el.x, el.y, el.width, el.height);
            offCtx.fill();
            offCtx.fillStyle = '#1c1917';
            offCtx.font = '500 13px serif';
            offCtx.fillText(el.text, el.x + 12, el.y + 24, el.width - 24);
            offCtx.restore();
          }
        });

        offCtx.restore();
        return offscreen.toDataURL('image/png');
      },

      exportToSVG: (): string => {
        const isNight = edition === 'night';
        const bg = isNight ? '#141311' : '#F5F1E8';
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" style="background:${bg}">`;
        elements.forEach((el) => {
          if (el.type === 'stroke') {
            if (el.points.length > 1) {
              const d = el.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
              svg += `<path d="${d}" stroke="${el.color}" stroke-width="${el.size}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${el.opacity ?? 1}" />`;
            }
          } else if (el.type === 'shape' && el.shapeType === 'rectangle') {
            svg += `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" stroke="${el.color}" stroke-width="${el.strokeWidth}" fill="${el.fillColor || 'none'}" />`;
          } else if (el.type === 'text') {
            svg += `<text x="${el.x}" y="${el.y + el.fontSize}" fill="${el.color}" font-size="${el.fontSize}" font-family="serif">${el.text}</text>`;
          }
        });
        svg += '</svg>';
        return svg;
      },

      resetView: () => {
        onViewStateChange({ panX: 0, panY: 0, zoom: 1 });
      },

      fitToContent: () => {
        if (elements.length === 0) {
          onViewStateChange({ panX: 0, panY: 0, zoom: 1 });
          return;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        elements.forEach((el) => {
          if (el.type === 'stroke') {
            el.points.forEach((p) => {
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
            });
          } else if (el.type === 'shape' || el.type === 'sticky' || el.type === 'image') {
            minX = Math.min(minX, el.x);
            minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + el.width);
            maxY = Math.max(maxY, el.y + el.height);
          } else if (el.type === 'text') {
            minX = Math.min(minX, el.x);
            minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + 180);
            maxY = Math.max(maxY, el.y + 40);
          }
        });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const pad = 80;
        const w = Math.max(100, maxX - minX + pad * 2);
        const h = Math.max(100, maxY - minY + pad * 2);

        const zoomX = canvas.clientWidth / w;
        const zoomY = canvas.clientHeight / h;
        const targetZoom = Math.min(1.5, Math.max(0.2, Math.min(zoomX, zoomY)));

        const targetPanX = canvas.clientWidth / 2 - ((minX + maxX) / 2) * targetZoom;
        const targetPanY = canvas.clientHeight / 2 - ((minY + maxY) / 2) * targetZoom;

        onViewStateChange({
          panX: targetPanX,
          panY: targetPanY,
          zoom: targetZoom,
        });
      },

      zoomIn: () => {
        const canvas = canvasRef.current;
        const cx = canvas ? canvas.clientWidth / 2 : 0;
        const cy = canvas ? canvas.clientHeight / 2 : 0;
        const newZoom = Math.min(3.5, viewState.zoom * 1.25);
        const newPanX = cx - (cx - viewState.panX) * (newZoom / viewState.zoom);
        const newPanY = cy - (cy - viewState.panY) * (newZoom / viewState.zoom);
        onViewStateChange({ panX: newPanX, panY: newPanY, zoom: newZoom });
      },

      zoomOut: () => {
        const canvas = canvasRef.current;
        const cx = canvas ? canvas.clientWidth / 2 : 0;
        const cy = canvas ? canvas.clientHeight / 2 : 0;
        const newZoom = Math.max(0.15, viewState.zoom / 1.25);
        const newPanX = cx - (cx - viewState.panX) * (newZoom / viewState.zoom);
        const newPanY = cy - (cy - viewState.panY) * (newZoom / viewState.zoom);
        onViewStateChange({ panX: newPanX, panY: newPanY, zoom: newZoom });
      },

      getViewState: () => viewState,
      setViewState: (view: ViewState) => onViewStateChange(view),
    }));

    return (
      <div
        ref={containerRef}
        className="relative w-full h-full overflow-hidden select-none touch-none"
        style={{
          cursor:
            activeTool === 'laser'
              ? 'crosshair'
              : activeTool === 'hand'
              ? 'grab'
              : activeTool === 'pen' || activeTool === 'highlighter'
              ? 'crosshair'
              : activeTool === 'eraser'
              ? 'cell'
              : activeTool === 'text'
              ? 'text'
              : 'default',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
          className="absolute inset-0 block w-full h-full"
        />

        {/* Multi-line Auto-Growing Textarea Inline Tool */}
        {inlineTextPos && (
          <div
            style={{
              position: 'absolute',
              left: `${worldToScreen(inlineTextPos.x, inlineTextPos.y).x}px`,
              top: `${worldToScreen(inlineTextPos.x, inlineTextPos.y).y}px`,
              transform: `scale(${viewState.zoom})`,
              transformOrigin: 'top left',
            }}
            className="z-50 pointer-events-auto"
          >
            <textarea
              ref={textInputRef}
              rows={1}
              value={inlineTextVal}
              onChange={(e) => {
                setInlineTextVal(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onBlur={handleTextSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleTextSubmit();
                } else if (e.key === 'Escape') {
                  setInlineTextPos(null);
                  setInlineTextVal('');
                }
              }}
              placeholder="Type dispatch... (Shift+Enter for newline)"
              style={{
                color: activeColor,
                fontSize: `${Math.max(16, activeSize * 4.5)}px`,
                minWidth: '200px',
                maxWidth: '480px',
                resize: 'none',
                overflow: 'hidden',
              }}
              className="bg-paper-aged/90 dark:bg-stone-900/90 border-2 border-amber-600 dark:border-amber-400 rounded-none px-2.5 py-1.5 outline-none font-editorial font-bold shadow-2xl"
            />
          </div>
        )}
      </div>
    );
  }
);

WhiteboardCanvas.displayName = 'WhiteboardCanvas';
