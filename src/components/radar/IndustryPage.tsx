// An industry brief from Radar's search box (raspberry_pi/industry.py), built
// from public data: Wikipedia, Wikidata companies, SEC filings, OpenAlex
// research counts, market figures as research firms published them, and news.
// AI notes (trends, risks, openings, fit) are added only when asked.
import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft, LoaderCircle, Check, AlertTriangle, RefreshCw, NotebookPen, FlaskConical, ExternalLink, Building2, TrendingUp,
  ShieldAlert, Lightbulb, Newspaper, LineChart, UserRound, MapPin, BookOpen, Sparkles, GraduationCap, Database, Quote,
} from 'lucide-react';
import { IndustryBrief, IndustryCompany, IndustryMarket, RADAR_EVENT, billions, industryApi, signedPct, timeAgo } from '../../services/radar';
import { useToast } from '../../context/ToastContext';
import { Panel, chipButton, eyebrow, primaryButton } from './parts';
import { FitBadge } from './LabTab';

const SEVERITY: Record<string, string> = {
  High: 'text-red-600 bg-red-500/10',
  Medium: 'text-amber-700 bg-amber-500/10 dark:text-amber-400',
  Low: 'text-emerald-600 bg-emerald-500/10',
};

const ago = (iso: string) => { const t = timeAgo(iso); return t === 'just now' ? t : `${t} ago`; };

// Wikidata's exchange names to Google Finance's codes; anything else goes to a search.
const EXCHANGES: [RegExp, string][] = [
  [/nasdaq/i, 'NASDAQ'], [/new york stock exchange|nyse/i, 'NYSE'], [/national stock exchange of india/i, 'NSE'], [/bombay/i, 'BOM'],
  [/london/i, 'LON'], [/tokyo/i, 'TYO'], [/hong kong/i, 'HKG'], [/frankfurt|xetra/i, 'ETR'], [/toronto/i, 'TSE'], [/australian/i, 'ASX'],
  [/euronext paris/i, 'EPA'], [/shenzhen/i, 'SHE'], [/shanghai/i, 'SHA'], [/korea/i, 'KRX'], [/six swiss/i, 'SWX'], [/tel aviv/i, 'TLV'],
];

function quoteUrl(c: IndustryCompany): string {
  const code = EXCHANGES.find(([re]) => re.test(c.exchange))?.[1];
  return code ? `https://www.google.com/finance/quote/${encodeURIComponent(c.ticker)}:${code}` : `https://www.google.com/search?q=${encodeURIComponent(`${c.ticker} stock`)}`;
}

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  return `$${Math.round(n / 1e6)}M`;
}

function shortExchange(name: string): string {
  return EXCHANGES.find(([re]) => re.test(name))?.[1] || name;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="surface-item rounded-2xl p-3 md:p-4 min-w-0">
      <div className={eyebrow}>{label}</div>
      <div className="text-[22px] md:text-[26px] font-semibold tabular-nums tracking-tight text-gray-900 dark:text-white leading-tight mt-1">{value}</div>
      {note && <div className="text-[11.5px] text-gray-400 mt-0.5 truncate" title={note}>{note}</div>}
    </div>
  );
}

// The reported size and forecast; years between follow the reported growth rate (pale).
function GrowthBars({ market }: { market: IndustryMarket }) {
  const { sizeUsdB, sizeYear, cagrPct, forecastUsdB, forecastYear } = market;
  if (!sizeUsdB || !sizeYear) return null;
  const end = forecastYear && forecastUsdB ? forecastYear : cagrPct !== null ? sizeYear + 5 : sizeYear;
  // Between two published points, grow smoothly from one to the other; else use the published rate.
  const rate = forecastUsdB && forecastYear ? Math.pow(forecastUsdB / sizeUsdB, 1 / (forecastYear - sizeYear)) - 1 : cagrPct !== null ? cagrPct / 100 : 0;
  const years: { year: number; value: number; given: boolean }[] = [];
  for (let y = sizeYear; y <= Math.min(end, sizeYear + 10); y++) {
    const given = y === sizeYear || (y === forecastYear && !!forecastUsdB);
    years.push({ year: y, value: y === forecastYear && forecastUsdB ? forecastUsdB : sizeUsdB * Math.pow(1 + rate, y - sizeYear), given });
  }
  if (years.length < 2) return null;
  const max = Math.max(...years.map(y => y.value));
  return (
    <div className="space-y-1.5" role="img" aria-label={`Reported ${billions(sizeUsdB)} in ${sizeYear}${forecastUsdB ? `, ${billions(forecastUsdB)} by ${forecastYear}` : ''}`}>
      <div className="flex items-end gap-1 md:gap-1.5 h-32">
        {years.map(y => (
          <div key={y.year} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
            {y.given && <span className="text-[10.5px] font-semibold tabular-nums text-gray-700 dark:text-gray-200 mb-0.5 whitespace-nowrap">{billions(y.value)}</span>}
            <div className={`w-full rounded-t-md ${y.given ? 'bg-blue-500' : 'bg-blue-500/30'}`} style={{ height: `${Math.max(4, (y.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 md:gap-1.5">
        {years.map(y => <span key={y.year} className="flex-1 text-center text-[10px] tabular-nums text-gray-400 min-w-0">{String(y.year).slice(2)}</span>)}
      </div>
      <p className="text-[11px] text-gray-400">Solid bars are the published figures (median across sites); pale ones are the years in between.</p>
    </div>
  );
}

function PaperBars({ years }: { years: { year: number; count: number }[] }) {
  const max = Math.max(1, ...years.map(y => y.count));
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-1 h-20">
        {years.map(y => (
          <div key={y.year} className="flex-1 h-full flex items-end min-w-0" title={`${y.year}: ${y.count.toLocaleString()} papers`}>
            <div className="w-full rounded-t bg-teal-500/80" style={{ height: `${Math.max(3, (y.count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1">{years.map(y => <span key={y.year} className="flex-1 text-center text-[10px] tabular-nums text-gray-400 min-w-0">{String(y.year).slice(2)}</span>)}</div>
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
        <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Gathering public data</h3>
        <span className="text-[12px] text-gray-400">about a minute</span>
      </div>
      <ol className="space-y-2">
        {brief.steps.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2.5 text-[13px] min-w-0">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold ${s.status === 'done' ? 'bg-emerald-500 text-white' : s.status === 'run' ? 'bg-purple-500 text-white' : s.status === 'failed' ? 'bg-red-500 text-white' : 'bg-black/[0.06] dark:bg-white/10 text-gray-500'}`}>
              {s.status === 'done' ? <Check size={13} /> : s.status === 'run' ? <LoaderCircle size={13} className="animate-spin" /> : i + 1}
            </span>
            <span className="font-semibold text-gray-800 dark:text-gray-100 shrink-0">{s.name}</span>
            {s.detail && <span className="text-gray-400 truncate">{s.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

const KIND_LABEL = { size: 'Size', forecast: 'Forecast', cagr: 'Growth' } as const;

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
  const [aiLeft, setAiLeft] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [allFigures, setAllFigures] = useState(false);

  const load = useCallback(() => industryApi.get(briefId)
    .then(r => { setBrief(r.brief); setAiLeft(r.aiLeft); setError(''); })
    .catch(e => setError(e.message || "Can't reach the Pi")), [briefId]);
  useEffect(() => { setBrief(null); load(); }, [load]);
  const working = brief?.status === 'queued' || brief?.status === 'running';
  const aiRunning = brief?.aiStatus === 'running';
  useEffect(() => {
    if (!working && !aiRunning) return;
    const onEvent = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.type === 'RADAR_INDUSTRY' && d.id === briefId) load(); };
    window.addEventListener(RADAR_EVENT, onEvent);
    const timer = setInterval(load, 2500); // in case the live link is down
    return () => { window.removeEventListener(RADAR_EVENT, onEvent); clearInterval(timer); };
  }, [working, aiRunning, briefId, load]);

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
      onOpenBrief((await industryApi.search(brief.query, true)).id);
    } catch (e: any) {
      showToast(e.message || "Couldn't start a new brief", 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const askAI = async () => {
    if (!brief) return;
    setAsking(true);
    try {
      setBrief(await industryApi.askAI(brief.id));
    } catch (e: any) {
      showToast(e.message || "Couldn't ask the AI", 'error');
    } finally {
      setAsking(false);
    }
  };

  const back = <button onClick={onBack} className="flex items-center gap-1 shrink-0 uppercase hover:text-gray-900 dark:hover:text-white"><ChevronLeft size={14} /> Radar</button>;

  if (!brief) {
    return error
      ? <div className="space-y-3"><div className="eyebrow text-gray-500">{back}</div><p className="text-[13px] text-red-500 text-center py-10">{error}</p></div>
      : <div className="space-y-4" aria-busy="true"><div className="skeleton h-40" /><div className="skeleton h-72" /></div>;
  }

  const name = brief.name || brief.query;
  const m = brief.market;
  const companies = brief.companies || [];
  const listed = companies.filter(c => c.ticker).length;
  const withRevenue = companies.filter(c => c.revenueUsd).length;
  const figures = brief.figures || [];
  const shownFigures = allFigures ? figures : figures.slice(0, 6);
  const research = brief.research;
  const ai = brief.ai;
  const finished = !working && brief.status !== 'failed';

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl">
        <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2 min-w-0">
          {back}
          <span className="truncate">· industry brief{brief.finishedAt ? `, ${ago(brief.finishedAt)}` : ''}</span>
        </div>
        <h1 className="text-display text-[28px] md:text-[40px] font-semibold leading-[1.05]">{name}</h1>
        {brief.oneLiner && <p className="text-[14.5px] text-gray-500 dark:text-gray-400 mt-1.5">{brief.oneLiner}</p>}
        <div className="flex gap-1.5 mt-3 flex-wrap items-center">
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md text-teal-700 bg-teal-500/10 dark:text-teal-300 flex items-center gap-1"><Database size={11} /> Public data</span>
          {brief.sources.slice(0, 6).map(s => s.name).filter((n, i, a) => a.indexOf(n) === i && !n.includes('.')).map(n => (
            <span key={n} className="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-black/[0.04] dark:bg-white/10 text-gray-600 dark:text-gray-300">{n}</span>
          ))}
          {ai?.fit && <FitBadge fit={ai.fit.score} why={ai.fit.why} />}
        </div>
        {finished && (
          <div className="flex gap-2 mt-5 flex-wrap">
            <button onClick={() => (brief.noteId && !saving ? onOpenNote(brief.noteId) : saveNote())} disabled={saving} className={primaryButton}>
              {saving ? <LoaderCircle size={14} className="animate-spin" /> : <NotebookPen size={14} />} {brief.noteId ? 'Open note' : 'Save to Notes'}
            </button>
            <button onClick={() => onResearch(`Startup ideas in ${name}`)} className={chipButton} title="Studio's 5-step research: three scored startup ideas (uses AI)">
              <FlaskConical size={14} className="text-purple-500" /> Find ideas in Studio
            </button>
            <button onClick={refresh} disabled={refreshing} className={`${chipButton} text-gray-500`} title="Gather the data again">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        )}
      </div>

      {working && <Progress brief={brief} />}
      {!working && brief.error && (
        <p className="text-[12.5px] font-medium text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{brief.status === 'failed' ? "Couldn't make this brief: " : 'Some sources were down, so parts are missing: '}{brief.error}</span>
        </p>
      )}

      {finished && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
          <Stat label={`Market size${m?.sizeYear ? ` ${m.sizeYear}` : ''}`} value={m?.sizeUsdB ? billions(m.sizeUsdB) : '–'}
            note={m?.sizeUsdB ? `median of ${m.sizeSites} site${m.sizeSites === 1 ? '' : 's'}${m.low !== null && m.high !== null && m.low !== m.high ? `, ${billions(m.low)}–${billions(m.high)}` : ''}` : 'no published figure found'} />
          <Stat label="Growth a year" value={m?.cagrPct != null ? `+${m.cagrPct}%` : '–'}
            note={m?.cagrPct != null ? `CAGR, ${m.cagrSites} site${m.cagrSites === 1 ? '' : 's'}${m.forecastUsdB ? ` · ${billions(m.forecastUsdB)} by ${m.forecastYear}` : ''}` : 'no published rate found'} />
          <Stat label="Companies" value={String(companies.length)} note={`${listed} listed${withRevenue ? ` · ${withRevenue} with SEC revenue` : ''} · Wikidata`} />
          <Stat label="Papers last year" value={research ? research.lastYear.toLocaleString() : '–'}
            note={research ? `${research.growth5yPct !== null ? `${research.growth5yPct > 0 ? '+' : ''}${research.growth5yPct}% in 5 years · ` : ''}OpenAlex` : 'research count unavailable'} />
        </div>
      )}

      {finished && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="lg:col-span-7 space-y-4 md:space-y-6">
            {brief.wiki && (
              <Panel icon={<BookOpen size={18} className="text-blue-500" />} title="What it is" note="Wikipedia"
                right={<a href={brief.wiki.url} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">Read more <ExternalLink size={11} /></a>}>
                <div className="flex gap-4 items-start">
                  <div className="min-w-0 flex-1 space-y-2">
                    {brief.wiki.extract.split('\n').slice(0, 3).map((p, i) => <p key={i} className="text-[13.5px] text-gray-700 dark:text-gray-200 leading-relaxed">{p}</p>)}
                  </div>
                  {brief.wiki.thumbnail && <img src={brief.wiki.thumbnail} alt="" loading="lazy" className="hidden sm:block w-32 h-32 object-cover rounded-2xl shrink-0 bg-black/5" />}
                </div>
              </Panel>
            )}

            <Panel icon={<Building2 size={18} className="text-purple-500" />} title="Companies" note={companies.length ? `${companies.length} from Wikidata, listed first` : undefined}>
              {companies.length === 0 ? <p className="text-[12.5px] text-gray-400">Wikidata lists no companies under this industry.</p> : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-left text-[12.5px]">
                    <thead>
                      <tr>
                        <th className={`${eyebrow} pb-1.5 px-1`}>Company</th>
                        <th className={`${eyebrow} pb-1.5 px-1`}>Ticker</th>
                        <th className={`${eyebrow} pb-1.5 px-1 text-right`}>Staff</th>
                        <th className={`${eyebrow} pb-1.5 px-1 text-right`}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map(c => (
                        <tr key={c.qid} className="border-t border-black/5 dark:border-white/5 align-top">
                          <td className="py-2 px-1 min-w-0">
                            {c.website
                              ? <a href={c.website} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-900 dark:text-white hover:underline">{c.name}</a>
                              : <span className="font-semibold text-gray-900 dark:text-white">{c.name}</span>}
                            <div className="text-[11px] text-gray-400">{[c.country, c.founded ? `since ${c.founded}` : ''].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="py-2 px-1 whitespace-nowrap">
                            {c.ticker ? (
                              <>
                                <a href={quoteUrl(c)} target="_blank" rel="noopener noreferrer" className="font-semibold tabular-nums text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5">{c.ticker}<ExternalLink size={10} /></a>
                                <div className="text-[10.5px] text-gray-400">{shortExchange(c.exchange)}</div>
                              </>
                            ) : <span className="text-gray-300 dark:text-gray-600">private</span>}
                          </td>
                          <td className="py-2 px-1 text-right tabular-nums text-gray-600 dark:text-gray-300">{c.employees ? c.employees.toLocaleString() : '–'}</td>
                          <td className="py-2 px-1 text-right tabular-nums whitespace-nowrap">
                            {c.revenueUsd ? (
                              <a href={c.secUrl} target="_blank" rel="noopener noreferrer" title={`10-K, fiscal ${c.revenueYear}`} className="hover:underline">
                                <span className="font-semibold text-gray-900 dark:text-white">{usd(c.revenueUsd)}</span>
                                {c.revenueGrowthPct != null && <div className={`text-[10.5px] ${c.revenueGrowthPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{signedPct(c.revenueGrowthPct, 0)} y/y</div>}
                              </a>
                            ) : <span className="text-gray-300 dark:text-gray-600">–</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-gray-400 mt-2 px-1">Revenue from SEC 10-K filings (US-listed only). Staff and listings from Wikidata.</p>
                </div>
              )}
            </Panel>

            <Panel icon={<Quote size={18} className="text-sky-500" />} title="Market numbers, as published" note={figures.length ? `${figures.length} from ${new Set(figures.map(f => f.site)).size} sites` : undefined}>
              {figures.length === 0 ? <p className="text-[12.5px] text-gray-400">No research firm figures turned up in the search results.</p> : (
                <>
                  <ul className="divide-y divide-black/5 dark:divide-white/5">
                    {shownFigures.map((f, i) => (
                      <li key={`${f.url}-${i}`} className="py-2 first:pt-0 flex gap-3 items-start">
                        <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 mt-0.5 ${f.kind === 'size' ? 'text-blue-600 bg-blue-500/10' : f.kind === 'forecast' ? 'text-purple-600 bg-purple-500/10' : 'text-emerald-600 bg-emerald-500/10'}`}>{KIND_LABEL[f.kind]}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-gray-900 dark:text-white tabular-nums">
                            {f.kind === 'cagr' ? `${f.pct}% a year` : `${billions(f.usdB)}${f.year ? ` (${f.year})` : ''}`}
                            <a href={f.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-[11.5px] font-medium text-blue-600 dark:text-blue-400 hover:underline">{f.site}</a>
                          </div>
                          <div className="text-[11.5px] text-gray-500 line-clamp-2" title={f.sentence}>“{f.sentence}”</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {figures.length > 6 && (
                    <button onClick={() => setAllFigures(!allFigures)} className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:underline">{allFigures ? 'Show fewer' : `Show all ${figures.length}`}</button>
                  )}
                  <p className="text-[11px] text-gray-400">Firms measure markets differently, so figures vary; the totals above use the middle value.</p>
                </>
              )}
            </Panel>
          </div>

          <div className="lg:col-span-5 space-y-4 md:space-y-6">
            {m?.sizeUsdB && m.sizeYear ? (
              <Panel icon={<LineChart size={18} className="text-blue-500" />} title="Market size" note="US$ a year, as published">
                <GrowthBars market={m} />
              </Panel>
            ) : null}
            {research && (
              <Panel icon={<GraduationCap size={18} className="text-teal-500" />} title="Research activity" note="papers a year"
                right={<a href={research.url} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">OpenAlex <ExternalLink size={11} /></a>}>
                <PaperBars years={research.years} />
                <p className="text-[11px] text-gray-400">How many scientific papers mention it each year: a sign of where the field is heading.</p>
              </Panel>
            )}
            {brief.board && (
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
              </Panel>
            )}

            <Panel icon={<Sparkles size={18} className="text-amber-500" />} title="AI notes" note={ai ? 'written from the data on this page' : 'optional'}>
              {!ai && brief.aiStatus !== 'running' && (
                <div className="space-y-2">
                  <p className="text-[12.5px] text-gray-500">Everything above is from public data. If you want, the AI can add trends, risks, small businesses to start{brief.news.length ? '' : ''} and how it fits you, using only this page's facts.</p>
                  {brief.aiStatus === 'failed' && <p className="text-[12px] text-amber-700 dark:text-amber-400">{brief.aiError}</p>}
                  <button onClick={askAI} disabled={asking || aiLeft === 0} className={chipButton} title={aiLeft === 0 ? 'No AI write-ups left today' : `${aiLeft} left today`}>
                    {asking ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} className="text-amber-500" />} Ask AI ({aiLeft} left today)
                  </button>
                </div>
              )}
              {brief.aiStatus === 'running' && <p className="text-[12.5px] text-gray-500 flex items-center gap-2"><LoaderCircle size={14} className="animate-spin" /> Writing…</p>}
              {ai && (
                <div className="space-y-3">
                  {ai.trends.length > 0 && (
                    <div className="space-y-1.5">
                      <div className={`${eyebrow} flex items-center gap-1`}><TrendingUp size={12} /> Trends</div>
                      {ai.trends.map(t => (
                        <p key={t.title} className="text-[12.5px] text-gray-600 dark:text-gray-300"><span className="font-semibold text-gray-900 dark:text-white">{t.title}.</span> {t.text}
                          {t.news && brief.news[t.news - 1] && <a href={brief.news[t.news - 1].url} target="_blank" rel="noopener noreferrer" className="text-[10.5px] font-semibold text-blue-600 dark:text-blue-400 hover:underline ml-1">[news]</a>}
                        </p>
                      ))}
                    </div>
                  )}
                  {ai.risks.length > 0 && (
                    <div className="space-y-1.5">
                      <div className={`${eyebrow} flex items-center gap-1`}><ShieldAlert size={12} /> Risks</div>
                      {ai.risks.map(r => (
                        <p key={r.title} className="text-[12.5px] flex items-start gap-2">
                          <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${SEVERITY[r.severity]}`}>{r.severity}</span>
                          <span className="text-gray-600 dark:text-gray-300"><span className="font-semibold text-gray-900 dark:text-white">{r.title}.</span> {r.text}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  {ai.openings.length > 0 && (
                    <div className="space-y-1.5">
                      <div className={`${eyebrow} flex items-center gap-1`}><Lightbulb size={12} /> Openings</div>
                      {ai.openings.map(o => (
                        <div key={o.idea} className="rounded-xl bg-black/[0.03] dark:bg-white/5 p-2.5">
                          <div className="text-[13px] font-semibold text-gray-900 dark:text-white">{o.idea}</div>
                          <div className="text-[12px] text-gray-500">{o.buyer && <><span className="font-semibold">First buyer:</span> {o.buyer}. </>}{o.why}</div>
                          <button onClick={() => onResearch(`${o.idea} (${name})`)} className="text-[12px] font-semibold text-purple-600 dark:text-purple-300 hover:underline flex items-center gap-1 pt-0.5"><FlaskConical size={12} /> Research this</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {ai.india && <p className="text-[12.5px] text-gray-600 dark:text-gray-300 flex gap-1.5"><MapPin size={14} className="text-orange-500 shrink-0 mt-0.5" />{ai.india}</p>}
                  {ai.fit && (
                    <p className="text-[12.5px] text-gray-600 dark:text-gray-300 flex gap-1.5"><UserRound size={14} className="text-blue-500 shrink-0 mt-0.5" />
                      <span>{ai.fit.why}{ai.fit.firstStep && <> <span className="font-semibold">This week:</span> {ai.fit.firstStep}</>}</span>
                    </p>
                  )}
                  <p className="text-[11px] text-gray-400">AI-written{brief.engine ? ` (${brief.engine})` : ''}; check before acting.</p>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {!working && brief.news.length > 0 && (
        <Panel icon={<Newspaper size={18} className="text-gray-500" />} title="Latest news" note={`${brief.news.length} from Radar and Google News`}>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 divide-y md:divide-y-0 divide-black/5 dark:divide-white/5">
            {brief.news.slice(0, 10).map(n => (
              <li key={n.url} className="py-2 md:border-b md:border-black/5 md:dark:border-white/5">
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-gray-900 dark:text-white hover:underline">{n.title}</a>
                <div className="text-[11.5px] text-gray-400 flex items-center gap-1.5">
                  {n.kind === 'radar' && <span className="text-[10px] font-semibold px-1 rounded bg-purple-500/10 text-purple-600 dark:text-purple-300">Radar</span>}
                  <span>{n.source}</span>{n.published && <span>· {ago(n.published)}</span>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!working && brief.sources.length > 0 && (
        <details className="surface p-4 md:p-5 rounded-3xl border border-black/5 dark:border-white/5">
          <summary className="cursor-pointer text-[13px] font-semibold text-gray-700 dark:text-gray-200">Sources ({brief.sources.length})</summary>
          <ol className="mt-2 space-y-1 list-decimal pl-5">
            {brief.sources.map(s => (
              <li key={s.url} className="text-[12px] text-gray-500">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">{s.name}</a> <span className="text-gray-400">{s.title}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
