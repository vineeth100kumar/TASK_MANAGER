// Turns a board's Excalidraw elements into a plain-text outline an AI can read:
// the shapes and their labels, which arrow joins what, loose notes, and how
// much freehand drawing there is (which only the snapshot image shows).

const SHAPES = new Set(['rectangle', 'diamond', 'ellipse', 'frame', 'magicframe', 'embeddable']);
const SHAPE_NAMES: Record<string, string> = {
  rectangle: 'box', diamond: 'decision', ellipse: 'oval', frame: 'frame', magicframe: 'frame', embeddable: 'embed',
};

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

// How far outside a shape an arrow end can stop and still count as touching it.
const SNAP_PX = 30;

// The shape an arrow end sits on, for arrows drawn without snapping to it.
function shapeAt(shapes: any[], px: number, py: number) {
  let best: any = null;
  let bestDist = Infinity;
  for (const el of shapes) {
    const inside = px >= el.x - SNAP_PX && px <= el.x + el.width + SNAP_PX && py >= el.y - SNAP_PX && py <= el.y + el.height + SNAP_PX;
    if (!inside) continue;
    const dist = Math.hypot(px - (el.x + el.width / 2), py - (el.y + el.height / 2));
    if (dist < bestDist) { best = el; bestDist = dist; }
  }
  return best;
}

// Where an arrow starts and ends: the shape it's attached to, or failing that
// the shape its end is drawn on or next to.
function arrowEnds(el: any, byId: Map<string, any>, shapes: any[]) {
  const pts = Array.isArray(el.points) && el.points.length ? el.points : [[0, 0]];
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const from = byId.get(el.startBinding?.elementId) || shapeAt(shapes, el.x + sx, el.y + sy);
  const to = byId.get(el.endBinding?.elementId) || shapeAt(shapes, el.x + ex, el.y + ey);
  return { from, to };
}

export function boardOutline(elements: readonly any[]): string {
  const live = elements.filter(el => !el.isDeleted);
  const byId = new Map(live.map(el => [el.id, el]));

  // Text inside a shape or on an arrow is that element's label.
  const labels = new Map<string, string>();
  for (const el of live) {
    if (el.type === 'text' && el.containerId && el.text) labels.set(el.containerId, oneLine(el.text));
  }

  // Reading order: top to bottom, then left to right.
  const ordered = [...live].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const refs = new Map<string, string>();
  const lines: string[] = [];

  const shapes = ordered.filter(el => SHAPES.has(el.type));
  // Shapes are named by their label. Only unlabelled ones get a number, so the
  // AI talks about "Searched for opportunities", not "S2".
  let unlabelled = 0;
  const nameOf = (el: any) => {
    if (!refs.has(el.id)) {
      const label = labels.get(el.id) || (el.type.endsWith('frame') ? el.name : '') || (el.type === 'text' ? oneLine(el.text || '') : '');
      refs.set(el.id, label ? `"${label}"` : `unlabelled ${SHAPE_NAMES[el.type] || el.type} #${++unlabelled}`);
    }
    return refs.get(el.id)!;
  };
  if (shapes.length) {
    lines.push('Shapes (top to bottom):');
    for (const el of shapes) {
      const filled = el.backgroundColor && el.backgroundColor !== 'transparent' ? ', filled like a sticky note' : '';
      lines.push(`- ${nameOf(el)} (${SHAPE_NAMES[el.type] || el.type}${filled})`);
    }
  }

  const connectors = ordered.filter(el => el.type === 'arrow' || el.type === 'line');
  const joined: string[] = [];
  let loose = 0;
  for (const el of connectors) {
    const { from, to } = arrowEnds(el, byId, shapes);
    if (!from && !to) { loose++; continue; }
    const label = labels.get(el.id);
    const arrow = el.type === 'line' ? '—' : '→';
    joined.push(`- ${from ? nameOf(from) : '(empty space)'} ${arrow} ${to ? nameOf(to) : '(empty space)'}${label ? ` [labelled "${label}"]` : ''}`);
  }
  if (joined.length) lines.push('', 'Arrows:', ...joined);

  // Spelled out so a small model doesn't claim a link is missing when it isn't.
  if (shapes.length > 1) {
    const linked = new Set<string>();
    for (const el of connectors) {
      const { from, to } = arrowEnds(el, byId, shapes);
      if (from) linked.add(from.id);
      if (to) linked.add(to.id);
    }
    const alone = shapes.filter(el => !linked.has(el.id));
    lines.push('', alone.length
      ? `Shapes with no arrow to or from them: ${alone.map(nameOf).join(', ')}.`
      : 'Every shape has at least one arrow to or from it.');
  }

  const notes = ordered.filter(el => el.type === 'text' && !el.containerId && oneLine(el.text || ''));
  if (notes.length) {
    lines.push('', 'Free text on the board:');
    for (const el of notes) {
      const isTitle = el === ordered.find(o => !(o.type === 'text' && o.containerId)) && shapes.length > 0;
      lines.push(`- "${oneLine(el.text)}"${isTitle ? ' (at the top, probably the title)' : ''}`);
    }
  }

  const extras: string[] = [];
  if (loose) extras.push(`${loose} arrow${loose > 1 ? 's' : ''} or line${loose > 1 ? 's' : ''} not attached to anything`);
  const freehand = live.filter(el => el.type === 'freedraw').length;
  if (freehand) extras.push(`${freehand} freehand stroke${freehand > 1 ? 's' : ''} (see the image)`);
  if (extras.length) lines.push('', `Also: ${extras.join('; ')}.`);

  return lines.length ? lines.join('\n') : '(The board is empty.)';
}
