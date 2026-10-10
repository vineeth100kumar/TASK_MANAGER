import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

/**
 * Line-art figures for the Drafting look, drawn in isometric projection.
 * Colours come from CSS variables (--la-*) so they follow light and dark.
 */

const COS = Math.cos(Math.PI / 6);

/** Isometric projection: plane (x, y) plus height z to screen (X, Y). */
function iso(ox: number, oy: number, k: number) {
  const p = (x: number, y: number, z: number) => [ox + (x - y) * COS * k, oy + ((x + y) / 2 - z) * k] as const;
  const pts = (list: [number, number, number][]) => list.map(q => p(...q).map(n => n.toFixed(1)).join(',')).join(' ');
  /** Transform that maps plane coordinates onto the top face at height z. */
  const top = (x: number, y: number, z: number) => {
    const [X, Y] = p(x, y, z);
    return `matrix(${(COS * k).toFixed(4)},${(k / 2).toFixed(4)},${(-COS * k).toFixed(4)},${(k / 2).toFixed(4)},${X.toFixed(1)},${Y.toFixed(1)})`;
  };
  return { p, pts, top };
}

type Iso = ReturnType<typeof iso>;

function Plate({ v, x, y, z, w, d, t, tone, children }: {
  v: Iso; x: number; y: number; z: number; w: number; d: number; t: number; tone?: 'ink' | 'alert'; children?: ReactNode;
}) {
  return (
    <g className={tone === 'alert' ? 'la-alert' : tone === 'ink' ? 'la-ink' : undefined}>
      <polygon points={v.pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + t], [x, y + d, z + t]])} className="la-side-l" />
      <polygon points={v.pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + t], [x, y + d, z + t]])} fill="url(#la-hatch)" stroke="none" />
      <polygon points={v.pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + t], [x + w, y, z + t]])} className="la-side-r" />
      <polygon points={v.pts([[x, y, z + t], [x + w, y, z + t], [x + w, y + d, z + t], [x, y + d, z + t]])} className="la-top" />
      {children && <g transform={v.top(x, y, z + t)}>{children}</g>}
    </g>
  );
}

const Defs = () => (
  <defs>
    <pattern id="la-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" className="la-hatch" />
    </pattern>
  </defs>
);

export type DayLayer = 'attention' | 'focus' | 'scheduled';

/**
 * Today as an exploded stack: scheduled at the bottom, focus above it and
 * needs-attention on top, each with a labelled leader line. The layers settle
 * into place on load; with onPick each one is a button for its section.
 */
export function ExplodedDay({ attention, focus, scheduled, onPick, className = '' }: {
  attention: number; focus: number; scheduled: number; onPick?: (layer: DayLayer) => void; className?: string;
}) {
  const v = iso(205, 116, 0.34);
  const W = 400, D = 250, T = 14, STEP = 150;
  const layers: { id: DayLayer; n: number; label: string; tone: 'ink' | 'alert' }[] = [
    { id: 'scheduled', n: scheduled, label: 'Scheduled', tone: 'ink' },
    { id: 'focus', n: focus, label: 'In focus', tone: 'ink' },
    { id: 'attention', n: attention, label: 'Needs attention', tone: attention > 0 ? 'alert' : 'ink' },
  ];
  return (
    <svg viewBox="0 0 360 232" className={`line-art exploded-day ${className}`} role="group"
      aria-label={`Today: ${attention} need attention, ${focus} in focus, ${scheduled} scheduled`}>
      <Defs />
      {layers.map((l, i) => i > 0 && (
        <g key={`g${l.id}`} className="la-guides" style={{ animationDelay: `${260 + i * 90}ms` }}>
          {[[0, 0], [W, 0], [W, D], [0, D]].map(([cx, cy]) => {
            const [x1, y1] = v.p(cx, cy, (i - 1) * STEP + T);
            const [x2, y2] = v.p(cx, cy, i * STEP);
            return <line key={`${cx}-${cy}`} x1={x1} y1={y1} x2={x2} y2={y2} className="la-guide" />;
          })}
        </g>
      ))}
      {layers.map((l, i) => {
        const z = i * STEP;
        const [ax, ay] = v.p(0, D, z + T);
        // Focus always has a section on Today; the others only when they hold something.
        const pickable = !!onPick && (l.n > 0 || l.id === 'focus');
        const name = `${l.n} ${l.label.toLowerCase()}`;
        return (
          <g key={l.id} className={`la-layer ${l.tone === 'alert' ? 'la-alert' : 'la-ink'}`} style={{ animationDelay: `${i * 90}ms` }}
            {...(pickable ? {
              role: 'button', tabIndex: 0, 'aria-label': `Show ${name}`, 'data-pickable': '',
              onClick: () => onPick!(l.id),
              onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick!(l.id); } },
            } : { 'aria-label': name })}>
            {pickable && <title>{`Show ${name}`}</title>}
            <Plate v={v} x={0} y={0} z={z} w={W} d={D} t={T}>
              {Array.from({ length: Math.min(l.n, 3) }, (_, r) => (
                <rect key={r} x={22} y={30 + r * 62} width={300 - r * 40} height={38} rx={7} className="la-bar" />
              ))}
            </Plate>
            <circle cx={ax} cy={ay} r={2.4} className="la-dot" />
            <line x1={ax} y1={ay} x2={4} y2={ay} className="la-leader" />
            {/* A wider invisible strip so the label is easy to hit. */}
            <rect x={0} y={ay - 18} width={ax} height={22} fill="transparent" />
            <text x={4} y={ay - 6} className="la-label">{l.n} {l.label.toUpperCase()}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Empty inbox: a tray with sorted cards lifting out of it. */
export function InboxTrayArt({ className = '' }: { className?: string }) {
  const v = iso(76, 102, 0.4);
  return (
    <svg viewBox="0 0 186 212" className={`line-art ${className}`} aria-hidden>
      <Defs />
      <g className="la-ink">
      <Plate v={v} x={0} y={0} z={0} w={300} d={200} t={40} />
      <g><polygon points={v.pts([[20, 20, 40], [280, 20, 40], [280, 180, 40], [20, 180, 40]])} className="la-well" /></g>
      {[0, 1, 2].map(i => {
        const [x1, y1] = v.p(50 + i * 70, 100, 50);
        const [x2, y2] = v.p(50 + i * 70, 100, 210 + i * 30);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="la-guide" />;
      })}
      {[0, 1, 2].map(i => (
        <g key={i} className="la-float" style={{ animationDelay: `${i * 220}ms` }}>
          <Plate v={v} x={20 + i * 70} y={60} z={210 + i * 30} w={60} d={80} t={4}>
            <path d="M16,40 l10,10 l20,-20" className="la-tick" />
          </Plate>
        </g>
      ))}
      </g>
    </svg>
  );
}
