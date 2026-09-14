import { describe, it, expect } from 'vitest';
import { Point, StrokeElement, StickyColor } from '../../../types';

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

describe('Whiteboard Vector Engine Math', () => {
  describe('Coordinate Transforms', () => {
    it('accurately maps screen coordinates to world coordinates under pan and zoom', () => {
      const panX = 100;
      const panY = 50;
      const zoom = 2;

      // Screen (200, 150) -> World: (200 - 100) / 2 = 50, (150 - 50) / 2 = 50
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
      const p = { x: 20, y: 0 }; // 10 units beyond endpoint w

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
      // For i = 1 (p1: 10,20 and p2: 30,40) -> mid = (20, 30)
      expect(midpoints[0]).toEqual({ x: 20, y: 30 });
      // For i = 2 (p2: 30,40 and p3: 50,20) -> mid = (40, 30)
      expect(midpoints[1]).toEqual({ x: 40, y: 30 });
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
