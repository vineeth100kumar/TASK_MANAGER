import React, { useState } from 'react';
import { 
  Folder, Plus, CheckCircle2, Circle, Clock, Flag, 
  Trash2, ChevronDown, ChevronRight, Calendar, Tag, AlertCircle, PenTool,
  Network, CheckSquare
} from 'lucide-react';
import { Project, Milestone, WorkItem, Subtask } from '../../types';
import { formatRelativeDate } from '../../utils/dateHelpers';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Skeleton } from '../common/Skeleton';
import { ProjectMap } from './ProjectMap';

interface ProjectsHubProps {
  isLoading?: boolean;
  projects: Project[];
  milestones: Milestone[];
  items: WorkItem[];
  onCreateProject: (proj: { name: string; color?: string; description?: string }) => void;
  onDeleteProject: (id: string) => void;
  onCreateMilestone: (m: { project_id?: string; title: string; due_date: string }) => void;
  onDeleteMilestone: (id: string) => void;
  onSelectItem: (item: WorkItem) => void;
  onCreateItem?: (item: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => void;
  onToggleComplete?: (item: WorkItem) => void;
  onToggleSubtask?: (itemId: string, subtaskId: string) => void;
  onAddSubtask?: (itemId: string, title: string) => void;
  onDeleteSubtask?: (itemId: string, subtaskId: string) => void;
  onOpenWhiteboard?: (projectId: string) => void;
}

/*
 * Project colours, named.
 *
 * These were eight raw Tailwind hexes — pink, cyan, violet — none of which
 * exist anywhere else in the app. A project dot was the only place the
 * interface used a hue the palette had never heard of. These six are drawn
 * from the four ramps plus two neighbours that sit with them, so a board full
 * of projects still reads as one product.
 */
const COLOR_PRESETS: { value: string; name: string }[] = [
  { value: '#0A6CFF', name: 'Blue' },
  { value: '#1C7A4A', name: 'Green' },
  { value: '#A8641B', name: 'Amber' },
  { value: '#B3261E', name: 'Red' },
  { value: '#5B4FCF', name: 'Indigo' },
  { value: '#6B6F78', name: 'Grey' },
];

export const ProjectsHub: React.FC<ProjectsHubProps> = ({
  isLoading = false,
  projects,
  milestones,
  items,
  onCreateProject,
  onDeleteProject,
  onCreateMilestone,
  onDeleteMilestone,
  onSelectItem,
  onCreateItem,
  onToggleComplete,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onOpenWhiteboard,
}) => {
  // View mode: 'list' or 'map' (interactive project map)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [mappedProjectId, setMappedProjectId] = useState<string | null>(
    projects.length > 0 ? projects[0].id : null
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deletingMilestoneId, setDeletingMilestoneId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectColor, setNewProjectColor] = useState(COLOR_PRESETS[0].value);
  
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
    projects.length > 0 ? projects[0].id : null
  );

  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState('');
  const [addingMilestoneForProject, setAddingMilestoneForProject] = useState<string | null>(null);

  // Quick Task Creation state per project
  const [quickTaskTitle, setQuickTaskTitle] = useState<{ [projectId: string]: string }>({});
  const [quickTaskMilestone, setQuickTaskMilestone] = useState<{ [projectId: string]: string }>({});
  const [quickTaskPriority, setQuickTaskPriority] = useState<{ [projectId: string]: string }>({});
  const [hideCompletedTasks, setHideCompletedTasks] = useState<{ [projectId: string]: boolean }>({});

  // Subtask accordion & input state in task cards
  const [expandedTaskSubtasks, setExpandedTaskSubtasks] = useState<{ [taskId: string]: boolean }>({});
  const [taskSubtaskInput, setTaskSubtaskInput] = useState<{ [taskId: string]: string }>({});

  const handleQuickAddTask = (projectId: string, milestoneId?: string) => {
    const title = (quickTaskTitle[projectId] || '').trim();
    if (!title) return;

    const chosenMilestone = milestoneId || quickTaskMilestone[projectId] || undefined;
    const chosenPriority = (quickTaskPriority[projectId] || 'medium') as any;

    if (onCreateItem) {
      onCreateItem({
        title,
        project_id: projectId,
        milestone_id: chosenMilestone,
        priority: chosenPriority,
        status: 'todo',
        entity_type: 'task'
      });
    }

    setQuickTaskTitle(prev => ({ ...prev, [projectId]: '' }));
  };

  const isDuplicateName = projects.some(
    p => p.name.trim().toLowerCase() === newProjectName.trim().toLowerCase()
  );

  const handleCreateProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    onCreateProject({
      name: newProjectName.trim(),
      description: newProjectDesc.trim() || undefined,
      color: newProjectColor
    });
    setNewProjectName('');
    setNewProjectDesc('');
    setNewProjectColor(COLOR_PRESETS[0].value);
    setShowCreateModal(false);
  };

  const handleAddMilestoneSubmit = (projectId: string) => {
    if (!newMilestoneTitle.trim() || !newMilestoneDueDate) return;
    onCreateMilestone({
      project_id: projectId,
      title: newMilestoneTitle.trim(),
      due_date: newMilestoneDueDate
    });
    setNewMilestoneTitle('');
    setNewMilestoneDueDate('');
    setAddingMilestoneForProject(null);
  };

  const activeMapProject = projects.find(p => p.id === mappedProjectId) || (projects.length > 0 ? projects[0] : null);

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-1">
        <div>
          <h1 className="screen-title">Projects</h1>
          <p className="text-meta text-ink-3 mt-0.5">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            {milestones.length > 0 && ` · ${milestones.length} ${milestones.length === 1 ? 'milestone' : 'milestones'}`}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {projects.length > 0 && (
            <div className="flex items-center bg-sunken rounded-control p-0.5 border border-hairline text-meta">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 rounded-control font-medium transition-colors ${
 viewMode === 'list'
 ? 'bg-surface text-ink shadow-xs'
 : 'text-ink-3 hover:text-ink'
 }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!mappedProjectId && projects.length > 0) {
                    setMappedProjectId(projects[0].id);
                  }
                  setViewMode('map');
                }}
                className={`px-3 py-1 rounded-control font-medium flex items-center gap-1.5 transition-colors ${
 viewMode === 'map'
 ? 'bg-surface text-ink shadow-xs'
 : 'text-ink-3 hover:text-ink'
 }`}
              >
                <Network className="w-3.5 h-3.5 text-blue-500" />
                Project Map
              </button>
            </div>
          )}

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-control bg-accent-500 hover:bg-accent-600 text-white font-medium text-meta transition-all duration-150 ease-settle active:scale-[0.98] self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" /> New project
          </button>
        </div>
      </div>

      {viewMode === 'map' && activeMapProject ? (
        <ProjectMap
          project={activeMapProject}
          allProjects={projects}
          milestones={milestones}
          items={items}
          onSelectProject={(id) => setMappedProjectId(id)}
          onToggleComplete={onToggleComplete}
          onToggleSubtask={onToggleSubtask}
          onAddSubtask={onAddSubtask}
          onDeleteSubtask={onDeleteSubtask}
          onCreateItem={onCreateItem}
          onCreateMilestone={onCreateMilestone}
          onClose={() => setViewMode('list')}
        />
      ) : projects.length === 0 ? (
        isLoading ? (
          <div className="space-y-4">
            <Skeleton variant="card" count={3} />
          </div>
        ) : (
        <div className="surface-sunken text-center px-6 py-16">
          <Folder className="w-8 h-8 text-ink-3 mx-auto" aria-hidden="true" />
          <h3 className="text-lead font-semibold text-ink mt-3">No projects yet</h3>
          <p className="text-meta text-ink-2 max-w-xs mx-auto mt-1.5 leading-relaxed">
            A project holds the tasks that belong together, like a home lab build
            or this year's taxes.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="h-10 px-4 mt-5 rounded-control bg-accent-500 hover:bg-accent-600 text-white text-meta font-medium transition-all duration-200 ease-spring active:scale-[0.97]"
          >
            New project
          </button>
        </div>
        )
      ) : (
        <div className="space-y-4">
          {projects.map(proj => {
            const isExpanded = expandedProjectId === proj.id;
            const projectMilestones = milestones.filter(m => m.project_id === proj.id);
            const projectTasks = items.filter(i => i.project_id === proj.id);
            const completedCount = projectTasks.filter(i => i.is_completed).length;
            const totalCount = projectTasks.length;
            const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            return (
              <div 
                key={proj.id}
                className="bg-sunken border border-hairline rounded-control overflow-hidden transition-all shadow-sm relative"
              >                {/* Project Header Bar */}
                <div 
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-ink/5 transition-colors"
                  onClick={() => setExpandedProjectId(isExpanded ? null : proj.id)}
                >
                  <div className="flex items-start md:items-center gap-3">
                    <div 
                      className="w-2.5 h-10 rounded-control border border-hairline flex-shrink-0"
                      style={{ backgroundColor: proj.color || '#d97706' }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lead font-semibold text-ink tracking-tight">{proj.name}</h3>
                        <span className="text-caption px-2 py-0.5 rounded-control bg-sunken text-ink-2 border border-hairline">
                          {completedCount}/{totalCount} tasks
                        </span>
                      </div>
                      {proj.description && (
                        <p className="italic text-meta text-ink-2 mt-0.5 max-w-xl">{proj.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Progress & Controls */}
                  <div className="flex items-center gap-4 self-end md:self-auto w-full md:w-auto">
                    {/* Progress Bar */}
                    <div className="flex-1 md:w-48">
                      <div className="flex items-center justify-between text-meta mb-1">
                        <span className="text-ink-2">Progress</span>
                        <span className="font-semibold text-ink">{progressPct}%</span>
                      </div>
                      <div className="h-2 w-full bg-sunken rounded-control overflow-hidden border border-hairline">
                        <div 
                          className="h-full rounded-control transition-all duration-500"
                          style={{ 
                            width: `${progressPct}%`,
                            backgroundColor: proj.color || '#d97706'
                          }}
                        />
                      </div>
                    </div>

                    {onOpenWhiteboard && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenWhiteboard(proj.id);
                        }}
                        aria-label={`Open Whiteboard for ${proj.name}`}
                        className="p-1.5 rounded-control text-ink-2 hover:text-accent-600 dark:hover:text-accent-400 border border-hairline hover:bg-ink/5 transition-colors"
                        title="Open whiteboard"
                      >
                        <PenTool className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMappedProjectId(proj.id);
                        setViewMode('map');
                      }}
                      aria-label={`Open Project Map for ${proj.name}`}
                      className="p-1.5 rounded-control text-ink-2 hover:text-accent-600 dark:hover:text-accent-400 border border-hairline hover:bg-ink/5 transition-colors"
                      title="Open project map"
                    >
                      <Network className="w-4 h-4" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProjectId(proj.id);
                      }}
                      aria-label={`Delete project: ${proj.name}`}
                      className="p-1.5 rounded-control text-ink-3 hover:text-danger-600 dark:hover:text-danger-400 border border-hairline hover:bg-ink/5 transition-colors"
                      title="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="p-1 text-ink-3">
                      {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Details: Milestones & Tasks */}
                {isExpanded && (
                  <div className="border-t border-hairline p-5 bg-surface dark:bg-sunken/60 space-y-6 animate-in fade-in">
                    {/* Milestones Section */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-meta font-semibold text-ink-2 flex items-center gap-1.5">
                          <Flag className="w-3.5 h-3.5 text-accent-500" />
                          Milestones ({projectMilestones.length})
                        </h4>
                        <button
                          onClick={() => setAddingMilestoneForProject(addingMilestoneForProject === proj.id ? null : proj.id)}
                          className="flex items-center gap-1 text-meta text-accent-600 dark:text-accent-400 hover:text-accent-700 font-semibold"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add milestone
                        </button>
                      </div>

                      {/* Add Milestone Inline */}
                      {addingMilestoneForProject === proj.id && (
                        <div className="p-3 mb-3 rounded-control bg-sunken border border-hairline flex flex-wrap gap-2 items-center animate-in fade-in">
                          <input
                            type="text"
                            placeholder="Milestone title (e.g. Sub-25m 5K Time Trial)"
                            value={newMilestoneTitle}
                            onChange={e => setNewMilestoneTitle(e.target.value)}
                            className="flex-1 min-w-[200px] bg-sunken border border-hairline rounded-control px-3 py-1.5 text-meta text-ink focus:outline-none"
                          />
                          <input
                            type="date"
                            value={newMilestoneDueDate}
                            onChange={e => setNewMilestoneDueDate(e.target.value)}
                            className="bg-sunken border border-hairline rounded-control px-3 py-1.5 text-meta text-ink focus:outline-none"
                          />
                          <button
                            onClick={() => handleAddMilestoneSubmit(proj.id)}
                            className="px-3 py-1.5 rounded-control bg-accent-500 hover:bg-accent-600 text-white text-meta font-semibold"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => setAddingMilestoneForProject(null)}
                            className="px-2 py-1.5 text-meta text-ink-3 hover:text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* Milestones List */}
                      {projectMilestones.length === 0 ? (
                        <p className="text-meta text-ink-3 px-3 py-4">
                          No milestones set yet for this project.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {projectMilestones.map(m => (
                            <div 
                              key={m.id}
                              className="p-3 rounded-control bg-sunken border border-hairline flex items-center justify-between text-meta"
                            >
                              <div className="flex items-center gap-2.5 truncate pr-2">
                                <Flag className={`w-3.5 h-3.5 ${m.status === 'achieved' ? 'text-done-500 dark:text-done-400' : 'text-accent-500'}`} />
                                <span className="font-semibold text-ink truncate">{m.title}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-meta text-ink-2 flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-ink-2" />
                                  {formatRelativeDate(m.due_date)}
                                </span>
                                <button
                                  onClick={() => {
                                    setQuickTaskMilestone(prev => ({ ...prev, [proj.id]: m.id }));
                                    const el = document.getElementById(`quick-add-task-${proj.id}`);
                                    el?.focus();
                                  }}
                                  className="px-2 py-0.5 rounded-control bg-sunken hover:bg-hairline text-ink text-caption border border-hairline transition-colors"
                                  title="Add task for this milestone"
                                >
                                  Task
                                </button>
                                <button
                                  onClick={() => setDeletingMilestoneId(m.id)}
                                  aria-label={`Delete milestone: ${m.title}`}
                                  className="p-1 text-ink-3 hover:text-danger-600 dark:hover:text-danger-400 rounded-control transition-colors"
                                  title="Delete milestone"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Linked Tasks Section */}
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <h4 className="text-meta font-semibold text-ink-2">
                          Tasks ({completedCount} of {totalCount} done)
                        </h4>
                        {totalCount > 0 && (
                          <label className="flex items-center gap-1.5 text-meta text-ink-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!hideCompletedTasks[proj.id]}
                              onChange={e => setHideCompletedTasks(prev => ({ ...prev, [proj.id]: e.target.checked }))}
                              className="rounded border-hairline bg-sunken text-blue-500 w-3 h-3"
                            />
                            <span>Hide completed</span>
                          </label>
                        )}
                      </div>

                      {/* Inline Quick Task Adder */}
                      <div className="p-2.5 mb-3 rounded-control bg-sunken border border-hairline flex flex-wrap gap-2 items-center">
                        <input
                          id={`quick-add-task-${proj.id}`}
                          type="text"
                          placeholder={`+ Add task to "${proj.name}"...`}
                          value={quickTaskTitle[proj.id] || ''}
                          onChange={e => setQuickTaskTitle(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleQuickAddTask(proj.id);
                          }}
                          className="flex-1 min-w-[180px] bg-sunken border border-hairline rounded-control px-3 py-1.5 text-meta text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent-500"
                        />
                        <select
                          value={quickTaskMilestone[proj.id] || ''}
                          onChange={e => setQuickTaskMilestone(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          className="field w-auto text-meta"
                        >
                          <option value="">No milestone</option>
                          {projectMilestones.map(m => (
                            <option key={m.id} value={m.id}>{m.title}</option>
                          ))}
                        </select>
                        <select
                          value={quickTaskPriority[proj.id] || 'medium'}
                          onChange={e => setQuickTaskPriority(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          className="field w-auto text-meta"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Med</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                        <button
                          onClick={() => handleQuickAddTask(proj.id)}
                          className="h-11 px-4 rounded-control bg-accent-500 hover:bg-accent-600 text-white text-meta font-medium transition-all duration-200 ease-spring active:scale-[0.97] shrink-0"
                        >
                          Add task
                        </button>
                      </div>

                      {/* Tasks List */}
                      {projectTasks.length === 0 ? (
                        <p className="text-meta text-ink-3 px-3 py-4">
                          No tasks here yet. Add the first one above.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {projectTasks
                            .filter(task => !hideCompletedTasks[proj.id] || !task.is_completed)
                            .map(task => {
                              const taskMilestone = projectMilestones.find(m => m.id === task.milestone_id);
                              const isSubtasksExpanded = !!expandedTaskSubtasks[task.id];
                              const taskSubtasks = task.subtasks || [];
                              const completedSubCount = taskSubtasks.filter(s => s.is_completed).length;

                              return (
                                  <div
                                    key={task.id}
                                    className="rounded-control bg-surface border border-hairline hover:border-hairline transition-colors shadow-sm overflow-hidden"
                                  >
                                    <div
                                      onClick={() => onSelectItem(task)}
                                      className="flex items-center justify-between p-2.5 cursor-pointer text-meta hover:bg-ink/5 transition-colors"
                                    >
                                      <div className="flex items-center gap-2.5 truncate pr-2">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onToggleComplete?.(task);
                                          }}
                                          className="p-0.5 rounded-control text-ink-2 hover:text-ink transition-colors"
                                          title={task.is_completed ? "Mark incomplete" : "Mark complete"}
                                        >
                                          {task.is_completed ? (
                                            <CheckCircle2 className="w-4 h-4 text-done-500 dark:text-done-400 flex-shrink-0" />
                                          ) : (
                                            <Circle className="w-4 h-4 text-ink-2 hover:text-ink-3 flex-shrink-0" />
                                          )}
                                        </button>
                                        <span className={`font-semibold truncate ${task.is_completed ? 'line-through text-ink-2 italic' : 'text-ink'}`}>
                                          {task.title}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        {taskMilestone && (
                                          <span className="text-caption px-1.5 py-0.5 rounded-control bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/20 text-amber-800 dark:text-amber-300 flex items-center gap-1">
                                            {taskMilestone.title}
                                          </span>
                                        )}
                                        {task.due_date && (
                                          <span className="text-caption text-ink-2">
                                            {formatRelativeDate(task.due_date)}
                                          </span>
                                        )}
                                        <span className={`text-caption px-1.5 py-0.5 rounded-control font-semibold border ${
 task.priority === 'urgent' ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-700' :
 task.priority === 'high' ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-700' :
 'bg-sunken text-ink-2 border-hairline'
 }`}>
                                          {task.priority}
                                        </span>

                                        {/* Subtasks Accordion Button */}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setExpandedTaskSubtasks(prev => ({ ...prev, [task.id]: !prev[task.id] }));
                                          }}
                                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-caption font-medium transition-colors ${
 taskSubtasks.length > 0
 ? 'bg-sunken text-ink hover:bg-hairline'
 : 'text-ink-3 hover:text-ink'
 }`}
                                          title="Toggle subtasks"
                                        >
                                          <CheckSquare className="w-3 h-3" />
                                          <span>
                                            {taskSubtasks.length > 0 ? `${completedSubCount}/${taskSubtasks.length}` : '+ Subtasks'}
                                          </span>
                                          {isSubtasksExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                        </button>
                                      </div>
                                    </div>

                                    {/* Expanded Subtasks List */}
                                    {isSubtasksExpanded && (
                                      <div className="border-t border-hairline p-2.5 bg-sunken/40 space-y-2 animate-in fade-in">
                                        {taskSubtasks.length > 0 && (
                                          <div className="space-y-1">
                                            {taskSubtasks.map(st => (
                                              <div
                                                key={st.id}
                                                className="group flex items-center justify-between p-1.5 rounded-control bg-surface border border-hairline/60 hover:border-hairline transition-colors"
                                              >
                                                <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                                  <input
                                                    type="checkbox"
                                                    checked={st.is_completed}
                                                    onChange={() => onToggleSubtask?.(task.id, st.id)}
                                                    className="w-3.5 h-3.5 rounded text-blue-600 bg-sunken border-hairline cursor-pointer"
                                                  />
                                                  <span className={`text-meta truncate ${st.is_completed ? 'line-through text-ink-3' : 'text-ink'}`}>
                                                    {st.title}
                                                  </span>
                                                </label>
                                                <button
                                                  type="button"
                                                  onClick={() => onDeleteSubtask?.(task.id, st.id)}
                                                  className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-3 hover:text-rose-500 transition-opacity"
                                                  title="Delete subtask"
                                                >
                                                  <Trash2 className="w-3 h-3" />
                                                </button>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {/* Inline Add Subtask Input */}
                                        <div className="flex items-center gap-1.5 pt-0.5">
                                          <input
                                            type="text"
                                            placeholder="+ Add micro-step / subtask..."
                                            value={taskSubtaskInput[task.id] || ''}
                                            onChange={e => setTaskSubtaskInput(prev => ({ ...prev, [task.id]: e.target.value }))}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter') {
                                                const val = (taskSubtaskInput[task.id] || '').trim();
                                                if (val) {
                                                  onAddSubtask?.(task.id, val);
                                                  setTaskSubtaskInput(prev => ({ ...prev, [task.id]: '' }));
                                                }
                                              }
                                            }}
                                            className="flex-1 bg-surface border border-hairline rounded px-2.5 py-1 text-meta text-ink placeholder-ink-3 focus:outline-none focus:border-accent-500"
                                          />
                                          <button
                                            type="button"
                                            disabled={!(taskSubtaskInput[task.id] || '').trim()}
                                            onClick={() => {
                                              const val = (taskSubtaskInput[task.id] || '').trim();
                                              if (val) {
                                                onAddSubtask?.(task.id, val);
                                                setTaskSubtaskInput(prev => ({ ...prev, [task.id]: '' }));
                                              }
                                            }}
                                            className="px-2.5 py-1 rounded bg-accent-500 hover:bg-accent-600 text-white font-semibold text-caption disabled:opacity-40 disabled:pointer-events-none transition-colors"
                                          >
                                            Add
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New project */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="New project"
        maxWidth="md"
        hasUnsavedChanges={!!newProjectName.trim() || !!newProjectDesc.trim()}
      >
        <form onSubmit={handleCreateProjectSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="new-project-name" className="label">Name</label>
            <input
              id="new-project-name"
              type="text"
              required
              autoFocus
              placeholder="e.g. Home network rebuild"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              className="field"
            />
            {isDuplicateName && (
              <p className="text-caption text-late-500 dark:text-late-400">
                A project already has this name.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="new-project-desc" className="label">Description</label>
            <textarea
              id="new-project-desc"
              rows={2}
              placeholder="Leave this empty and Sage will write one for you"
              value={newProjectDesc}
              onChange={e => setNewProjectDesc(e.target.value)}
              className="field resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <span className="label">Colour</span>
            <div className="flex items-center gap-2.5" role="radiogroup" aria-label="Project colour">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={newProjectColor === c.value}
                  aria-label={c.name}
                  title={c.name}
                  onClick={() => setNewProjectColor(c.value)}
                  className={`w-7 h-7 rounded-full transition-transform duration-200 ease-spring ${
 newProjectColor === c.value
 ? 'scale-110 ring-2 ring-accent-500 ring-offset-2 ring-offset-surface'
 : 'hover:scale-110'
 }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="h-10 px-4 rounded-control text-meta font-medium text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newProjectName.trim()}
              className="h-10 px-4 rounded-control bg-accent-500 hover:bg-accent-600 text-white text-meta font-medium transition-all duration-200 ease-spring active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
            >
              Create project
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Project Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingProjectId}
        title="Delete this project?"
        message={`"${projects.find(p => p.id === deletingProjectId)?.name || 'This project'}" will go. Its tasks stay where they are, and Ctrl+Z brings the project back.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => {
          if (deletingProjectId) {
            onDeleteProject(deletingProjectId);
            setDeletingProjectId(null);
          }
        }}
        onCancel={() => setDeletingProjectId(null)}
      />

      {/* Delete Milestone Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingMilestoneId}
        title="Delete this milestone?"
        message={`"${milestones.find(m => m.id === deletingMilestoneId)?.title || 'This milestone'}" will go. Ctrl+Z brings it back.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => {
          if (deletingMilestoneId) {
            onDeleteMilestone(deletingMilestoneId);
            setDeletingMilestoneId(null);
          }
        }}
        onCancel={() => setDeletingMilestoneId(null)}
      />
    </div>
  );
};
