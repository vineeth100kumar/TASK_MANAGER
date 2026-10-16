import { useState } from 'react';
import { ChevronLeft, GitBranch, Target, Star, ShieldAlert, Users, Link2, LoaderCircle, Gauge, FlaskConical, Sparkles, ExternalLink } from 'lucide-react';
import { api } from '../../services/api';
import { money, researchApi, sparksApi } from '../../services/radar';
import { turnIntoProject, focusFirstStep } from '../../services/ideaProject';
import { Dossier, Idea } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { MoatRadar, Panel, ScoreRing, Tag, chipButton, eyebrow, primaryButton } from './parts';
import { FitBadge } from './LabTab';

const SEVERITY: Record<string, string> = {
  High: 'text-red-600 bg-red-500/10',
  Medium: 'text-amber-700 bg-amber-500/10 dark:text-amber-400',
  Low: 'text-emerald-600 bg-emerald-500/10',
};

// What the score is made of, out of each part's maximum. Ideas researched
// with My edge also score fit, and the other parts give up points for it.
const PARTS: [keyof Idea['scoreParts'], string, number][] = [
  ['whyNow', 'Why now', 25], ['pain', 'Pain', 20], ['money', 'Money', 20], ['moat', 'Moat', 20], ['safety', 'Safety', 15],
];
const PARTS_WITH_FIT: [keyof Idea['scoreParts'], string, number][] = [
  ['whyNow', 'Why now', 20], ['pain', 'Pain', 20], ['money', 'Money', 15], ['moat', 'Moat', 15], ['safety', 'Safety', 15], ['fit', 'Fit', 15],
];

const PHASE_DOTS = ['bg-purple-500', 'bg-sky-500', 'bg-emerald-500', 'bg-orange-500'];

interface IdeaPageProps {
  idea: Idea;
  dossier?: Dossier;
  onBack: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenDossier: (id: string) => void;
  onResearchStarted: () => void;
}

// A kept spark: no research yet, so no numbers, just the idea and where it came from.
function SparkIdeaPage({ idea, onBack, onResearchStarted }: { idea: Idea; onBack: () => void; onResearchStarted: () => void }) {
  const { showToast } = useToast();
  const [working, setWorking] = useState(false);

  const research = async () => {
    setWorking(true);
    try {
      if (idea.sparkId) await sparksApi.research(idea.sparkId);
      else await researchApi.start(`${idea.name}: ${idea.oneLiner}`.slice(0, 200), 'brief');
      showToast('Research started');
      onResearchStarted();
    } catch (e: any) {
      showToast(e.message || "Couldn't start research", 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl">
        <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2 min-w-0">
          <button onClick={onBack} className="flex items-center gap-1 shrink-0 uppercase hover:text-gray-900 dark:hover:text-white"><ChevronLeft size={14} /> Ideas</button>
          <span className="truncate">· kept from a Lab spark</span>
        </div>
        <h1 className="text-display text-[28px] md:text-[40px] font-semibold leading-[1.05]">{idea.name}</h1>
        <p className="text-[14.5px] text-gray-500 dark:text-gray-400 mt-1.5">{idea.oneLiner}</p>
        <div className="flex gap-1.5 mt-3 flex-wrap items-center">
          {typeof idea.fit === 'number' && <FitBadge fit={idea.fit} why={idea.fitWhy} />}
          {idea.angle && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md text-purple-600 bg-purple-500/10 dark:text-purple-300">{idea.angle}</span>}
          {idea.tags.map(t => <Tag key={t} tag={t} />)}
        </div>
        <div className="flex gap-2 mt-5 flex-wrap">
          <button onClick={research} disabled={working} className={primaryButton} title="Studio's 5-step research: a dossier, scores and a 90-day playbook">
            {working ? <LoaderCircle size={14} className="animate-spin" /> : <FlaskConical size={14} />} Research this
          </button>
          <button onClick={() => api.ideas.update(idea.id, { starred: !idea.starred })} aria-pressed={idea.starred} className={chipButton}>
            <Star size={14} className={`text-amber-500 ${idea.starred ? 'fill-amber-500' : ''}`} /> {idea.starred ? 'Starred' : 'Star'}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Panel icon={<Users size={18} className="text-blue-500" />} title="Who buys, and why you">
          {idea.icp && <p className="text-[13.5px] text-gray-800 dark:text-gray-200"><span className="font-semibold">First buyer:</span> {idea.icp}</p>}
          {idea.fitWhy && <p className="text-[13.5px] text-gray-800 dark:text-gray-200"><span className="font-semibold">Why it fits:</span> {idea.fitWhy}</p>}
        </Panel>
        <Panel icon={<Sparkles size={18} className="text-amber-500" />} title="Where it came from">
          {idea.whyNow && <p className="text-[13.5px] text-gray-800 dark:text-gray-200"><span className="font-semibold">What changed:</span> {idea.whyNow}</p>}
          {idea.clue && (
            <p className="text-[12.5px] text-gray-500">
              {idea.clue.label}:{' '}
              {idea.clue.link
                ? <a href={idea.clue.link} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{idea.clue.title} <ExternalLink size={11} className="inline" /></a>
                : idea.clue.title}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function IdeaPage(props: IdeaPageProps) {
  if (props.idea.stage === 'spark') return <SparkIdeaPage idea={props.idea} onBack={props.onBack} onResearchStarted={props.onResearchStarted} />;
  return <ResearchedIdeaPage {...props} />;
}

function ResearchedIdeaPage({ idea, dossier, onBack, onOpenProject, onOpenDossier }: IdeaPageProps) {
  const { showToast } = useToast();
  const [working, setWorking] = useState<'' | 'project' | 'focus'>('');
  const sources = dossier?.sources || [];
  const projectExists = !!idea.projectId && api.sync.getState().projects.some(p => p && p.id === idea.projectId);
  const taskCount = idea.playbook.reduce((n, p) => n + p.steps.length, 0);

  const makeProject = async () => {
    setWorking('project');
    try {
      const made = await turnIntoProject(idea);
      showToast(`Made ${made.project.name}: ${idea.playbook.length} branches, ${made.tasks.length} tasks`, 'success', {
        label: 'Undo', group: 'radar-project',
        onAction: async () => { await made.undo(); showToast('Project removed'); },
      });
    } catch (e: any) {
      showToast(e.message || "Couldn't make the project", 'error');
    } finally {
      setWorking('');
    }
  };

  const focus = async () => {
    setWorking('focus');
    try {
      const item = await focusFirstStep(idea);
      showToast(`In Focus: ${item.title}`);
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setWorking('');
    }
  };

  const star = async () => {
    await api.ideas.update(idea.id, { starred: !idea.starred });
  };

  const cite = (refs: number[]) => refs.filter(n => sources[n - 1]).map(n => (
    <a key={n} href={sources[n - 1].url} target="_blank" rel="noopener noreferrer" title={sources[n - 1].title}
      className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline ml-1">[{n}]</a>
  ));

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl">
        <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2 min-w-0">
          <button onClick={onBack} className="flex items-center gap-1 shrink-0 uppercase hover:text-gray-900 dark:hover:text-white"><ChevronLeft size={14} /> Ideas</button>
          {dossier && <span className="truncate">· from “{dossier.theme}”</span>}
        </div>
        <div className="flex items-center gap-4 md:gap-5">
          <div className="flex-1 min-w-0">
            <h1 className="text-display text-[28px] md:text-[40px] font-semibold leading-[1.05]">{idea.name}</h1>
            <p className="text-[14.5px] text-gray-500 dark:text-gray-400 mt-1.5">{idea.oneLiner} {cite(idea.sources)}</p>
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {idea.tags.map(t => <Tag key={t} tag={t} />)}
              {idea.whyNow && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md text-blue-600 bg-blue-500/10 dark:text-blue-300">Why now: {idea.whyNow}</span>}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1 shrink-0"><ScoreRing score={idea.score} size={96} /><span className="text-[11px] font-medium text-gray-400">opportunity</span></div>
        </div>
        <div className="flex gap-2 mt-5 flex-wrap">
          {projectExists ? (
            <button onClick={() => onOpenProject(idea.projectId!)} className={primaryButton}><GitBranch size={14} /> Open project</button>
          ) : (
            <button onClick={makeProject} disabled={!!working} className={primaryButton} title={`A project with ${idea.playbook.length} branches and ${taskCount} tasks`}>
              {working === 'project' ? <LoaderCircle size={14} className="animate-spin" /> : <GitBranch size={14} />} Turn into a project
            </button>
          )}
          <button onClick={focus} disabled={!!working} className={chipButton}>
            {working === 'focus' ? <LoaderCircle size={14} className="animate-spin" /> : <Target size={14} className="text-amber-500" />} Focus on first step
          </button>
          <button onClick={star} aria-pressed={idea.starred} className={chipButton}>
            <Star size={14} className={`text-amber-500 ${idea.starred ? 'fill-amber-500' : ''}`} /> {idea.starred ? 'Starred' : 'Star'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['ACV', money(idea.acvUsd)],
          ['Gross margin', idea.grossMarginPct === null ? '?' : `${Math.round(idea.grossMarginPct)}%`],
          ['Payback', idea.paybackMonths === null ? '?' : `${Math.round(idea.paybackMonths)} mo`],
          ['Sales cycle', idea.salesCycleWeeks === null ? '?' : `${Math.round(idea.salesCycleWeeks)} wk`],
        ].map(([k, v]) => (
          <div key={k} className="surface-item rounded-2xl p-3.5">
            <div className={eyebrow}>{k} <span className="normal-case tracking-normal font-medium">· estimate</span></div>
            <div className="text-[22px] font-semibold tracking-tight tabular-nums text-gray-900 dark:text-white">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
        <Panel className="lg:col-span-4" icon={<Gauge size={18} className="text-emerald-500" />} title="Score" note="how the 100 adds up">
          <div className="space-y-2">
            {(idea.scoreParts?.fit !== undefined ? PARTS_WITH_FIT : PARTS).map(([key, label, max]) => {
              const value = idea.scoreParts?.[key] ?? 0;
              return (
                <div key={key} className="flex items-center gap-2.5">
                  <span className="w-16 shrink-0 text-[12px] font-semibold text-gray-600 dark:text-gray-300">{label}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-200/70 dark:bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(value / max) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right text-[11.5px] font-semibold tabular-nums text-gray-400">{Math.round(value)}/{max}</span>
                </div>
              );
            })}
          </div>
          <div className="pt-2"><div className={eyebrow}>Moat</div><MoatRadar moat={idea.moat} /></div>
        </Panel>

        <div className="lg:col-span-8 space-y-4 md:space-y-6">
          <Panel icon={<Users size={18} className="text-blue-500" />} title="Who buys, and why">
            <p className="text-[13.5px] text-gray-800 dark:text-gray-200"><span className="font-semibold">Buyer:</span> {idea.icp}</p>
            <p className="text-[13.5px] text-gray-800 dark:text-gray-200"><span className="font-semibold">Pain:</span> {idea.pain}</p>
          </Panel>
          <Panel icon={<ShieldAlert size={18} className="text-red-500" />} title="Red team" note="why it might not work">
            {idea.risks.length === 0 && <p className="text-[12.5px] text-gray-400">No risks came back for this one; treat it with extra care.</p>}
            {idea.risks.map((r, i) => (
              <div key={i} className="p-3.5 rounded-2xl surface-item space-y-1">
                <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-gray-900 dark:text-white">{r.kind}</span><span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${SEVERITY[r.severity]}`}>{r.severity}</span></div>
                <p className="text-[12.5px] text-gray-600 dark:text-gray-300">{r.detail}</p>
                {r.mitigation && <p className="text-[12px] text-emerald-700 dark:text-emerald-400"><span className="font-semibold">Mitigation:</span> {r.mitigation}</p>}
              </div>
            ))}
          </Panel>
        </div>
      </div>

      {idea.playbook.length > 0 && (
        <Panel icon={<GitBranch size={18} className="text-purple-500" />} title="90-day playbook"
          note={projectExists ? 'already a project' : `becomes a project with ${idea.playbook.length} branches and ${taskCount} tasks`}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {idea.playbook.map((p, i) => (
              <div key={i} className="p-3.5 rounded-2xl surface-item">
                <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${PHASE_DOTS[i % PHASE_DOTS.length]}`} /><span className={eyebrow}>Weeks {p.startWeek}–{p.endWeek}</span></div>
                <p className="text-[13.5px] font-semibold text-gray-900 dark:text-white mt-1">{p.name}</p>
                <ul className="mt-1.5 space-y-1">
                  {p.steps.map((s, k) => <li key={k} className="text-[12.5px] text-gray-600 dark:text-gray-300 flex gap-1.5"><span className="text-gray-300 dark:text-white/30">•</span>{s}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {idea.sources.length > 0 && (
        <Panel icon={<Link2 size={18} className="text-gray-400" />} title="Sources"
          right={dossier && <button onClick={() => onOpenDossier(dossier.id)} className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 hover:underline">Full dossier ›</button>}>
          <ol className="space-y-1">
            {idea.sources.filter(n => sources[n - 1]).map(n => (
              <li key={n} className="text-[12.5px]">
                <span className="text-gray-400 tabular-nums mr-1.5">[{n}]</span>
                <a href={sources[n - 1].url} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600">{sources[n - 1].title}</a>
                <span className="text-gray-400"> · {sources[n - 1].site}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}
