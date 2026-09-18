import React, { useState } from 'react';
import { 
  Folder, Plus, CheckCircle2, Circle, Clock, Flag, 
  Trash2, ChevronDown, ChevronRight, Calendar, Tag, AlertCircle, PenTool
} from 'lucide-react';
import { Project, Milestone, WorkItem } from '../../types';
import { formatRelativeDate } from '../../utils/dateHelpers';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Skeleton } from '../common/Skeleton';

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
  onOpenWhiteboard?: (projectId: string) => void;
}

const COLOR_PRESETS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#6366f1', // indigo
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
  onOpenWhiteboard,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deletingMilestoneId, setDeletingMilestoneId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectColor, setNewProjectColor] = useState(COLOR_PRESETS[0]);
  
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

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 h-9 px-3.5 rounded-control bg-accent-500 hover:bg-accent-600 text-white font-medium text-meta transition-all duration-150 ease-settle active:scale-[0.98] self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> New project
        </button>
      </div>

      {/* Projects Grid / List */}
      {projects.length === 0 ? (
        isLoading ? (
          <div className="space-y-4">
            <Skeleton variant="card" count={3} />
          </div>
        ) : (
        <div className="text-center py-16 bg-sunken border border-stone-300 dark:border-stone-800 rounded-control relative">          <Folder className="w-12 h-12 text-ink-2 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-stone-900 dark:text-zinc-100">No Active Dossiers</h3>
          <p className="text-meta text-ink-3 dark:text-zinc-400 max-w-sm mx-auto mt-1 mb-4">
            Create your first strategic dossier like "Pi Home Lab Setup", "Half Marathon Prep", or "Q4 Tax Planning".
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-control bg-amber-600 hover:bg-amber-500 text-stone-950 text-meta font-bold transition-all"
          >
            + Create Dossier
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
                className="bg-sunken border border-stone-300 dark:border-stone-800 rounded-control overflow-hidden transition-all shadow-sm relative"
              >                {/* Project Header Bar */}
                <div 
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-black/5 dark:hover:bg-stone-800/30 transition-colors"
                  onClick={() => setExpandedProjectId(isExpanded ? null : proj.id)}
                >
                  <div className="flex items-start md:items-center gap-3">
                    <div 
                      className="w-2.5 h-10 rounded-control border border-stone-400 dark:border-stone-600 flex-shrink-0"
                      style={{ backgroundColor: proj.color || '#d97706' }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-stone-900 dark:text-stone-100 tracking-tight">{proj.name}</h3>
                        <span className="text-caption px-2 py-0.5 rounded-control bg-paper-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-700">
                          {completedCount}/{totalCount} tasks
                        </span>
                      </div>
                      {proj.description && (
                        <p className="italic text-meta text-ink-3 dark:text-stone-400 mt-0.5 max-w-xl">{proj.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Progress & Controls */}
                  <div className="flex items-center gap-4 self-end md:self-auto w-full md:w-auto">
                    {/* Progress Bar */}
                    <div className="flex-1 md:w-48">
                      <div className="flex items-center justify-between text-meta mb-1">
                        <span className="text-ink-3 dark:text-zinc-400">Progress</span>
                        <span className="font-bold text-stone-900 dark:text-white">{progressPct}%</span>
                      </div>
                      <div className="h-2 w-full bg-stone-200 dark:bg-zinc-800 rounded-control overflow-hidden border border-stone-300 dark:border-stone-700">
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
                        className="p-1.5 rounded-control text-ink-3 dark:text-stone-400 hover:text-amber-700 dark:hover:text-amber-400 border border-stone-300 dark:border-stone-700 hover:bg-black/5 dark:hover:bg-stone-800 transition-colors"
                        title="Open whiteboard"
                      >
                        <PenTool className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProjectId(proj.id);
                      }}
                      aria-label={`Delete project: ${proj.name}`}
                      className="p-1.5 rounded-control text-ink-3 hover:text-rose-600 dark:hover:text-rose-400 border border-stone-300 dark:border-stone-700 hover:bg-black/5 dark:hover:bg-stone-800 transition-colors"
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
                  <div className="border-t border-ink-base/15 dark:border-stone-800 p-5 bg-paper-white dark:bg-sunken/60 space-y-6 animate-in fade-in">
                    {/* Milestones Section */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-meta font-bold text-stone-700 dark:text-zinc-400 flex items-center gap-1.5">
                          <Flag className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          Milestones ({projectMilestones.length})
                        </h4>
                        <button
                          onClick={() => setAddingMilestoneForProject(addingMilestoneForProject === proj.id ? null : proj.id)}
                          className="flex items-center gap-1 text-meta text-amber-700 dark:text-amber-400 hover:text-amber-800 font-bold"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add milestone
                        </button>
                      </div>

                      {/* Add Milestone Inline */}
                      {addingMilestoneForProject === proj.id && (
                        <div className="p-3 mb-3 rounded-control bg-paper-base dark:bg-stone-800/80 border border-stone-300 dark:border-stone-700 flex flex-wrap gap-2 items-center animate-in fade-in">
                          <input
                            type="text"
                            placeholder="Milestone title (e.g. Sub-25m 5K Time Trial)"
                            value={newMilestoneTitle}
                            onChange={e => setNewMilestoneTitle(e.target.value)}
                            className="flex-1 min-w-[200px] bg-paper-white dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 rounded-control px-3 py-1.5 text-meta text-stone-900 dark:text-white focus:outline-none"
                          />
                          <input
                            type="date"
                            value={newMilestoneDueDate}
                            onChange={e => setNewMilestoneDueDate(e.target.value)}
                            className="bg-paper-white dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 rounded-control px-3 py-1.5 text-meta text-stone-900 dark:text-zinc-300 focus:outline-none"
                          />
                          <button
                            onClick={() => handleAddMilestoneSubmit(proj.id)}
                            className="px-3 py-1.5 rounded-control bg-amber-600 hover:bg-amber-500 text-stone-950 text-meta font-bold"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => setAddingMilestoneForProject(null)}
                            className="px-2 py-1.5 text-meta text-ink-3 hover:text-stone-900 dark:hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* Milestones List */}
                      {projectMilestones.length === 0 ? (
                        <p className="text-meta text-ink-3 italic p-3 rounded-lg bg-surface/30 border border-hairline/60">
                          No milestones set yet for this project.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {projectMilestones.map(m => (
                            <div 
                              key={m.id}
                              className="p-3 rounded-control bg-sunken border border-stone-300 dark:border-zinc-800 flex items-center justify-between text-meta"
                            >
                              <div className="flex items-center gap-2.5 truncate pr-2">
                                <Flag className={`w-3.5 h-3.5 ${m.status === 'achieved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`} />
                                <span className="font-semibold text-stone-900 dark:text-zinc-200 truncate">{m.title}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-meta text-ink-3 dark:text-zinc-400 flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-ink-2" />
                                  {formatRelativeDate(m.due_date)}
                                </span>
                                <button
                                  onClick={() => {
                                    setQuickTaskMilestone(prev => ({ ...prev, [proj.id]: m.id }));
                                    const el = document.getElementById(`quick-add-task-${proj.id}`);
                                    el?.focus();
                                  }}
                                  className="px-2 py-0.5 rounded-control bg-paper-white dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 text-stone-800 dark:text-zinc-300 text-caption border border-stone-300 dark:border-stone-700 transition-colors"
                                  title="Add task for this milestone"
                                >
                                  Task
                                </button>
                                <button
                                  onClick={() => setDeletingMilestoneId(m.id)}
                                  aria-label={`Delete milestone: ${m.title}`}
                                  className="p-1 text-ink-3 hover:text-rose-600 dark:hover:text-rose-400 rounded-control transition-colors"
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
                        <h4 className="text-meta font-bold text-ink-2">
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
                      <div className="p-2.5 mb-3 rounded-control bg-paper-base dark:bg-zinc-900/90 border border-stone-300 dark:border-zinc-800 flex flex-wrap gap-2 items-center">
                        <input
                          id={`quick-add-task-${proj.id}`}
                          type="text"
                          placeholder={`+ Add task to "${proj.name}"...`}
                          value={quickTaskTitle[proj.id] || ''}
                          onChange={e => setQuickTaskTitle(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleQuickAddTask(proj.id);
                          }}
                          className="flex-1 min-w-[180px] bg-paper-white dark:bg-zinc-800/80 border border-stone-300 dark:border-zinc-700 rounded-control px-3 py-1.5 text-meta text-stone-900 dark:text-white placeholder-stone-400 focus:outline-none focus:border-amber-600"
                        />
                        <select
                          value={quickTaskMilestone[proj.id] || ''}
                          onChange={e => setQuickTaskMilestone(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          className="bg-paper-white dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-control px-2 py-1.5 text-meta text-stone-800 dark:text-zinc-300 focus:outline-none"
                        >
                          <option value="">No milestone</option>
                          {projectMilestones.map(m => (
                            <option key={m.id} value={m.id}>🏁 {m.title}</option>
                          ))}
                        </select>
                        <select
                          value={quickTaskPriority[proj.id] || 'medium'}
                          onChange={e => setQuickTaskPriority(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          className="bg-paper-white dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-control px-2 py-1.5 text-meta text-stone-800 dark:text-zinc-300 focus:outline-none"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Med</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                        <button
                          onClick={() => handleQuickAddTask(proj.id)}
                          className="px-3 py-1.5 rounded-control bg-amber-600 hover:bg-amber-500 text-stone-950 text-meta font-bold transition-all shadow-sm active:scale-95"
                        >
                          Add task
                        </button>
                      </div>

                      {/* Tasks List */}
                      {projectTasks.length === 0 ? (
                        <p className="text-meta text-ink-3 italic p-3 rounded-lg bg-surface/30 border border-hairline/60">
                          No tasks linked to this project yet. Use the box above to quickly add deliverables!
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {projectTasks
                            .filter(task => !hideCompletedTasks[proj.id] || !task.is_completed)
                            .map(task => {
                              const taskMilestone = projectMilestones.find(m => m.id === task.milestone_id);
                              return (
                                <div
                                  key={task.id}
                                  onClick={() => onSelectItem(task)}
                                  className="flex items-center justify-between p-2.5 rounded-control bg-surface border border-stone-200 dark:border-stone-800/80 hover:border-stone-400 cursor-pointer text-meta transition-colors shadow-sm"
                                >
                                  <div className="flex items-center gap-2.5 truncate pr-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleComplete?.(task);
                                      }}
                                      className="p-0.5 rounded-control text-ink-2 hover:text-stone-900 dark:hover:text-white transition-colors"
                                      title={task.is_completed ? "Mark incomplete" : "Mark complete"}
                                    >
                                      {task.is_completed ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                                      ) : (
                                        <Circle className="w-4 h-4 text-ink-2 hover:text-ink-3 flex-shrink-0" />
                                      )}
                                    </button>
                                    <span className={` font-semibold truncate ${task.is_completed ? 'line-through text-ink-2 dark:text-zinc-500 italic' : 'text-stone-900 dark:text-zinc-100'}`}>
                                      {task.title}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {taskMilestone && (
                                      <span className="text-caption px-1.5 py-0.5 rounded-control bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/20 text-amber-800 dark:text-amber-300 flex items-center gap-1">
                                        🏁 {taskMilestone.title}
                                      </span>
                                    )}
                                    {task.due_date && (
                                      <span className="text-caption text-ink-3 dark:text-zinc-400">
                                        {formatRelativeDate(task.due_date)}
                                      </span>
                                    )}
                                    <span className={`text-caption px-1.5 py-0.5 rounded-control font-bold border ${
                                      task.priority === 'urgent' ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-700' :
                                      task.priority === 'high' ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-700' :
                                      'bg-paper-aged dark:bg-zinc-800 text-stone-700 dark:text-zinc-400 border-stone-300 dark:border-stone-700'
                                    }`}>
                                      {task.priority}
                                    </span>
                                  </div>
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

      {/* Create Project Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Project"
        icon={<Folder className="w-4 h-4 text-blue-400" />}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreateProjectSubmit} className="space-y-4">
              <div>
                <label className="block text-meta font-semibold text-ink-2 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Raspberry Pi Cluster Automation"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  className="w-full bg-paper-base dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-control px-3 py-2 text-sm text-stone-900 dark:text-white focus:outline-none focus:border-amber-600"
                />
              </div>

              <div>
                <label className="block text-meta font-semibold text-ink-2 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional: Leave blank to auto-generate strategic scope upon saving..."
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                  className="w-full bg-paper-base dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 rounded-control px-3 py-2 text-sm text-stone-900 dark:text-white focus:outline-none focus:border-amber-600 resize-none"
                />
              </div>

              <div>
                <label className="block text-meta font-semibold text-ink-2 mb-1.5">
                  Theme Color
                </label>
                <div className="flex items-center gap-2">
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewProjectColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${newProjectColor === c ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-stone-300 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-control text-meta text-ink-3 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-control bg-amber-600 hover:bg-amber-500 text-stone-950 text-meta font-bold transition-all"
                >
                  Create Dossier
                </button>
              </div>
            </form>
      </Modal>

      {/* Delete Project Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingProjectId}
        title="Delete Project"
        message={`Are you sure you want to delete "${projects.find(p => p.id === deletingProjectId)?.name || 'this project'}"? Linked tasks will not be deleted, and you can undo this via the undo notification or Ctrl+Z.`}
        confirmLabel="Delete Project"
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
        title="Delete Milestone"
        message={`Are you sure you want to delete milestone "${milestones.find(m => m.id === deletingMilestoneId)?.title || 'this milestone'}"? This can be undone via the undo notification or Ctrl+Z.`}
        confirmLabel="Delete Milestone"
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
