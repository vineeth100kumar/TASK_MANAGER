import React, { useRef, useEffect } from 'react';
import { WhiteboardElement, ViewState } from '../../types';

export interface WhiteboardMinimapProps {
  elements: WhiteboardElement[];
  viewState: ViewState;
  canvasWidth: number;
  canvasHeight: number;
  onPanTo: (panX: number, panY: number) => void;
  edition?: 'day' | 'night';
}

const W = 160;
const H = 100;

export const WhiteboardMinimap: React.FC<WhiteboardMinimapProps> = ({
  elements,
  viewState,
  canvasWidth,
  canvasHeight,
  onPanTo,
  edition = 'day',
}) => {
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boundsRef = useRef<{
    scale: number;
    offsetX: number;
    offsetY: number;
    minX: number;
    minY: number;
  }>({ scale: 0.05, offsetX: W / 2, offsetY: H / 2, minX: -1000, minY: -1000 });

  useEffect(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    const isNight = edition === 'night';

    // 1. Clear background
    ctx.fillStyle = isNight ? '#181612' : '#F5F1E8';
    ctx.fillRect(0, 0, W, H);

    // 2. Compute bounding box of all content
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    elements.forEach((el) => {
      if (el.type === 'stroke') {
        el.points.forEach((p) => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
      } else if (el.type === 'shape' || el.type === 'sticky' || el.type === 'image') {
        const x2 = el.x + el.width;
        const y2 = el.y + el.height;
        if (el.x < minX) minX = el.x;
        if (x2 > maxX) maxX = x2;
        if (el.y < minY) minY = el.y;
        if (y2 > maxY) maxY = y2;
      } else if (el.type === 'text') {
        const w = el.width || 120;
        const h = el.fontSize * 1.5;
        if (el.x < minX) minX = el.x;
        if (el.x + w > maxX) maxX = el.x + w;
        if (el.y < minY) minY = el.y;
        if (el.y + h > maxY) maxY = el.y + h;
      }
    });

    // Also include current viewport in bounds
    const vpWorldLeft = -viewState.panX / viewState.zoom;
    const vpWorldTop = -viewState.panY / viewState.zoom;
    const vpWorldRight = (canvasWidth - viewState.panX) / viewState.zoom;
    const vpWorldBottom = (canvasHeight - viewState.panY) / viewState.zoom;

    minX = Math.min(minX, vpWorldLeft);
    maxX = Math.max(maxX, vpWorldRight);
    minY = Math.min(minY, vpWorldTop);
    maxY = Math.max(maxY, vpWorldBottom);

    if (minX === Infinity || maxX === -Infinity) {
      minX = -1000;
      maxX = 1000;
      minY = -1000;
      maxY = 1000;
    }

    // Add padding around content
    const pad = 150;
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;

    const contentW = Math.max(200, maxX - minX);
    const contentH = Math.max(200, maxY - minY);

    const scaleX = (W - 16) / contentW;
    const scaleY = (H - 16) / contentH;
    const scale = Math.min(scaleX, scaleY, 0.15);

    const offsetX = (W - contentW * scale) / 2 - minX * scale;
    const offsetY = (H - contentH * scale) / 2 - minY * scale;

    boundsRef.current = { scale, offsetX, offsetY, minX, minY };

    // 3. Draw Elements simplified
    elements.forEach((el) => {
      if (el.type === 'stroke') {
        if (el.points.length < 2) return;
        ctx.strokeStyle = el.color;
        ctx.lineWidth = Math.max(1, el.size * scale);
        ctx.globalAlpha = el.isHighlighter ? 0.35 : 0.8;
        ctx.beginPath();
        ctx.moveTo(el.points[0].x * scale + offsetX, el.points[0].y * scale + offsetY);
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(el.points[i].x * scale + offsetX, el.points[i].y * scale + offsetY);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      } else if (el.type === 'shape') {
        const sx = el.x * scale + offsetX;
        const sy = el.y * scale + offsetY;
        const sw = el.width * scale;
        const sh = el.height * scale;
        if (el.fillColor) {
          ctx.fillStyle = el.fillColor;
          ctx.fillRect(sx, sy, sw, sh);
        }
        ctx.strokeStyle = el.color;
        ctx.lineWidth = Math.max(1, el.strokeWidth * scale);
        ctx.strokeRect(sx, sy, sw, sh);
      } else if (el.type === 'sticky') {
        const sx = el.x * scale + offsetX;
        const sy = el.y * scale + offsetY;
        const sw = el.width * scale;
        const sh = el.height * scale;
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeStyle = '#ca8a04';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, sw, sh);
      } else if (el.type === 'text') {
        const sx = el.x * scale + offsetX;
        const sy = el.y * scale + offsetY;
        ctx.fillStyle = el.color;
        ctx.fillRect(sx, sy, (el.width || 100) * scale, el.fontSize * scale);
      } else if (el.type === 'image') {
        const sx = el.x * scale + offsetX;
        const sy = el.y * scale + offsetY;
        const sw = el.width * scale;
        const sh = el.height * scale;
        ctx.fillStyle = isNight ? '#2d2b27' : '#d6cfc4';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, sw, sh);
      }
    });

    // 4. Draw Viewport Indicator Rect
    const vpX = vpWorldLeft * scale + offsetX;
    const vpY = vpWorldTop * scale + offsetY;
    const vpW = (canvasWidth / viewState.zoom) * scale;
    const vpH = (canvasHeight / viewState.zoom) * scale;

    ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
    ctx.fillRect(vpX, vpY, vpW, vpH);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vpX, vpY, vpW, vpH);

    ctx.restore();
  }, [elements, viewState, canvasWidth, canvasHeight, edition]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const { scale, offsetX, offsetY } = boundsRef.current;
    const worldX = (clickX - offsetX) / scale;
    const worldY = (clickY - offsetY) / scale;

    const newPanX = canvasWidth / 2 - worldX * viewState.zoom;
    const newPanY = canvasHeight / 2 - worldY * viewState.zoom;

    onPanTo(newPanX, newPanY);
  };

  return (
    <div className="bg-surface rounded-control border border-ink-base/20 dark:border-paper-light/20 shadow-lg p-1.5 space-y-1 select-none backdrop-blur-sm">
      <div className="flex items-center justify-between px-1 text-caption text-ink-muted dark:text-stone-400">
        <span>OVERVIEW MINIMAP</span>
        <span>{Math.round(viewState.zoom * 100)}%</span>
      </div>
      <canvas
        ref={minimapCanvasRef}
        onClick={handleClick}
        style={{ width: `${W}px`, height: `${H}px` }}
        className="cursor-crosshair block border border-ink-base/10 dark:border-paper-light/10"
      />
    </div>
  );
};
