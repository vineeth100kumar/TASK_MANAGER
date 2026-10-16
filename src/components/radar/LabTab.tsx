// Radar Lab: each morning's sparks, small business ideas made from the last
// day of headlines and market moves and matched to My edge
// (raspberry_pi/sparks.py). Keep one, research it, or say why not.
import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Bookmark, FlaskConical, X, LoaderCircle, ExternalLink, UserRound, Pencil, RefreshCw, Lightbulb, AlertTriangle, LineChart, Newspaper } from 'lucide-react';
import { RADAR_EVENT, Spark, SparkList, sparksApi, timeAgo } from '../../services/radar';
import { Idea } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { EdgeEditor } from './EdgeEditor';
import { Panel, Tag, chipButton, eyebrow, primaryButton } from './parts';

const ago = (iso: string) => { const t = timeAgo(iso); return t === 'just now' ? t : `${t} ago`; };

interface LabTabProps {
  ideas: Idea[];
  onOpenIdea: (id: string) => void;
  onResearchStarted: () => void;
}

export function FitBadge({ fit, why }: { fit: number; why?: string }) {
  const tone = fit >= 8 ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300' : fit >= 5 ? 'text-amber-700 bg-amber-500/10 dark:text-amber-300' : 'text-gray-500 bg-gray-500/10';
  return <span title={why} className={`text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md shrink-0 ${tone}`}>Fit {fit}/10</span>;
}

function SparkCard({ spark, busy, reasons, onKeep, onResearch, onDismiss }: {
  spark: Spark; busy: string; reasons: string[];
  onKeep: () => void; onResearch: () => void; onDismiss: (reason: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <article className="p-4 rounded-3xl surface-item space-y-2.5">
      <div className="flex items-center gap-2 min-w-0">
        {spark.clue.kind === 'market' ? <LineChart size={13} className="text-gray-400 shrink-0" /> : <Newspaper size={13} className="text-gray-400 shrink-0" />}
        <span className={`${eyebrow} normal-case tracking-normal truncate`}>{spark.clue.label}</span>
        <span className="ml-auto"><FitBadge fit={spark.fit} why={spark.fitWhy} /></span>
      </div>
      <div className="min-w-0">
        <h3 className="text-[16px] font-semibold tracking-tight text-gray-900 dark:text-white">{spark.idea}</h3>
        <p className="text-[13.5px] text-gray-700 dark:text-gray-200">{spark.pitch}</p>
      </div>
      <div className="space-y-1 text-[12.5px] text-gray-500 dark:text-gray-400">
        <p><span className="font-semibold text-gray-600 dark:text-gray-300">What changed:</span> {spark.change || spark.clue.title}</p>
        {spark.buyer && <p><span className="font-semibold text-gray-600 dark:text-gray-300">First buyer:</span> {spark.buyer}</p>}
        {spark.fitWhy && <p><span className="font-semibold text-gray-600 dark:text-gray-300">Why it fits:</span> {spark.fitWhy}</p>}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {spark.angle && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md text-purple-600 bg-purple-500/10 dark:text-purple-300">{spark.angle}</span>}
        {(spark.clue.tags || []).slice(0, 2).map(t => <Tag key={t} tag={t} />)}
        {spark.clue.link && (
          <a href={spark.clue.link} target="_blank" rel="noopener noreferrer" title={spark.clue.title}
            className="text-[11.5px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 min-w-0">
            <span className="truncate max-w-[220px]">{spark.clue.title}</span> <ExternalLink size={11} className="shrink-0" />
          </a>
        )}
      </div>
      {asking ? (
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Why not?">
          <span className="text-[12px] font-semibold text-gray-500 mr-1">Why not?</span>
          {reasons.map(r => (
            <button key={r} onClick={() => onDismiss(r)} disabled={!!busy} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-black/[0.04] dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-gray-700 dark:text-gray-200">{r}</button>
          ))}
          <button onClick={() => setAsking(false)} className="text-[12px] font-semibold px-2 py-1 text-gray-400 hover:text-gray-700">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onKeep} disabled={!!busy} className={primaryButton}>
            {busy === 'keep' ? <LoaderCircle size={14} className="animate-spin" /> : <Bookmark size={14} />} Keep
          </button>
          <button onClick={onResearch} disabled={!!busy} className={chipButton} title="Run Studio's 5-step research on it (uses one of today's runs)">
            {busy === 'research' ? <LoaderCircle size={14} className="animate-spin" /> : <FlaskConical size={14} className="text-purple-500" />} Research
          </button>
          <button onClick={() => setAsking(true)} disabled={!!busy} className={`${chipButton} text-gray-500`}>
            <X size={14} /> Dismiss
          </button>
        </div>
      )}
    </article>
  );
}

export function LabTab({ ideas, onOpenIdea, onResearchStarted }: LabTabProps) {
  const { showToast } = useToast();
  const [list, setList] = useState<SparkList | null>(null);
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState<{ id: string; what: string } | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => sparksApi.list().then(l => { setList(l); setError(''); }).catch(e => setError(e.message || "Can't reach the Pi")), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onEvent = (e: Event) => { if ((e as CustomEvent).detail?.type === 'RADAR_SPARKS') load(); };
    window.addEventListener(RADAR_EVENT, onEvent);
    return () => window.removeEventListener(RADAR_EVENT, onEvent);
  }, [load]);

  const make = async () => {
    setMaking(true);
    try {
      setList(await sparksApi.make());
      showToast('New sparks are in');
    } catch (e: any) {
      showToast(e.message || "Couldn't make sparks", 'error');
      load();
    } finally {
      setMaking(false);
    }
  };

  const act = async (spark: Spark, what: 'keep' | 'research' | 'dismiss', reason = '') => {
    setBusy({ id: spark.id, what });
    try {
      if (what === 'keep') {
        await sparksApi.keep(spark.id);
        showToast(`Kept ${spark.idea} in Ideas`);
      } else if (what === 'research') {
        await sparksApi.research(spark.id);
        showToast('Research started');
        onResearchStarted();
      } else {
        await sparksApi.dismiss(spark.id, reason);
        showToast('Dismissed. Tomorrow’s sparks will steer away from it.');
      }
      await load();
    } catch (e: any) {
      showToast(e.message || "Couldn't do that", 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!list && !error) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6" aria-busy="true">
        <div className="lg:col-span-8 skeleton h-96" />
        <div className="lg:col-span-4 skeleton h-64" />
      </div>
    );
  }
  if (!list) return <p className="text-[13px] text-red-500 text-center py-10">{error}</p>;

  const keptIdeas = list.kept.map(s => ({ spark: s, idea: ideas.find(i => i.id === s.ideaId) }));
  const edgeEmpty = !Object.values(list.edge).some(v => v.trim());
  const failed = list.lastRun && !list.lastRun.ok ? list.lastRun.error : '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
      <div className="lg:col-span-8 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-amber-500" />
            <h2 className="font-semibold text-[15px] tracking-tight text-gray-900 dark:text-white">Today's sparks</h2>
            <span className="text-[12px] font-medium text-gray-400">{list.sparks.length ? `${list.sparks.length} open, best fit first` : ''}</span>
          </div>
          <button onClick={make} disabled={making || list.running || list.manualLeft === 0} className={chipButton}
            title={list.manualLeft === 0 ? 'No extra batches left today' : `${list.manualLeft} extra batch${list.manualLeft === 1 ? '' : 'es'} left today`}>
            {making || list.running ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />} {making || list.running ? 'Making sparks…' : `Make new (${list.manualLeft} left)`}
          </button>
        </div>
        {failed && (
          <p className="text-[12px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={13} /> The last batch didn't work ({ago(list.lastRun!.at)}): {failed}
          </p>
        )}
        {list.sparks.length === 0 ? (
          <div className="p-8 rounded-3xl surface-item text-center space-y-2">
            <Sparkles size={26} className="text-amber-500 mx-auto" />
            <p className="text-[14px] font-semibold text-gray-900 dark:text-white">
              {list.madeToday ? "You've gone through today's sparks" : 'Sparks arrive each morning at 7:00'}
            </p>
            <p className="text-[12.5px] text-gray-500 max-w-sm mx-auto">
              Each one starts from a headline or a market move in Radar and turns it into a small business you could start, ranked by how well it fits you.
            </p>
            {list.manualLeft > 0 && (
              <button onClick={make} disabled={making || list.running} className={`${primaryButton} mx-auto mt-2`}>
                {making || list.running ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />} Make {list.perDay} sparks now
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {list.sparks.map(s => (
              <SparkCard key={s.id} spark={s} reasons={list.reasons} busy={busy?.id === s.id ? busy.what : busy ? 'other' : ''}
                onKeep={() => act(s, 'keep')} onResearch={() => act(s, 'research')} onDismiss={r => act(s, 'dismiss', r)} />
            ))}
          </div>
        )}
      </div>

      <div className="lg:col-span-4 space-y-4 md:space-y-6">
        <Panel icon={<UserRound size={18} className="text-blue-500" />} title="My edge" note="sparks are matched to this"
          right={!editing && <button onClick={() => setEditing(true)} className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"><Pencil size={12} /> Edit</button>}>
          {editing ? (
            <EdgeEditor edge={list.edge} onCancel={() => setEditing(false)} onSaved={edge => { setEditing(false); setList({ ...list, edge }); load(); }} />
          ) : (
            <>
              {edgeEmpty && <p className="text-[12.5px] text-amber-700 dark:text-amber-400">Not filled in yet, so Radar guesses from your projects. Add what you know and have for better sparks.</p>}
              <ul className="space-y-1">
                {list.edgeUsed.map(line => <li key={line} className="text-[12.5px] text-gray-600 dark:text-gray-300">{line.replace(/^- /, '')}</li>)}
              </ul>
            </>
          )}
        </Panel>
        <Panel icon={<Lightbulb size={18} className="text-emerald-500" />} title="Kept" note={keptIdeas.length ? `${keptIdeas.length} in Ideas` : undefined}>
          {keptIdeas.length === 0 ? (
            <p className="text-[12.5px] text-gray-400">Sparks you keep or research show up here and in Ideas.</p>
          ) : (
            <ul className="space-y-1.5">
              {keptIdeas.map(({ spark, idea }) => (
                <li key={spark.id}>
                  <button onClick={() => idea && onOpenIdea(idea.id)} disabled={!idea}
                    className="w-full text-left flex items-center gap-2 p-2 -mx-2 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/5 disabled:cursor-default">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-gray-900 dark:text-white truncate">{spark.idea}</span>
                      <span className="block text-[11.5px] text-gray-400 truncate">{spark.state === 'researched' ? 'Researched in Studio' : `Kept ${ago(spark.createdAt)}`}</span>
                    </span>
                    <FitBadge fit={spark.fit} why={spark.fitWhy} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
