import React, { useState, useRef, useMemo } from 'react';
import {
  Folder, Flag, CheckCircle2, Circle, CheckSquare, Plus,
  Search, ZoomIn, ZoomOut, RotateCcw, Lock, Calendar, Clock,
  ChevronDown, ChevronRight, Trash2
} from 'lucide-react';
import { Project, Milestone, WorkItem } from '../../types';
import { formatRelativeDate } from '../../utils/dateHelpers';

interface ProjectMapProps {
  project: Project;
  allProjects?: Project[];
  milestones: Milestone[];
  items: WorkItem[];
  onSelectProject?: (projectId: string) => void;
  onToggleComplete?: (item: WorkItem) => void;
  onToggleSubtask?: (itemId: string, subtaskId: string) => void;
  onAddSubtask?: (itemId: string, title: string) => void;
  onDeleteSubtask?: (itemId: string, subtaskId: string) => void;
  onCreateItem?: (item: any) => void;
  onCreateMilestone?: (m: { project_id?: string; title: string; due_date: string }) => void;
  onClose?: () => void;
}

export const ProjectMap: React.FC<ProjectMapProps> = ({
  project,
  allProjects = [],
  milestones,
  items,
  onSelectProject,
  onToggleComplete,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onCreateItem,
  onCreateMilestone,
  onClose,
}) => {
  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Filter & Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'completed'>('all');
  const [expandedTasks, setExpandedTasks] = useState<{ [taskId: string]: boolean }>({});
  const [newSubtaskInputs, setNewSubtaskInputs] = useState<{ [taskId: string]: string }>({});

  // Quick Add states
  const [quickAddMilestoneId, setQuickAddMilestoneId] = useState<string | null>(null);
  const [quickTaskTitle, setQuickTaskTitle] = useState('');
  const [isAddingMilestone, setIsAddingMilestone] = useState(false);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);

  // Project data
  const projectMilestones = useMemo(() => {
    return milestones
      .filter((m) => m.project_id === project.id)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [milestones, project.id]);

  const projectTasks = useMemo(() => {
    return items.filter((i) => i.project_id === project.id);
  }, [items, project.id]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return projectTasks.filter((task) => {
      if (filterMode === 'active' && task.is_completed) return false;
      if (filterMode === 'completed' && !task.is_completed) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(q);
        const matchesDesc = (task.description || '').toLowerCase().includes(q);
        const matchesSubtask = (task.subtasks || []).some((s) => s.title.toLowerCase().includes(q));
        if (!matchesTitle && !matchesDesc && !matchesSubtask) return false;
      }
      return true;
    });
  }, [projectTasks, filterMode, searchQuery]);

  // Group tasks by milestone (with an unassigned/backlog group)
  const tasksByMilestone = useMemo(() => {
    const map: { [key: string]: WorkItem[] } = {};
    for (const m of projectMilestones) {
      map[m.id] = [];
    }
    map['unassigned'] = [];

    for (const t of filteredTasks) {
      if (t.milestone_id && map[t.milestone_id]) {
        map[t.milestone_id].push(t);
      } else {
        map['unassigned'].push(t);
      }
    }
    return map;
  }, [projectMilestones, filteredTasks]);

  // Overall calculations
  const totalTasks = projectTasks.length;
  const completedTasks = projectTasks.filter((t) => t.is_completed).length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const totalSubtasks = useMemo(() => {
    return projectTasks.reduce((acc, t) => acc + (t.subtasks?.length || 0), 0);
  }, [projectTasks]);

  const completedSubtasks = useMemo(() => {
    return projectTasks.reduce(
      (acc, t) => acc + (t.subtasks?.filter((s) => s.is_completed).length || 0),
      0
    );
  }, [projectTasks]);

  // Zoom / Pan handlers
  const handleZoomIn = () => setZoom((prev) => Math.min(1.4, prev + 0.15));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.65, prev - 0.15));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only pan when clicking canvas background, not inside interactive cards
    if ((e.target as HTMLElement).closest('.interactive-node')) return;
    setIsPanning(true);
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - startPan.x,
      y: e.clientY - startPan.y,
    });
  };

  const handleMouseUp = () => setIsPanning(false);

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const handleAddSubtaskSubmit = (taskId: string) => {
    const title = (newSubtaskInputs[taskId] || '').trim();
    if (!title) return;
    onAddSubtask?.(taskId, title);
    setNewSubtaskInputs((prev) => ({ ...prev, [taskId]: '' }));
  };

  const handleQuickAddTaskSubmit = (milestoneId?: string) => {
    if (!quickTaskTitle.trim()) return;
    onCreateItem?.({
      title: quickTaskTitle.trim(),
      project_id: project.id,
      milestone_id: milestoneId === 'unassigned' ? undefined : milestoneId,
      priority: 'medium',
      status: 'todo',
      entity_type: 'task',
    });
    setQuickTaskTitle('');
    setQuickAddMilestoneId(null);
  };

  const handleAddMilestoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMilestoneTitle.trim() || !newMilestoneDueDate) return;
    onCreateMilestone?.({
      project_id: project.id,
      title: newMilestoneTitle.trim(),
      due_date: newMilestoneDueDate,
    });
    setNewMilestoneTitle('');
    setNewMilestoneDueDate('');
    setIsAddingMilestone(false);
  };

  return (
    <div className="flex flex-col h-full bg-ground border border-stone-300 dark:border-stone-800 rounded-2xl shadow-sm overflow-hidden animate-in fade-in">
      {/* Top Map Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-surface border-b border-hairline/80 z-20">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Project Switcher */}
          {allProjects.length > 1 && onSelectProject ? (
            <div className="flex items-center gap-2">
              <span className="text-caption text-ink-3 font-semibold uppercase tracking-wider">Project</span>
              <select
                value={project.id}
                onChange={(e) => onSelectProject(e.target.value)}
                className="bg-sunken border border-hairline rounded-control px-2.5 py-1 text-meta font-bold text-ink focus:outline-none"
              >
                {allProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    ● {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full shadow-sm"
                style={{ backgroundColor: project.color || '#3b82f6' }}
              />
              <span className="text-body font-bold text-ink">{project.name}</span>
            </div>
          )}

          {/* Metrics Pill */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-sunken border border-hairline text-caption text-ink-2">
            <span>
              <strong className="text-ink">{completedTasks}</strong>/{totalTasks} tasks
            </span>
            <span className="text-ink-3">·</span>
            <span className="font-semibold text-accent-600 dark:text-accent-400">{progressPct}% done</span>
            {totalSubtasks > 0 && (
              <>
                <span className="text-ink-3">·</span>
                <span>
                  <strong className="text-ink">{completedSubtasks}</strong>/{totalSubtasks} subtasks
                </span>
              </>
            )}
          </div>
        </div>

        {/* Search, Filters, Zoom Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-3 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-32 sm:w-44 pl-8 pr-2.5 py-1 rounded-control bg-sunken border border-hairline text-meta text-ink placeholder-ink-3 focus:outline-none focus:w-48 transition-all"
            />
          </div>

          {/* Filter Mode */}
          <div className="flex items-center bg-sunken rounded-control p-0.5 border border-hairline text-caption">
            {(['all', 'active', 'completed'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-2 py-0.5 rounded capitalize transition-colors ${
                  filterMode === mode
                    ? 'bg-surface text-ink font-semibold shadow-xs'
                    : 'text-ink-3 hover:text-ink'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Zoom Buttons */}
          <div className="flex items-center gap-1 bg-sunken rounded-control p-0.5 border border-hairline">
            <button
              onClick={handleZoomOut}
              className="p-1 text-ink-3 hover:text-ink rounded transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-caption font-mono px-1 text-ink-3 select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1 text-ink-3 hover:text-ink rounded transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetView}
              className="p-1 text-ink-3 hover:text-ink rounded transition-colors border-l border-hairline ml-0.5"
              title="Reset view"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="px-2.5 py-1 rounded-control bg-sunken hover:bg-hairline/60 text-ink-2 hover:text-ink text-meta font-medium transition-colors"
            >
              List view
            </button>
          )}
        </div>
      </div>

      {/* Pannable & Zoomable Map Canvas */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="relative flex-1 overflow-hidden min-h-[560px] cursor-grab active:cursor-grabbing select-none bg-ground"
        style={{
          backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
          color: 'var(--color-ink-3)',
          opacity: 0.98,
        }}
      >
        {/* Transform Layer */}
        <div
          className="absolute inset-0 origin-top-left transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${pan.x + 40}px, ${pan.y + 40}px) scale(${zoom})`,
          }}
        >
          {/* Main Map Hierarchy Flow */}
          <div className="inline-flex flex-col gap-10 items-start pb-40 pr-40">
            {/* ---------------- PROJECT ROOT NODE ---------------- */}
            <div
              className="interactive-node relative rounded-2xl bg-surface border-2 shadow-md p-5 min-w-[320px] max-w-md transition-all hover:shadow-lg"
              style={{ borderColor: project.color || '#3b82f6' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-sm"
                    style={{ backgroundColor: project.color || '#3b82f6' }}
                  >
                    <Folder className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-caption uppercase tracking-wider text-ink-3 font-bold block">Strategic Project</span>
                    <h2 className="text-lg font-bold text-ink leading-tight">{project.name}</h2>
                  </div>
                </div>

                {/* Progress Dial */}
                <div className="text-right">
                  <span className="text-xl font-extrabold text-ink font-mono">{progressPct}%</span>
                  <span className="text-caption text-ink-3 block">completed</span>
                </div>
              </div>

              {project.description && (
                <p className="text-meta text-ink-2 mt-2.5 leading-relaxed bg-sunken/60 p-2.5 rounded-lg border border-hairline/60">
                  {project.description}
                </p>
              )}

              {/* Action Bar inside Project Node */}
              <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-hairline text-caption text-ink-2">
                <div className="flex items-center gap-2">
                  <span>🚩 {projectMilestones.length} milestones</span>
                  <span>·</span>
                  <span>📋 {totalTasks} deliverables</span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsAddingMilestone(!isAddingMilestone)}
                    className="px-2 py-1 rounded bg-accent-500/10 hover:bg-accent-500/20 text-accent-600 dark:text-accent-400 font-semibold transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Milestone
                  </button>
                  <button
                    onClick={() => {
                      setQuickAddMilestoneId('unassigned');
                      setQuickTaskTitle('');
                    }}
                    className="px-2 py-1 rounded bg-sunken hover:bg-hairline text-ink font-semibold transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Task
                  </button>
                </div>
              </div>

              {/* Inline Add Milestone Form */}
              {isAddingMilestone && (
                <form
                  onSubmit={handleAddMilestoneSubmit}
                  className="mt-3 p-2.5 rounded-xl bg-sunken border border-hairline flex flex-col gap-2"
                >
                  <input
                    type="text"
                    required
                    placeholder="Milestone title (e.g. Beta Release v1)"
                    value={newMilestoneTitle}
                    onChange={(e) => setNewMilestoneTitle(e.target.value)}
                    className="bg-surface border border-hairline rounded px-2 py-1 text-meta text-ink focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      required
                      value={newMilestoneDueDate}
                      onChange={(e) => setNewMilestoneDueDate(e.target.value)}
                      className="bg-surface border border-hairline rounded px-2 py-1 text-meta text-ink focus:outline-none flex-1"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1 bg-accent-500 text-white rounded text-caption font-bold"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingMilestone(false)}
                      className="px-2 py-1 text-ink-3 text-caption hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* ---------------- MILESTONE STREAMS & TASK TREES ---------------- */}
            <div className="flex items-start gap-8 pl-6 relative">
              {/* Vertical trunk connecting root down to streams */}
              <div
                className="absolute -top-10 left-6 w-0.5 bg-gradient-to-b from-stone-400 to-transparent dark:from-stone-600 h-10"
              />

              {/* 1. Milestone Columns */}
              {projectMilestones.map((m) => {
                const streamTasks = tasksByMilestone[m.id] || [];
                const mTotal = streamTasks.length;
                const mDone = streamTasks.filter((t) => t.is_completed).length;
                const mPct = mTotal > 0 ? Math.round((mDone / mTotal) * 100) : 0;
                const isAdding = quickAddMilestoneId === m.id;

                return (
                  <div key={m.id} className="flex flex-col gap-3 min-w-[300px] max-w-[340px]">
                    {/* Milestone Header Card */}
                    <div className="interactive-node p-3.5 rounded-xl bg-surface border border-stone-300 dark:border-stone-800 shadow-sm relative group hover:border-amber-500/60 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Flag
                            className={`w-4 h-4 ${
                              m.status === 'achieved'
                                ? 'text-emerald-500'
                                : 'text-amber-500'
                            }`}
                          />
                          <h3 className="text-meta font-bold text-ink truncate max-w-[180px]">{m.title}</h3>
                        </div>
                        <span
                          className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full ${
                            m.status === 'achieved'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {m.status}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-caption text-ink-3 mt-2">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-ink-2" />
                          {formatRelativeDate(m.due_date)}
                        </span>
                        <span className="font-medium text-ink-2">
                          {mDone}/{mTotal} deliverables ({mPct}%)
                        </span>
                      </div>

                      {/* Milestone Progress bar */}
                      <div className="w-full bg-sunken rounded-full h-1.5 mt-2 overflow-hidden border border-hairline/60">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-300"
                          style={{ width: `${mPct}%` }}
                        />
                      </div>

                      {/* Quick Add Task button */}
                      <div className="mt-2.5 pt-2 border-t border-hairline flex justify-end">
                        <button
                          onClick={() => {
                            setQuickAddMilestoneId(isAdding ? null : m.id);
                            setQuickTaskTitle('');
                          }}
                          className="flex items-center gap-1 text-caption font-semibold text-accent-600 dark:text-accent-400 hover:text-accent-500"
                        >
                          <Plus className="w-3 h-3" /> Add task
                        </button>
                      </div>

                      {isAdding && (
                        <div className="mt-2 pt-2 border-t border-hairline flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="New deliverable..."
                            value={quickTaskTitle}
                            onChange={(e) => setQuickTaskTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleQuickAddTaskSubmit(m.id);
                            }}
                            className="flex-1 bg-sunken border border-hairline rounded px-2 py-1 text-meta text-ink focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={() => handleQuickAddTaskSubmit(m.id)}
                            className="px-2 py-1 bg-accent-500 text-white rounded text-caption font-bold"
                          >
                            Add
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Task Cards in this Milestone */}
                    <div className="flex flex-col gap-2 pl-2 border-l-2 border-dashed border-stone-300 dark:border-stone-800 ml-3">
                      {streamTasks.length === 0 ? (
                        <div className="p-3 text-caption text-ink-3 italic bg-sunken/40 rounded-lg border border-dashed border-hairline">
                          No deliverables linked to this milestone yet.
                        </div>
                      ) : (
                        streamTasks.map((task) => (
                          <TaskMapCard
                            key={task.id}
                            task={task}
                            isExpanded={!!expandedTasks[task.id]}
                            newSubtaskTitle={newSubtaskInputs[task.id] || ''}
                            onToggleExpanded={() => toggleTaskExpanded(task.id)}
                            onToggleComplete={() => onToggleComplete?.(task)}
                            onToggleSubtask={(subId) => onToggleSubtask?.(task.id, subId)}
                            onDeleteSubtask={(subId) => onDeleteSubtask?.(task.id, subId)}
                            onSubtaskInputChange={(val) =>
                              setNewSubtaskInputs((prev) => ({ ...prev, [task.id]: val }))
                            }
                            onAddSubtask={() => handleAddSubtaskSubmit(task.id)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 2. Unassigned / Backlog Stream */}
              {(tasksByMilestone['unassigned'] || []).length > 0 || quickAddMilestoneId === 'unassigned' ? (
                <div className="flex flex-col gap-3 min-w-[300px] max-w-[340px]">
                  <div className="interactive-node p-3.5 rounded-xl bg-surface border border-stone-300 dark:border-stone-800 shadow-sm relative">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Folder className="w-4 h-4 text-ink-3" />
                        <h3 className="text-meta font-bold text-ink">General & Backlog</h3>
                      </div>
                      <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-sunken text-ink-3">
                        {(tasksByMilestone['unassigned'] || []).length} tasks
                      </span>
                    </div>

                    <p className="text-caption text-ink-3 mt-1">Deliverables not tied to a specific milestone.</p>

                    <div className="mt-2.5 pt-2 border-t border-hairline flex justify-end">
                      <button
                        onClick={() => {
                          setQuickAddMilestoneId(quickAddMilestoneId === 'unassigned' ? null : 'unassigned');
                          setQuickTaskTitle('');
                        }}
                        className="flex items-center gap-1 text-caption font-semibold text-accent-600 dark:text-accent-400 hover:text-accent-500"
                      >
                        <Plus className="w-3 h-3" /> Add task
                      </button>
                    </div>

                    {quickAddMilestoneId === 'unassigned' && (
                      <div className="mt-2 pt-2 border-t border-hairline flex items-center gap-1">
                        <input
                          type="text"
                          placeholder="New deliverable..."
                          value={quickTaskTitle}
                          onChange={(e) => setQuickTaskTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleQuickAddTaskSubmit('unassigned');
                          }}
                          className="flex-1 bg-sunken border border-hairline rounded px-2 py-1 text-meta text-ink focus:outline-none"
                          autoFocus
                        />
                        <button
                          onClick={() => handleQuickAddTaskSubmit('unassigned')}
                          className="px-2 py-1 bg-accent-500 text-white rounded text-caption font-bold"
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Tasks List */}
                  <div className="flex flex-col gap-2 pl-2 border-l-2 border-dashed border-stone-300 dark:border-stone-800 ml-3">
                    {(tasksByMilestone['unassigned'] || []).map((task) => (
                      <TaskMapCard
                        key={task.id}
                        task={task}
                        isExpanded={!!expandedTasks[task.id]}
                        newSubtaskTitle={newSubtaskInputs[task.id] || ''}
                        onToggleExpanded={() => toggleTaskExpanded(task.id)}
                        onToggleComplete={() => onToggleComplete?.(task)}
                        onToggleSubtask={(subId) => onToggleSubtask?.(task.id, subId)}
                        onDeleteSubtask={(subId) => onDeleteSubtask?.(task.id, subId)}
                        onSubtaskInputChange={(val) =>
                          setNewSubtaskInputs((prev) => ({ ...prev, [task.id]: val }))
                        }
                        onAddSubtask={() => handleAddSubtaskSubmit(task.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ----------------- SUBCOMPONENT: TASK CARD ON THE MAP ----------------- */
interface TaskMapCardProps {
  task: WorkItem;
  isExpanded: boolean;
  newSubtaskTitle: string;
  onToggleExpanded: () => void;
  onToggleComplete: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  onSubtaskInputChange: (val: string) => void;
  onAddSubtask: () => void;
}

const TaskMapCard: React.FC<TaskMapCardProps> = ({
  task,
  isExpanded,
  newSubtaskTitle,
  onToggleExpanded,
  onToggleComplete,
  onToggleSubtask,
  onDeleteSubtask,
  onSubtaskInputChange,
  onAddSubtask,
}) => {
  const subtasks = task.subtasks || [];
  const completedSubtasks = subtasks.filter((s) => s.is_completed).length;
  const subtasksCount = subtasks.length;
  const hasBlockers = (task.depends_on || []).length > 0;

  const priorityColors: { [key: string]: string } = {
    urgent: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-800',
    high: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800',
    medium: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-800',
    low: 'bg-stone-500/10 text-stone-600 dark:text-stone-400 border-stone-300 dark:border-stone-800',
  };

  return (
    <div
      className={`interactive-node rounded-xl p-3 bg-surface border transition-all duration-150 shadow-xs hover:shadow-sm ${
        task.is_completed
          ? 'border-hairline bg-surface/60 opacity-80'
          : 'border-stone-300 dark:border-stone-700/80 hover:border-stone-400'
      }`}
    >
      {/* Top row: Checkbox, Title, Priority */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={onToggleComplete}
            className="p-0.5 mt-0.5 rounded text-ink-3 hover:text-ink transition-colors flex-shrink-0"
            title={task.is_completed ? 'Mark pending' : 'Mark complete'}
          >
            {task.is_completed ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : (
              <Circle className="w-4 h-4 text-ink-3 hover:text-ink-2" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <span
              className={`text-meta font-medium leading-snug block break-words ${
                task.is_completed ? 'line-through text-ink-3' : 'text-ink'
              }`}
            >
              {task.title}
            </span>

            {task.description && (
              <p className="text-caption text-ink-3 mt-0.5 line-clamp-2 leading-relaxed">
                {task.description}
              </p>
            )}
          </div>
        </div>

        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border capitalize flex-shrink-0 ${
            priorityColors[task.priority] || priorityColors.medium
          }`}
        >
          {task.priority}
        </span>
      </div>

      {/* Meta Bar: Due date, duration, subtasks button */}
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-hairline/60 text-caption text-ink-3">
        <div className="flex items-center gap-2 flex-wrap">
          {task.due_date && (
            <span className="flex items-center gap-1 text-ink-2">
              <Calendar className="w-3 h-3 text-ink-3" />
              {formatRelativeDate(task.due_date)}
            </span>
          )}
          {task.estimated_minutes && (
            <span className="flex items-center gap-1 font-mono">
              <Clock className="w-3 h-3 text-ink-3" />
              {task.estimated_minutes}m
            </span>
          )}
          {hasBlockers && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold" title="Has dependencies">
              <Lock className="w-3 h-3" /> Blocked
            </span>
          )}
        </div>

        {/* Subtasks Accordion Button */}
        <button
          onClick={onToggleExpanded}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-caption font-medium transition-colors ${
            subtasksCount > 0
              ? 'bg-sunken text-ink hover:bg-hairline'
              : 'text-ink-3 hover:text-ink'
          }`}
        >
          <CheckSquare className="w-3 h-3" />
          <span>
            {subtasksCount > 0 ? `${completedSubtasks}/${subtasksCount}` : '+ Subtasks'}
          </span>
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      </div>

      {/* ---------------- NESTED SUBTASKS CHECKLIST ---------------- */}
      {isExpanded && (
        <div className="mt-2.5 pt-2 border-t border-hairline space-y-2 animate-in fade-in">
          {/* Subtask list */}
          {subtasks.length > 0 && (
            <div className="space-y-1">
              {subtasks.map((st) => (
                <div
                  key={st.id}
                  className="group flex items-center justify-between p-1.5 rounded-lg bg-sunken/60 hover:bg-sunken border border-hairline/50 transition-colors"
                >
                  <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={st.is_completed}
                      onChange={() => onToggleSubtask(st.id)}
                      className="w-3 h-3 rounded text-accent-500 bg-sunken border-zinc-600 cursor-pointer"
                    />
                    <span
                      className={`text-caption truncate ${
                        st.is_completed ? 'line-through text-ink-3' : 'text-ink'
                      }`}
                    >
                      {st.title}
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() => onDeleteSubtask(st.id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-3 hover:text-rose-500 transition-opacity"
                    title="Delete subtask"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Quick Add Subtask Input */}
          <div className="flex items-center gap-1 pt-1">
            <input
              type="text"
              placeholder="Add micro-step..."
              value={newSubtaskTitle}
              onChange={(e) => onSubtaskInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAddSubtask();
              }}
              className="flex-1 bg-sunken border border-hairline rounded px-2 py-0.5 text-caption text-ink placeholder-ink-3 focus:outline-none"
            />
            <button
              onClick={onAddSubtask}
              disabled={!newSubtaskTitle.trim()}
              className="px-2 py-0.5 rounded bg-accent-500 hover:bg-accent-600 text-white text-[11px] font-bold disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
