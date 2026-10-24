// An industry brief from Radar's search box (raspberry_pi/industry.py): what
// the industry is, its size and growth, who the big companies are, the news,
// trends, risks, openings and how it fits My edge. Numbers are AI estimates
// from the cited sources.
import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft, LoaderCircle, Check, AlertTriangle, RefreshCw, NotebookPen, FlaskConical, ExternalLink, Building2, TrendingUp,
  ShieldAlert, Lightbulb, Newspaper, LineChart, Layers, UserRound, MapPin, BookOpen, CircleDollarSign,
} from 'lucide-react';
import { IndustryBrief, IndustryPlayer, RADAR_EVENT, billions, industryApi, signedPct, timeAgo } from '../../services/radar';
import { useToast } from '../../context/ToastContext';
import { Panel, chipButton, eyebrow, primaryButton } from './parts';
import { FitBadge } from './LabTab';

const SEVERITY: Record<string, string> = {
  High: 'text-red-600 bg-red-500/10',
  Medium: 'text-amber-700 bg-amber-500/10 dark:text-amber-400',
  Low: 'text-emerald-600 bg-emerald-500/10',
};

const OUTLOOK: Record<string, string> = {
  Booming: 'text-emerald-700 bg-emerald-500/15 dark:text-emerald-300',
  Growing: 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300',
  Steady: 'text-sky-700 bg-sky-500/10 dark:text-sky-300',
  Shrinking: 'text-red-600 bg-red-500/10',
  Hyped: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
};

const SEGMENT_COLORS = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-amber-500', 'bg-sky-400', 'bg-rose-400'];

const ago = (iso: string) => { const t = timeAgo(iso); return t === 'just now' ? t : `${t} ago`; };

// Exchanges Google Finance knows by these names; anything else goes to a search.
const EXCHANGES: Record<string, string> = { NASDAQ: 'NASDAQ', NYSE: 'NYSE', NSE: 'NSE', BSE: 'BOM', LSE: 'LON', TSE: 'TYO', HKEX: 'HKG', XETRA: 'ETR', TSX: 'TSE', ASX: 'ASX', EURONEXT: 'EPA' };

function quoteUrl(p: IndustryPlayer): string {
  const ticker = p.ticker.replace(/\.(NS|BO)$/, '');
  const exchange = EXCHANGES[p.exchange] || (p.ticker.endsWith('.NS') ? 'NSE' : p.ticker.endsWith('.BO') ? 'BOM' : '');
  return exchange ? `https://www.google.com/finance/quote/${encodeURIComponent(ticker)}:${exchange}` : `https://www.google.com/search?q=${encodeURIComponent(`${p.ticker} stock`)}`;
}

function Cite({ n, brief }: { n: number | null | undefined; brief: IndustryBrief }) {
  const source = n ? brief.sources[n - 1] : undefined;
  if (!source) return null;
  return (
    <a href={source.url} target="_blank" rel="noopener noreferrer" title={`${source.title} (${source.site})`}
      className="text-[10.5px] font-semibold text-blue-600 dark:text-blue-400 hover:underline align-super ml-0.5">[{n}]</a>
  );
}

function Stat({ label, value, note, cite }: { label: string; value: string; note?: string; cite?: React.ReactNode }) {
  return (
    <div className="surface-item rounded-2xl p-3 md:p-4 min-w-0">
      <div className={eyebrow}>{label}</div>
      <div className="text-[22px] md:text-[26px] font-semibold tabular-nums tracking-tight text-gray-900 dark:text-white leading-tight mt-1">{value}{cite}</div>
      {note && <div className="text-[11.5px] text-gray-400 mt-0.5 truncate" title={note}>{note}</div>}
    </div>
  );
}

// Size today and the forecast, with the years between filled in from the growth rate.
function GrowthBars({ market }: { market: NonNullable<IndustryBrief['market']> }) {
  const { sizeUsdB, year, cagrPct, forecastUsdB, forecastYear } = market;
  if (!sizeUsdB || !year) return null;
  const end = forecastYear && forecastUsdB ? forecastYear : cagrPct !== null ? year + 5 : year;
  const rate = cagrPct !== null ? cagrPct / 100 : forecastUsdB && forecastYear ? Math.pow(forecastUsdB / sizeUsdB, 1 / (forecastYear - year)) - 1 : 0;
  const years: { year: number; value: number; given: boolean }[] = [];
  for (let y = year; y <= Math.min(end, year + 10); y++) {
    const given = y === year || (y === forecastYear && !!forecastUsdB);
    const value = y === forecastYear && forecastUsdB ? forecastUsdB : sizeUsdB * Math.pow(1 + rate, y - year);
    years.push({ year: y, value, given });
  }
  if (years.length < 2) return null;
  const max = Math.max(...years.map(y => y.value));
  return (
    <div className="space-y-1.5" role="img" aria-label={`Market ${billions(sizeUsdB)} in ${year}${forecastUsdB ? `, ${billions(forecastUsdB)} by ${forecastYear}` : ''}`}>
      <div className="flex items-end gap-1 md:gap-1.5 h-32">
        {years.map(y => (
          <div key={y.year} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
            {y.given && <span className="text-[10.5px] font-semibold tabular-nums text-gray-700 dark:text-gray-200 mb-0.5 whitespace-nowrap">{billions(y.value)}</span>}
            <div className={`w-full rounded-t-md ${y.given ? 'bg-blue-500' : 'bg-blue-500/35'}`} style={{ height: `${Math.max(4, (y.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 md:gap-1.5">
        {years.map(y => <span key={y.year} className="flex-1 text-center text-[10px] tabular-nums text-gray-400 min-w-0">{String(y.year).slice(2).padStart(2, '0')}</span>)}
      </div>
      <p className="text-[11px] text-gray-400">Solid bars are the cited figures; pale ones follow the growth rate. AI estimates.</p>
    </div>
  );
}

function Segments({ segments }: { segments: NonNullable<IndustryBrief['segments']> }) {
  if (!segments.length) return null;
  return (
    <div className="space-y-2.5">
      <div className="flex h-3.5 rounded-full overflow-hidden bg-black/[0.04] dark:bg-white/5">
        {segments.map((s, i) => <div key={s.name} className={SEGMENT_COLORS[i % SEGMENT_COLORS.length]} style={{ width: `${s.sharePct}%` }} title={`${s.name} ${s.sharePct}%`} />)}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {segments.map((s, i) => (
          <li key={s.name} className="flex items-center gap-1.5 text-[12.5px] min-w-0">
            <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`} aria-hidden />
            <span className="truncate text-gray-700 dark:text-gray-200">{s.name}</span>
            <span className="ml-auto tabular-nums text-gray-400">{Math.round(s.sharePct)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniLine({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${30 - ((v - lo) / span) * 26}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox="0 0 120 32" className={`w-full h-10 ${up ? 'text-emerald-500' : 'text-red-500'}`} aria-hidden preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Progress({ brief }: { brief: IndustryBrief }) {
  return (
    <div className="surface p-5 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-3" aria-live="polite">
      <div className="flex items-center gap-2">
        <LoaderCircle size={18} className="animate-spin text-purple-500" />
        <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Writing the brief</h3>
        <span className="text-[12px] text-gray-400">about a minute</span>
      </div>
      <ol className="space-y-2">
        {brief.steps.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2.5 text-[13px]">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold ${s.status === 'done' ? 'bg-emerald-500 text-white' : s.status === 'run' ? 'bg-purple-500 text-white' : s.status === 'failed' ? 'bg-red-500 text-white' : 'bg-black/[0.06] dark:bg-white/10 text-gray-500'}`}>
              {s.status === 'done' ? <Check size={13} /> : s.status === 'run' ? <LoaderCircle size={13} className="animate-spin" /> : i + 1}
            </span>
            <span className="font-semibold text-gray-800 dark:text-gray-100">{s.name}</span>
            {s.detail && <span className="text-gray-400 truncate">{s.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface IndustryPageProps {
  briefId: string;
  onBack: () => void;
  onResearch: (theme: string) => void;
  onOpenNote: (noteId: string) => void;
  onOpenBrief: (id: string) => void;
}

export function IndustryPage({ briefId, onBack, onResearch, onOpenNote, onOpenBrief }: IndustryPageProps) {
  const { showToast } = useToast();
  const [brief, setBrief] = useState<IndustryBrief | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => industryApi.get(briefId).then(b => { setBrief(b); setError(''); }).catch(e => setError(e.message || "Can't reach the Pi")), [briefId]);
  useEffect(() => { setBrief(null); load(); }, [load]);
  const working = brief?.status === 'queued' || brief?.status === 'running';
  useEffect(() => {
    if (!working) return;
    const onEvent = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.type === 'RADAR_INDUSTRY' && d.id === briefId) load(); };
    window.addEventListener(RADAR_EVENT, onEvent);
    const timer = setInterval(load, 2500); // in case the live link is down
    return () => { window.removeEventListener(RADAR_EVENT, onEvent); clearInterval(timer); };
  }, [working, briefId, load]);

  const saveNote = async () => {
    if (!brief) return;
    setSaving(true);
    try {
      const saved = await industryApi.saveNote(brief.id);
      setBrief(saved);
      showToast(brief.noteId ? 'Note updated' : 'Saved to Notes', 'success', saved.noteId ? { label: 'Open', onAction: () => onOpenNote(saved.noteId!) } : undefined);
    } catch (e: any) {
      showToast(e.message || "Couldn't save it", 'error');
    } finally {
      setSaving(false);
    }
  };

  const refresh = async () => {
    if (!brief) return;
    setRefreshing(true);
    try {
      const fresh = await industryApi.search(brief.query, true);
      onOpenBrief(fresh.id);
    } catch (e: any) {
      showToast(e.message || "Couldn't start a new brief", 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const back = (
    <button onClick={onBack} className="flex items-center gap-1 shrink-0 uppercase hover:text-gray-900 dark:hover:text-white"><ChevronLeft size={14} /> Radar</button>
  );

  if (!brief) {
    return error
      ? <div className="space-y-3"><div className="eyebrow text-gray-500">{back}</div><p className="text-[13px] text-red-500 text-center py-10">{error}</p></div>
      : <div className="space-y-4" aria-busy="true"><div className="skeleton h-40" /><div className="skeleton h-72" /></div>;
  }

  const m = brief.market;
  const name = brief.name || brief.query;
  const hasBody = !!brief.whatItIs;
  const players = brief.players || [];
  const listed = players.filter(p => p.ticker).length;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl">
        <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2 min-w-0">
          {back}
          <span className="truncate">· industry brief{brief.finishedAt ? `, ${ago(brief.finishedAt)}` : ''}{brief.engine ? ` · ${brief.engine}` : ''}</span>
        </div>
        <h1 className="text-display text-[28px] md:text-[40px] font-semibold leading-[1.05]">{name}</h1>
        {brief.oneLiner && <p className="text-[14.5px] text-gray-500 dark:text-gray-400 mt-1.5">{brief.oneLiner}</p>}
        <div className="flex gap-1.5 mt-3 flex-wrap items-center">
          {brief.outlook?.stance && (
            <span title={brief.outlook.text} className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${OUTLOOK[brief.outlook.stance] || ''}`}>
              <TrendingUp size={11} className="inline -mt-0.5 mr-1" />{brief.outlook.stance}
            </span>
          )}
          {brief.outlook?.text && <span className="text-[12px] text-gray-500 dark:text-gray-400">{brief.outlook.text}</span>}
          {brief.fit && <FitBadge fit={brief.fit.score} why={brief.fit.why} />}
        </div>
        {!working && (
          <div className="flex gap-2 mt-5 flex-wrap">
            {hasBody && (
              <button onClick={() => (brief.noteId && !saving ? onOpenNote(brief.noteId) : saveNote())} disabled={saving} className={primaryButton}>
                {saving ? <LoaderCircle size={14} className="animate-spin" /> : <NotebookPen size={14} />} {brief.noteId ? 'Open note' : 'Save to Notes'}
              </button>
            )}
            <button onClick={() => onResearch(`Startup ideas in ${name}`)} className={chipButton} title="Studio's 5-step research: three scored startup ideas">
              <FlaskConical size={14} className="text-purple-500" /> Find ideas in Studio
            </button>
            <button onClick={refresh} disabled={refreshing} className={`${chipButton} text-gray-500`} title="Search again and write a new brief (uses one of today's)">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        )}
      </div>

      {working && <Progress brief={brief} />}
      {!working && brief.error && (
        <p className="text-[12.5px] font-medium text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{brief.status === 'failed' ? "Couldn't write this brief: " : 'The AI part stopped, so this shows only the news and markets: '}{brief.error}</span>
        </p>
      )}

      {hasBody && m && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
          <Stat label={`Market size${m.year ? ` ${m.year}` : ''}`} value={billions(m.sizeUsdB)} note={m.note || 'AI estimate'} cite={<Cite n={m.source} brief={brief} />} />
          <Stat label="Growth a year" value={m.cagrPct !== null ? `${m.cagrPct > 0 ? '+' : ''}${m.cagrPct.toFixed(m.cagrPct % 1 ? 1 : 0)}%` : '?'} note="compound (CAGR)" />
          <Stat label={`Forecast${m.forecastYear ? ` ${m.forecastYear}` : ''}`} value={billions(m.forecastUsdB)} note={m.forecastUsdB && m.sizeUsdB ? `${(m.forecastUsdB / m.sizeUsdB).toFixed(1)}× today` : undefined} />
          <Stat label="Companies" value={String(players.length)} note={`${listed} listed · ${players.length - listed} private`} />
        </div>
      )}

      {hasBody && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="lg:col-span-7 space-y-4 md:space-y-6">
            <Panel icon={<BookOpen size={18} className="text-blue-500" />} title="What it is">
              <p className="text-[13.5px] text-gray-700 dark:text-gray-200 leading-relaxed">{brief.whatItIs}</p>
              {brief.howMoney && (
                <p className="text-[13px] text-gray-600 dark:text-gray-300 flex gap-2">
                  <CircleDollarSign size={16} className="text-emerald-500 shrink-0 mt-0.5" /><span><span className="font-semibold">How money is made:</span> {brief.howMoney}</span>
                </p>
              )}
              {!!brief.keyNumbers?.length && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {brief.keyNumbers.map(k => (
                    <div key={k.label} className="rounded-xl bg-black/[0.03] dark:bg-white/5 p-2.5 min-w-0">
                      <div className="text-[15px] font-semibold tabular-nums text-gray-900 dark:text-white">{k.value}<Cite n={k.source} brief={brief} /></div>
                      <div className="text-[11px] text-gray-500 leading-snug">{k.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel icon={<Building2 size={18} className="text-purple-500" />} title="Key companies" note={players.length ? `${players.length}, leaders first` : undefined}>
              {players.length === 0 ? <p className="text-[12.5px] text-gray-400">None named.</p> : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-left text-[12.5px]">
                    <thead>
                      <tr className="text-gray-400">
                        <th className={`${eyebrow} font-semibold pb-1.5 px-1`}>Company</th>
                        <th className={`${eyebrow} font-semibold pb-1.5 px-1`}>Ticker</th>
                        <th className={`${eyebrow} font-semibold pb-1.5 px-1`}>What they do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {players.map(p => (
                        <tr key={p.name} className="border-t border-black/5 dark:border-white/5 align-top">
                          <td className="py-2 px-1">
                            <div className="font-semibold text-gray-900 dark:text-white">{p.name}</div>
                            <div className="text-[11px] text-gray-400">{[p.country, p.type !== 'Listed' ? p.type : ''].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="py-2 px-1 whitespace-nowrap">
                            {p.ticker ? (
                              <a href={quoteUrl(p)} target="_blank" rel="noopener noreferrer" className="font-semibold tabular-nums text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5">
                                {p.ticker}<ExternalLink size={10} />
                              </a>
                            ) : <span className="text-gray-300 dark:text-gray-600">–</span>}
                            {p.exchange && <div className="text-[10.5px] text-gray-400">{p.exchange}</div>}
                          </td>
                          <td className="py-2 px-1 text-gray-600 dark:text-gray-300">{p.role}{p.note && <span className="text-gray-400"> {p.note}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {!!brief.valueChain?.length && (
              <Panel icon={<Layers size={18} className="text-sky-500" />} title="Value chain" note="where the gaps are">
                <ol className="space-y-2">
                  {brief.valueChain.map((l, i) => (
                    <li key={l.layer} className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 text-[11px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="min-w-0 text-[12.5px]">
                        <div className="font-semibold text-[13px] text-gray-900 dark:text-white">{l.layer}</div>
                        <div className="text-gray-600 dark:text-gray-300">{l.players}</div>
                        {l.gap && <div className="text-amber-700 dark:text-amber-400"><span className="font-semibold">Gap:</span> {l.gap}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}

            {!!brief.trends?.length && (
              <Panel icon={<TrendingUp size={18} className="text-emerald-500" />} title="Trends">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {brief.trends.map(t => (
                    <div key={t.title} className="rounded-2xl bg-black/[0.03] dark:bg-white/5 p-3">
                      <div className="font-semibold text-[13px] text-gray-900 dark:text-white">{t.title}<Cite n={t.source} brief={brief} /></div>
                      <p className="text-[12.5px] text-gray-600 dark:text-gray-300 mt-0.5">{t.text}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {!!brief.risks?.length && (
              <Panel icon={<ShieldAlert size={18} className="text-red-500" />} title="Risks">
                <ul className="space-y-2">
                  {brief.risks.map(r => (
                    <li key={r.title} className="flex items-start gap-2 text-[12.5px]">
                      <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 mt-px ${SEVERITY[r.severity]}`}>{r.severity}</span>
                      <span className="min-w-0"><span className="font-semibold text-gray-900 dark:text-white">{r.title}.</span> <span className="text-gray-600 dark:text-gray-300">{r.text}</span></span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          <div className="lg:col-span-5 space-y-4 md:space-y-6">
            {m?.sizeUsdB && m.year ? (
              <Panel icon={<LineChart size={18} className="text-blue-500" />} title="Market size" note="US$ a year">
                <GrowthBars market={m} />
              </Panel>
            ) : null}
            {!!brief.segments?.length && (
              <Panel icon={<Layers size={18} className="text-purple-500" />} title="Segments" note="share of the market">
                <Segments segments={brief.segments} />
              </Panel>
            )}
            {brief.fit && (
              <Panel icon={<UserRound size={18} className="text-blue-500" />} title="Fit for you" right={<FitBadge fit={brief.fit.score} />}>
                <p className="text-[13px] text-gray-700 dark:text-gray-200">{brief.fit.why}</p>
                {brief.fit.firstStep && <p className="text-[12.5px] text-gray-500 dark:text-gray-400"><span className="font-semibold text-gray-600 dark:text-gray-300">This week:</span> {brief.fit.firstStep}</p>}
              </Panel>
            )}
            {!!brief.openings?.length && (
              <Panel icon={<Lightbulb size={18} className="text-amber-500" />} title="Openings" note="small businesses to start">
                <ul className="space-y-2.5">
                  {brief.openings.map(o => (
                    <li key={o.idea} className="rounded-2xl bg-black/[0.03] dark:bg-white/5 p-3 space-y-1">
                      <div className="font-semibold text-[13px] text-gray-900 dark:text-white">{o.idea}</div>
                      {o.buyer && <div className="text-[12px] text-gray-500"><span className="font-semibold text-gray-600 dark:text-gray-300">First buyer:</span> {o.buyer}</div>}
                      {o.why && <div className="text-[12px] text-gray-500">{o.why}</div>}
                      <button onClick={() => onResearch(`${o.idea} (${name})`)} className="text-[12px] font-semibold text-purple-600 dark:text-purple-300 hover:underline flex items-center gap-1 pt-0.5">
                        <FlaskConical size={12} /> Research this
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {brief.india && (
              <Panel icon={<MapPin size={18} className="text-orange-500" />} title="In India">
                <p className="text-[13px] text-gray-700 dark:text-gray-200">{brief.india}</p>
              </Panel>
            )}
          </div>
        </div>
      )}

      {!working && (brief.board || brief.news.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className={brief.board ? 'lg:col-span-7' : 'lg:col-span-12'}>
            <Panel icon={<Newspaper size={18} className="text-gray-500" />} title="Latest news" note={`${brief.news.length} from Radar and the web`}>
              {brief.news.length === 0 ? <p className="text-[12.5px] text-gray-400">No news found.</p> : (
                <ul className="divide-y divide-black/5 dark:divide-white/5">
                  {brief.news.slice(0, 10).map(n => (
                    <li key={n.url} className="py-2 first:pt-0">
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-gray-900 dark:text-white hover:underline">{n.title}</a>
                      <div className="text-[11.5px] text-gray-400 flex items-center gap-1.5">
                        {n.kind === 'radar' && <span className="text-[10px] font-semibold px-1 rounded bg-purple-500/10 text-purple-600 dark:text-purple-300">Radar</span>}
                        <span>{n.source}</span>{n.published && <span>· {ago(n.published)}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          {brief.board && (
            <div className="lg:col-span-5">
              <Panel icon={<LineChart size={18} className="text-emerald-500" />} title="On the Markets board" note={`${brief.board.region} · ${brief.board.symbol}`}>
                <div className="text-[13px] font-semibold text-gray-900 dark:text-white">
                  {brief.board.name}{brief.board.name !== brief.board.sector && <span className="font-normal text-gray-400"> in {brief.board.sector}</span>}
                </div>
                <MiniLine values={brief.board.closes} />
                <div className="grid grid-cols-3 gap-2">
                  {(['1D', '1M', 'YTD'] as const).map(r => {
                    const v = brief.board!.changes[r];
                    return (
                      <div key={r} className="rounded-xl bg-black/[0.03] dark:bg-white/5 p-2 text-center">
                        <div className={eyebrow}>{r}</div>
                        <div className={`text-[14px] font-semibold tabular-nums ${v === null ? 'text-gray-400' : v >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{signedPct(v, 1)}</div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400">The closest fund or index Radar already tracks; prices from the Markets tab.</p>
              </Panel>
            </div>
          )}
        </div>
      )}

      {!working && brief.sources.length > 0 && (
        <details className="surface p-4 md:p-5 rounded-3xl border border-black/5 dark:border-white/5">
          <summary className="cursor-pointer text-[13px] font-semibold text-gray-700 dark:text-gray-200">Sources ({brief.sources.length})</summary>
          <ol className="mt-2 space-y-1 list-decimal pl-5">
            {brief.sources.map(s => (
              <li key={s.url} className="text-[12px] text-gray-500">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">{s.title || s.site}</a> <span className="text-gray-400">({s.site})</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
