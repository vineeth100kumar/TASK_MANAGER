import React, { useState } from 'react';
import { 
  Plus, 
  CheckSquare, 
  Calendar, 
  Bell, 
  Flag, 
  RotateCw, 
  Trash2, 
  Sparkles, 
  Kanban, 
  ListFilter,
  CheckCircle2,
  Clock,
  Target,
  Zap,
  Check,
  X
} from 'lucide-react';
import { WorkItem, Milestone, EntityType, TaskStatus, TaskPriority } from '../../types';
import { api } from '../../services/api';

interface TasksViewProps {
  items: WorkItem[];
  milestones: Milestone[];
  onRefresh: () => void;
  onToggleComplete: (item: WorkItem) => void;
  onCreateItem?: (item: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => void;
  onDeleteItem?: (id: string) => void;
  onUpdateItem?: (id: string, updates: Partial<WorkItem>) => void;
  onToggleSubtask?: (itemId: string, subtaskId: string) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({
  items,
  milestones,
  onRefresh,
  onToggleComplete,
  onCreateItem,
  onDeleteItem,
  onUpdateItem,
  onToggleSubtask
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isAiExpanding, setIsAiExpanding] = useState(false);
  
  // AI Improvisation & Organization State
  const [isAiPolishing, setIsAiPolishing] = useState(false);
  const [generatedSubtasks, setGeneratedSubtasks] = useState<string[]>([]);
  const [isBoardOrganizerOpen, setIsBoardOrganizerOpen] = useState(false);
  const [boardOrgData, setBoardOrgData] = useState<any | null>(null);
  const [isOrganizingBoard, setIsOrganizingBoard] = useState(false);
  const [refiningItemId, setRefiningItemId] = useState<string | null>(null);

  // New Item State
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<EntityType>('task');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [newRepeatRule, setNewRepeatRule] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const filteredItems = items.filter((item) => {
    if (filterType === 'all') return true;
    if (filterType === 'task') return item.entity_type === 'task';
    if (filterType === 'event') return item.entity_type === 'event';
    if (filterType === 'reminder') return item.entity_type === 'reminder';
    if (filterType === 'milestone') return false; // Handled separately
    return true;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const itemData = {
      title: newTitle.trim(),
      entity_type: newType,
      priority: newPriority,
      due_date: newDueDate || undefined,
      repeat_rule: newRepeatRule || undefined,
      description: newDescription || undefined,
      status: 'todo' as TaskStatus,
      subtasks: generatedSubtasks.length > 0 ? generatedSubtasks : undefined,
    };

    if (onCreateItem) {
      onCreateItem(itemData);
    } else {
      api.createItem(itemData).then(() => onRefresh());
    }

    setNewTitle('');
    setNewDescription('');
    setNewDueDate('');
    setNewRepeatRule('');
    setGeneratedSubtasks([]);
    setIsCreating(false);
  };

  const handleAiPolishNewItem = async () => {
    if (!newTitle.trim()) return;
    setIsAiPolishing(true);
    try {
      const res = await api.improveTask(newTitle, newDescription, newType);
      if (res.success && res.data) {
        setNewTitle(res.data.improved_title);
        setNewDescription(res.data.description);
        if (res.data.priority) setNewPriority(res.data.priority as TaskPriority);
        if (res.data.subtasks && res.data.subtasks.length > 0) {
          setGeneratedSubtasks(res.data.subtasks);
        }
      }
    } catch (err) {
      console.error('Failed to polish item with AI:', err);
    } finally {
      setIsAiPolishing(false);
    }
  };

  const handleQuickRefine = async (item: WorkItem) => {
    setRefiningItemId(item.id);
    try {
      const res = await api.improveTask(item.title, item.description || undefined, item.entity_type);
      if (res.success && res.data) {
        const updates: Partial<WorkItem> = {
          title: res.data.improved_title,
          description: res.data.description,
          priority: (res.data.priority as TaskPriority) || item.priority,
          estimated_minutes: res.data.estimated_minutes || item.estimated_minutes,
        };
        if (onUpdateItem) {
          onUpdateItem(item.id, updates);
        } else {
          await api.updateItem(item.id, updates);
          onRefresh();
        }
      }
    } catch (err) {
      console.error('Failed to quick refine task:', err);
    } finally {
      setRefiningItemId(null);
    }
  };

  const handleOpenBoardOrganizer = async () => {
    setIsBoardOrganizerOpen(true);
    setIsOrganizingBoard(true);
    try {
      const res = await api.organizeBoard(items);
      if (res.success && res.data) {
        setBoardOrgData(res.data);
      }
    } catch (err) {
      console.error('Failed to organize board with AI:', err);
    } finally {
      setIsOrganizingBoard(false);
    }
  };

  const handleApplyTitleImprovement = async (id: string, improvedTitle: string) => {
    if (onUpdateItem) {
      onUpdateItem(id, { title: improvedTitle });
    } else {
      await api.updateItem(id, { title: improvedTitle });
      onRefresh();
    }
    if (boardOrgData) {
      setBoardOrgData({
        ...boardOrgData,
        title_improvements: boardOrgData.title_improvements.filter((ti: any) => ti.id !== id)
      });
    }
  };

  const handleApplyAllTitleImprovements = async () => {
    if (!boardOrgData?.title_improvements) return;
    for (const ti of boardOrgData.title_improvements) {
      if (onUpdateItem) {
        onUpdateItem(ti.id, { title: ti.improved_title });
      } else {
        await api.updateItem(ti.id, { title: ti.improved_title });
      }
    }
    onRefresh();
    setBoardOrgData({
      ...boardOrgData,
      title_improvements: []
    });
  };

  const handleAiAutoFill = async (item: WorkItem) => {
    setIsAiExpanding(true);
    try {
      const res = await api.autoFillTask(item.title, item.description || undefined);
      if (res.success && res.data) {
        const updates: Partial<WorkItem> = {
          description: res.data.description,
          priority: (res.data.priority as TaskPriority) || item.priority,
          estimated_minutes: res.data.estimated_minutes || item.estimated_minutes
        };
        setSelectedItem({ ...item, ...updates });
        if (onUpdateItem) {
          onUpdateItem(item.id, updates);
        } else {
          await api.updateItem(item.id, updates);
          onRefresh();
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAiExpanding(false);
    }
  };

  const handleDelete = (id: string) => {
    if (selectedItem?.id === id) setSelectedItem(null);
    if (onDeleteItem) {
      onDeleteItem(id);
    } else {
      api.deleteItem(id).then(() => onRefresh());
    }
  };

  const handleToggleSubtask = (subtaskId: string) => {
    if (selectedItem) {
      const updatedSubtasks = selectedItem.subtasks.map(s => 
        s.id === subtaskId ? { ...s, is_completed: !s.is_completed } : s
      );
      setSelectedItem({ ...selectedItem, subtasks: updatedSubtasks });
      if (onToggleSubtask) {
        onToggleSubtask(selectedItem.id, subtaskId);
      } else {
        api.toggleSubtask(subtaskId).then(() => onRefresh());
      }
    }
  };

  const kanbanColumns: { id: TaskStatus; label: string }[] = [
    { id: 'todo', label: 'To Do' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'blocked', label: 'Blocked' },
    { id: 'done', label: 'Completed' },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Tasks, Events & Reminders</h1>
          <p className="text-xs text-zinc-400">Total items: {items.length} • Recurring active: {items.filter(i => !!i.repeat_rule).length}</p>
        </div>

        <div className="flex items-center space-x-2">
          {/* View Toggle (List vs Kanban) */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-1 flex items-center">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded text-xs transition-colors ${
                viewMode === 'list' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="List View"
            >
              <ListFilter className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded text-xs transition-colors ${
                viewMode === 'kanban' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Kanban Board"
            >
              <Kanban className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleOpenBoardOrganizer}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600/20 via-indigo-600/20 to-purple-600/20 text-blue-300 hover:text-white hover:border-blue-400/40 border border-blue-500/30 rounded-lg text-xs font-semibold shadow-sm transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>AI Organize Board</span>
          </button>

          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>New Item</span>
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'all', label: 'All Items' },
          { id: 'task', label: 'Tasks' },
          { id: 'event', label: 'Events' },
          { id: 'reminder', label: 'Reminders' },
          { id: 'milestone', label: 'Milestones' },
        ].map((chip) => (
          <button
            key={chip.id}
            onClick={() => setFilterType(chip.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterType === chip.id
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 bg-zinc-900/50 border border-zinc-800/60'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Milestones View if selected */}
      {filterType === 'milestone' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {milestones.length === 0 ? (
            <div className="col-span-2 text-center py-12 text-zinc-400 text-xs">
              No milestones created yet.
            </div>
          ) : (
            milestones.map((m) => (
              <div key={m.id} className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">{m.title}</h3>
                    <p className="text-xs text-zinc-400 mt-0.5">Target Due Date: {m.due_date}</p>
                  </div>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                    {m.status}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-400 font-medium">
                    <span>Progress ({m.completed_task_count}/{m.linked_task_count} tasks)</span>
                    <span>{m.progress_percentage}%</span>
                  </div>
                  <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full rounded-full" style={{ width: `${m.progress_percentage}%` }} />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : viewMode === 'list' ? (
        /* List View */
        <div className="space-y-2">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 text-xs">
              No items match this filter. Click "+ New Item" or use AI Brain Dump!
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
                  item.is_completed
                    ? 'bg-zinc-900/40 border-zinc-800/40 text-zinc-400'
                    : 'bg-zinc-900/90 border-zinc-800 hover:border-zinc-700 text-zinc-200'
                }`}
              >
                <div className="flex items-center space-x-3.5 flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={item.is_completed}
                    onChange={() => onToggleComplete(item)}
                    className="w-4 h-4 rounded text-blue-600 bg-zinc-800 border-zinc-700 cursor-pointer shrink-0"
                  />
                  <div 
                    onClick={() => setSelectedItem(item)}
                    className="cursor-pointer min-w-0 flex-1"
                  >
                    <p className={`text-xs font-medium truncate ${item.is_completed ? 'line-through' : ''}`}>
                      {item.title}
                    </p>
                    <div className="flex items-center space-x-2 mt-1 text-[11px] text-zinc-400">
                      {item.due_date && <span>📅 {item.due_date}</span>}
                      {item.repeat_rule && (
                        <span className="text-blue-400 flex items-center space-x-1">
                          <RotateCw className="w-3 h-3" />
                          <span>{item.repeat_rule}</span>
                        </span>
                      )}
                      {item.subtasks && item.subtasks.length > 0 && (
                        <span>
                          ☑ {item.subtasks.filter(s => s.is_completed).length}/{item.subtasks.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0 ml-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleQuickRefine(item);
                    }}
                    disabled={refiningItemId === item.id}
                    title="Polish title & generate subtasks with AI"
                    className="text-zinc-500 hover:text-blue-400 p-1 rounded hover:bg-zinc-800 transition-colors"
                  >
                    {refiningItemId === item.id ? (
                      <RotateCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                      item.priority === 'urgent'
                        ? 'bg-red-500/20 text-red-400'
                        : item.priority === 'high'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {item.priority}
                  </span>

                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-zinc-400 hover:text-red-400 p-1 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Kanban Board View */
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 overflow-x-auto pb-4">
          {kanbanColumns.map((col) => {
            const colItems = filteredItems.filter(i => {
              if (col.id === 'done') return i.is_completed || i.status === 'done';
              return !i.is_completed && i.status === col.id;
            });

            return (
              <div key={col.id} className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">{col.label}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                    {colItems.length}
                  </span>
                </div>

                <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[600px] pr-1">
                  {colItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className="bg-zinc-900 border border-zinc-800/90 hover:border-zinc-700 p-3 rounded-xl cursor-pointer shadow-sm transition-all space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-xs font-medium ${item.is_completed ? 'line-through text-zinc-400' : 'text-zinc-200'}`}>
                          {item.title}
                        </span>
                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickRefine(item);
                            }}
                            disabled={refiningItemId === item.id}
                            title="Polish with AI"
                            className="text-zinc-500 hover:text-blue-400 p-0.5 rounded transition-colors"
                          >
                            {refiningItemId === item.id ? (
                              <RotateCw className="w-3 h-3 animate-spin text-blue-400" />
                            ) : (
                              <Sparkles className="w-3 h-3" />
                            )}
                          </button>
                          <span
                            className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                              item.priority === 'urgent'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {item.priority}
                          </span>
                        </div>
                      </div>
                      {item.repeat_rule && (
                        <div className="text-[10px] text-blue-400 flex items-center space-x-1">
                          <RotateCw className="w-2.5 h-2.5" />
                          <span>{item.repeat_rule}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {isCreating && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <h2 className="text-base font-semibold text-zinc-100">Create New Item</h2>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-zinc-400">Title</label>
                  <button
                    type="button"
                    onClick={handleAiPolishNewItem}
                    disabled={isAiPolishing || !newTitle.trim()}
                    className="flex items-center space-x-1 text-[11px] text-blue-400 hover:text-blue-300 disabled:opacity-40 font-medium px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 transition-all"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>{isAiPolishing ? 'Polishing...' : '✨ AI Polish & Auto-Complete'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. gym, pay wifi, meet raj tomorrow..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Generated Subtasks Preview in Create Modal */}
              {generatedSubtasks.length > 0 && (
                <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-400 flex items-center space-x-1.5">
                      <Sparkles className="w-3 h-3" />
                      <span>AI Generated Action Checklist ({generatedSubtasks.length})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setGeneratedSubtasks([])}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="space-y-1">
                    {generatedSubtasks.map((st, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-zinc-800/60 px-2.5 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-200">
                        <span>{st}</span>
                        <button
                          type="button"
                          onClick={() => setGeneratedSubtasks(generatedSubtasks.filter((_, idx) => idx !== i))}
                          className="text-zinc-500 hover:text-red-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Type</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as EntityType)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="task">Task</option>
                    <option value="event">Event</option>
                    <option value="reminder">Reminder</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Recurrence (Optional)</label>
                  <select
                    value={newRepeatRule}
                    onChange={(e) => setNewRepeatRule(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="">None (One-time)</option>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays (Mon-Fri)</option>
                    <option value="weekly:mon">Every Monday</option>
                    <option value="monthly:1">Monthly (1st of month)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Optional context or notes..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Item Detail & AI Auto-Fill Modal / Drawer */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-mono text-blue-400 uppercase tracking-wider">
                  {selectedItem.entity_type} • {selectedItem.priority}
                </span>
                <h2 className="text-base font-bold text-zinc-100 mt-0.5">{selectedItem.title}</h2>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-zinc-400 hover:text-zinc-200 text-xs"
              >
                Close
              </button>
            </div>

            {/* Description */}
            <div className="bg-zinc-950/60 p-3.5 rounded-xl border border-zinc-800/80">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-zinc-300">Description & Context</span>
                {/* AI Detail Filling Button */}
                <button
                  onClick={() => handleAiAutoFill(selectedItem)}
                  disabled={isAiExpanding}
                  className="flex items-center space-x-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isAiExpanding ? 'AI Generating...' : 'AI Auto-Fill Details'}</span>
                </button>
              </div>
              <p className="text-xs text-zinc-400 whitespace-pre-wrap">
                {selectedItem.description || "No description provided. Click 'AI Auto-Fill Details' to have Raspberry Pi 5 generate one!"}
              </p>
            </div>

            {/* Subtasks Checklist */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-zinc-300">Actionable Checklist</span>
              {selectedItem.subtasks.length === 0 ? (
                <p className="text-xs text-zinc-400 italic">No checklist items yet.</p>
              ) : (
                selectedItem.subtasks.map((st) => (
                  <div
                    key={st.id}
                    onClick={() => handleToggleSubtask(st.id)}
                    className="flex items-center space-x-2.5 p-2 rounded-lg bg-zinc-800/60 border border-zinc-700/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={st.is_completed}
                      onChange={() => handleToggleSubtask(st.id)}
                      className="w-3.5 h-3.5 rounded text-blue-600 bg-zinc-800 border-zinc-600 cursor-pointer"
                    />
                    <span className={`text-xs ${st.is_completed ? 'line-through text-zinc-400' : 'text-zinc-200'}`}>
                      {st.title}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Recurrence & Due Date info */}
            <div className="flex items-center justify-between text-xs text-zinc-400 border-t border-zinc-800 pt-3">
              <span>Due: {selectedItem.due_date || 'None'}</span>
              <span>{selectedItem.repeat_rule ? `🔄 Recurrence: ${selectedItem.repeat_rule}` : 'One-time item'}</span>
            </div>
          </div>
        </div>
      )}

      {/* AI Board Organizer Modal */}
      {isBoardOrganizerOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-xl p-6 space-y-5 shadow-2xl max-h-[88vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                    Executive Board Organizer
                  </h2>
                  <p className="text-[11px] text-zinc-400">
                    AI strategic workload analysis & task title optimization
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBoardOrganizerOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isOrganizingBoard ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <RotateCw className="w-6 h-6 animate-spin text-blue-400" />
                <p className="text-xs text-zinc-400">Analyzing tasks and strategic priorities...</p>
              </div>
            ) : boardOrgData ? (
              <div className="space-y-4">
                {/* Executive Summary Card */}
                <div className="bg-gradient-to-br from-blue-950/40 via-zinc-900 to-zinc-900 border border-blue-500/20 rounded-xl p-3.5 space-y-1.5">
                  <span className="text-[10px] font-mono text-blue-400 uppercase tracking-wider font-semibold">
                    Workload Synthesis
                  </span>
                  <p className="text-xs text-zinc-200 leading-relaxed">
                    {boardOrgData.executive_summary}
                  </p>
                </div>

                {/* Top 3 Big Rocks */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-zinc-300">
                    <Target className="w-4 h-4 text-red-400" />
                    <span>Today's Strategic Big 3 (High Leverage)</span>
                  </div>
                  <div className="space-y-1.5">
                    {boardOrgData.big_rocks.length === 0 ? (
                      <p className="text-xs text-zinc-400 italic">No pending tasks on the board.</p>
                    ) : (
                      boardOrgData.big_rocks.map((task: any, idx: number) => (
                        <div
                          key={task.id || idx}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs"
                        >
                          <div className="flex items-center space-x-2 min-w-0 flex-1">
                            <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold text-[10px]">
                              {idx + 1}
                            </span>
                            <span className="font-medium text-zinc-200 truncate">{task.title}</span>
                          </div>
                          <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded ml-2 ${
                            task.priority === 'urgent' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {task.priority || 'medium'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Proposed Title Polish */}
                {boardOrgData.title_improvements && boardOrgData.title_improvements.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-300 flex items-center space-x-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                        <span>Recommended Title Improvements ({boardOrgData.title_improvements.length})</span>
                      </span>
                      <button
                        onClick={handleApplyAllTitleImprovements}
                        className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20"
                      >
                        Polish All
                      </button>
                    </div>

                    <div className="space-y-2">
                      {boardOrgData.title_improvements.map((ti: any) => (
                        <div
                          key={ti.id}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950/50 border border-zinc-800/80 text-xs gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] text-zinc-400 line-through truncate">{ti.current_title}</div>
                            <div className="font-semibold text-emerald-400 truncate mt-0.5">{ti.improved_title}</div>
                          </div>
                          <button
                            onClick={() => handleApplyTitleImprovement(ti.id, ti.improved_title)}
                            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium shrink-0 flex items-center space-x-1"
                          >
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Apply</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setIsBoardOrganizerOpen(false)}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
