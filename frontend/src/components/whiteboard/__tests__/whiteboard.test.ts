import { describe, it, expect } from 'vitest';
import { Point, StrokeElement, StickyColor, ImageElement, WhiteboardElement } from '../../../types';

// Coordinate transformations (mirroring engine logic)
function screenToWorld(sx: number, sy: number, panX: number, panY: number, zoom: number): Point {
  return {
    x: (sx - panX) / zoom,
    y: (sy - panY) / zoom,
  };
}

function worldToScreen(wx: number, wy: number, panX: number, panY: number, zoom: number): Point {
  return {
    x: wx * zoom + panX,
    y: wy * zoom + panY,
  };
}

// Distance from point to line segment (stroke eraser engine logic)
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

// Midpoint calculation for Quadratic Bezier Smoothing
function computeMidpoints(points: Point[]): Point[] {
  const midpoints: Point[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    midpoints.push({
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    });
  }
  return midpoints;
}

// Pinch-to-zoom midpoint anchor math
function computePinchZoom(
  pt1: { x: number; y: number },
  pt2: { x: number; y: number },
  containerRect: { left: number; top: number },
  initialPan: { x: number; y: number },
  initialZoom: number,
  scale: number
) {
  const newZoom = Math.min(3.5, Math.max(0.15, initialZoom * scale));
  const midX = (pt1.x + pt2.x) / 2;
  const midY = (pt1.y + pt2.y) / 2;
  const cx = midX - containerRect.left;
  const cy = midY - containerRect.top;

  const newPanX = cx - (cx - initialPan.x) * (newZoom / initialZoom);
  const newPanY = cy - (cy - initialPan.y) * (newZoom / initialZoom);
  return { zoom: newZoom, panX: newPanX, panY: newPanY, cx, cy };
}

// Fluid Incremental Two-Finger Pan & Pinch-Zoom engine math
function computeIncrementalPinchStep(
  lastCenter: { x: number; y: number },
  currCenter: { x: number; y: number },
  containerRect: { left: number; top: number },
  currentPan: { x: number; y: number },
  currentZoom: number,
  scaleFactor: number
) {
  const newZoom = Math.min(3.5, Math.max(0.15, currentZoom * scaleFactor));
  const lastCx = lastCenter.x - containerRect.left;
  const lastCy = lastCenter.y - containerRect.top;
  const currCx = currCenter.x - containerRect.left;
  const currCy = currCenter.y - containerRect.top;
  const zoomRatio = newZoom / currentZoom;
  const newPanX = currCx - (lastCx - currentPan.x) * zoomRatio;
  const newPanY = currCy - (lastCy - currentPan.y) * zoomRatio;
  return { zoom: newZoom, panX: newPanX, panY: newPanY };
}

// Velocity taper factor math
function computeVelocityTaper(p0: Point, p1: Point): number {
  if (!p0.t || !p1.t) return 1.0;
  const dt = Math.max(1, p1.t - p0.t);
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  return 1.0 - Math.min(dist / dt / 2.5, 0.45);
}

// Bounding box intersection for lasso selection
function intersectsLasso(
  elBox: { x: number; y: number; w: number; h: number },
  lassoBox: { x: number; y: number; w: number; h: number }
): boolean {
  return (
    elBox.x < lassoBox.x + lassoBox.w &&
    elBox.x + elBox.w > lassoBox.x &&
    elBox.y < lassoBox.y + lassoBox.h &&
    elBox.y + elBox.h > lassoBox.y
  );
}

describe('Whiteboard Vector Engine Math', () => {
  describe('Coordinate Transforms', () => {
    it('accurately maps screen coordinates to world coordinates under pan and zoom', () => {
      const panX = 100;
      const panY = 50;
      const zoom = 2;

      const world = screenToWorld(200, 150, panX, panY, zoom);
      expect(world.x).toBe(50);
      expect(world.y).toBe(50);
    });

    it('satisfies round-trip invertibility: worldToScreen(screenToWorld(p)) === p', () => {
      const panX = -230.5;
      const panY = 412.8;
      const zoom = 1.35;

      const screenPt = { x: 580, y: 720 };
      const worldPt = screenToWorld(screenPt.x, screenPt.y, panX, panY, zoom);
      const restoredScreen = worldToScreen(worldPt.x, worldPt.y, panX, panY, zoom);

      expect(restoredScreen.x).toBeCloseTo(screenPt.x, 5);
      expect(restoredScreen.y).toBeCloseTo(screenPt.y, 5);
    });
  });

  describe('Midpoint-Anchored Pinch Zoom (Bug 1 Fix)', () => {
    it('preserves the world coordinate at the pinch midpoint when zooming', () => {
      const pt1 = { x: 100, y: 100 };
      const pt2 = { x: 300, y: 300 };
      const rect = { left: 0, top: 0 };
      const initialPan = { x: 50, y: 50 };
      const initialZoom = 1.0;
      const scale = 2.0;

      // Midpoint in screen space is (200, 200)
      // World coordinate before zoom: (200 - 50) / 1.0 = 150
      const worldBefore = screenToWorld(200, 200, initialPan.x, initialPan.y, initialZoom);
      expect(worldBefore.x).toBe(150);
      expect(worldBefore.y).toBe(150);

      // Perform pinch zoom
      const res = computePinchZoom(pt1, pt2, rect, initialPan, initialZoom, scale);
      expect(res.zoom).toBe(2.0);

      // World coordinate after zoom at the same screen midpoint (200, 200):
      const worldAfter = screenToWorld(200, 200, res.panX, res.panY, res.zoom);
      expect(worldAfter.x).toBeCloseTo(150, 5);
      expect(worldAfter.y).toBeCloseTo(150, 5);
    });

    it('performs pure two-finger panning without zoom change (scaleFactor = 1.0)', () => {
      const lastCenter = { x: 200, y: 200 };
      const currCenter = { x: 240, y: 215 }; // moved by +40px X, +15px Y
      const rect = { left: 0, top: 0 };
      const currentPan = { x: 50, y: 50 };
      const currentZoom = 1.5;
      const scaleFactor = 1.0;

      const res = computeIncrementalPinchStep(lastCenter, currCenter, rect, currentPan, currentZoom, scaleFactor);
      expect(res.zoom).toBe(1.5);
      expect(res.panX).toBe(50 + 40); // 90
      expect(res.panY).toBe(50 + 15); // 65
    });

    it('handles simultaneous two-finger pan and zoom without drifting', () => {
      const lastCenter = { x: 200, y: 200 };
      const currCenter = { x: 220, y: 220 }; // hand shifted +20px while spreading fingers
      const rect = { left: 0, top: 0 };
      const currentPan = { x: 30, y: 30 };
      const currentZoom = 1.0;
      const scaleFactor = 1.5;

      const res = computeIncrementalPinchStep(lastCenter, currCenter, rect, currentPan, currentZoom, scaleFactor);
      expect(res.zoom).toBe(1.5);

      // Verify that the world point that was at lastCenter (200, 200) is now tracked cleanly
      const worldBefore = screenToWorld(200, 200, currentPan.x, currentPan.y, currentZoom);
      expect(worldBefore.x).toBe(170);
      expect(worldBefore.y).toBe(170);

      const worldAfter = screenToWorld(currCenter.x, currCenter.y, res.panX, res.panY, res.zoom);
      expect(worldAfter.x).toBeCloseTo(170, 5);
      expect(worldAfter.y).toBeCloseTo(170, 5);
    });

    it('purges active inking points and shape start when multi-touch pinch begins', () => {
      let isDrawing = true;
      let currentPoints: Point[] = [{ x: 10, y: 10 }, { x: 20, y: 20 }];
      let shapeStart: Point | null = { x: 50, y: 50 };
      let isPinchActive = false;

      // Simulate multi-touch touchstart event (e.touches.length >= 2)
      const onMultiTouchStart = () => {
        isPinchActive = true;
        isDrawing = false;
        currentPoints = [];
        shapeStart = null;
      };

      onMultiTouchStart();

      expect(isPinchActive).toBe(true);
      expect(isDrawing).toBe(false);
      expect(currentPoints).toHaveLength(0);
      expect(shapeStart).toBeNull();
    });
  });

  describe('Velocity Taper & Stroke Dynamics', () => {
    it('returns 1.0 taper for slow strokes', () => {
      const p0: Point = { x: 10, y: 10, t: 1000 };
      const p1: Point = { x: 11, y: 10, t: 1100 }; // 1px in 100ms -> very slow
      const taper = computeVelocityTaper(p0, p1);
      expect(taper).toBeCloseTo(1.0, 2);
    });

    it('thins stroke (taper < 1.0) on fast flicks', () => {
      const p0: Point = { x: 10, y: 10, t: 1000 };
      const p1: Point = { x: 150, y: 10, t: 1010 }; // 140px in 10ms -> fast flick
      const taper = computeVelocityTaper(p0, p1);
      expect(taper).toBeLessThan(1.0);
      expect(taper).toBeGreaterThanOrEqual(0.55); // clamped maximum taper reduction
    });
  });

  describe('Stroke Eraser Point-to-Segment Math', () => {
    it('returns distance 0 when point lies directly on line segment', () => {
      const v = { x: 0, y: 0 };
      const w = { x: 100, y: 0 };
      const p = { x: 50, y: 0 };

      const dist = distToSegment(p, v, w);
      expect(dist).toBe(0);
    });

    it('accurately computes perpendicular distance from segment', () => {
      const v = { x: 10, y: 10 };
      const w = { x: 50, y: 10 };
      const p = { x: 30, y: 25 };

      const dist = distToSegment(p, v, w);
      expect(dist).toBe(15);
    });

    it('correctly clamps to closest endpoint when point is beyond the segment', () => {
      const v = { x: 0, y: 0 };
      const w = { x: 10, y: 0 };
      const p = { x: 20, y: 0 };

      const dist = distToSegment(p, v, w);
      expect(dist).toBe(10);
    });
  });

  describe('Quadratic Bezier Inking Smoothing', () => {
    it('interpolates midpoints between consecutive input points', () => {
      const points: Point[] = [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 20 },
      ];

      const midpoints = computeMidpoints(points);
      expect(midpoints[0]).toEqual({ x: 20, y: 30 });
      expect(midpoints[1]).toEqual({ x: 40, y: 30 });
    });
  });

  describe('Lasso Selection & Element Bounding Boxes', () => {
    it('correctly detects element intersections with lasso rect', () => {
      const elBox = { x: 100, y: 100, w: 50, h: 50 };
      const lassoHit = { x: 80, y: 80, w: 100, h: 100 };
      const lassoMiss = { x: 200, y: 200, w: 50, h: 50 };

      expect(intersectsLasso(elBox, lassoHit)).toBe(true);
      expect(intersectsLasso(elBox, lassoMiss)).toBe(false);
    });

    it('verifies ImageElement conforms to WhiteboardElement schema', () => {
      const img: ImageElement = {
        id: 'img_test_1',
        type: 'image',
        x: 50,
        y: 60,
        width: 320,
        height: 240,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      };

      const element: WhiteboardElement = img;
      expect(element.type).toBe('image');
      expect((element as ImageElement).width).toBe(320);
    });
  });

  describe('Sticky Notes Palette Specification', () => {
    it('validates supported sticky note color themes', () => {
      const validColors: StickyColor[] = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange'];
      expect(validColors).toHaveLength(6);
      expect(validColors).toContain('yellow');
      expect(validColors).toContain('blue');
      expect(validColors).toContain('green');
      expect(validColors).toContain('pink');
      expect(validColors).toContain('purple');
      expect(validColors).toContain('orange');
    });
  });

  describe('Element Moving, Resizing, and In-Place Editing', () => {
    it('translates shapes, images, text, and sticky notes by dx and dy', () => {
      const shape: WhiteboardElement = {
        id: 'shape_1',
        type: 'shape',
        shapeType: 'rectangle',
        x: 100,
        y: 150,
        width: 200,
        height: 120,
        color: '#1c1917',
        strokeWidth: 2,
      };

      const dx = 45;
      const dy = -30;

      const movedShape = {
        ...shape,
        x: shape.x + dx,
        y: shape.y + dy,
      };

      expect(movedShape.x).toBe(145);
      expect(movedShape.y).toBe(120);
      expect(movedShape.width).toBe(200);
      expect(movedShape.height).toBe(120);
    });

    it('translates freehand stroke by offsetting all constituent points', () => {
      const stroke: StrokeElement = {
        id: 'stroke_1',
        type: 'stroke',
        points: [
          { x: 10, y: 20, pressure: 0.6, t: 1000 },
          { x: 30, y: 50, pressure: 0.8, t: 1020 },
          { x: 70, y: 90, pressure: 0.5, t: 1040 },
        ],
        color: '#dc2626',
        size: 4,
      };

      const dx = 15;
      const dy = 25;

      const movedStroke: StrokeElement = {
        ...stroke,
        points: stroke.points.map((p) => ({
          ...p,
          x: p.x + dx,
          y: p.y + dy,
        })),
      };

      expect(movedStroke.points[0]).toEqual({ x: 25, y: 45, pressure: 0.6, t: 1000 });
      expect(movedStroke.points[1]).toEqual({ x: 45, y: 75, pressure: 0.8, t: 1020 });
      expect(movedStroke.points[2]).toEqual({ x: 85, y: 115, pressure: 0.5, t: 1040 });
    });

    it('translates multi-selected elements together in lockstep', () => {
      const elements: WhiteboardElement[] = [
        {
          id: 'text_1',
          type: 'text',
          x: 50,
          y: 60,
          text: 'Headline Dispatch',
          fontSize: 24,
          color: '#1c1917',
        },
        {
          id: 'stroke_1',
          type: 'stroke',
          points: [{ x: 50, y: 90 }, { x: 120, y: 90 }],
          color: '#b45309',
          size: 3,
        },
        {
          id: 'unselected_shape',
          type: 'shape',
          shapeType: 'rectangle',
          x: 500,
          y: 500,
          width: 80,
          height: 80,
          color: '#000',
          strokeWidth: 2,
        },
      ];

      const selectedIds = new Set(['text_1', 'stroke_1']);
      const dx = 100;
      const dy = 50;

      const moved = elements.map((item) => {
        if (!selectedIds.has(item.id)) return item;
        if (item.type === 'shape' || item.type === 'text' || item.type === 'image' || item.type === 'sticky') {
          return { ...item, x: item.x + dx, y: item.y + dy };
        } else if (item.type === 'stroke') {
          return {
            ...item,
            points: item.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
          };
        }
        return item;
      });

      // text moved
      expect((moved[0] as any).x).toBe(150);
      expect((moved[0] as any).y).toBe(110);
      // stroke moved
      expect((moved[1] as StrokeElement).points[0]).toEqual({ x: 150, y: 140 });
      // unselected shape remained untouched
      expect((moved[2] as any).x).toBe(500);
      expect((moved[2] as any).y).toBe(500);
    });

    it('computes accurate 8 resize handles for shapes and images', () => {
      const getHandlePositions = (el: { x: number; y: number; width: number; height: number }) => {
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

      const img = { x: 100, y: 200, width: 300, height: 200 };
      const handles = getHandlePositions(img);

      expect(handles).toHaveLength(8);
      expect(handles.find((h) => h.id === 'nw')).toEqual({ id: 'nw', x: 100, y: 200 });
      expect(handles.find((h) => h.id === 'se')).toEqual({ id: 'se', x: 400, y: 400 });
      expect(handles.find((h) => h.id === 'n')).toEqual({ id: 'n', x: 250, y: 200 });
      expect(handles.find((h) => h.id === 'e')).toEqual({ id: 'e', x: 400, y: 300 });
    });

    it('resizes elements properly with minimum dimension clamping', () => {
      let x = 100, y = 100, width = 150, height = 150;
      const dx = -200; // dragged far inwards to the left
      const dy = -200; // dragged far upwards

      // Southeast resize with min dimension 20
      width = Math.max(20, width + dx);
      height = Math.max(20, height + dy);

      expect(width).toBe(20);
      expect(height).toBe(20);
    });

    it('duplicates selected elements with appropriate position offset', () => {
      const original: WhiteboardElement = {
        id: 'shape_orig',
        type: 'shape',
        shapeType: 'diamond',
        x: 120,
        y: 180,
        width: 100,
        height: 100,
        color: '#2563eb',
        strokeWidth: 2,
      };

      const offset = 24; // offset at zoom 1
      const newId = 'shape_dup_123';
      const duplicate: WhiteboardElement = {
        ...original,
        id: newId,
        x: original.x + offset,
        y: original.y + offset,
      };

      expect(duplicate.id).not.toBe(original.id);
      expect((duplicate as any).x).toBe(144);
      expect((duplicate as any).y).toBe(204);
      expect((duplicate as any).color).toBe(original.color);
    });

    it('reorders layers correctly for bring to front and send to back', () => {
      const el1 = { id: '1', type: 'shape' } as WhiteboardElement;
      const el2 = { id: '2', type: 'shape' } as WhiteboardElement;
      const el3 = { id: '3', type: 'shape' } as WhiteboardElement;
      const list = [el1, el2, el3];

      const targetIds = new Set(['1']);

      // Bring to front
      const nonSelected = list.filter((el) => !targetIds.has(el.id));
      const selected = list.filter((el) => targetIds.has(el.id));
      const broughtToFront = [...nonSelected, ...selected];
      expect(broughtToFront.map((e) => e.id)).toEqual(['2', '3', '1']);

      // Send to back (from broughtToFront, send 1 to back)
      const sentToBack = [...selected, ...nonSelected];
      expect(sentToBack.map((e) => e.id)).toEqual(['1', '2', '3']);
    });
  });

  describe('Robust Eraser Engine (Continuous Sweep, Negative Shapes & Stylus Bypass)', () => {
    it('erases a stroke when swept over quickly via segment interpolation', () => {
      // Stroke vertical line from (100, 50) to (100, 150)
      const stroke: StrokeElement = {
        id: 'stroke_v',
        type: 'stroke',
        points: [{ x: 100, y: 50 }, { x: 100, y: 150 }],
        color: '#000',
        size: 4,
      };

      // Fast swipe from (80, 100) to (120, 100) (jumping 40px in a single event)
      const pA = { x: 80, y: 100 };
      const pB = { x: 120, y: 100 };
      const eraserRadius = 22;

      // Check discrete point distance for endpoint pB:
      // pB is (120, 100), distance to (100, 100) is 20px (close, but what if jump was 80px?)
      const fastPA = { x: 50, y: 100 };
      const fastPB = { x: 150, y: 100 }; // neither endpoint is within radius 22 of line x=100!

      // Continuous interpolation test
      const dist = Math.hypot(fastPB.x - fastPA.x, fastPB.y - fastPA.y);
      const steps = Math.max(1, Math.ceil(dist / 10));
      let hit = false;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const pt = { x: fastPA.x + (fastPB.x - fastPA.x) * t, y: fastPA.y + (fastPB.y - fastPA.y) * t };
        const d = distToSegment(pt, stroke.points[0], stroke.points[1]);
        if (d <= eraserRadius + stroke.size / 2) {
          hit = true;
          break;
        }
      }

      expect(hit).toBe(true);
    });

    it('erases single-point dot/tap strokes', () => {
      const dotStroke: StrokeElement = {
        id: 'dot_1',
        type: 'stroke',
        points: [{ x: 200, y: 200 }],
        color: '#dc2626',
        size: 8,
      };

      const eraserPt = { x: 205, y: 205 };
      const eraserRadius = 22;

      const d = Math.hypot(eraserPt.x - dotStroke.points[0].x, eraserPt.y - dotStroke.points[0].y);
      const hit = d <= eraserRadius + dotStroke.size / 2;
      expect(hit).toBe(true);
    });

    it('erases shapes drawn with inverted/negative dimensions', () => {
      // Shape drawn right-to-left, bottom-to-top: x=300, width=-100, y=300, height=-100
      const shape: WhiteboardElement = {
        id: 'shape_neg',
        type: 'shape',
        shapeType: 'rectangle',
        x: 300,
        y: 300,
        width: -100,
        height: -100,
        color: '#000',
        strokeWidth: 2,
      };

      const eraserPt = { x: 250, y: 250 };
      const eraserRadius = 22;

      const minX = Math.min(shape.x, shape.x + shape.width);
      const maxX = Math.max(shape.x, shape.x + shape.width);
      const minY = Math.min(shape.y, shape.y + shape.height);
      const maxY = Math.max(shape.y, shape.y + shape.height);

      const hit =
        eraserPt.x >= minX - eraserRadius &&
        eraserPt.x <= maxX + eraserRadius &&
        eraserPt.y >= minY - eraserRadius &&
        eraserPt.y <= maxY + eraserRadius;

      expect(minX).toBe(200);
      expect(maxX).toBe(300);
      expect(hit).toBe(true);
    });

    it('erases line and arrow shapes using segment distance rather than bounding box', () => {
      const lineShape: WhiteboardElement = {
        id: 'arrow_1',
        type: 'shape',
        shapeType: 'arrow',
        x: 100,
        y: 100,
        width: 100,
        height: 0, // horizontal arrow from (100, 100) to (200, 100)
        color: '#b45309',
        strokeWidth: 4,
      };

      const eraserPt = { x: 150, y: 110 }; // 10px below arrow
      const eraserRadius = 22;

      const d = distToSegment(
        eraserPt,
        { x: lineShape.x, y: lineShape.y },
        { x: lineShape.x + lineShape.width, y: lineShape.y + lineShape.height }
      );
      const hit = d <= eraserRadius + (lineShape as any).strokeWidth / 2;
      expect(d).toBe(10);
      expect(hit).toBe(true);
    });

    it('bypasses palm rejection pan when activeTool is eraser so finger touches erase', () => {
      const stylusOnly = false;
      const hasPenDetected = true; // Pen was used earlier
      const pointerType: string = 'touch'; // Now user touches with finger

      // When activeTool is 'pen': finger touch triggers palm rejection pan
      const activeToolPen: string = 'pen';
      const isEraserPen = activeToolPen === 'eraser' || pointerType === 'eraser';
      const shouldPanPen = (stylusOnly || hasPenDetected) && pointerType === 'touch' && !isEraserPen && activeToolPen !== 'select';
      expect(shouldPanPen).toBe(true);

      // When activeTool is 'eraser': finger touch MUST NOT pan, it must erase!
      const activeToolEraser: string = 'eraser';
      const isEraserTool = activeToolEraser === 'eraser' || pointerType === 'eraser';
      const shouldPanEraser = (stylusOnly || hasPenDetected) && pointerType === 'touch' && !isEraserTool && activeToolEraser !== 'select';
      expect(shouldPanEraser).toBe(false);
    });
  });
});
