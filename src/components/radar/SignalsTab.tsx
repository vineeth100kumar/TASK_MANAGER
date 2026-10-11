import { Newspaper, TrendingUp, Inbox, Check, ArrowUpRight, AlertTriangle, CheckCircle2, Lightbulb, Sparkles } from 'lucide-react';
import { RISING, RadarSignal, RadarSummary, timeAgo } from '../../services/radar';
import { Idea } from '../../services/types';
import { Panel, ScoreRing, SourceList, Tag } from './parts';

interface SignalsTabProps {
  summary: RadarSummary;
  signals: RadarSignal[];
  region: string;
  setRegion: (r: string) => void;
  tag: string;
  setTag: (t: string) => void;
  sentIds: Set<string>;
  onInbox: (s: RadarSignal) => void;
  onResearch: (theme: string) => void;
  topIdeas: Idea[];
  onOpenIdea: (id: string) => void;
  onAllIdeas: () => void;
}

function SignalRow({ signal, sent, onInbox, onResearch, setTag }: { signal: RadarSignal; sent: boolean; onInbox: () => void; onResearch: () => void; setTag: (t: string) => void }) {
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
        <button onClick={onResearch} title="Research this in Studio" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] font-semibold text-purple-600 dark:text-purple-300 bg-purple-500/10 hover:bg-purple-500/15 active:scale-95 transition-transform">
          <Sparkles size={12} /> Research
        </button>
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

function Velocity({ summary, tag, setTag }: { summary: RadarSummary; tag: string; setTag: (t: string) => void }) {
  const { learning, readyOn, tags } = summary.velocity;
  // While learning there is no usual pace yet, so the bars show raw counts.
  const most = Math.max(1, ...tags.map(t => (learning ? t.recent : t.velocity ?? 0)));
  const scale = learning ? most : Math.max(RISING * 1.5, most);
  return (
    <Panel icon={<TrendingUp size={18} className="text-amber-500" />} title="Trend velocity" note={learning ? 'headlines, last 48 h' : 'news volume, 48 h vs usual'}>
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
    </Panel>
  );
}

export function SignalsTab(p: SignalsTabProps) {
  const { summary, signals } = p;
  const down = summary.sources.filter(s => !s.ok);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
      <Panel className="lg:col-span-7 !space-y-4" icon={<Newspaper size={18} className="text-blue-500" />} title="Signals"
        note={<span className="tabular-nums font-semibold">{summary.new24h} today</span>}
        right={
          <div className="flex gap-1 overflow-x-auto no-scrollbar max-w-full">
            {summary.regions.map(r => (
              <button key={r} onClick={() => p.setRegion(r)} aria-pressed={p.region === r}
                className={`shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${p.region === r ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'}`}>
                {r}
              </button>
            ))}
          </div>
        }>
        {p.tag && (
          <div className="flex items-center gap-2 text-[12px] text-gray-500">
            Showing <Tag tag={p.tag} /> <button onClick={() => p.setTag('')} className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">Show all</button>
          </div>
        )}
        {signals.length === 0 ? (
          <p className="text-[13px] text-gray-400 py-10 text-center">
            {summary.sources.length === 0 ? 'Fetching the first headlines…' : 'No headlines match these filters yet.'}
          </p>
        ) : (
          <div className="space-y-2 stagger">
            {signals.map(s => (
              <SignalRow key={s.id} signal={s} sent={p.sentIds.has(s.id)} onInbox={() => p.onInbox(s)} onResearch={() => p.onResearch(s.title)} setTag={p.setTag} />
            ))}
          </div>
        )}
      </Panel>

      <div className="lg:col-span-5 space-y-4 md:space-y-6">
        <Velocity summary={summary} tag={p.tag} setTag={p.setTag} />

        <Panel icon={<Lightbulb size={18} className="text-emerald-500" />} title="Top ideas"
          right={p.topIdeas.length > 0 && <button onClick={p.onAllIdeas} className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:underline">All ideas ›</button>}>
          {p.topIdeas.length === 0 ? (
            <p className="text-[12.5px] text-gray-400">Press Research on a headline, and the best ideas from it land here, scored out of 100.</p>
          ) : p.topIdeas.map(i => (
            <button key={i.id} onClick={() => p.onOpenIdea(i.id)} className="w-full text-left p-3 rounded-2xl surface-item is-interactive flex items-center gap-3">
              <ScoreRing score={i.score} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[13px] text-gray-900 dark:text-white">{i.name}</p>
                <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{i.oneLiner}</p>
              </div>
            </button>
          ))}
        </Panel>

        <Panel icon={down.length ? <AlertTriangle size={18} className="text-amber-500" /> : <CheckCircle2 size={18} className="text-emerald-500" />}
          title="Sources" note={<span className="tabular-nums">{summary.sources.length - down.length} of {summary.sources.length} working</span>}>
          <SourceList sources={summary.sources} />
        </Panel>
      </div>
    </div>
  );
}
