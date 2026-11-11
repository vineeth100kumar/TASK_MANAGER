import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Search, Check, LoaderCircle, Circle, X, FileText, Sparkles, Lightbulb, AlertTriangle, History } from 'lucide-react';
import { RADAR_EVENT, RadarSignal, ResearchJob, ResearchList, researchApi, timeAgo } from '../../services/radar';
import { Dossier, Idea } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { Panel, ScoreRing, eyebrow, primaryButton } from './parts';
import { Select } from '../common/Select';

interface StudioTabProps {
  seedTheme: string;
  signals: RadarSignal[];
  dossiers: Dossier[];
  ideas: Idea[];
  onOpenIdea: (id: string) => void;
  onOpenDossier: (id: string) => void;
}

const ACTIVE = new Set(['queued', 'running']);
const ENGINE_NAME: Record<string, string> = { groq: 'Groq', claude: 'Claude', local: 'the Pi' };

function engineLabel(engine: string | null): string {
  return (engine || '').split(' + ').map(e => ENGINE_NAME[e] || e).join(' + ');
}

function StepList({ job }: { job: ResearchJob }) {
  return (
    <div className="space-y-1">
      {job.steps.map((s, i) => (
        <div key={s.name} className={`p-3 rounded-2xl flex items-center gap-3 ${s.status === 'run' ? 'surface-item ring-1 ring-purple-400/30' : ''}`}>
          {s.status === 'done' ? <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0"><Check size={14} strokeWidth={3} /></span>
            : s.status === 'run' ? <LoaderCircle size={24} className="text-purple-500 animate-spin shrink-0" />
            : s.status === 'failed' ? <span className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0"><X size={14} strokeWidth={3} /></span>
            : <Circle size={24} className="text-gray-300 dark:text-white/20 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className={`text-[13px] font-semibold ${s.status === 'todo' ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>{i + 1}. {s.name}</p>
            {s.detail && <p className={`text-[11.5px] ${s.status === 'failed' ? 'text-red-500' : 'text-gray-400'}`}>{s.detail}</p>}
          </div>
          {s.seconds !== null && s.status !== 'run' && <span className="text-[11px] tabular-nums text-gray-400">{s.seconds}s</span>}
        </div>
      ))}
    </div>
  );
}

export function StudioTab({ seedTheme, signals, dossiers, ideas, onOpenIdea, onOpenDossier }: StudioTabProps) {
  const { showToast } = useToast();
  const [theme, setTheme] = useState(seedTheme);
  const [depth, setDepth] = useState<'brief' | 'memo'>('brief');
  const [list, setList] = useState<ResearchList | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (seedTheme) { setTheme(seedTheme); input.current?.focus(); } }, [seedTheme]);

  const load = () => researchApi.list().then(l => { setList(l); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  // Each step of a run arrives over the live stream.
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type !== 'RADAR_PROGRESS' || !detail.job) return;
      const job: ResearchJob = detail.job;
      setList(prev => prev && ({ ...prev, jobs: [job, ...prev.jobs.filter(j => j.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
      if (!ACTIVE.has(job.status)) load();
    };
    window.addEventListener(RADAR_EVENT, onEvent);
    // In case the live stream is down, check every few seconds while a run is going.
    const timer = setInterval(() => { if (list?.jobs.some(j => ACTIVE.has(j.status))) load(); }, 8000);
    return () => { window.removeEventListener(RADAR_EVENT, onEvent); clearInterval(timer); };
  }, [list]);

  const jobs = list?.jobs || [];
  const job = jobs.find(j => j.id === selectedId) || jobs[0] || null;
  const dossier = job ? dossiers.find(d => d.id === job.id) : undefined;
  const jobIdeas = dossier ? ideas.filter(i => i.dossierId === dossier.id).sort((a, b) => b.score - a.score) : [];
  const left = list ? Math.max(0, list.dailyCap - list.runsToday) : null;
  const busy = jobs.some(j => ACTIVE.has(j.status));

  // Themes worth a look: rising headlines first.
  const suggestions = useMemo(() => {
    const picked = [...signals].sort((a, b) => Number(b.rising) - Number(a.rising)).slice(0, 3);
    return picked.map(s => s.title.length > 70 ? s.title.slice(0, 67).replace(/\s+\S*$/, '') + '…' : s.title);
  }, [signals]);

  const start = async () => {
    setStarting(true);
    try {
      const created = await researchApi.start(theme, depth);
      setSelectedId(created.id);
      await load();
      showToast(busy ? 'Queued after the current run' : 'Research started');
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <Panel icon={<FlaskConical size={18} className="text-purple-500" />} title="Research a theme"
        note={list && <span className="tabular-nums">{left} of {list.dailyCap} runs left today · {list.engines.map(e => ENGINE_NAME[e] || e).join(', then ')}</span>}>
        <form onSubmit={e => { e.preventDefault(); if (theme.trim().length >= 3) start(); }} className="flex flex-col sm:flex-row gap-2">
          <label className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-2xl surface-item focus-within:ring-2 focus-within:ring-purple-400/40">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input ref={input} value={theme} onChange={e => setTheme(e.target.value)} maxLength={200}
              placeholder="e.g. Cross-border payroll for remote teams in Southeast Asia"
              className="w-full bg-transparent outline-none text-[14px] text-gray-900 dark:text-white placeholder:text-gray-400" />
          </label>
          <div className="flex gap-2">
            <Select value={depth} onChange={v => setDepth(v as 'brief' | 'memo')} aria-label="Depth"
              className="px-3 py-2.5 rounded-2xl text-[13px] font-semibold text-gray-600 dark:text-gray-300 surface-item outline-none">
              <option value="brief">Brief</option>
              <option value="memo">Partner memo</option>
            </Select>
            <button type="submit" disabled={starting || theme.trim().length < 3 || left === 0} className={`${primaryButton} !rounded-2xl !px-4`}>
              {starting ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />} {busy ? 'Queue' : 'Research'}
            </button>
          </div>
        </form>
        {suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap text-[12px] items-center">
            <span className="text-gray-400">From your signals:</span>
            {suggestions.map(t => (
              <button key={t} onClick={() => setTheme(t)} className="px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/5 font-semibold text-gray-600 dark:text-gray-300 hover:bg-black/[0.07] text-left">{t}</button>
            ))}
          </div>
        )}
        {error && <p className="text-[12px] text-red-500">{error}</p>}
      </Panel>

      {job ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <Panel className="lg:col-span-5" title="Venture council"
            note={`${Math.min(job.step, 5)} of 5${job.engine ? ` · ${engineLabel(job.engine)}` : ''}`}>
            <p className="text-[13px] font-semibold text-gray-700 dark:text-gray-200 leading-snug">“{job.theme}”</p>
            {job.status === 'queued' && <p className="text-[12px] text-gray-400">Waiting for the run before it to finish.</p>}
            <StepList job={job} />
            {job.status === 'failed' && <p className="text-[12.5px] text-red-500 flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> {job.error || 'The run failed.'}</p>}
          </Panel>

          <Panel className="lg:col-span-7" icon={<FileText size={18} className="text-blue-500" />} title="Dossier"
            right={dossier && <button onClick={() => onOpenDossier(dossier.id)} className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:underline">Open in Vault ›</button>}>
            {dossier ? (
              <div className="space-y-4">
                {dossier.status === 'needs_review' && (
                  <p className="text-[12.5px] text-amber-700 dark:text-amber-400 flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> Part of the AI's answer couldn't be read, so check this one. {dossier.error}</p>
                )}
                {dossier.summary && <p className="text-[14px] font-semibold leading-snug text-gray-900 dark:text-white">{dossier.summary}</p>}
                <div className="p-4 rounded-2xl surface-item space-y-2">
                  <div className={eyebrow}>Macro backdrop</div>
                  <p className="text-[13.5px] leading-relaxed text-gray-800 dark:text-gray-200">{dossier.macro}</p>
                  {dossier.whyNow && <p className="text-[13.5px] leading-relaxed text-gray-800 dark:text-gray-200"><span className="font-semibold">Why now:</span> {dossier.whyNow}</p>}
                </div>
                {jobIdeas.length > 0 && (
                  <div className="space-y-2">
                    <div className={`${eyebrow} flex items-center gap-1.5`}><Lightbulb size={12} /> Ideas</div>
                    {jobIdeas.map(i => (
                      <button key={i.id} onClick={() => onOpenIdea(i.id)} className="w-full text-left p-3 rounded-2xl surface-item is-interactive flex items-center gap-3">
                        <ScoreRing score={i.score} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[13px] text-gray-900 dark:text-white">{i.name}</p>
                          <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{i.oneLiner}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[12px] text-gray-400 flex items-center gap-1.5"><Sparkles size={12} /> {dossier.sources.length} sources linked · saved to your Vault and Notes.</p>
              </div>
            ) : ACTIVE.has(job.status) ? (
              <div className="space-y-2" aria-busy="true">
                <p className="text-[12.5px] text-gray-400">The write-up appears here when the council finishes, usually in a couple of minutes.</p>
                <div className="skeleton h-3 w-11/12 !rounded-full" />
                <div className="skeleton h-3 w-4/5 !rounded-full" />
                <div className="skeleton h-3 w-2/3 !rounded-full" />
              </div>
            ) : (
              <p className="text-[12.5px] text-gray-400">{job.status === 'failed' ? 'Nothing was saved from this run.' : 'Syncing the dossier…'}</p>
            )}
          </Panel>
        </div>
      ) : list && (
        <p className="text-[13px] text-gray-400 text-center py-8">No research yet. Type a theme above, or press Research on a headline in Signals.</p>
      )}

      {jobs.length > 1 && (
        <Panel icon={<History size={18} className="text-gray-400" />} title="Recent runs">
          <div className="flex gap-2 flex-wrap">
            {jobs.map(j => (
              <button key={j.id} onClick={() => setSelectedId(j.id)} aria-pressed={job?.id === j.id}
                className={`px-2.5 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 max-w-full ${job?.id === j.id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'surface-item text-gray-600 dark:text-gray-300'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${j.status === 'done' ? 'bg-emerald-500' : j.status === 'failed' ? 'bg-red-500' : j.status === 'needs_review' ? 'bg-amber-500' : 'bg-purple-500 animate-pulse'}`} />
                <span className="truncate">{j.theme}</span>
                <span className="opacity-60 shrink-0">{timeAgo(j.createdAt)}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
