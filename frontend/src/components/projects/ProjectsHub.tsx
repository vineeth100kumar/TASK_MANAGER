import React, { useState } from 'react';
import { 
  Folder, Plus, CheckCircle2, Circle, Clock, Flag, 
  Trash2, ChevronDown, ChevronRight, Calendar, Tag, AlertCircle
} from 'lucide-react';
import { Project, Milestone, WorkItem } from '../../types';
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
  onToggleComplete
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Folder className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-white">Projects & Milestones Hub</h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Organize complex multi-week initiatives with milestone tracking, progress bars, and linked deliverables.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-black font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {/* Projects Grid / List */}
      {projects.length === 0 ? (
        isLoading ? (
          <div className="space-y-4">
            <Skeleton variant="card" count={3} />
          </div>
        ) : (
        <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
          <Folder className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-zinc-300">No Projects Yet</h3>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1 mb-4">
            Create your first project like "Pi Home Lab Setup", "Half Marathon Prep", or "Q4 Tax Planning".
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-black text-xs font-bold transition-all"
          >
            Create Project
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
                className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden transition-all shadow-sm"
              >
                {/* Project Header Bar */}
                <div 
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                  onClick={() => setExpandedProjectId(isExpanded ? null : proj.id)}
                >
                  <div className="flex items-start md:items-center gap-3">
                    <div 
                      className="w-3.5 h-10 rounded-full flex-shrink-0"
                      style={{ backgroundColor: proj.color || '#3b82f6' }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">{proj.name}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 font-mono">
                          {completedCount}/{totalCount} tasks
                        </span>
                      </div>
                      {proj.description && (
                        <p className="text-xs text-zinc-400 mt-0.5 max-w-xl">{proj.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Progress & Controls */}
                  <div className="flex items-center gap-4 self-end md:self-auto w-full md:w-auto">
                    {/* Progress Bar */}
                    <div className="flex-1 md:w-48">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-zinc-400">Progress</span>
                        <span className="font-bold text-white font-mono">{progressPct}%</span>
                      </div>
                      <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full transition-all duration-500"
                          style={{ 
                            width: `${progressPct}%`,
                            backgroundColor: proj.color || '#3b82f6'
                          }}
                        />
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProjectId(proj.id);
                      }}
                      aria-label={`Delete project: ${proj.name}`}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                      title="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <div className="p-1 rounded-lg text-zinc-400">
                      {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Details: Milestones & Tasks */}
                {isExpanded && (
                  <div className="border-t border-zinc-800 p-5 bg-zinc-950/40 space-y-6 animate-in fade-in">
                    {/* Milestones Section */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                          <Flag className="w-3.5 h-3.5 text-amber-400" />
                          Milestones ({projectMilestones.length})
                        </h4>
                        <button
                          onClick={() => setAddingMilestoneForProject(addingMilestoneForProject === proj.id ? null : proj.id)}
                          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                        >
                          <Plus className="w-3 h-3" /> Add Milestone
                        </button>
                      </div>

                      {/* Add Milestone Inline */}
                      {addingMilestoneForProject === proj.id && (
                        <div className="p-3 mb-3 rounded-xl bg-zinc-800/80 border border-blue-500/40 flex flex-wrap gap-2 items-center animate-in fade-in">
                          <input
                            type="text"
                            placeholder="Milestone title (e.g. Sub-25m 5K Time Trial)"
                            value={newMilestoneTitle}
                            onChange={e => setNewMilestoneTitle(e.target.value)}
                            className="flex-1 min-w-[200px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none"
                          />
                          <input
                            type="date"
                            value={newMilestoneDueDate}
                            onChange={e => setNewMilestoneDueDate(e.target.value)}
                            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none"
                          />
                          <button
                            onClick={() => handleAddMilestoneSubmit(proj.id)}
                            className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-black text-xs font-bold"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => setAddingMilestoneForProject(null)}
                            className="px-2 py-1.5 text-xs text-zinc-400 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* Milestones List */}
                      {projectMilestones.length === 0 ? (
                        <p className="text-xs text-zinc-500 italic p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60">
                          No milestones set yet for this project.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {projectMilestones.map(m => (
                            <div 
                              key={m.id}
                              className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800 flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2.5 truncate pr-2">
                                <Flag className={`w-3.5 h-3.5 ${m.status === 'achieved' ? 'text-emerald-400' : 'text-amber-400'}`} />
                                <span className="font-semibold text-zinc-200 truncate">{m.title}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[11px] text-zinc-400 font-mono flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-zinc-500" />
                                  {m.due_date}
                                </span>
                                <button
                                  onClick={() => {
                                    setQuickTaskMilestone(prev => ({ ...prev, [proj.id]: m.id }));
                                    const el = document.getElementById(`quick-add-task-${proj.id}`);
                                    el?.focus();
                                  }}
                                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] font-medium transition-colors"
                                  title="Add task for this milestone"
                                >
                                  + Task
                                </button>
                                <button
                                  onClick={() => setDeletingMilestoneId(m.id)}
                                  aria-label={`Delete milestone: ${m.title}`}
                                  className="p-1 text-zinc-500 hover:text-rose-400 rounded transition-colors"
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
                        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                          Linked Deliverables ({completedCount}/{totalCount} completed)
                        </h4>
                        {totalCount > 0 && (
                          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!hideCompletedTasks[proj.id]}
                              onChange={e => setHideCompletedTasks(prev => ({ ...prev, [proj.id]: e.target.checked }))}
                              className="rounded border-zinc-700 bg-zinc-800 text-blue-500 w-3 h-3"
                            />
                            <span>Hide completed</span>
                          </label>
                        )}
                      </div>

                      {/* Inline Quick Task Adder */}
                      <div className="p-2.5 mb-3 rounded-xl bg-zinc-900/90 border border-zinc-800 flex flex-wrap gap-2 items-center">
                        <input
                          id={`quick-add-task-${proj.id}`}
                          type="text"
                          placeholder={`+ Add task to "${proj.name}"...`}
                          value={quickTaskTitle[proj.id] || ''}
                          onChange={e => setQuickTaskTitle(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleQuickAddTask(proj.id);
                          }}
                          className="flex-1 min-w-[180px] bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                        />
                        <select
                          value={quickTaskMilestone[proj.id] || ''}
                          onChange={e => setQuickTaskMilestone(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 focus:outline-none"
                        >
                          <option value="">No Milestone</option>
                          {projectMilestones.map(m => (
                            <option key={m.id} value={m.id}>🏁 {m.title}</option>
                          ))}
                        </select>
                        <select
                          value={quickTaskPriority[proj.id] || 'medium'}
                          onChange={e => setQuickTaskPriority(prev => ({ ...prev, [proj.id]: e.target.value }))}
                          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 focus:outline-none"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Med</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                        <button
                          onClick={() => handleQuickAddTask(proj.id)}
                          className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-black text-xs font-bold transition-all shadow-sm active:scale-95"
                        >
                          Add Task
                        </button>
                      </div>

                      {/* Tasks List */}
                      {projectTasks.length === 0 ? (
                        <p className="text-xs text-zinc-500 italic p-3 rounded-lg bg-zinc-900/30 border border-zinc-800/60">
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
                                  className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:bg-zinc-800/50 cursor-pointer text-xs transition-colors"
                                >
                                  <div className="flex items-center gap-2.5 truncate pr-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleComplete?.(task);
                                      }}
                                      className="p-0.5 rounded text-zinc-400 hover:text-white transition-colors"
                                      title={task.is_completed ? "Mark incomplete" : "Mark complete"}
                                    >
                                      {task.is_completed ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                      ) : (
                                        <Circle className="w-4 h-4 text-zinc-500 hover:text-zinc-300 flex-shrink-0" />
                                      )}
                                    </button>
                                    <span className={`font-medium truncate ${task.is_completed ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                                      {task.title}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {taskMilestone && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono flex items-center gap-1">
                                        🏁 {taskMilestone.title}
                                      </span>
                                    )}
                                    {task.due_date && (
                                      <span className="text-[10px] text-zinc-400 font-mono">
                                        {task.due_date}
                                      </span>
                                    )}
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                      task.priority === 'urgent' ? 'bg-rose-500/20 text-rose-300' :
                                      task.priority === 'high' ? 'bg-amber-500/20 text-amber-300' :
                                      'bg-zinc-800 text-zinc-400'
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
                <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Raspberry Pi Cluster Automation"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Goals, target completion date, or strategic focus..."
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1.5">
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

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-black text-xs font-bold transition-all shadow-md shadow-blue-500/20"
                >
                  Create Project
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
