import { ReactNode } from 'react';
import { WorkItem } from '../../services/types';
import { groupByProject, ProjectGroup } from '../../utils/taskLists';

interface Props {
  items: WorkItem[];
  children: (item: WorkItem, grouped: boolean) => ReactNode;
}

// Several projects: a quiet header per project, so similar names stay apart.
// One project (or none): a plain list with no headers.
export function ProjectGroups({ items, children }: Props) {
  const groups: ProjectGroup[] = groupByProject(items);
  if (groups.length < 2) return <>{items.map(i => children(i, false))}</>;
  return (
    <>
      {groups.map(g => (
        <div key={g.key} className="pt-2 first:pt-0">
          <h4 className="flex items-center gap-2 px-1 pb-1 text-[11.5px] font-semibold uppercase tracking-wide text-gray-400">
            {g.color && <span className="w-2 h-2 rounded-full" style={{ background: g.color }} aria-hidden />}
            <span className="truncate">{g.name}</span>
            <span className="tabular-nums text-gray-300 dark:text-gray-600">{g.items.length}</span>
          </h4>
          {g.items.map(i => children(i, true))}
        </div>
      ))}
    </>
  );
}
