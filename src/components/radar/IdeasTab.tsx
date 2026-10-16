import { useState } from 'react';
import { ArrowUpRight, Lightbulb, Star, GitBranch } from 'lucide-react';
import { money } from '../../services/radar';
import { Dossier, Idea } from '../../services/types';
import { ScoreRing, Tag } from './parts';
import { FitBadge } from './LabTab';

export function IdeasTab({ ideas, dossiers, onOpenIdea, onStudio }: { ideas: Idea[]; dossiers: Dossier[]; onOpenIdea: (id: string) => void; onStudio: () => void }) {
  const [only, setOnly] = useState<'all' | 'starred' | 'projects'>('all');
  const shown = ideas.filter(i => only === 'all' || (only === 'starred' ? i.starred : !!i.projectId));
  const themeOf = (i: Idea) => dossiers.find(d => d.id === i.dossierId)?.theme;

  if (ideas.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <div className="surface-item p-4 rounded-2xl inline-flex text-emerald-500"><Lightbulb size={28} /></div>
        <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">No ideas yet</h3>
        <p className="text-[14px] text-gray-500">Each research run in Studio drafts three ideas, scored out of 100 on timing, pain, money, moat, risk and fit. Sparks you keep in the Lab land here too.</p>
        <button onClick={onStudio} className="mt-2 px-4 py-2 rounded-xl text-[13px] font-semibold bg-gray-900 text-white dark:bg-white dark:text-gray-900">Go to Studio</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {([['all', `All ${ideas.length}`], ['starred', 'Starred'], ['projects', 'In a project']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setOnly(id)} aria-pressed={only === id}
            className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg ${only === id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'}`}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-[13px] text-gray-400 text-center py-10">Nothing here yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 stagger">
          {shown.map(i => (
            <button key={i.id} onClick={() => onOpenIdea(i.id)} className="text-left p-4 rounded-3xl surface-item is-interactive space-y-3">
              <div className="flex items-center gap-3">
                {i.stage === 'spark'
                  ? <span className="w-[52px] h-[52px] shrink-0 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-[11px] font-semibold">Spark</span>
                  : <ScoreRing score={i.score} size={52} />}
                <div className="min-w-0">
                  <p className="font-semibold text-[14px] text-gray-900 dark:text-white flex items-center gap-1.5">
                    <span className="truncate">{i.name}</span>
                    {i.starred && <Star size={13} className="text-amber-500 fill-amber-500 shrink-0" />}
                  </p>
                  <div className="flex gap-1 flex-wrap mt-0.5">{i.tags.map(t => <Tag key={t} tag={t} />)}</div>
                </div>
              </div>
              <p className="text-[12.5px] text-gray-500 dark:text-gray-400 line-clamp-2">{i.oneLiner}</p>
              {themeOf(i) && <p className="text-[11px] text-gray-400 truncate">From “{themeOf(i)}”</p>}
              {i.stage === 'spark' && i.clue && <p className="text-[11px] text-gray-400 truncate">From {i.clue.label}</p>}
              <div className="flex justify-between items-center text-[11.5px] font-semibold text-gray-400">
                {i.stage === 'spark'
                  ? <span className="flex items-center gap-1.5">{typeof i.fit === 'number' && <FitBadge fit={i.fit} why={i.fitWhy} />} Not researched yet</span>
                  : <span>ACV {money(i.acvUsd)} <span className="font-medium">est.</span></span>}
                {i.projectId
                  ? <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400"><GitBranch size={12} /> Project</span>
                  : <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">Open <ArrowUpRight size={12} /></span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
