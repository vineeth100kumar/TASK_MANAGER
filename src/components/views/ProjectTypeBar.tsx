import { useState } from 'react';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import { projectTypeInfo } from '../../services/projectTypes';
import { useDataChanges } from '../../hooks/useDataChanges';
import { useToast } from '../../context/ToastContext';
import { ProjectTypeMenu } from '../common/ProjectTypePicker';

// The strip at the top of a project's page: its type (tap to change) and, for
// types with a usual flow, one chip per stage. Stages are plain tags on items,
// so a chip filters by its tag and works with every view.
export function ProjectTypeBar({ projectId, tag, onTag }: { projectId: string; tag: string; onTag: (tag: string) => void }) {
  const { showToast } = useToast();
  const read = () => {
    const state = api.sync.getState();
    return {
      projects: state.projects.filter(Boolean) as Project[],
      items: state.workItems.filter(i => i && !i.deletedAt && i.projectId === projectId),
    };
  };
  const [data, setData] = useState(read);
  useDataChanges(() => setData(read()));

  const project = data.projects.find(p => p.id === projectId);
  if (!project) return null;
  const type = projectTypeInfo(project);
  const open = data.items.filter(i => i.status !== 'done').length;
  const done = data.items.length - open;
  const count = (stage: string) => data.items.filter(i => i.status !== 'done' && (i.labels || []).includes(stage)).length;

  const changeType = async (next: string) => {
    if (next === (project.type || '')) return;
    try {
      await api.projects.update(project.id, { type: next });
      setData(read());
      showToast(`${project.name} is now ${projectTypeInfo(next).label}`);
    } catch (e: any) {
      showToast(e.message || 'Could not change the type', 'error');
    }
  };

  return (
    <div className="mb-4 md:mb-5 flex flex-col md:flex-row md:items-center gap-2.5 md:gap-4">
      <div className="flex items-center gap-2.5 shrink-0">
        <ProjectTypeMenu project={project} projects={data.projects} onChange={changeType} />
        <span className="text-[12.5px] text-gray-500 tabular-nums">{open} open · {done} done</span>
      </div>
      {type.stages.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0" role="group" aria-label="Stages">
          <span className="hidden md:inline text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 mr-1">Stages</span>
          {type.stages.map((stage, i) => {
            const on = tag === stage;
            const n = count(stage);
            return (
              <div key={stage} className="flex items-center gap-1.5 shrink-0">
                {i > 0 && <span className="w-2.5 h-px bg-gray-300 dark:bg-white/15" aria-hidden />}
                <button type="button" onClick={() => onTag(on ? '' : stage)} aria-pressed={on}
                  title={on ? 'Show every stage' : `Show items tagged #${stage}`}
                  className={`flex items-center gap-1.5 h-7 pl-2.5 pr-2 rounded-full text-[12.5px] font-semibold capitalize transition-colors ${on
                    ? type.chip + ' ring-1 ring-current/30'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-white/10'}`}>
                  {stage}
                  <span className={`min-w-4 text-center text-[11px] tabular-nums ${n ? '' : 'opacity-40'}`}>{n}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
