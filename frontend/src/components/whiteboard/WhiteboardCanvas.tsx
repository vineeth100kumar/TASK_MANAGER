import React, { useRef, useEffect, useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import {
  WhiteboardElement,
  StrokeElement,
  ShapeElement,
  TextElement,
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
  activeColor: string;
  activeSize: number;
  activeShape: ShapeType;
  highlighterColor: string;
  highlighterSize: number;
  viewState: ViewState;
  onViewStateChange: (view: ViewState) => void;
  selectedElementId: string | null;
  onSelectElementId: (id: string | null) => void;
  edition?: 'day' | 'night';
  gridType?: WhiteboardGridType;
  stylusOnly?: boolean;
  onCanvasDoubleClick?: (point: Point) => void;
}

// Helper: Distance from point P to line segment AB
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

export const WhiteboardCanvas = forwardRef<WhiteboardCanvasRef, WhiteboardCanvasProps>(
  (
    {
      elements,
      onElementsChange,
      activeTool,
      activeColor,
      activeSize,
      activeShape,
      highlighterColor,
      highlighterSize,
      viewState,
      onViewStateChange,
      selectedElementId,
      onSelectElementId,
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

    // Laser pointer points with timestamps: { x, y, time }
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

    // Text editing inline
    const [inlineTextPos, setInlineTextPos] = useState<{ x: number; y: number } | null>(null);
    const [inlineTextVal, setInlineTextVal] = useState('');
    const textInputRef = useRef<HTMLInputElement | null>(null);

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
    // RENDER PASS: Infinite Grid + Vector Elements + Laser
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

      // 1. Clear Canvas Background (Parchment in Day, Slate Blueprint in Night)
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

      // 2. Draw Drafting Grid Surface
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

      // 3. Draw Committed Elements (strokes, shapes, text)
      elements.forEach((el) => {
        if (el.type === 'stroke') {
          drawStroke(ctx, el);
        } else if (el.type === 'shape') {
          drawShape(ctx, el, el.id === selectedElementId);
        } else if (el.type === 'text') {
          drawText(ctx, el, el.id === selectedElementId);
        }
      });

      // 4. Draw Active Inking Stroke (In Progress)
      if (isDrawingRef.current && currentPointsRef.current.length > 1) {
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
            strokeWidth: activeSize,
          },
          false
        );
      }

      // 6. Draw Laser Pointer Trace (Smooth temporary fading beam)
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

      // If laser points remain, continue animation loop for smooth fadeout
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
      highlighterColor,
      highlighterSize,
      selectedElementId,
      edition,
      gridType,
    ]);

    // -------------------------------------------------------------
    // VECTOR DRAWING PRIMITIVES
    // -------------------------------------------------------------
    const drawStroke = (ctx: CanvasRenderingContext2D, stroke: StrokeElement) => {
      const { points, color, size, isHighlighter, opacity } = stroke;
      if (points.length < 1) return;

      ctx.save();
      if (isHighlighter) {
        ctx.globalAlpha = opacity ?? 0.38;
        ctx.lineCap = 'square';
        ctx.lineJoin = 'bevel';
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
      } else {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = size;
      }

      if (points.length === 1) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      // Midpoint Quadratic Bezier Interpolation for smooth strokes
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }

      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
      ctx.restore();
    };

    const drawShape = (ctx: CanvasRenderingContext2D, shape: ShapeElement, isSelected: boolean) => {
      const { shapeType, x, y, width, height, color, fillColor, strokeWidth } = shape;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;

      if (shapeType === 'rectangle') {
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        if (fillColor) {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
        ctx.stroke();
      } else if (shapeType === 'circle') {
        ctx.beginPath();
        const rx = Math.abs(width) / 2;
        const ry = Math.abs(height) / 2;
        const cx = x + width / 2;
        const cy = y + height / 2;
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        if (fillColor) {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
        ctx.stroke();
      } else if (shapeType === 'diamond') {
        ctx.beginPath();
        const cx = x + width / 2;
        const cy = y + height / 2;
        ctx.moveTo(cx, y);
        ctx.lineTo(x + width, cy);
        ctx.lineTo(cx, y + height);
        ctx.lineTo(x, cy);
        ctx.closePath();
        if (fillColor) {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
        ctx.stroke();
      } else if (shapeType === 'line') {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y + height);
        ctx.stroke();
      } else if (shapeType === 'arrow') {
        const fromX = x;
        const fromY = y;
        const toX = x + width;
        const toY = y + height;
        const headlen = Math.max(14, strokeWidth * 3.5);
        const angle = Math.atan2(toY - fromY, toX - fromX);

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.moveTo(toX, toY);
        ctx.lineTo(
          toX - headlen * Math.cos(angle - Math.PI / 6),
          toY - headlen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          toX - headlen * Math.cos(angle + Math.PI / 6),
          toY - headlen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      }

      if (isSelected) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x - 4, y - 4, width + 8, height + 8);
      }

      ctx.restore();
    };

    const drawText = (ctx: CanvasRenderingContext2D, el: TextElement, isSelected: boolean) => {
      ctx.save();
      ctx.font = `600 ${el.fontSize}px 'Newsreader', Georgia, serif`;
      ctx.fillStyle = el.color;
      ctx.fillText(el.text, el.x, el.y + el.fontSize);

      if (isSelected) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        const metrics = ctx.measureText(el.text);
        ctx.strokeRect(el.x - 3, el.y, metrics.width + 6, el.fontSize + 6);
      }

      ctx.restore();
    };

    // -------------------------------------------------------------
    // CANVAS RESIZING & SETUP
    // -------------------------------------------------------------
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
        } else if (el.type === 'shape') {
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
            point.x <= el.x + 160 + eraserRadius &&
            point.y >= el.y - eraserRadius &&
            point.y <= el.y + 40 + eraserRadius
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
    // POINTER EVENTS HANDLING (Pen, Laser, Shapes, Eraser, Pan)
    // -------------------------------------------------------------
    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Multi-touch pinch detection
      if (activePointersRef.current.size === 2) {
        const pts = Array.from(activePointersRef.current.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        initialPinchDistRef.current = dist;
        initialPinchZoomRef.current = viewState.zoom;
        return;
      }

      // Palm Rejection: If stylus-only mode is active and input is touch, only pan
      if (stylusOnly && e.pointerType === 'touch') {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - viewState.panX, y: e.clientY - viewState.panY };
        return;
      }

      // Spacebar or Middle-click or Hand tool initiates canvas pan
      if (spacePressedRef.current || e.button === 1 || activeTool === 'hand') {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - viewState.panX, y: e.clientY - viewState.panY };
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const worldPoint = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      worldPoint.pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;

      if (activeTool === 'laser') {
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
      } else if (activeTool === 'eraser') {
        eraseIntersecting(worldPoint);
      } else if (activeTool === 'text') {
        setInlineTextPos(worldPoint);
        setInlineTextVal('');
        setTimeout(() => textInputRef.current?.focus(), 50);
      } else if (activeTool === 'select') {
        // Selection hit test
        const hit = elements
          .slice()
          .reverse()
          .find((el) => {
            if (el.type === 'shape') {
              return (
                worldPoint.x >= el.x &&
                worldPoint.x <= el.x + el.width &&
                worldPoint.y >= el.y &&
                worldPoint.y <= el.y + el.height
              );
            }
            if (el.type === 'text') {
              return (
                worldPoint.x >= el.x &&
                worldPoint.x <= el.x + 180 &&
                worldPoint.y >= el.y &&
                worldPoint.y <= el.y + 40
              );
            }
            return false;
          });

        onSelectElementId(hit ? hit.id : null);
      }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Handle Two-Finger Pinch Zoom
      if (activePointersRef.current.size === 2 && initialPinchDistRef.current) {
        const pts = Array.from(activePointersRef.current.values());
        const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const scale = currentDist / initialPinchDistRef.current;
        const newZoom = Math.min(3, Math.max(0.2, initialPinchZoomRef.current * scale));

        onViewStateChange({
          ...viewState,
          zoom: newZoom,
        });
        return;
      }

      if (isPanningRef.current) {
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

      if (activeTool === 'laser' && isDrawingRef.current) {
        laserPointsRef.current.push({ x: worldPoint.x, y: worldPoint.y, time: Date.now() });
        renderCanvas();
      } else if (isDrawingRef.current && (activeTool === 'pen' || activeTool === 'highlighter')) {
        currentPointsRef.current.push(worldPoint);
        renderCanvas();
      } else if (activeTool === 'shape' && shapeStartRef.current) {
        shapeCurrentRef.current = worldPoint;
        renderCanvas();
      } else if (activeTool === 'eraser' && (e.buttons === 1 || e.pressure > 0)) {
        eraseIntersecting(worldPoint);
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) {
        initialPinchDistRef.current = null;
      }

      if (isPanningRef.current) {
        isPanningRef.current = false;
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
        // Zoom
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
        const newZoom = Math.min(3, Math.max(0.2, viewState.zoom * zoomFactor));

        const newPanX = mouseX - (mouseX - viewState.panX) * (newZoom / viewState.zoom);
        const newPanY = mouseY - (mouseY - viewState.panY) * (newZoom / viewState.zoom);

        onViewStateChange({
          panX: newPanX,
          panY: newPanY,
          zoom: newZoom,
        });
      } else {
        // Trackpad Pan
        onViewStateChange({
          ...viewState,
          panX: viewState.panX - e.deltaX,
          panY: viewState.panY - e.deltaY,
        });
      }
    };

    // Keyboard spacebar listener for panning
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
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
          } else if (el.type === 'shape' || el.type === 'sticky') {
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

        // Draw elements translated to offset
        offCtx.save();
        offCtx.translate(-minX + padding, -minY + padding);

        elements.forEach((el) => {
          if (el.type === 'stroke') drawStroke(offCtx, el);
          if (el.type === 'shape') drawShape(offCtx, el, false);
          if (el.type === 'text') drawText(offCtx, el, false);
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
            svg += `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" stroke="${el.color}" stroke-width="${el.strokeWidth}" fill="none" />`;
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
          } else if (el.type === 'shape' || el.type === 'sticky') {
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
        const targetZoom = Math.min(1.5, Math.max(0.3, Math.min(zoomX, zoomY)));

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
        const cx = canvas ? canvas.clientWidth / 2 : 400;
        const cy = canvas ? canvas.clientHeight / 2 : 300;
        const newZoom = Math.min(3, viewState.zoom * 1.25);
        const newPanX = cx - (cx - viewState.panX) * (newZoom / viewState.zoom);
        const newPanY = cy - (cy - viewState.panY) * (newZoom / viewState.zoom);
        onViewStateChange({ panX: newPanX, panY: newPanY, zoom: newZoom });
      },

      zoomOut: () => {
        const canvas = canvasRef.current;
        const cx = canvas ? canvas.clientWidth / 2 : 400;
        const cy = canvas ? canvas.clientHeight / 2 : 300;
        const newZoom = Math.max(0.2, viewState.zoom * 0.8);
        const newPanX = cx - (cx - viewState.panX) * (newZoom / viewState.zoom);
        const newPanY = cy - (cy - viewState.panY) * (newZoom / viewState.zoom);
        onViewStateChange({ panX: newPanX, panY: newPanY, zoom: newZoom });
      },

      getViewState: () => viewState,
      setViewState: (v: ViewState) => onViewStateChange(v),
    }));

    // Inline text submit
    const handleTextSubmit = () => {
      if (inlineTextPos && inlineTextVal.trim()) {
        const newText: TextElement = {
          id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: 'text',
          x: inlineTextPos.x,
          y: inlineTextPos.y,
          text: inlineTextVal.trim(),
          fontSize: 18,
          color: activeColor,
        };
        onElementsChange([...elements, newText], true);
      }
      setInlineTextPos(null);
      setInlineTextVal('');
    };

    return (
      <div
        ref={containerRef}
        className="w-full h-full relative overflow-hidden select-none touch-none"
        onDoubleClick={(e) => {
          if (onCanvasDoubleClick) {
            const rect = e.currentTarget.getBoundingClientRect();
            const worldPoint = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
            onCanvasDoubleClick(worldPoint);
          }
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          className="absolute inset-0 block w-full h-full"
          style={{
            cursor:
              activeTool === 'laser'
                ? 'crosshair'
                : activeTool === 'pen' || activeTool === 'highlighter'
                ? 'crosshair'
                : activeTool === 'eraser'
                ? 'cell'
                : activeTool === 'hand'
                ? 'grab'
                : activeTool === 'shape'
                ? 'crosshair'
                : 'default',
          }}
        />

        {/* Inline Text Editing Box */}
        {inlineTextPos && (
          <div
            style={{
              position: 'absolute',
              left: `${worldToScreen(inlineTextPos.x, inlineTextPos.y).x}px`,
              top: `${worldToScreen(inlineTextPos.x, inlineTextPos.y).y}px`,
              transform: 'translateY(-50%)',
            }}
            className="z-20 pointer-events-auto"
          >
            <input
              ref={textInputRef}
              type="text"
              value={inlineTextVal}
              onChange={(e) => setInlineTextVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextSubmit();
                if (e.key === 'Escape') setInlineTextPos(null);
              }}
              onBlur={handleTextSubmit}
              placeholder="Type dispatch note..."
              style={{ color: activeColor }}
              className="bg-paper-white/95 border border-ink-primary px-2.5 py-1 text-sm font-editorial font-bold outline-none shadow-md rounded-[1px]"
            />
          </div>
        )}
      </div>
    );
  }
);

WhiteboardCanvas.displayName = 'WhiteboardCanvas';
