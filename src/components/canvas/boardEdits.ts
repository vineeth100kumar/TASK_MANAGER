// Lets the thinking partner change a board. The AI sees the board as a short
// list of numbered shapes (n1, n2…) and arrows (e1…), and replies with edit
// operations against those numbers. They're shown to you first, then applied
// here as ordinary Excalidraw elements, so they sync and undo like your own.
import { FONT_FAMILY, convertToExcalidrawElements } from '@excalidraw/excalidraw';

const SHAPES = new Set(['rectangle', 'diamond', 'ellipse']);
const KIND_NAMES: Record<string, string> = { rectangle: 'box', diamond: 'decision', ellipse: 'oval' };
const KIND_TYPES: Record<string, 'rectangle' | 'diamond' | 'ellipse'> = { box: 'rectangle', decision: 'diamond', oval: 'ellipse' };
// Most edits a single request should make; more usually means the AI lost the plot.
const MAX_OPS = 40;
const GAP_Y = 90;
const GAP_X = 60;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export type EditOp =
  | { op: 'add_node'; ref: string; label: string; shape?: string; near?: string }
  | { op: 'add_edge'; from: string; to: string; label?: string }
  | { op: 'edit_label'; id: string; label: string }
  | { op: 'delete'; id: string };

// Board refs (n1, e1…) to Excalidraw element ids, fixed when the board was read.
export type RefMap = Record<string, string>;

// The board as the AI sees it when asked to change it.
export function boardGraph(elements: readonly any[]): { text: string; refs: RefMap } {
  const live = elements.filter(el => !el.isDeleted);
  const labels = new Map<string, string>();
  for (const el of live) if (el.type === 'text' && el.containerId && el.text) labels.set(el.containerId, oneLine(el.text));

  const refs: RefMap = {};
  const refOf = new Map<string, string>();
  const shapes = live.filter(el => SHAPES.has(el.type)).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const lines: string[] = [];
  shapes.forEach((el, i) => {
    const ref = `n${i + 1}`;
    refs[ref] = el.id;
    refOf.set(el.id, ref);
  });
  if (shapes.length) {
    lines.push('Shapes (top to bottom):');
    for (const el of shapes) lines.push(`- ${refOf.get(el.id)}: ${KIND_NAMES[el.type]} "${labels.get(el.id) || ''}"`);
  }

  const arrows = live.filter(el => el.type === 'arrow');
  const edgeLines: string[] = [];
  arrows.forEach((el, i) => {
    const from = refOf.get(el.startBinding?.elementId) || refOf.get(shapeNear(shapes, el, 0)?.id);
    const to = refOf.get(el.endBinding?.elementId) || refOf.get(shapeNear(shapes, el, -1)?.id);
    if (!from && !to) return;
    const ref = `e${i + 1}`;
    refs[ref] = el.id;
    const label = labels.get(el.id);
    edgeLines.push(`- ${ref}: ${from || '(nothing)'} → ${to || '(nothing)'}${label ? ` "${label}"` : ''}`);
  });
  if (edgeLines.length) lines.push('', 'Arrows:', ...edgeLines);

  const notes = live.filter(el => el.type === 'text' && !el.containerId && oneLine(el.text || ''));
  if (notes.length) lines.push('', 'Free text (read only):', ...notes.map(el => `- "${oneLine(el.text)}"`));

  return { text: lines.length ? lines.join('\n') : '(The board is empty.)', refs };
}

// The shape an unbound arrow end is drawn on (index 0 = start, -1 = end).
function shapeNear(shapes: any[], arrow: any, index: 0 | -1) {
  const pts = Array.isArray(arrow.points) && arrow.points.length ? arrow.points : [[0, 0]];
  const [px, py] = pts[index === 0 ? 0 : pts.length - 1];
  const x = arrow.x + px;
  const y = arrow.y + py;
  return shapes.find(el => x >= el.x - 30 && x <= el.x + el.width + 30 && y >= el.y - 30 && y <= el.y + el.height + 30);
}

// Drops anything malformed or pointing at a shape that doesn't exist.
export function cleanOps(raw: unknown, refs: RefMap): EditOp[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(Object.keys(refs));
  const ops: EditOp[] = [];
  for (const o of raw.slice(0, MAX_OPS)) {
    if (!o || typeof o !== 'object') continue;
    const op = o as any;
    const str = (v: unknown) => (typeof v === 'string' ? oneLine(v) : '');
    if (op.op === 'add_node' && str(op.ref) && str(op.label) && !known.has(str(op.ref))) {
      known.add(str(op.ref));
      ops.push({ op: 'add_node', ref: str(op.ref), label: str(op.label), shape: str(op.shape) || 'box', near: str(op.near) || undefined });
    } else if (op.op === 'add_edge' && known.has(str(op.from)) && known.has(str(op.to)) && str(op.from) !== str(op.to)) {
      ops.push({ op: 'add_edge', from: str(op.from), to: str(op.to), label: str(op.label) || undefined });
    } else if (op.op === 'edit_label' && refs[str(op.id)] && str(op.label)) {
      ops.push({ op: 'edit_label', id: str(op.id), label: str(op.label) });
    } else if (op.op === 'delete' && refs[str(op.id)]) {
      ops.push({ op: 'delete', id: str(op.id) });
    }
  }
  return ops;
}

// One plain line per change, for the preview.
export function describeOps(ops: EditOp[], elements: readonly any[], refs: RefMap): string[] {
  const labelOf = (ref: string) => {
    const added = ops.find(o => o.op === 'add_node' && o.ref === ref) as any;
    if (added) return `"${added.label}"`;
    const id = refs[ref];
    const text = elements.find(el => el.type === 'text' && el.containerId === id && !el.isDeleted);
    return text ? `"${oneLine(text.text)}"` : 'a shape';
  };
  return ops.map(o => {
    switch (o.op) {
      case 'add_node': return `Add ${o.shape === 'decision' ? 'decision' : o.shape === 'oval' ? 'oval' : 'box'} "${o.label}"`;
      case 'add_edge': return `Connect ${labelOf(o.from)} → ${labelOf(o.to)}${o.label ? ` ("${o.label}")` : ''}`;
      case 'edit_label': return `Rename ${labelOf(o.id)} to "${o.label}"`;
      case 'delete': return o.id.startsWith('e') ? 'Remove an arrow' : `Remove ${labelOf(o.id)}`;
    }
  });
}

const sizeFor = (label: string, shape: string) => {
  const width = Math.max(180, Math.min(360, label.length * 11 + 60));
  const lines = Math.ceil((label.length * 11) / (width - 40));
  const height = Math.max(70, lines * 26 + 34);
  // Text inside a diamond or oval has less room.
  return shape === 'box' ? { width, height } : { width: width + 60, height: height + 40 };
};

const overlaps = (a: any, b: any) =>
  a.x < b.x + b.width + 20 && a.x + a.width + 20 > b.x && a.y < b.y + b.height + 20 && a.y + a.height + 20 > b.y;

// Points for an arrow between two boxes: down if the target is below, up if
// above, sideways otherwise.
function arrowBetween(a: any, b: any) {
  const acx = a.x + a.width / 2, bcx = b.x + b.width / 2;
  const acy = a.y + a.height / 2, bcy = b.y + b.height / 2;
  let start: [number, number], end: [number, number];
  if (b.y >= a.y + a.height) { start = [acx, a.y + a.height + 6]; end = [bcx, b.y - 6]; }
  else if (b.y + b.height <= a.y) { start = [acx, a.y - 6]; end = [bcx, b.y + b.height + 6]; }
  else if (bcx >= acx) { start = [a.x + a.width + 6, acy]; end = [b.x - 6, bcy]; }
  else { start = [a.x - 6, acy]; end = [b.x + b.width + 6, bcy]; }
  return { x: start[0], y: start[1], points: [[0, 0], [end[0] - start[0], end[1] - start[1]]] };
}

// Applies edits to the current elements and returns the new element list.
export function applyOps(current: readonly any[], ops: EditOp[], refs: RefMap): any[] {
  let elements = current.map(el => el);
  // New shapes copy the look of what's already there (the board defaults to
  // clean lines and Nunito, not the hand-drawn style).
  const sample = current.find(el => !el.isDeleted && SHAPES.has(el.type));
  const sampleText = current.find(el => !el.isDeleted && el.type === 'text');
  const look = {
    strokeColor: sample?.strokeColor ?? '#1e1e1e',
    strokeWidth: sample?.strokeWidth ?? 2,
    roughness: sample?.roughness ?? 0,
  };
  const labelLook = { fontFamily: sampleText?.fontFamily ?? FONT_FAMILY.Nunito, fontSize: sampleText?.fontSize ?? 20 };
  const byId = () => new Map(elements.filter(el => !el.isDeleted).map(el => [el.id, el]));
  const idFor: Record<string, string> = { ...refs };
  const bump = (el: any, changes: any) => ({ ...el, ...changes, version: (el.version || 1) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });
  const replace = (id: string, fn: (el: any) => any) => { elements = elements.map(el => (el.id === id ? fn(el) : el)); };
  const makeId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

  for (const o of ops) {
    const live = byId();
    if (o.op === 'delete') {
      const target = live.get(idFor[o.id]);
      if (!target) continue;
      // A shape goes with its label and any arrow attached to it.
      const doomed = new Set([target.id]);
      for (const el of live.values()) {
        if (el.containerId === target.id) doomed.add(el.id);
        if (el.type === 'arrow' && (el.startBinding?.elementId === target.id || el.endBinding?.elementId === target.id)) {
          doomed.add(el.id);
          for (const t of live.values()) if (t.containerId === el.id) doomed.add(t.id);
        }
      }
      elements = elements.map(el => (doomed.has(el.id) ? bump(el, { isDeleted: true }) : el));
    } else if (o.op === 'edit_label') {
      const shape = live.get(idFor[o.id]);
      if (!shape) continue;
      const text = [...live.values()].find(el => el.containerId === shape.id);
      // Rebuilt under the same id so attached arrows stay attached.
      const [fresh, freshText] = convertToExcalidrawElements([
        { type: shape.type, id: shape.id, x: shape.x, y: shape.y, width: shape.width, height: Math.max(shape.height, sizeFor(o.label, KIND_NAMES[shape.type] || 'box').height), strokeColor: shape.strokeColor, backgroundColor: shape.backgroundColor, roundness: shape.roundness, roughness: shape.roughness, strokeWidth: shape.strokeWidth, label: { text: o.label, ...labelLook } } as any,
      ], { regenerateIds: false }) as any[];
      const arrowsOnIt = (shape.boundElements || []).filter((b: any) => b.type === 'arrow');
      replace(shape.id, () => bump(shape, { ...fresh, boundElements: [...arrowsOnIt, { id: freshText.id, type: 'text' }] }));
      if (text) replace(text.id, el => bump(el, { isDeleted: true }));
      elements.push(freshText);
    } else if (o.op === 'add_node') {
      const shape = KIND_TYPES[o.shape || 'box'] ? (o.shape as string) : 'box';
      const { width, height } = sizeFor(o.label, shape);
      const shapes = [...live.values()].filter(el => SHAPES.has(el.type));
      const near = o.near ? live.get(idFor[o.near]) : undefined;
      let x: number, y: number;
      if (near) {
        x = near.x + near.width / 2 - width / 2;
        y = near.y + near.height + GAP_Y;
      } else if (shapes.length) {
        const lowest = shapes.reduce((a, b) => (a.y + a.height > b.y + b.height ? a : b));
        x = lowest.x + lowest.width / 2 - width / 2;
        y = lowest.y + lowest.height + GAP_Y;
      } else {
        x = 0; y = 0;
      }
      // Step right until it doesn't sit on anything.
      const others = [...live.values()].filter(el => el.type !== 'text' || !el.containerId);
      for (let tries = 0; tries < 20 && others.some(el => overlaps({ x, y, width, height }, el)); tries++) x += width + GAP_X;
      const id = makeId();
      idFor[o.ref] = id;
      const made = convertToExcalidrawElements([
        { type: KIND_TYPES[shape], id, x, y, width, height, roundness: shape === 'box' ? { type: 3 } : null, ...look, label: { text: o.label, ...labelLook } } as any,
      ], { regenerateIds: false });
      elements.push(...made);
    } else if (o.op === 'add_edge') {
      const a = live.get(idFor[o.from]);
      const b = live.get(idFor[o.to]);
      if (!a || !b) continue;
      const id = makeId();
      const made = convertToExcalidrawElements([
        { type: 'arrow', id, ...arrowBetween(a, b), ...look, ...(o.label ? { label: { text: o.label, ...labelLook, fontSize: Math.min(labelLook.fontSize, 16) } } : {}) } as any,
      ], { regenerateIds: false }) as any[];
      const [arrow, ...rest] = made;
      elements.push(
        { ...arrow, startBinding: { elementId: a.id, focus: 0, gap: 6 }, endBinding: { elementId: b.id, focus: 0, gap: 6 } },
        ...rest,
      );
      for (const end of [a, b]) replace(end.id, el => bump(el, { boundElements: [...(el.boundElements || []), { id, type: 'arrow' }] }));
    }
  }
  return elements;
}

// Ids of elements the edits created, to select them after applying.
export const newIds = (before: readonly any[], after: readonly any[]) => {
  const old = new Set(before.map(el => el.id));
  return after.filter(el => !old.has(el.id) && !el.isDeleted && el.type !== 'text').map(el => el.id);
};
