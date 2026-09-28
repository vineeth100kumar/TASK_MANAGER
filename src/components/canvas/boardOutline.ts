// Turns a board's Excalidraw elements into a plain-text outline an AI can read:
// the shapes and their labels, which arrow joins what, loose notes, and how
// much freehand drawing there is (which only the snapshot image shows).

const SHAPES = new Set(['rectangle', 'diamond', 'ellipse', 'frame', 'magicframe', 'embeddable']);
const SHAPE_NAMES: Record<string, string> = {
  rectangle: 'box', diamond: 'decision', ellipse: 'oval', frame: 'frame', magicframe: 'frame', embeddable: 'embed',
};

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

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
  if (shapes.length) {
    lines.push('Shapes:');
    shapes.forEach((el, i) => {
      const ref = `S${i + 1}`;
      refs.set(el.id, ref);
      const label = labels.get(el.id) || (el.type.endsWith('frame') ? el.name : '') || '';
      const filled = el.backgroundColor && el.backgroundColor !== 'transparent' ? ' (filled, like a sticky note)' : '';
      lines.push(`- ${ref} ${SHAPE_NAMES[el.type] || el.type}${filled}: ${label ? `"${label}"` : '(no label)'}`);
    });
  }

  const describe = (id?: string | null) => {
    const el = id ? byId.get(id) : null;
    if (!el) return null;
    const label = labels.get(el.id) || (el.type === 'text' ? oneLine(el.text || '') : '');
    return `${refs.get(el.id) || 'text'}${label ? ` "${label}"` : ''}`;
  };

  const connectors = ordered.filter(el => el.type === 'arrow' || el.type === 'line');
  const joined = connectors.filter(el => el.startBinding || el.endBinding);
  const loose = connectors.length - joined.length;
  if (joined.length) {
    lines.push('', 'Connections:');
    for (const el of joined) {
      const from = describe(el.startBinding?.elementId) || '(nothing)';
      const to = describe(el.endBinding?.elementId) || '(nothing)';
      const label = labels.get(el.id);
      const arrow = el.type === 'line' ? '—' : '→';
      lines.push(`- ${from} ${arrow} ${to}${label ? ` [labelled "${label}"]` : ''}`);
    }
  }

  const notes = ordered.filter(el => el.type === 'text' && !el.containerId && oneLine(el.text || ''));
  if (notes.length) {
    lines.push('', 'Free text on the board:');
    for (const el of notes) lines.push(`- "${oneLine(el.text)}"`);
  }

  const extras: string[] = [];
  if (loose) extras.push(`${loose} arrow${loose > 1 ? 's' : ''} or line${loose > 1 ? 's' : ''} not attached to anything`);
  const freehand = live.filter(el => el.type === 'freedraw').length;
  if (freehand) extras.push(`${freehand} freehand stroke${freehand > 1 ? 's' : ''} (see the image)`);
  if (extras.length) lines.push('', `Also: ${extras.join('; ')}.`);

  return lines.length ? lines.join('\n') : '(The board is empty.)';
}
