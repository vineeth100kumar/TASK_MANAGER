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
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; to: 'below' | 'above' | 'left_of' | 'right_of'; of: string }
  | { op: 'resize'; id: string; scale: number }
  | { op: 'color'; id: string; color: string }
  | { op: 'tidy' }
  | { op: 'undo_last' };

// Soft fills from Excalidraw's own palette, by the names the AI uses.
const COLORS: Record<string, string> = {
  red: '#ffc9c9', orange: '#ffd8a8', yellow: '#ffec99', green: '#b2f2bb', teal: '#96f2d7',
  blue: '#a5d8ff', purple: '#d0bfff', pink: '#fcc2d7', gray: '#e9ecef', grey: '#e9ecef', none: 'transparent',
};
const PLACES = new Set(['below', 'above', 'left_of', 'right_of']);

// Board refs (n1, e1…) to Excalidraw element ids, fixed when the board was read.
export type RefMap = Record<string, string>;

// The board as the AI sees it when asked to change it.
export function boardGraph(elements: readonly any[], selectedIds: string[] = []): { text: string; refs: RefMap } {
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
    for (const el of shapes) lines.push(`- ${refOf.get(el.id)}: ${KIND_NAMES[el.type]} "${labels.get(el.id) || ''}"${el.customData?.sageTaskId ? ' (already a task in my list)' : ''}`);
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

  // What "this" and "these" mean: the shapes selected right now, including
  // the one whose label is selected.
  const refById = new Map(Object.entries(refs).map(([ref, id]) => [id, ref]));
  const selected = [...new Set(selectedIds.map(id => {
    const el = live.find(e => e.id === id);
    return refById.get(el?.containerId || id);
  }).filter(Boolean))];
  if (selected.length) lines.push('', `Selected right now: ${selected.join(', ')}`);

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
    } else if (op.op === 'move' && known.has(str(op.id)) && known.has(str(op.of)) && PLACES.has(str(op.to)) && str(op.id) !== str(op.of)) {
      ops.push({ op: 'move', id: str(op.id), to: str(op.to) as any, of: str(op.of) });
    } else if (op.op === 'resize' && known.has(str(op.id)) && Number(op.scale) > 0) {
      ops.push({ op: 'resize', id: str(op.id), scale: Math.min(3, Math.max(0.4, Number(op.scale))) });
    } else if (op.op === 'color' && known.has(str(op.id)) && COLORS[str(op.color).toLowerCase()]) {
      ops.push({ op: 'color', id: str(op.id), color: str(op.color).toLowerCase() });
    } else if (op.op === 'tidy') {
      ops.push({ op: 'tidy' });
    } else if (op.op === 'undo_last') {
      // Taking back the last change stands alone; nothing else in the reply applies.
      return [{ op: 'undo_last' }];
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
      case 'move': return `Move ${labelOf(o.id)} ${o.to.replace('_', ' ')} ${labelOf(o.of)}`;
      case 'resize': return `Make ${labelOf(o.id)} ${o.scale >= 1 ? 'bigger' : 'smaller'}`;
      case 'color': return o.color === 'none' ? `Clear the colour of ${labelOf(o.id)}` : `Colour ${labelOf(o.id)} ${o.color}`;
      case 'tidy': return 'Tidy the layout, top to bottom';
      case 'undo_last': return 'Take back the last change';
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

// An arrow's x/y is its first point, and the rest can run up or left of it,
// so its box comes from the points.
const boxOf = (el: any) => {
  if (!Array.isArray(el.points) || !el.points.length) return el;
  const xs = el.points.map((p: number[]) => el.x + p[0]), ys = el.points.map((p: number[]) => el.y + p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

const overlaps = (a: any, el: any) => {
  const b = boxOf(el);
  return a.x < b.x + b.width + 20 && a.x + a.width + 20 > b.x && a.y < b.y + b.height + 20 && a.y + a.height + 20 > b.y;
};

// Whether the straight line from p to q passes through a shape.
const crosses = (p: [number, number], q: [number, number], el: any) => {
  for (let i = 1; i < 24; i++) {
    const t = i / 24, x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
    if (x > el.x - 4 && x < el.x + el.width + 4 && y > el.y - 4 && y < el.y + el.height + 4) return true;
  }
  return false;
};

// Points for an arrow between two boxes: straight down if the target is
// below, sideways if it's level. An arrow that would cut through other shapes
// (one skipping a step) goes round them on the left, and one looping back up
// (a retry) goes round on the right. `lane` spaces out several such arrows so
// they don't sit on top of each other.
function arrowBetween(a: any, b: any, shapes: any[] = [], lane = 0) {
  const acx = a.x + a.width / 2, bcx = b.x + b.width / 2;
  const acy = a.y + a.height / 2, bcy = b.y + b.height / 2;
  const others = shapes.filter(el => el.id !== a.id && el.id !== b.id);
  // Shapes level with any part of the route, which a detour has to clear.
  const between = (top: number, bottom: number) => others.filter(el => el.y < bottom && el.y + el.height > top);
  let pts: Array<[number, number]>;
  let detour: 'left' | 'right' | null = null;
  if (b.y >= a.y + a.height) {
    pts = [[acx, a.y + a.height + 6], [bcx, b.y - 6]];
    if (others.some(el => crosses(pts[0], pts[1], el))) {
      detour = 'left';
      const out = Math.min(a.x, b.x, ...between(a.y, b.y + b.height).map(el => el.x)) - 40 - lane * 24;
      pts = [[a.x - 6, acy], [out, acy], [out, bcy], [b.x - 6, bcy]];
    }
  } else if (b.y + b.height <= a.y) {
    detour = 'right';
    const out = Math.max(a.x + a.width, b.x + b.width, ...between(b.y, a.y + a.height).map(el => el.x + el.width)) + 40 + lane * 24;
    pts = [[a.x + a.width + 6, acy], [out, acy], [out, bcy], [b.x + b.width + 6, bcy]];
  }
  else if (bcx >= acx) pts = [[a.x + a.width + 6, acy], [b.x - 6, bcy]];
  else pts = [[a.x - 6, acy], [b.x + b.width + 6, bcy]];
  const [x, y] = pts[0];
  const points = pts.map(([px, py]) => [px - x, py - y]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  // Where a label sits: the middle of the middle segment.
  const m = Math.floor((pts.length - 1) / 2);
  const mid: [number, number] = [(pts[m][0] + pts[m + 1][0]) / 2, (pts[m][1] + pts[m + 1][1]) / 2];
  return { x, y, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), mid, detour };
}

const withoutMid = ({ mid: _mid, detour: _detour, ...route }: ReturnType<typeof arrowBetween>) => route;

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
  // Shapes that moved or changed size; their arrows get redrawn at the end.
  const touched = new Set<string>();
  // What each arrow joins, read before anything moves: an arrow that was only
  // drawn touching its shapes can't be matched to them once they've moved.
  const startShapes = current.filter(el => !el.isDeleted && SHAPES.has(el.type));
  const joins = new Map<string, [string | undefined, string | undefined]>();
  for (const el of current) {
    if (el.isDeleted || el.type !== 'arrow') continue;
    joins.set(el.id, [el.startBinding?.elementId || shapeNear(startShapes, el, 0)?.id, el.endBinding?.elementId || shapeNear(startShapes, el, -1)?.id]);
  }
  // Arrows that go round other shapes are spaced apart, one lane each.
  const lanes = { left: 0, right: 0 };
  const route = (a: any, b: any) => {
    const shapes = [...byId().values()].filter(el => SHAPES.has(el.type));
    const plain = arrowBetween(a, b, shapes);
    if (!plain.detour) return plain;
    return arrowBetween(a, b, shapes, lanes[plain.detour]++);
  };

  // Sets a shape's box, carrying its label along.
  const place = (id: string, x: number, y: number, width?: number, height?: number) => {
    const shape = byId().get(id);
    if (!shape) return;
    let w = width ?? shape.width, h = height ?? shape.height;
    // Never shrink a shape below what its label needs, or the words wrap a
    // letter at a time. It grows around its centre instead.
    const label = elements.find(t => t.containerId === id && !t.isDeleted);
    if (label) {
      const need = sizeFor(String(label.text).replace(/\s+/g, ' '), shape.type === 'rectangle' ? 'box' : 'decision');
      const minW = Math.max(label.width + 30, Math.min(need.width, shape.width));
      const minH = Math.max(label.height + 20, Math.min(need.height, shape.height));
      if (w < minW) { x -= (minW - w) / 2; w = minW; }
      if (h < minH) { y -= (minH - h) / 2; h = minH; }
    }
    replace(id, el => bump(el, { x, y, width: w, height: h }));
    for (const t of elements) {
      if (t.containerId === id && !t.isDeleted) replace(t.id, el => bump(el, { x: x + w / 2 - el.width / 2, y: y + h / 2 - el.height / 2 }));
    }
    touched.add(id);
  };

  for (const o of ops) {
    const live = byId();
    if (o.op === 'move') {
      const shape = live.get(idFor[o.id]);
      const anchor = live.get(idFor[o.of]);
      if (!shape || !anchor) continue;
      const cx = anchor.x + anchor.width / 2 - shape.width / 2;
      const cy = anchor.y + anchor.height / 2 - shape.height / 2;
      const spot = {
        below: [cx, anchor.y + anchor.height + GAP_Y],
        above: [cx, anchor.y - shape.height - GAP_Y],
        right_of: [anchor.x + anchor.width + GAP_X * 2, cy],
        left_of: [anchor.x - shape.width - GAP_X * 2, cy],
      }[o.to];
      place(shape.id, spot[0], spot[1]);
      continue;
    }
    if (o.op === 'resize') {
      const shape = live.get(idFor[o.id]);
      if (!shape) continue;
      const w = shape.width * o.scale, h = shape.height * o.scale;
      place(shape.id, shape.x + shape.width / 2 - w / 2, shape.y + shape.height / 2 - h / 2, w, h);
      continue;
    }
    if (o.op === 'color') {
      const shape = live.get(idFor[o.id]);
      if (shape) replace(shape.id, el => bump(el, { backgroundColor: COLORS[o.color], fillStyle: 'solid' }));
      continue;
    }
    if (o.op === 'tidy') {
      for (const [id, box] of tidyLayout([...byId().values()], joins)) place(id, box.x, box.y);
      continue;
    }
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
      const target = live.get(idFor[o.id]);
      if (!target) continue;
      const oldText = [...live.values()].find(el => el.containerId === target.id);
      // Only the label is replaced. The shape or arrow keeps its id, place,
      // links and task marker; a shape grows taller if the new words need it.
      const isArrow = target.type === 'arrow';
      const height = isArrow ? target.height : Math.max(target.height, sizeFor(o.label, KIND_NAMES[target.type] || 'box').height);
      const stand = isArrow
        ? { type: 'arrow', id: target.id, x: target.x, y: target.y, points: target.points, width: target.width, height: target.height, label: { text: o.label, ...labelLook, fontSize: oldText?.fontSize ?? Math.min(labelLook.fontSize, 16) } }
        : { type: target.type, id: target.id, x: target.x, y: target.y, width: target.width, height, label: { text: o.label, ...labelLook, fontSize: oldText?.fontSize ?? labelLook.fontSize } };
      const made = convertToExcalidrawElements([stand as any], { regenerateIds: false }) as any[];
      const fresh = made.find(el => el.type === 'text');
      if (!fresh) continue;
      let text = { ...fresh, containerId: target.id, strokeColor: oldText?.strokeColor ?? fresh.strokeColor };
      // An arrow's label stays where it was along the arrow.
      if (isArrow && oldText) text = { ...text, x: oldText.x + oldText.width / 2 - text.width / 2, y: oldText.y + oldText.height / 2 - text.height / 2 };
      const others = (target.boundElements || []).filter((b: any) => b.id !== oldText?.id);
      replace(target.id, el => bump(el, { height, boundElements: [...others, { id: text.id, type: 'text' }] }));
      if (oldText) replace(oldText.id, el => bump(el, { isDeleted: true }));
      elements.push(text);
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
        { type: 'arrow', id, ...withoutMid(route(a, b)), ...look, ...(o.label ? { label: { text: o.label, ...labelLook, fontSize: Math.min(labelLook.fontSize, 16) } } : {}) } as any,
      ], { regenerateIds: false }) as any[];
      const [arrow, ...rest] = made;
      elements.push(
        { ...arrow, startBinding: { elementId: a.id, focus: 0, gap: 6 }, endBinding: { elementId: b.id, focus: 0, gap: 6 } },
        ...rest,
      );
      for (const end of [a, b]) replace(end.id, el => bump(el, { boundElements: [...(el.boundElements || []), { id, type: 'arrow' }] }));
    }
  }

  // Redraw the arrows of anything that moved, and attach them properly if
  // they were only drawn touching the shape.
  if (touched.size) {
    const live = byId();
    lanes.left = 0; lanes.right = 0;
    // Shorter detours first, so they take the lanes nearest the shapes.
    const arrows = [...live.values()].filter(el => el.type === 'arrow').map(arrow => {
      const [fromId, toId] = joins.get(arrow.id) || [];
      const from = live.get(arrow.startBinding?.elementId) || live.get(fromId as string);
      const to = live.get(arrow.endBinding?.elementId) || live.get(toId as string);
      return { arrow, from, to };
    }).sort((p, q) => (p.from && p.to ? Math.abs(p.from.y - p.to.y) : 0) - (q.from && q.to ? Math.abs(q.from.y - q.to.y) : 0));
    for (const { arrow, from, to } of arrows) {
      if (!from || !to || from.id === to.id || !(touched.has(from.id) || touched.has(to.id))) continue;
      const { mid, detour: _detour, ...path } = route(from, to);
      replace(arrow.id, el => bump(el, { ...path, startBinding: { elementId: from.id, focus: 0, gap: 6 }, endBinding: { elementId: to.id, focus: 0, gap: 6 } }));
      for (const end of [from, to]) {
        if (!(end.boundElements || []).some((b: any) => b.id === arrow.id)) replace(end.id, el => bump(el, { boundElements: [...(el.boundElements || []), { id: arrow.id, type: 'arrow' }] }));
      }
      // Keep an arrow's label on its middle.
      for (const t of elements) if (t.containerId === arrow.id && !t.isDeleted) replace(t.id, el => bump(el, { x: mid[0] - el.width / 2, y: mid[1] - el.height / 2 }));
    }
  }
  return elements;
}

// A top-to-bottom layout for a flowchart: each shape goes one row below the
// shapes that point to it, rows are centred on each other, and each row is
// ordered to follow its parents so arrows cross as little as possible.
// Shapes nothing connects to go in a row at the bottom.
function tidyLayout(live: any[], joins: Map<string, [string | undefined, string | undefined]>): Map<string, { x: number; y: number }> {
  const shapes = live.filter(el => SHAPES.has(el.type));
  const byId = new Map(shapes.map(el => [el.id, el]));
  const kids = new Map<string, string[]>(shapes.map(el => [el.id, []]));
  const parents = new Map<string, string[]>(shapes.map(el => [el.id, []]));
  for (const arrow of live.filter(el => el.type === 'arrow')) {
    const [fromId, toId] = joins.get(arrow.id) || [];
    const from = byId.get(arrow.startBinding?.elementId) || byId.get(fromId as string) || shapeNear(shapes, arrow, 0);
    const to = byId.get(arrow.endBinding?.elementId) || byId.get(toId as string) || shapeNear(shapes, arrow, -1);
    if (!from || !to || from.id === to.id) continue;
    kids.get(from.id)!.push(to.id);
    parents.get(to.id)!.push(from.id);
  }
  const connected = shapes.filter(el => kids.get(el.id)!.length || parents.get(el.id)!.length);
  // Rows by longest path from a start, ignoring arrows that loop back.
  const row = new Map<string, number>();
  const order = [...connected].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const starts = order.filter(el => !parents.get(el.id)!.length);
  const visit = (id: string, depth: number, path: Set<string>) => {
    if (path.has(id) || (row.get(id) ?? -1) >= depth) return;
    row.set(id, depth);
    path.add(id);
    for (const k of kids.get(id)!) visit(k, depth + 1, path);
    path.delete(id);
  };
  for (const el of starts.length ? starts : order.slice(0, 1)) visit(el.id, 0, new Set());
  for (const el of order) if (!row.has(el.id)) visit(el.id, 0, new Set()); // parts only reachable through a loop
  const rows: string[][] = [];
  for (const el of order) (rows[row.get(el.id)!] ||= []).push(el.id);
  const loose = shapes.filter(el => !row.has(el.id)).map(el => el.id);
  if (loose.length) rows.push(loose);

  const top = Math.min(...shapes.map(el => el.y));
  const centre = shapes.reduce((sum, el) => sum + el.x + el.width / 2, 0) / Math.max(1, shapes.length);
  const out = new Map<string, { x: number; y: number }>();
  const slot = new Map<string, number>(); // x centre, for ordering the next row
  let y = top;
  for (const ids of rows.filter(Boolean)) {
    const avgParent = (id: string) => {
      const xs = parents.get(id)!.map(p => slot.get(p)).filter((v): v is number => v !== undefined);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : byId.get(id)!.x;
    };
    ids.sort((a, b) => avgParent(a) - avgParent(b));
    const width = ids.reduce((sum, id) => sum + byId.get(id)!.width, 0) + GAP_X * (ids.length - 1);
    let x = centre - width / 2;
    const height = Math.max(...ids.map(id => byId.get(id)!.height));
    for (const id of ids) {
      const el = byId.get(id)!;
      out.set(id, { x, y: y + (height - el.height) / 2 });
      slot.set(id, x + el.width / 2);
      x += el.width + GAP_X;
    }
    y += height + GAP_Y;
  }
  return out;
}

// Ids of elements the edits created, to select them after applying.
export const newIds = (before: readonly any[], after: readonly any[]) => {
  const old = new Set(before.map(el => el.id));
  return after.filter(el => !old.has(el.id) && !el.isDeleted && el.type !== 'text').map(el => el.id);
};
