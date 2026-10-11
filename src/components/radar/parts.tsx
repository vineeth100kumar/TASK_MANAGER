// Small pieces the Radar tabs share: topic tags, sparklines, score rings, the
// moat chart and the list of sources with their health.
import { ReactNode } from 'react';
import { RadarQuote, RadarSummary, formatQuote, timeAgo } from '../../services/radar';

const TAG_COLOR: Record<string, string> = {
  AI: 'text-blue-600 bg-blue-500/10 dark:text-blue-300',
  Regulation: 'text-purple-600 bg-purple-500/10 dark:text-purple-300',
  Fintech: 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-300',
  'Supply chain': 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
  Climate: 'text-teal-600 bg-teal-500/10 dark:text-teal-300',
  Defense: 'text-slate-600 bg-slate-500/10 dark:text-slate-300',
  Health: 'text-rose-600 bg-rose-500/10 dark:text-rose-300',
};

export function Tag({ tag, active, onClick }: { tag: string; active?: boolean; onClick?: () => void }) {
  const tone = TAG_COLOR[tag] || 'text-gray-500 bg-gray-500/10';
  const cls = `text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${tone} ${active ? 'ring-1 ring-current' : ''}`;
  return onClick
    ? <button onClick={onClick} aria-pressed={active} className={`${cls} hover:opacity-80`}>#{tag}</button>
    : <span className={cls}>#{tag}</span>;
}

export function Panel({ icon, title, note, right, children, className = '' }: { icon?: ReactNode; title: string; note?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {icon}
          <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">{title}</h3>
          {note && <span className="text-[12px] font-medium text-gray-400">{note}</span>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 44},${15 - ((v - lo) / span) * 13}`).join(' ');
  return (
    <svg width="44" height="16" aria-hidden className={up ? 'text-emerald-500' : 'text-red-500'}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Ticker({ quotes }: { quotes: RadarQuote[] }) {
  if (!quotes.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
      {quotes.map(q => {
        const up = (q.changePct ?? 0) >= 0;
        return (
          <div key={q.symbol} className="surface-item rounded-2xl px-3 py-2 flex items-center gap-3 shrink-0" title={`7-day closes · updated ${timeAgo(q.updatedAt)} ago`}>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">{q.name}</div>
              <div className="text-[14px] font-semibold tabular-nums text-gray-900 dark:text-white">
                {formatQuote(q)}{' '}
                {q.changePct !== null && (
                  <span className={`text-[11.5px] ${up ? 'text-emerald-600' : 'text-red-500'}`}>{up ? '+' : ''}{q.changePct.toFixed(2)}%</span>
                )}
              </div>
            </div>
            <Spark values={q.closes} up={up} />
          </div>
        );
      })}
    </div>
  );
}

export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  const tone = score >= 75 ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : 'text-gray-400';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-200 dark:text-white/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className={tone} strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-gray-900 dark:text-white ${size > 60 ? 'text-[22px]' : 'text-[13px]'}`}>{score}</span>
    </div>
  );
}

const MOAT_LABELS: [keyof MoatValues, string][] = [['network', 'Network'], ['switching', 'Switching'], ['data', 'Data'], ['cost', 'Cost'], ['regulatory', 'Regulatory']];
type MoatValues = { network: number; switching: number; data: number; cost: number; regulatory: number };

export function MoatRadar({ moat }: { moat: MoatValues }) {
  const R = 70, cx = 100, cy = 92;
  const pt = (i: number, r: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const poly = (r: (i: number) => number) => MOAT_LABELS.map((_, i) => pt(i, r(i)).join(',')).join(' ');
  return (
    <svg viewBox="-22 0 244 185" className="w-full max-w-[240px] mx-auto" role="img" aria-label={MOAT_LABELS.map(([k, l]) => `${l} ${moat[k]} of 10`).join(', ')}>
      {[0.33, 0.66, 1].map(k => <polygon key={k} points={poly(() => R * k)} fill="none" stroke="currentColor" className="text-gray-200 dark:text-white/10" />)}
      <polygon points={poly(i => (moat[MOAT_LABELS[i][0]] / 10) * R)} fill="rgb(59 130 246 / 0.18)" stroke="rgb(59 130 246)" strokeWidth="2" strokeLinejoin="round" />
      {MOAT_LABELS.map(([k, l], i) => { const [x, y] = pt(i, R + 14); return <text key={k} x={x} y={y + 3} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" style={{ fontSize: 9.5, fontWeight: 600 }}>{l} {moat[k]}</text>; })}
    </svg>
  );
}

export function SourceList({ sources }: { sources: RadarSummary['sources'] }) {
  if (!sources.length) return <p className="text-[12.5px] text-gray-400">Nothing checked yet.</p>;
  return (
    <ul className="space-y-1.5">
      {sources.map(s => (
        <li key={s.name} className="flex items-start gap-2 text-[12.5px]">
          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${s.ok ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden />
          <span className="font-semibold text-gray-700 dark:text-gray-300 shrink-0">{s.name}</span>
          <span className="text-gray-400 min-w-0">
            {s.ok
              ? `${s.items} ${s.kind === 'markets' ? 'price' : 'headline'}${s.items === 1 ? '' : 's'} · ${timeAgo(s.checkedAt)} ago`
              : `down: ${s.error || 'no data'}${s.lastOkAt ? ` · last worked ${timeAgo(s.lastOkAt)} ago` : ''}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const eyebrow = 'text-[11px] font-semibold uppercase tracking-wider text-gray-400';
export const chipButton = 'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold surface-item hover:brightness-[0.98] active:scale-[0.98] transition-transform disabled:opacity-60';
export const primaryButton = 'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold bg-gray-900 text-white dark:bg-white dark:text-gray-900 active:scale-[0.98] transition-transform disabled:opacity-60';
