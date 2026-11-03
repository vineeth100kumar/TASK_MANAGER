import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { api } from '../../services/api';
import type { LifeContext, Project } from '../../services/types';
import { selectItems } from '../../services/items';
import { projectTypeInfo, stageOf } from '../../services/projectTypes';
import { useDataChanges } from '../../hooks/useDataChanges';
import { useToast } from '../../context/ToastContext';
import { ProjectTypeMenu } from '../common/ProjectTypePicker';

// The strip at the top of a project's page: its type (tap to change) and one
// chip per status that type uses, with a count; a chip shows only that status.
export function ProjectTypeBar({ projectId, lifeContext, stage, onStage }: { projectId: string; lifeContext?: LifeContext; stage: string; onStage: (stage: string) => void }) {
  const { showToast } = useToast();
  const read = () => {
    // The same items the page below starts from (before its filters), so
    // these counts match the Board's columns and the List's groups.
    const projects = api.sync.getState().projects.filter(Boolean) as Project[];
    return {
      projects,
      items: selectItems(api.workItems.snapshot(), { projectId, lifeContext }, projects).items,
    };
  };
  const [data, setData] = useState(read);
  useEffect(() => setData(read()), [projectId, lifeContext]);
  useDataChanges(() => setData(read()));

  const project = data.projects.find(p => p.id === projectId);
  if (!project) return null;
  const type = projectTypeInfo(project);
  const open = data.items.filter(i => i.status !== 'done').length;
  const done = data.items.length - open;

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
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('sage:edit-project', { detail: project.id }))}
          className="flex items-center gap-1 h-7 px-2 rounded-full text-[12px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          title="Edit name, key, colour and type">
          <Pencil size={12} /> Edit
        </button>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0" role="group" aria-label="Statuses">
        {type.statuses.map((st, i) => {
          const on = stage === st.id;
          const n = data.items.filter(it => stageOf(it, type.statuses).id === st.id).length;
          return (
            <div key={st.id} className="flex items-center gap-1.5 shrink-0">
              {i > 0 && <span className="w-2.5 h-px bg-gray-300 dark:bg-white/15" aria-hidden />}
              <button type="button" onClick={() => onStage(on ? '' : st.id)} aria-pressed={on}
                title={on ? 'Show every status' : `Show only ${st.label}`}
                className={`flex items-center gap-1.5 h-7 pl-2.5 pr-2 rounded-full text-[12.5px] font-semibold transition-colors ${on
                  ? type.chip + ' ring-1 ring-inset ring-current/25'
                  : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-white/10'}`}>
                <st.icon size={13} strokeWidth={2.2} className={on ? '' : st.tint} aria-hidden />
                {st.label}
                <span className={`min-w-4 text-center text-[11px] tabular-nums ${n ? '' : 'opacity-40'}`}>{n}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
