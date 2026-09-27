/**
 * SAGE IMAGE EXPORTER
 * Exports beautiful visual PNG snapshots of Tasks and Flowcharts directly from the browser.
 */

import { WorkItem, Project } from '../services/types';

export function downloadTaskImage(task: WorkItem, project?: Project | null) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = 800;
  const height = 500;
  const scale = 2; // High DPI

  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#0f172a');
  bgGrad.addColorStop(1, '#1e293b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Card container
  const cardX = 40;
  const cardY = 40;
  const cardW = width - 80;
  const cardH = height - 80;
  const radius = 24;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, radius);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Header Badge (Project & Key)
  const projName = project?.name || 'SAGE TASK';
  ctx.fillStyle = '#6366f1';
  ctx.font = 'bold 12px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(`${task.key}  •  ${projName.toUpperCase()}`, cardX + 32, cardY + 48);

  // Task Title
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 24px Inter, system-ui, -apple-system, sans-serif';
  
  // Wrap title text
  const words = task.title.split(' ');
  let line = '';
  let lineY = cardY + 90;
  const maxTitleW = cardW - 64;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxTitleW && n > 0) {
      ctx.fillText(line, cardX + 32, lineY);
      line = words[n] + ' ';
      lineY += 32;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, cardX + 32, lineY);

  // Description
  if (task.description) {
    ctx.fillStyle = '#64748b';
    ctx.font = '14px Inter, system-ui, -apple-system, sans-serif';
    const desc = task.description.length > 180 ? task.description.substring(0, 180) + '...' : task.description;
    ctx.fillText(desc, cardX + 32, lineY + 36);
  }

  // Footer Attributes Grid
  const footerY = cardY + cardH - 50;

  // Status Pill
  const statusColor = task.status === 'done' ? '#10b981' : task.status === 'in_progress' ? '#3b82f6' : '#f59e0b';
  ctx.fillStyle = statusColor;
  ctx.beginPath();
  ctx.roundRect(cardX + 32, footerY - 18, 90, 28, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Inter, system-ui, sans-serif';
  ctx.fillText(task.status.toUpperCase(), cardX + 46, footerY);

  // Priority
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px Inter, system-ui, sans-serif';
  ctx.fillText(`Priority: ${(task.priority || 'Medium').toUpperCase()}`, cardX + 140, footerY);

  // Due Date
  if (task.dueDate) {
    ctx.fillStyle = '#64748b';
    ctx.fillText(`Due: ${task.dueDate}`, cardX + 280, footerY);
  }

  // Sage Branding watermark
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 12px Inter, system-ui, sans-serif';
  ctx.fillText('Sage Personal Flow Engine', cardX + cardW - 190, footerY);

  // Download Trigger
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${task.key}_${task.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20)}.png`;
  a.click();
}

export function downloadFlowCanvasImage(
  items: WorkItem[], 
  positions: { [id: string]: { x: number; y: number } }, 
  projectName: string = 'Project Flow'
) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = 1600;
  const height = 1000;
  const scale = 2;

  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);

  // Canvas background
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, width, height);

  // Title & Header
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 14px Inter, system-ui, sans-serif';
  ctx.fillText('SAGE PROJECT MAP', 60, 50);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'extrabold 28px Inter, system-ui, sans-serif';
  ctx.fillText(projectName, 60, 85);

  const CARD_W = 220;
  const CARD_H = 100;

  // Draw Connecting Bezier Curves
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;

  items.forEach(targetItem => {
    const targetPos = positions[targetItem.id];
    if (!targetPos) return;

    (targetItem.dependsOn || []).forEach(sourceId => {
      const sourcePos = positions[sourceId];
      if (!sourcePos) return;

      const x1 = sourcePos.x + CARD_W;
      const y1 = sourcePos.y + CARD_H / 2;
      const x2 = targetPos.x;
      const y2 = targetPos.y + CARD_H / 2;

      const dx = Math.abs(x2 - x1) * 0.5;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
      ctx.stroke();
    });
  });

  // Draw Node Cards
  items.forEach(item => {
    const pos = positions[item.id] || { x: 60, y: 120 };

    // Card BG
    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.roundRect(pos.x, pos.y, CARD_W, CARD_H, 16);
    ctx.fill();

    // Border
    ctx.strokeStyle = item.entityType === 'milestone' ? '#a855f7' : item.status === 'done' ? '#10b981' : '#27272a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Key
    ctx.fillStyle = '#71717a';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(item.key, pos.x + 14, pos.y + 24);

    // Title
    ctx.fillStyle = '#f4f4f5';
    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const title = item.title.length > 28 ? item.title.substring(0, 28) + '...' : item.title;
    ctx.fillText(title, pos.x + 14, pos.y + 48);

    // Status / Due
    ctx.fillStyle = item.status === 'done' ? '#10b981' : '#a1a1aa';
    ctx.font = '10px Inter, system-ui, sans-serif';
    const subText = item.dueDate ? `Due ${item.dueDate}` : item.status.toUpperCase();
    ctx.fillText(subText, pos.x + 14, pos.y + 78);
  });

  // Watermark
  ctx.fillStyle = '#52525b';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.fillText('Generated with Sage Flow Engine', width - 260, height - 30);

  // Trigger download
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_flowmap.png`;
  a.click();
}
