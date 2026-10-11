import { useCallback, useEffect, useMemo, useState } from 'react';
import { Radar, Newspaper, TrendingUp, Inbox, Check, RefreshCw, ArrowUpRight, AlertTriangle, CheckCircle2, Server } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { RADAR_EVENT, RISING, RadarSignal, RadarSummary, RadarQuote, radarApi, radarAvailable, formatQuote, timeAgo } from '../../services/radar';

const TAG_COLOR: Record<string, string> = {
  AI: 'text-blue-600 bg-blue-500/10 dark:text-blue-300',
  Regulation: 'text-purple-600 bg-purple-500/10 dark:text-purple-300',
  Fintech: 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-300',
  'Supply chain': 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
  Climate: 'text-teal-600 bg-teal-500/10 dark:text-teal-300',
  Defense: 'text-slate-600 bg-slate-500/10 dark:text-slate-300',
  Health: 'text-rose-600 bg-rose-500/10 dark:text-rose-300',
};

function Tag({ tag, active, onClick }: { tag: string; active?: boolean; onClick?: () => void }) {
  const tone = TAG_COLOR[tag] || 'text-gray-500 bg-gray-500/10';
  const cls = `text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${tone} ${active ? 'ring-1 ring-current' : ''}`;
  return onClick
    ? <button onClick={onClick} aria-pressed={active} className={`${cls} hover:opacity-80`}>#{tag}</button>
    : <span className={cls}>#{tag}</span>;
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

function Ticker({ quotes }: { quotes: RadarQuote[] }) {
  if (!quotes.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
      {quotes.map(q => {
        const up = (q.changePct ?? 0) >= 0;
        return (
          <div key={q.symbol} className="surface-item rounded-2xl px-3 py-2 flex items-center gap-3 shrink-0" title={`Updated ${timeAgo(q.updatedAt)} ago`}>
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

function VelocityPanel({ summary, tag, setTag }: { summary: RadarSummary; tag: string; setTag: (t: string) => void }) {
  const { learning, readyOn, tags } = summary.velocity;
  // While learning there is no usual pace yet, so the bars show raw counts.
  const most = Math.max(1, ...tags.map(t => (learning ? t.recent : t.velocity ?? 0)));
  const scale = learning ? most : Math.max(RISING * 1.5, most);
  return (
    <div className="surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <TrendingUp size={18} className="text-amber-500" />
        <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Trend velocity</h3>
        <span className="text-[12px] font-medium text-gray-400">{learning ? 'headlines, last 48 h' : 'news volume, 48 h vs usual'}</span>
      </div>
      <div className="space-y-2.5">
        {tags.map(t => {
          const value = learning ? t.recent : t.velocity ?? 0;
          const hot = !learning && (t.velocity ?? 0) >= RISING;
          return (
            <button key={t.tag} onClick={() => setTag(tag === t.tag ? '' : t.tag)} aria-pressed={tag === t.tag}
              className={`w-full flex items-center gap-3 rounded-lg -mx-1 px-1 py-0.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${tag === t.tag ? 'bg-black/[0.04] dark:bg-white/[0.06]' : ''}`}>
              <span className="w-24 shrink-0 text-[12.5px] font-semibold text-gray-700 dark:text-gray-300">#{t.tag}</span>
              <div className="flex-1 h-2 rounded-full bg-gray-200/70 dark:bg-white/10 overflow-hidden">
                <div className={`h-full rounded-full ${hot ? 'bg-amber-500' : value > 0 ? 'bg-blue-500' : 'bg-gray-300 dark:bg-white/25'}`} style={{ width: `${Math.min(100, (value / scale) * 100)}%` }} />
              </div>
              <span className={`w-12 text-right text-[12px] font-semibold tabular-nums ${hot ? 'text-amber-600' : 'text-gray-400'}`}>
                {learning ? t.recent : t.velocity === null ? (t.recent ? 'new' : '–') : `${t.velocity.toFixed(1)}×`}
              </span>
            </button>
          );
        })}
      </div>
      {learning && (
        <p className="text-[12px] text-gray-400">
          Radar is still learning what normal looks like. Speed-ups show {readyOn ? `from ${new Date(readyOn).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : 'after a few days'}.
        </p>
      )}
    </div>
  );
}

function SourcesPanel({ summary }: { summary: RadarSummary }) {
  const down = summary.sources.filter(s => !s.ok);
  return (
    <div className="surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-3">
      <div className="flex items-center gap-2">
        {down.length ? <AlertTriangle size={18} className="text-amber-500" /> : <CheckCircle2 size={18} className="text-emerald-500" />}
        <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Sources</h3>
        <span className="text-[12px] font-medium text-gray-400 tabular-nums">{summary.sources.length - down.length} of {summary.sources.length} working</span>
      </div>
      <SourceList sources={summary.sources} />
    </div>
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
              ? `${s.items} ${s.kind === 'markets' ? 'prices' : 'headlines'} · ${timeAgo(s.checkedAt)} ago`
              : `down: ${s.error || 'no data'}${s.lastOkAt ? ` · last worked ${timeAgo(s.lastOkAt)} ago` : ''}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SignalRow({ signal, sent, onInbox, setTag }: { signal: RadarSignal; sent: boolean; onInbox: () => void; setTag: (t: string) => void }) {
  return (
    <div className="p-3.5 rounded-2xl surface-item flex flex-col md:flex-row md:items-start gap-2 md:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400 mb-1 flex-wrap">
          <span className="font-semibold text-gray-500 dark:text-gray-300">{signal.source}</span>
          <span>· {timeAgo(signal.published)}</span>
          {signal.region !== 'Global' && <span>· {signal.region}</span>}
          {signal.rising && <span className="flex items-center gap-0.5 text-amber-600 font-semibold"><TrendingUp size={11} /> rising</span>}
        </div>
        <a href={signal.link} target="_blank" rel="noopener noreferrer" className="group font-semibold text-[13px] leading-snug text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">
          {signal.title}<ArrowUpRight size={12} className="inline ml-0.5 -mt-0.5 opacity-0 group-hover:opacity-60" />
        </a>
        {signal.tags.length > 0 && <div className="flex gap-1.5 mt-1.5 flex-wrap">{signal.tags.map(t => <Tag key={t} tag={t} onClick={() => setTag(t)} />)}</div>}
      </div>
      <div className="flex md:flex-col gap-1 shrink-0">
        {sent ? (
          <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400"><Check size={12} /> In Inbox</span>
        ) : (
          <button onClick={onInbox} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] font-semibold text-blue-600 dark:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 active:scale-95 transition-transform">
            <Inbox size={12} /> Inbox
          </button>
        )}
      </div>
    </div>
  );
}

export function RadarView() {
  const { showToast } = useToast();
  const [summary, setSummary] = useState<RadarSummary | null>(null);
  const [signals, setSignals] = useState<RadarSignal[]>([]);
  const [region, setRegion] = useState('Global');
  const [tag, setTag] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([radarApi.summary(), radarApi.signals(region, tag)]);
      setSummary(s);
      setSignals(list);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [region, tag]);

  useEffect(() => { if (radarAvailable()) load(); }, [load]);
  useEffect(() => {
    const onRadar = () => load();
    window.addEventListener(RADAR_EVENT, onRadar);
    // Headlines age while the page is open; recheck every few minutes too.
    const timer = setInterval(load, 5 * 60000);
    return () => { window.removeEventListener(RADAR_EVENT, onRadar); clearInterval(timer); };
  }, [load]);

  // Headlines already sent to Inbox show as sent, on every device.
  const loadSent = useCallback(() => {
    const ids = new Set<string>();
    for (const item of api.sync.getState().workItems) {
      const id = item && !item.deletedAt && (item.customFields as any)?.radarSignalId;
      if (id) ids.add(id);
    }
    setSentIds(ids);
  }, []);
  useEffect(loadSent, [loadSent]);
  useDataChanges(loadSent);

  const sendToInbox = async (signal: RadarSignal) => {
    try {
      const created = await api.workItems.create({
        title: signal.title,
        description: `${signal.link}\n\nFrom ${signal.source}, via Radar.`,
        lifeContext: 'work',
        isInbox: true,
        labels: ['radar', ...signal.tags.map(t => t.toLowerCase().replace(/\s+/g, '-'))],
        customFields: { radarSignalId: signal.id, sourceUrl: signal.link },
      } as any);
      setSentIds(prev => new Set(prev).add(signal.id));
      showToast('Added to Inbox', 'success', { label: 'Undo', group: 'radar-inbox', onAction: async () => { await api.workItems.softDelete(created.id); loadSent(); } });
    } catch (e: any) {
      showToast(e.message || "Couldn't add it", 'error');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const s = await radarApi.refresh();
      if (!s.refreshed) showToast('Refreshed under a minute ago, showing that');
      await load();
    } catch (e: any) {
      showToast(e.message || "Couldn't refresh", 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const today = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), []);

  if (!radarAvailable()) {
    return (
      <div className="max-w-md mx-auto text-center py-20 space-y-3">
        <div className="surface-item p-4 rounded-2xl inline-flex text-gray-500"><Server size={28} /></div>
        <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Radar runs on the Pi</h3>
        <p className="text-[14px] text-gray-500">It reads the news and prices from Sage's Pi server, so it shows when the app is opened from the Pi.</p>
      </div>
    );
  }

  const regions = summary?.regions || ['Global'];
  const down = summary?.sources.filter(s => !s.ok) || [];

  return (
    <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2">
              <Radar size={14} className="text-purple-500" />
              <span>{today}{summary?.updatedAt ? ` · updated ${new Date(summary.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
            </div>
            <h1 className="text-display text-[28px] md:text-[44px] font-semibold leading-[1.05] pb-1">Radar</h1>
            <p className="text-[14.5px] text-gray-500 dark:text-gray-400 mt-1">
              {error ? `Can't reach the Pi right now (${error}).` : summary ? summary.headline : 'Loading the latest signals…'}
            </p>
          </div>
          <button onClick={refresh} disabled={refreshing} title="Fetch headlines and prices now" aria-label="Refresh"
            className="shrink-0 p-2.5 rounded-xl surface-item text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-60 active:scale-95 transition-transform">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
        {summary && <Ticker quotes={summary.ticker} />}
        {down.length > 0 && (
          <p className="text-[12px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Down: {down.map(s => s.name).join(', ')}
          </p>
        )}
      </div>

      {!summary && !error ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6" aria-busy="true">
          <div className="lg:col-span-7 skeleton h-96" />
          <div className="lg:col-span-5 skeleton h-64" />
        </div>
      ) : summary && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="lg:col-span-7 surface p-4 md:p-6 rounded-3xl border border-black/5 dark:border-white/5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Newspaper size={18} className="text-blue-500" />
                <h3 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Signals</h3>
                <span className="text-[12px] font-semibold text-gray-400 tabular-nums">{summary.new24h} today</span>
              </div>
              <div className="flex gap-1 overflow-x-auto no-scrollbar max-w-full">
                {regions.map(r => (
                  <button key={r} onClick={() => setRegion(r)} aria-pressed={region === r}
                    className={`shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${region === r ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {tag && (
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                Showing <Tag tag={tag} /> <button onClick={() => setTag('')} className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">Show all</button>
              </div>
            )}
            {signals.length === 0 ? (
              <p className="text-[13px] text-gray-400 py-10 text-center">
                {summary.sources.length === 0 ? 'Fetching the first headlines…' : 'No headlines match these filters yet.'}
              </p>
            ) : (
              <div className="space-y-2 stagger">
                {signals.map(s => (
                  <SignalRow key={s.id} signal={s} sent={sentIds.has(s.id)} onInbox={() => sendToInbox(s)} setTag={setTag} />
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 space-y-4 md:space-y-6">
            <VelocityPanel summary={summary} tag={tag} setTag={setTag} />
            <SourcesPanel summary={summary} />
          </div>
        </div>
      )}
    </div>
  );
}
