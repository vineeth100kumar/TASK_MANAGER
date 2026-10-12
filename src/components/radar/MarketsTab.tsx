// Markets: every sector and industry at a glance, and why it moved.
// Prices and reasons come from the Pi (raspberry_pi/markets.py); this file only draws them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Gauge, LayoutGrid, Lightbulb, ListOrdered, Sparkles, TrendingDown, TrendingUp, HelpCircle } from 'lucide-react';
import {
  MarketBoard, MarketPart, MarketRange, MarketReason, MarketRegion, MarketSector, RADAR_EVENT, RadarQuote,
  formatQuote, marketsApi, signedPct, timeAgo,
} from '../../services/radar';
import { Idea } from '../../services/types';
import { Panel, ScoreRing } from './parts';

const REGION_KEY = 'sage-markets-region';
const RANGE_KEY = 'sage-markets-range';
const SPAN: Record<MarketRange, string> = { '1D': 'today', '1W': 'this week', '1M': 'this month', YTD: 'this year' };
// The move that paints a box fully green or red, per range.
const FULL: Record<MarketRange, number> = { '1D': 2, '1W': 4, '1M': 8, YTD: 25 };

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
}

const tone = (n: number | null) => n === null ? 'text-gray-400' : n > 0 ? 'text-emerald-600 dark:text-emerald-400' : n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500';
const arrow = (n: number | null) => n === null ? '' : n > 0 ? '▲' : n < 0 ? '▼' : '■';

// Green or red over the card's own surface, stronger with the size of the move.
function heat(n: number | null, range: MarketRange) {
  if (n === null) return { background: 'rgb(156 163 175 / 0.15)', strong: false };
  const t = Math.min(1, Math.abs(n) / FULL[range]);
  const alpha = 0.14 + 0.76 * Math.pow(t, 0.85);
  return { background: n >= 0 ? `rgb(16 163 110 / ${alpha})` : `rgb(214 59 59 / ${alpha})`, strong: alpha > 0.5 };
}

function Spark({ values, up, width = 64, height = 18 }: { values: number[]; up: boolean; width?: number; height?: number }) {
  if (values.length < 2) return <span style={{ width }} />;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (i: number) => 1 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden className={`shrink-0 ${up ? 'text-emerald-500' : 'text-red-500'}`}>
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r="2" fill="currentColor" />
    </svg>
  );
}

// A bar from the centre line: right for up, left for down.
function CentreBar({ value, max }: { value: number | null; max: number }) {
  const pct = value === null ? 0 : Math.min(50, (Math.abs(value) / (max || 1)) * 50);
  return (
    <div className="relative h-2 flex-1 min-w-[40px]" aria-hidden>
      <div className="absolute left-1/2 -top-1 -bottom-1 w-px bg-gray-300 dark:bg-white/20" />
      {value !== null && <div className={`absolute top-0 h-full rounded-full ${value >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={value >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }} />}
    </div>
  );
}

// --- Treemap (squarified) ---

interface Box { sector: MarketSector; x: number; y: number; w: number; h: number }

function squarify(items: MarketSector[], W: number, H: number): Box[] {
  const total = items.reduce((a, s) => a + s.weight, 0) || 1;
  let rest = items.map(s => ({ s, a: (s.weight / total) * W * H }));
  let x = 0, y = 0, w = W, h = H;
  const out: Box[] = [];
  const worst = (row: { a: number }[], side: number) => {
    const sum = row.reduce((a, r) => a + r.a, 0);
    const mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a));
    return Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    let row = [rest[0]];
    let best = worst(row, side);
    for (let k = 1; k < rest.length; k++) {
      const next = worst([...row, rest[k]], side);
      if (next > best) break;
      row = [...row, rest[k]];
      best = next;
    }
    const sum = row.reduce((a, r) => a + r.a, 0);
    if (w >= h) {
      const cw = sum / h;
      let cy = y;
      for (const r of row) { const ch = r.a / cw; out.push({ sector: r.s, x, y: cy, w: cw, h: ch }); cy += ch; }
      x += cw; w -= cw;
    } else {
      const ch = sum / w;
      let cx = x;
      for (const r of row) { const cw = r.a / ch; out.push({ sector: r.s, x: cx, y, w: cw, h: ch }); cx += cw; }
      y += ch; h -= ch;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

function HeatMap({ board, selected, onSelect }: { board: MarketBoard; selected: string; onSelect: (name: string) => void }) {
  const W = 100, H = 72;
  const boxes = useMemo(() => squarify([...board.sectors].sort((a, b) => b.weight - a.weight), W, H), [board.sectors]);
  return (
    <div className="relative w-full rounded-2xl overflow-hidden" style={{ aspectRatio: `${W} / ${H}` }} role="group" aria-label="Heat map: box size is share of the market, colour is the move">
      {boxes.map(({ sector: s, x, y, w, h }) => {
        const { background, strong } = heat(s.change, board.range);
        const small = w < 15 || h < 13;
        return (
          <button key={s.name} onClick={() => onSelect(s.name)} aria-pressed={selected === s.name}
            title={`${s.name} (${s.symbol}) ${signedPct(s.change)} ${board.range} · ${s.weight}% of the market`}
            className={`absolute p-0.5 text-left focus:outline-none group`}
            style={{ left: `${x}%`, top: `${(y / H) * 100}%`, width: `${w}%`, height: `${(h / H) * 100}%` }}>
            <span className={`flex h-full w-full flex-col justify-between overflow-hidden rounded-xl ${small ? 'p-1.5' : 'p-2.5'} transition-[filter] group-hover:brightness-[1.06] group-focus-visible:ring-2 ring-gray-900 dark:ring-white ${selected === s.name ? 'ring-2' : ''} ${strong ? 'text-white' : 'text-gray-900 dark:text-white'}`}
              style={{ background }}>
              <span className="min-w-0">
                <span className={`block truncate font-semibold ${small ? 'text-[10.5px]' : 'text-[13px]'}`}>{s.name}</span>
                {!small && <span className="block text-[10px] font-medium opacity-75 tabular-nums">{s.symbol}</span>}
              </span>
              <span className={`font-bold tabular-nums whitespace-nowrap ${small ? 'text-[11px]' : 'text-[15px]'}`}>{!small && arrow(s.change)} {signedPct(s.change)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RankedList({ board, selected, onSelect }: { board: MarketBoard; selected: string; onSelect: (name: string) => void }) {
  const rows = [...board.sectors].sort((a, b) => (b.change ?? -1e9) - (a.change ?? -1e9));
  const max = Math.max(FULL[board.range] / 2, ...rows.map(r => Math.abs(r.change ?? 0)));
  return (
    <div className="divide-y divide-black/5 dark:divide-white/5">
      {rows.map(s => (
        <button key={s.name} onClick={() => onSelect(s.name)} aria-pressed={selected === s.name}
          className={`w-full flex items-center gap-3 py-2.5 px-1 text-left ${selected === s.name ? 'bg-black/[0.03] dark:bg-white/[0.04]' : ''}`}>
          <span className="w-28 shrink-0 truncate text-[13px] font-semibold text-gray-800 dark:text-gray-200">{s.name}</span>
          <CentreBar value={s.change} max={max} />
          <span className={`w-16 text-right text-[12.5px] font-semibold tabular-nums ${tone(s.change)}`}>{signedPct(s.change)}</span>
        </button>
      ))}
    </div>
  );
}

const CONF_TONE: Record<MarketReason['confidence'], string> = {
  High: 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300',
  Medium: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
  Low: 'text-gray-500 bg-gray-500/10',
};

function Reasons({ reasons }: { reasons: MarketReason[] }) {
  if (!reasons.length) return <p className="text-[12.5px] text-gray-400">A small move, so nothing to explain.</p>;
  return (
    <ol className="space-y-3">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{r.title}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${CONF_TONE[r.confidence]}`}>{r.confidence}</span>
            </div>
            <p className="text-[12.5px] text-gray-600 dark:text-gray-300">{r.text}</p>
            {r.evidence.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {r.evidence.map((e, k) => e.link ? (
                  <a key={k} href={e.link} target="_blank" rel="noopener noreferrer" className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md text-blue-600 bg-blue-500/10 dark:text-blue-300 hover:underline">
                    {e.label}{e.published ? ` · ${timeAgo(e.published)}` : ''} <ArrowUpRight size={10} className="inline -mt-0.5" />
                  </a>
                ) : (
                  <span key={k} className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md text-gray-500 bg-gray-500/10 tabular-nums">{e.label}</span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Parts({ parts }: { parts: MarketPart[] }) {
  if (!parts.length) return <p className="text-[12px] text-gray-400">Radar needs about three months of prices to split this move.</p>;
  const max = Math.max(0.3, ...parts.map(p => Math.abs(p.value)));
  return (
    <div className="space-y-1.5">
      {parts.map(p => (
        <div key={p.key} className="flex items-center gap-3 text-[12px]" title={p.beta !== undefined ? `Usually moves ${p.beta.toFixed(2)}× with it` : 'What the market, oil, rates and the dollar do not explain'}>
          <span className={`w-28 shrink-0 ${p.key === 'left' ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
            {p.name}{p.beta !== undefined ? <span className="text-gray-400 tabular-nums"> · {p.beta.toFixed(2)}×</span> : null}
          </span>
          <CentreBar value={p.value} max={max} />
          <span className={`w-12 text-right font-semibold tabular-nums ${tone(p.value)}`}>{p.value > 0 ? '+' : p.value < 0 ? '−' : ''}{Math.abs(p.value).toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function SectorPanel({ board, sector, ideas, onOpenIdea, onResearch }: { board: MarketBoard; sector: MarketSector; ideas: Idea[]; onOpenIdea: (id: string) => void; onResearch: (theme: string) => void }) {
  const max = Math.max(FULL[board.range] / 2, ...sector.industries.map(i => Math.abs(i.change ?? 0)));
  const words = [sector.tag, sector.name, ...sector.industries.map(i => i.name)].filter(Boolean).map(w => w.toLowerCase());
  const mine = ideas.filter(i => i.tags.some(t => words.includes(t.toLowerCase())) || words.some(w => w.length > 3 && `${i.name} ${i.oneLiner}`.toLowerCase().includes(w))).slice(0, 3);
  return (
    <Panel className="lg:col-span-5" icon={<Activity size={18} className="text-purple-500" />} title={sector.name}
      note={<span className="tabular-nums">{sector.symbol}</span>}
      right={<span className={`text-[16px] font-bold tabular-nums ${tone(sector.change)}`}>{arrow(sector.change)} {signedPct(sector.change)}</span>}>
      {sector.industries.length > 0 && (
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {[...sector.industries].sort((a, b) => (b.change ?? -1e9) - (a.change ?? -1e9)).map(i => (
            <div key={i.symbol} className="flex items-center gap-3 py-2">
              <div className="w-28 shrink-0 min-w-0">
                <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200 truncate">{i.name}</div>
                <div className="text-[10px] font-medium text-gray-400 tabular-nums">{i.symbol}</div>
              </div>
              <Spark values={i.closes} up={(i.change ?? 0) >= 0} width={56} />
              <CentreBar value={i.change} max={max} />
              <span className={`w-14 text-right text-[12px] font-semibold tabular-nums ${tone(i.change)}`}>{signedPct(i.change)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="pt-1 space-y-2">
        <h4 className="text-[12.5px] font-semibold text-gray-900 dark:text-white flex items-center gap-1.5"><HelpCircle size={14} className="text-purple-500" /> Why it moved <span className="font-medium text-gray-400">· likely, not proof</span></h4>
        <Parts parts={sector.why.parts} />
        <Reasons reasons={sector.why.reasons} />
      </div>
      <div className="pt-1 space-y-2">
        <h4 className="text-[12.5px] font-semibold text-gray-900 dark:text-white flex items-center gap-1.5"><Lightbulb size={14} className="text-emerald-500" /> Your ideas here</h4>
        {mine.length === 0 ? <p className="text-[12px] text-gray-400">None of your Radar ideas sit in {sector.name.toLowerCase()} yet.</p> : mine.map(i => (
          <button key={i.id} onClick={() => onOpenIdea(i.id)} className="w-full text-left p-2.5 rounded-2xl surface-item is-interactive flex items-center gap-3">
            <ScoreRing score={i.score} size={36} />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">{i.name}</p>
              <p className="text-[11.5px] text-gray-500 truncate">{i.oneLiner}</p>
            </div>
          </button>
        ))}
      </div>
      <button onClick={() => onResearch(`${sector.name} ${SPAN[board.range]}: what is moving it and where the openings are`)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-purple-600 dark:text-purple-300 bg-purple-500/10 hover:bg-purple-500/15 active:scale-95 transition-transform">
        <Sparkles size={13} /> Research {sector.name.toLowerCase()} in Studio
      </button>
    </Panel>
  );
}

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex p-1 rounded-xl bg-black/[0.04] dark:bg-white/5" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)} aria-pressed={value === o}
          className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors ${value === o ? 'bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

interface MarketsTabProps {
  ideas: Idea[];
  onOpenIdea: (id: string) => void;
  onResearch: (theme: string) => void;
}

export function MarketsTab({ ideas, onOpenIdea, onResearch }: MarketsTabProps) {
  const [region, setRegionState] = useState<MarketRegion>(() => stored(REGION_KEY, ['US', 'India', 'Global'] as const, 'US'));
  const [range, setRangeState] = useState<MarketRange>(() => stored(RANGE_KEY, ['1D', '1W', '1M', 'YTD'] as const, '1D'));
  const [board, setBoard] = useState<MarketBoard | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [view, setView] = useState<'map' | 'list'>('map');

  const setRegion = (r: MarketRegion) => { setRegionState(r); setSelected(''); try { localStorage.setItem(REGION_KEY, r); } catch { /* storage unavailable */ } };
  const setRange = (r: MarketRange) => { setRangeState(r); try { localStorage.setItem(RANGE_KEY, r); } catch { /* storage unavailable */ } };

  const load = useCallback(async () => {
    try {
      const b = await marketsApi.board(region, range);
      setBoard(b);
      setError('');
      if (b.region !== region) setRegionState(b.region);
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [region, range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onRadar = (e: Event) => { if ((e as CustomEvent).detail?.type === 'RADAR_MARKETS') load(); };
    window.addEventListener(RADAR_EVENT, onRadar);
    const timer = setInterval(load, 5 * 60000);
    return () => { window.removeEventListener(RADAR_EVENT, onRadar); clearInterval(timer); };
  }, [load]);

  if (error && !board) return <p className="text-[13px] text-gray-400 text-center py-16">Can't load markets right now ({error}).</p>;
  if (!board) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="skeleton h-24" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6"><div className="lg:col-span-7 skeleton h-96" /><div className="lg:col-span-5 skeleton h-96" /></div>
      </div>
    );
  }

  const sector = board.sectors.find(s => s.name === selected) || [...board.sectors].filter(s => s.change !== null).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))[0] || board.sectors[0];
  const pointsMax = Math.max(0.05, ...board.why.points.map(p => Math.abs(p.value)));
  const marketName = board.gauges[0]?.name || 'the market';

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 space-y-1">
          <p className="text-[15px] font-semibold text-gray-900 dark:text-white">{board.headline}</p>
          <p className="text-[12px] text-gray-400">
            {board.updatedAt ? `Prices ${timeAgo(board.updatedAt)} ago` : 'No prices yet'} · {board.open ? 'market open' : 'market closed'} · reasons by {board.writer === 'rules' ? 'Radar\'s rules' : board.writer}{board.writing ? ', AI rewriting them now' : ''}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Toggle label="Region" value={board.region} options={board.regions} onChange={setRegion} />
          <Toggle label="Time range" value={range} options={board.ranges} onChange={setRange} />
        </div>
      </div>

      {/* A swipeable row on phones, a grid from tablets up. */}
      <div className="flex overflow-x-auto no-scrollbar -mx-1 px-1 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4 xl:grid-cols-8 gap-2">
        {board.gauges.map(g => (
          <div key={g.symbol} className="surface-item rounded-2xl px-3 py-2.5 min-w-0 shrink-0 w-[136px] sm:w-auto" title={`${g.symbol} · last 30 trading days`}>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 truncate">{g.name}</div>
            <div className="text-[15px] font-semibold tabular-nums text-gray-900 dark:text-white">{g.price === null ? '–' : formatQuote({ ...g, price: g.price } as unknown as RadarQuote)}</div>
            <div className={`text-[11.5px] font-semibold tabular-nums ${tone(g.change)}`}>{arrow(g.change)} {signedPct(g.change)}</div>
            <div className="mt-1"><Spark values={g.closes} up={(g.change ?? 0) >= 0} width={120} height={16} /></div>
          </div>
        ))}
      </div>

      <Panel icon={<HelpCircle size={18} className="text-purple-500" />} title={`Why ${marketName} moved ${SPAN[board.range]}`}
        note="likely reasons, not proof"
        right={<span className={`text-[14px] font-bold tabular-nums ${tone(board.why.change)}`}>{marketName} {signedPct(board.why.change)}</span>}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7"><Reasons reasons={board.why.reasons} /></div>
          {board.why.points.length > 0 && (
            <div className="lg:col-span-5 space-y-1.5">
              <p className="text-[11.5px] font-semibold text-gray-500">Who added the points <span className="font-medium text-gray-400">· weight × move</span></p>
              {board.why.points.map(p => (
                <div key={p.name} className="flex items-center gap-3 text-[12px]">
                  <span className="w-28 shrink-0 truncate text-gray-700 dark:text-gray-300">{p.name}</span>
                  <CentreBar value={p.value} max={pointsMax} />
                  <span className={`w-12 text-right font-semibold tabular-nums ${tone(p.value)}`}>{p.value > 0 ? '+' : p.value < 0 ? '−' : ''}{Math.abs(p.value).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 items-start">
        <Panel className="lg:col-span-7" icon={<LayoutGrid size={18} className="text-blue-500" />}
          title={board.region === 'Global' ? 'Markets by country' : 'Sectors'}
          note={view === 'map' ? 'box size = share of the market' : `ranked ${SPAN[board.range]}`}
          right={
            <div className="flex items-center gap-2">
              <span className="hidden md:flex items-center gap-1.5 text-[10.5px] text-gray-400 tabular-nums" aria-hidden>
                −{FULL[board.range]}%<span className="w-16 h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, rgb(214 59 59), rgb(156 163 175 / 0.3), rgb(16 163 110))' }} />+{FULL[board.range]}%
              </span>
              <div className="hidden md:flex p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/5">
                <button onClick={() => setView('map')} aria-pressed={view === 'map'} aria-label="Heat map" className={`p-1 rounded-md ${view === 'map' ? 'bg-white dark:bg-[#2c2c2e] shadow-sm' : 'text-gray-400'}`}><LayoutGrid size={14} /></button>
                <button onClick={() => setView('list')} aria-pressed={view === 'list'} aria-label="Ranked list" className={`p-1 rounded-md ${view === 'list' ? 'bg-white dark:bg-[#2c2c2e] shadow-sm' : 'text-gray-400'}`}><ListOrdered size={14} /></button>
              </div>
            </div>
          }>
          {/* Small boxes are hard to tap, so phones always get the ranked list. */}
          <div className="md:hidden"><RankedList board={board} selected={sector?.name || ''} onSelect={setSelected} /></div>
          <div className="hidden md:block">
            {view === 'map' ? <HeatMap board={board} selected={sector?.name || ''} onSelect={setSelected} /> : <RankedList board={board} selected={sector?.name || ''} onSelect={setSelected} />}
          </div>
        </Panel>
        {sector && <SectorPanel board={board} sector={sector} ideas={ideas} onOpenIdea={onOpenIdea} onResearch={onResearch} />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <Panel icon={<Gauge size={18} className="text-gray-400" />} title="Breadth" note={`of ${board.breadth.of} ${board.breadth.unit}`}>
          {board.breadth.of === 0 ? <p className="text-[12.5px] text-gray-400">No prices yet.</p> : (
            <>
              <div className="flex h-3 rounded-full overflow-hidden gap-0.5" role="img" aria-label={`${board.breadth.up} up, ${board.breadth.down} down`}>
                <div className="bg-emerald-500" style={{ flex: board.breadth.up || 0.0001 }} />
                <div className="bg-red-500" style={{ flex: board.breadth.down || 0.0001 }} />
              </div>
              <div className="flex justify-between text-[12px] font-semibold tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">▲ {board.breadth.up} up</span>
                <span className="text-red-600 dark:text-red-400">▼ {board.breadth.down} down</span>
              </div>
              <p className="text-[12px] text-gray-400">
                {board.breadth.up / board.breadth.of > 0.6 ? 'Broad move: most of the market joined in.'
                  : board.breadth.up / board.breadth.of < 0.4 ? 'Broad selling: most of the market fell.'
                  : 'Mixed: a few groups are doing the work.'}
              </p>
            </>
          )}
        </Panel>
        {([['Leaders', board.leaders, <TrendingUp key="u" size={18} className="text-emerald-500" />], ['Laggards', board.laggards, <TrendingDown key="d" size={18} className="text-red-500" />]] as const).map(([title, rows, icon]) => (
          <Panel key={title} icon={icon} title={title} note={board.breadth.unit}>
            {rows.length === 0 ? <p className="text-[12.5px] text-gray-400">Not enough prices yet.</p> : (
              <ul className="space-y-1.5">
                {rows.map(r => (
                  <li key={r.symbol} className="flex justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate text-gray-800 dark:text-gray-200">{r.name} <span className="text-[10.5px] text-gray-400">{r.symbol}</span></span>
                    <span className={`font-semibold tabular-nums ${tone(r.change)}`}>{arrow(r.change)} {signedPct(r.change)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>
      <p className="text-[11.5px] text-gray-400">Prices from Yahoo via the Pi, up to 15 minutes late. Industries use a fund (ETF) as their price. Weights are approximate.</p>
    </div>
  );
}
