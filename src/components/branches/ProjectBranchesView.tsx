import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { GitBranch, GitMerge, Plus, MoreHorizontal, Pencil, Trash2, RotateCcw, X } from 'lucide-react';
import { api } from '../../services/api';
import { Project, ProjectBranch, WorkItem } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { getTodayString } from '../../utils/dateUtils';
import { formatShortDate } from '../../utils/quickAddParser';
import { buildFlow, FlowRow } from './branchFlow';
import { useLook } from '../../utils/look';

const BRANCH_COLORS = ['#8b5cf6', '#f97316', '#10b981', '#ec4899', '#0ea5e9', '#eab308', '#ef4444', '#14b8a6'];
const MAIN_COLOR = '#64748b';
// On the blueprint sheet the main line is drawn in light ink.
const BLUEPRINT_MAIN = '#cfe0ff';
const LANE_W = 22;
const ROW_H = 56;
const PAD = 14;
const laneX = (lane: number) => PAD + lane * LANE_W;

interface Props {
  items: WorkItem[];
  lifeContext?: 'work' | 'personal';
  activeWorkspace: string;
  onSelectTask: (id: string) => void;
  onRefreshData?: () => void;
}

/**
 * A project as branches over time: the main line and every branch drawn as
 * lanes, oldest at the top, with each item placed on the day it happened (or
 * is planned) and a line marking today.
 */
export function ProjectBranchesView({ items, lifeContext, activeWorkspace, onSelectTask, onRefreshData }: Props) {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const today = getTodayString();
  const blueprint = useLook() === 'drafting';
  const mainColor = blueprint ? BLUEPRINT_MAIN : MAIN_COLOR;

  const loadProjects = async () => setProjects(await api.projects.list());
  useEffect(() => { loadProjects(); }, []);
  useDataChanges(loadProjects);

  // In a project's space it's that project; elsewhere pick one, starting with the busiest.
  const inProject = projects.some(p => p.id === activeWorkspace);
  const project = useMemo(() => {
    if (inProject) return projects.find(p => p.id === activeWorkspace) || null;
    const picked = projects.find(p => p.id === pickedId);
    if (picked) return picked;
    const counts = new Map<string, number>();
    items.forEach(i => i.projectId && counts.set(i.projectId, (counts.get(i.projectId) || 0) + 1));
    return [...projects].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0))[0] || null;
  }, [projects, activeWorkspace, pickedId, items, inProject]);

  const branches = project?.branches || [];
  const projectItems = useMemo(
    () => (project ? items.filter(i => !i.deletedAt && i.projectId === project.id) : []),
    [items, project]
  );
  const flow = useMemo(() => buildFlow(projectItems, branches, today, mainColor), [projectItems, branches, today, mainColor]);
  const branchById = new Map(branches.map(b => [b.id, b]));
  const lineName = (id: string | null | undefined) => (id && branchById.get(id)?.name) || 'Main';
  const lineColor = (id: string | null | undefined) => (id && branchById.get(id)?.color) || mainColor;
  const todayRow = flow.rows.findIndex(r => r.kind === 'today');

  const refresh = async () => { await loadProjects(); onRefreshData?.(); };

  const moveItem = async (item: WorkItem, branchId: string) => {
    await api.workItems.updateDetails(item.id, { branchId: branchId || null });
    showToast(`Moved to ${lineName(branchId)}`);
    refresh();
  };

  const branchAction = async (b: ProjectBranch, action: 'merge' | 'reopen' | 'rename' | 'delete') => {
    if (!project) return;
    setMenuFor(null);
    if (action === 'merge') {
      await api.projects.updateBranch(project.id, b.id, { mergedAt: today < b.startDate ? b.startDate : today });
      showToast(`Merged ${b.name} into ${lineName(b.parentId)}`);
    } else if (action === 'reopen') {
      await api.projects.updateBranch(project.id, b.id, { mergedAt: null });
      showToast(`${b.name} is open again`);
    } else if (action === 'rename') {
      const name = window.prompt('Branch name', b.name)?.trim();
      if (!name || name === b.name) return;
      await api.projects.updateBranch(project.id, b.id, { name });
    } else {
      if (!window.confirm(`Delete branch "${b.name}"? Its items move to ${lineName(b.parentId)}.`)) return;
      await api.projects.deleteBranch(project.id, b.id);
      showToast(`Deleted ${b.name}`);
    }
    refresh();
  };

  if (projects.length === 0) {
    return <EmptyState text="Create a project from the sidebar to see its branches here." />;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!inProject && projects.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Project">
            {projects.map(p => (
              <button key={p.id} role="tab" aria-selected={p.id === project?.id} onClick={() => setPickedId(p.id)}
                className={`px-3 py-1.5 rounded-xl text-[13px] font-semibold transition-colors ${p.id === project?.id ? 'bg-gray-900 text-white dark:bg-white dark:text-black' : 'surface-item text-gray-600 dark:text-gray-300'}`}>
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">{project?.name}</h2>
        )}
        <span className="flex-1" />
        <button onClick={() => setIsAdding(v => !v)}
          className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13.5px] font-semibold shadow-sm shadow-violet-600/25 active:scale-[0.97] transition-all">
          <GitBranch size={15} /> New branch
        </button>
      </div>

      {isAdding && project && (
        <NewBranchForm project={project} today={today} onCancel={() => setIsAdding(false)}
          onCreate={async (b) => {
            await api.projects.addBranch(project.id, b);
            setIsAdding(false);
            showToast(`Branch ${b.name} started`);
            refresh();
          }} />
      )}

      {/* Lines: main plus every branch, with what each holds and its state. */}
      <div className="flex flex-wrap gap-2">
        <LineChip name="Main" color={MAIN_COLOR} count={projectItems.filter(i => !i.branchId || !branchById.has(i.branchId)).length} />
        {branches.map(b => (
          <div key={b.id} className="relative">
            <LineChip name={b.name} color={b.color} merged={!!b.mergedAt}
              count={projectItems.filter(i => i.branchId === b.id).length}
              onMenu={() => setMenuFor(m => m === b.id ? null : b.id)} />
            {menuFor === b.id && (
              <div className="absolute z-20 top-full mt-1 left-0 min-w-[10rem] p-1 rounded-xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/10 shadow-xl">
                {b.mergedAt
                  ? <MenuItem icon={RotateCcw} label="Reopen" onClick={() => branchAction(b, 'reopen')} />
                  : <MenuItem icon={GitMerge} label={`Merge into ${lineName(b.parentId)}`} onClick={() => branchAction(b, 'merge')} />}
                <MenuItem icon={Pencil} label="Rename" onClick={() => branchAction(b, 'rename')} />
                <MenuItem icon={Trash2} label="Delete" danger onClick={() => branchAction(b, 'delete')} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={blueprint ? 'dark blueprint rounded-3xl overflow-hidden' : 'rounded-3xl surface border border-black/5 dark:border-white/5 overflow-hidden'}>
        <ol aria-label={`${project?.name} timeline`}>
          {flow.rows.map((row, r) => (
            <li key={rowKey(row)} className={`flex items-stretch ${blueprint ? 'transition-colors hover:bg-[#cfe0ff]/[0.06] focus-within:bg-[#cfe0ff]/[0.06]' : ''}`} style={{ height: ROW_H }}>
              <svg width={PAD * 2 + (flow.laneCount - 1) * LANE_W} height={ROW_H} className="shrink-0" aria-hidden>
                <RowGraph row={row} r={r} flow={flow} todayRow={todayRow} lineColor={lineColor} />
              </svg>
              <div className="flex-1 min-w-0 flex items-center pr-3 md:pr-5 border-b border-black/[0.04] dark:border-white/[0.04]">
                <RowContent row={row} lineName={lineName} branches={branches} onSelectTask={onSelectTask} onMove={moveItem} today={blueprint ? today : null} />
              </div>
            </li>
          ))}
        </ol>
      </div>

      {blueprint && project && <TitleBlock project={project} items={projectItems} today={today} />}

      {project && <AddItemBar project={project} branches={branches.filter(b => !b.mergedAt)} today={today} lifeContext={lifeContext}
        onAdded={(name) => { showToast(`Added to ${name}`); refresh(); }} />}
    </div>
  );
}

const rowKey = (row: FlowRow) =>
  row.kind === 'item' ? row.item.id : row.kind === 'today' ? 'today' : `${row.kind}:${row.branch.id}`;

function RowGraph({ row, r, flow, todayRow, lineColor }: {
  row: FlowRow; r: number; flow: ReturnType<typeof buildFlow>; todayRow: number; lineColor: (id?: string | null) => string;
}) {
  const mid = ROW_H / 2;
  const parts: ReactElement[] = [];
  // Lines after today are plans, so they're dashed.
  const dashTop = r > todayRow ? '3 4' : undefined;
  const dashBottom = r >= todayRow ? '3 4' : undefined;

  flow.spans.forEach((s, i) => {
    if (r < s.from || r > s.to) return;
    const x = laneX(s.lane);
    const isBranch = i > 0;
    const startsHere = isBranch && r === s.from;   // the fork curve draws this row
    const mergesHere = isBranch && !s.open && r === s.to; // the merge curve draws this row
    if (startsHere || mergesHere) return;
    if (r > s.from) parts.push(<line key={`t${i}`} x1={x} y1={0} x2={x} y2={mid} stroke={s.color} strokeWidth={2} strokeDasharray={dashTop} />);
    if (r < s.to) parts.push(<line key={`b${i}`} x1={x} y1={mid} x2={x} y2={ROW_H} stroke={s.color} strokeWidth={2} strokeDasharray={dashBottom} />);
  });

  if (row.kind === 'fork' || row.kind === 'merge') {
    const px = laneX(row.parentLane);
    const bx = laneX(row.lane);
    const color = row.branch.color;
    const d = row.kind === 'fork'
      ? `M ${px} ${mid} C ${px} ${ROW_H}, ${bx} ${mid}, ${bx} ${ROW_H}`
      : `M ${bx} 0 C ${bx} ${mid}, ${px} 0, ${px} ${mid}`;
    parts.push(<path key="curve" d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={row.kind === 'fork' ? dashBottom : dashTop} />);
    parts.push(<circle key="dot" cx={px} cy={mid} r={4.5} fill="var(--branch-bg, white)" stroke={color} strokeWidth={2.5} className="branch-node" />);
  } else if (row.kind === 'item') {
    const x = laneX(row.lane);
    const color = lineColor(row.branch?.id);
    const done = row.item.status === 'done';
    const blocked = row.item.status === 'blocked';
    if (row.item.entityType === 'milestone') {
      parts.push(<rect key="node" x={x - 6} y={mid - 6} width={12} height={12} transform={`rotate(45 ${x} ${mid})`}
        fill={done ? color : 'var(--branch-bg, white)'} stroke={color} strokeWidth={2.5} className={done ? '' : 'branch-node'} />);
    } else {
      parts.push(<circle key="node" cx={x} cy={mid} r={done ? 6 : 5.5}
        fill={done ? color : 'var(--branch-bg, white)'} stroke={blocked ? '#ef4444' : color} strokeWidth={2.5} className={done ? '' : 'branch-node'} />);
    }
  } else if (row.kind === 'today') {
    parts.push(<line key="today" x1={0} y1={mid} x2="100%" y2={mid} stroke="#3b82f6" strokeWidth={1.5} />);
    parts.push(<circle key="tdot" cx={laneX(0)} cy={mid} r={4} fill="#3b82f6" />);
  }
  return <>{parts}</>;
}

function RowContent({ row, lineName, branches, onSelectTask, onMove, today }: {
  row: FlowRow;
  /** Set on the blueprint sheet: fork rows then show how long the branch ran. */
  today: string | null;
  lineName: (id?: string | null) => string;
  branches: ProjectBranch[];
  onSelectTask: (id: string) => void;
  onMove: (item: WorkItem, branchId: string) => void;
}) {
  if (row.kind === 'today') {
    return (
      <div className="flex items-center gap-2 w-full">
        <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Today</span>
        <span className="text-[12px] text-gray-400">{formatShortDate(row.date)}</span>
        <span className="flex-1 h-px bg-blue-500/30" />
      </div>
    );
  }
  if (row.kind === 'fork' || row.kind === 'merge') {
    const Icon = row.kind === 'fork' ? GitBranch : GitMerge;
    return (
      <div className="flex items-center gap-2 min-w-0 text-[13px]">
        <Icon size={14} style={{ color: row.branch.color }} className="shrink-0" />
        <span className="truncate text-gray-600 dark:text-gray-300">
          <span className="font-semibold" style={{ color: row.branch.color }}>{row.branch.name}</span>
          {row.kind === 'fork' ? ` branched from ${lineName(row.branch.parentId)}` : ` merged into ${lineName(row.branch.parentId)}`}
        </span>
        <span className="shrink-0 text-[12px] text-gray-400">{formatShortDate(row.date)}</span>
        {today && row.kind === 'fork' && <Dimension branch={row.branch} today={today} />}
      </div>
    );
  }
  const { item } = row;
  const done = item.status === 'done';
  const when = done ? `Done ${formatShortDate(row.date)}`
    : (item.startDate || item.dueDate || item.startAt) ? `${row.date < getTodayString() ? 'Was due' : 'Due'} ${formatShortDate(row.date)}`
    : `Added ${formatShortDate(row.date)}`;
  return (
    <div className="group flex items-center gap-3 w-full min-w-0">
      <button onClick={() => onSelectTask(item.id)} className="min-w-0 flex-1 text-left">
        <div className={`text-[14px] font-medium truncate ${done ? 'text-gray-400 line-through decoration-gray-300 dark:decoration-gray-600' : 'text-gray-900 dark:text-white'}`}>{item.title}</div>
        <div className="text-[11.5px] text-gray-400 truncate">
          {when}{item.status === 'blocked' && <span className="text-red-500 font-semibold"> · Blocked</span>}
          {item.status === 'in_progress' && <span className="text-blue-500 font-semibold"> · In progress</span>}
        </div>
      </button>
      {branches.length > 0 && (
        <select value={item.branchId && branches.some(b => b.id === item.branchId) ? item.branchId : ''} onChange={e => onMove(item, e.target.value)}
          aria-label={`Branch for ${item.title}`}
          className="shrink-0 max-w-[8.5rem] text-[12px] font-semibold rounded-lg px-1.5 py-1 bg-transparent text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 outline-none cursor-pointer md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity dark:[color-scheme:dark]">
          <option value="">Main</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.mergedAt ? ' (merged)' : ''}</option>)}
        </select>
      )}
    </div>
  );
}

function LineChip({ name, color, count, merged, onMenu }: { name: string; color: string; count: number; merged?: boolean; onMenu?: () => void }) {
  return (
    <div className="flex items-center gap-2 pl-3 pr-1.5 h-9 rounded-xl surface-item text-[13px]">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span className="font-semibold text-gray-800 dark:text-gray-100">{name}</span>
      <span className="text-gray-400 tabular-nums">{count}</span>
      {merged && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-0.5"><GitMerge size={11} />Merged</span>}
      {onMenu ? (
        <button onClick={onMenu} aria-label={`${name} options`} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"><MoreHorizontal size={15} /></button>
      ) : <span className="w-1.5" />}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium text-left hover:bg-black/5 dark:hover:bg-white/10 ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}

function NewBranchForm({ project, today, onCancel, onCreate }: {
  project: Project; today: string; onCancel: () => void; onCreate: (b: Omit<ProjectBranch, 'id' | 'createdAt'>) => void;
}) {
  const branches = project.branches || [];
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [color, setColor] = useState(BRANCH_COLORS[branches.length % BRANCH_COLORS.length]);
  const field = 'h-9 rounded-xl px-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[13.5px] font-medium text-gray-900 dark:text-white outline-none focus:border-violet-500 dark:[color-scheme:dark]';
  return (
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) onCreate({ name: name.trim(), parentId: parentId || null, startDate, color, mergedAt: null }); }}
      className="p-4 rounded-2xl surface border border-black/5 dark:border-white/5 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 flex-1 min-w-[10rem]">
        <span className="text-[11.5px] font-semibold text-gray-500">Branch name</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mobile app" className={field} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-gray-500">Branch from</span>
        <select value={parentId} onChange={e => setParentId(e.target.value)} className={field}>
          <option value="">Main</option>
          {branches.filter(b => !b.mergedAt).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-gray-500">Starts</span>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value || today)} className={field} />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-gray-500">Colour</span>
        <div className="flex gap-1.5 h-9 items-center">
          {BRANCH_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Colour ${c}`} aria-pressed={color === c}
              className={`w-5 h-5 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white dark:ring-offset-[#1c1c1e]' : ''}`} style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-9 px-3 rounded-xl text-[13.5px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"><X size={16} /></button>
        <button type="submit" className="h-9 px-4 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black text-[13.5px] font-semibold">Create</button>
      </div>
    </form>
  );
}

function AddItemBar({ project, branches, today, lifeContext, onAdded }: {
  project: Project; branches: ProjectBranch[]; today: string; lifeContext?: 'work' | 'personal'; onAdded: (lineName: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(today);
  const field = 'h-9 rounded-xl px-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[13.5px] font-medium text-gray-900 dark:text-white outline-none focus:border-blue-500 dark:[color-scheme:dark]';
  return (
    <form className="flex flex-wrap gap-2" onSubmit={async e => {
      e.preventDefault();
      if (!title.trim()) return;
      await api.workItems.create({ title: title.trim(), projectId: project.id, branchId: branchId || null, dueDate: date || null, lifeContext: lifeContext || 'work' });
      setTitle('');
      onAdded(branches.find(b => b.id === branchId)?.name || 'Main');
    }}>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder={`Add a step to ${project.name}...`} className={`${field} flex-1 min-w-[12rem]`} />
      <select value={branchId} onChange={e => setBranchId(e.target.value)} aria-label="Branch" className={field}>
        <option value="">Main</option>
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" className={field} />
      <button type="submit" className="h-9 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13.5px] font-semibold flex items-center gap-1"><Plus size={15} /> Add</button>
    </form>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400">
      <GitBranch size={36} className="mb-3 opacity-40" />
      <p className="text-[14px]">{text}</p>
    </div>
  );
}

const DAY_MS = 86400000;
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS));

/** A dimension line: how long a branch ran, or has been open so far. */
function Dimension({ branch, today }: { branch: ProjectBranch; today: string }) {
  const days = daysBetween(branch.startDate, branch.mergedAt || today);
  const open = !branch.mergedAt;
  return (
    <span className="hidden sm:flex shrink-0 items-center gap-1 ml-1 font-tech text-[10px] font-bold text-[#8fb0e6]" title={open ? 'Open so far' : 'From branch to merge'}>
      <span aria-hidden>|&#8592;</span>
      <span>{days} {days === 1 ? 'DAY' : 'DAYS'}{open ? ' · OPEN' : ''}</span>
      <span aria-hidden>&#8594;|</span>
    </span>
  );
}

/** The drawing's title block: what this sheet is, with its counts and date. */
function TitleBlock({ project, items, today }: { project: Project; items: WorkItem[]; today: string }) {
  const branches = project.branches || [];
  const merged = branches.filter(b => b.mergedAt).length;
  const done = items.filter(i => i.status === 'done').length;
  const rows: [string, string][] = [
    ['Project', project.name],
    ['Drawing', `SAGE-${(project.key || project.name.slice(0, 4)).toUpperCase()}-BR`],
    ['Branches', `${branches.length} · ${merged} merged`],
    ['Items', `${done} of ${items.length} done`],
    ['Date', today],
  ];
  return (
    <dl className="dark blueprint ml-auto w-full sm:w-[22rem] rounded-xl font-tech text-[11px] overflow-hidden">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[6.5rem_1fr] border-b last:border-b-0 border-[#cfe0ff]/25">
          <dt className="px-3 py-1.5 uppercase text-[9.5px] text-[#8fb0e6] border-r border-[#cfe0ff]/25">{k}</dt>
          <dd className="px-3 py-1.5 font-bold text-[#e6efff] truncate uppercase">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
