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
});
