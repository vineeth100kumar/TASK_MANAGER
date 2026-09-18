import React, { useState, useEffect, useMemo } from 'react';
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
  X,
  Lock,
  Tag,
  Folder,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Sun,
  AlertCircle,
  CheckCheck,
  ArrowUpDown
} from 'lucide-react';
import { WorkItem, WorkItemUpdatePayload, Milestone, Project, EntityType, TaskStatus, TaskPriority } from '../../types';
import { api } from '../../services/api';
import { TimeBlockingCalendar } from './TimeBlockingCalendar';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { Skeleton } from '../common/Skeleton';
import { ListRow } from '../common/ListRow';
import { PullToRefresh } from '../common/PullToRefresh';
import { QuickAddBar } from './QuickAddBar';
import { BulkActionBar } from './BulkActionBar';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { 
  groupTasksBySmartDate, 
  getTodayDateString, 
  getTomorrowDateString, 
  isOverdue, 
  isDueToday,
  itemMoment,
  formatWhen,
  compareBySchedule,
  timeInputValue,
  withTimeOfDay
} from '../../utils/dateHelpers';
import { haptics } from '../../utils/haptics';

interface TasksViewProps {
  isLoading?: boolean;
  items: WorkItem[];
  projects: Project[];
  milestones: Milestone[];
  onRefresh: () => void;
  onToggleComplete: (item: WorkItem) => void;
  onCreateItem?: (item: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => void;
  onDeleteItem?: (id: string) => void;
  onUpdateItem?: (id: string, updates: WorkItemUpdatePayload) => void;
  onToggleSubtask?: (itemId: string, subtaskId: string) => void;
  onOpenBrainDump?: () => void;
  onCelebrationTrigger?: () => void;
}

export const TasksView: React.FC<TasksViewProps> = ({
  isLoading = false,
  items,
  projects = [],
  milestones,
  onRefresh,
  onToggleComplete,
  onCreateItem,
  onDeleteItem,
  onUpdateItem,
  onToggleSubtask,
  onOpenBrainDump,
  onCelebrationTrigger
}) => {
  // Persisted view settings
  const [filterType, setFilterType] = usePersistedState<string>('tasks_filter_type', 'all');
  const [viewMode, setViewMode] = usePersistedState<'list' | 'kanban' | 'timeline'>('tasks_view_mode', 'list');
  const [selectedTag, setSelectedTag] = usePersistedState<string | null>('tasks_selected_tag', null);
  const [selectedProjectId, setSelectedProjectId] = usePersistedState<string>('tasks_selected_project', 'all');
  const [sortBy, setSortBy] = usePersistedState<'due_date' | 'priority' | 'title' | 'created_at'>('tasks_sort_by', 'due_date');
  const [smartGrouping, setSmartGrouping] = usePersistedState<boolean>('tasks_smart_grouping', true);

  // Interaction State
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isAiExpanding, setIsAiExpanding] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [collapsedSections, setCollapsedSections] = useState<{ [key: string]: boolean }>({});

  // Multi-select state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // AI Improvisation & Organization State
  const [isAiPolishing, setIsAiPolishing] = useState(false);
  const [generatedSubtasks, setGeneratedSubtasks] = useState<string[]>([]);
  const [isBoardOrganizerOpen, setIsBoardOrganizerOpen] = useState(false);
  const [boardOrgData, setBoardOrgData] = useState<any | null>(null);
  const [isOrganizingBoard, setIsOrganizingBoard] = useState(false);
  const [refiningItemId, setRefiningItemId] = useState<string | null>(null);

  // New Item State (for manual create modal)
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<EntityType>('task');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [newRepeatRule, setNewRepeatRule] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newContextTags, setNewContextTags] = useState('');
  const [newProjectId, setNewProjectId] = useState<string>('');
  const [newMilestoneId, setNewMilestoneId] = useState<string>('');
  const [newEstimatedMinutes, setNewEstimatedMinutes] = useState<number>(30);

  // Check if an item is blocked by uncompleted dependencies
  const isItemBlocked = (item: WorkItem): { blocked: boolean; blockerTitles: string[] } => {
    if (!item.depends_on || item.depends_on.length === 0) return { blocked: false, blockerTitles: [] };
    const blockers = items.filter(i => item.depends_on.includes(i.id) && !i.is_completed);
    return {
      blocked: blockers.length > 0,
      blockerTitles: blockers.map(i => i.title)
    };
  };

  // Keep selectedItem in sync when items update
  useEffect(() => {
    if (selectedItem) {
      const refreshed = items.find(i => i.id === selectedItem.id);
      if (refreshed) {
        setSelectedItem(refreshed);
      }
    }
  }, [items]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filterType === 'task' && item.entity_type !== 'task') return false;
      if (filterType === 'event' && item.entity_type !== 'event') return false;
      if (filterType === 'reminder' && item.entity_type !== 'reminder') return false;
      if (filterType === 'milestone') return false;
      if (selectedTag && !item.context_tags?.toLowerCase().includes(selectedTag.toLowerCase())) {
        return false;
      }
      if (selectedProjectId === 'inbox') {
        if (item.project_id) return false;
      } else if (selectedProjectId !== 'all' && item.project_id !== selectedProjectId) {
        return false;
      }
      return true;
    });
  }, [items, filterType, selectedTag, selectedProjectId]);

  // Sort items
  const priorityWeights: { [key: string]: number } = { urgent: 4, high: 3, medium: 2, low: 1 };

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      if (sortBy === 'priority') {
        return (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0);
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'created_at') {
        return new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime();
      }
      // Default: when it happens, which includes the time of day. Sorting on
      // the date alone left everything due today in an arbitrary order.
      return compareBySchedule(a, b);
    });
  }, [filteredItems, sortBy]);

  // Smart Date Groups
  const smartGroups = useMemo(() => {
    return groupTasksBySmartDate(sortedItems);
  }, [sortedItems]);

  // Keyboard Navigation Shortcuts (j/k, Space, e, d, t, m)
  useKeyboardShortcuts({
    enabled: viewMode === 'list' && !isCreating && !selectedItem && !isBoardOrganizerOpen,
    onMoveDown: () => setHighlightedIndex(prev => Math.min(sortedItems.length - 1, prev + 1)),
    onMoveUp: () => setHighlightedIndex(prev => Math.max(0, prev - 1)),
    onToggleComplete: () => {
      if (highlightedIndex >= 0 && highlightedIndex < sortedItems.length) {
        onToggleComplete(sortedItems[highlightedIndex]);
      }
    },
    onEdit: () => {
      if (highlightedIndex >= 0 && highlightedIndex < sortedItems.length) {
        setSelectedItem(sortedItems[highlightedIndex]);
      }
    },
    onDelete: () => {
      if (highlightedIndex >= 0 && highlightedIndex < sortedItems.length) {
        setDeletingItemId(sortedItems[highlightedIndex].id);
      }
    },
    onSetToday: () => {
      if (highlightedIndex >= 0 && highlightedIndex < sortedItems.length && onUpdateItem) {
        onUpdateItem(sortedItems[highlightedIndex].id, { due_date: getTodayDateString() });
      }
    },
    onSetTomorrow: () => {
      if (highlightedIndex >= 0 && highlightedIndex < sortedItems.length && onUpdateItem) {
        onUpdateItem(sortedItems[highlightedIndex].id, { due_date: getTomorrowDateString() });
      }
    }
  });

  // Multi-Select Handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  };

  const handleBulkComplete = () => {
    const selectedItems = items.filter(i => selectedIds.has(i.id) && !i.is_completed);
    selectedItems.forEach(item => onToggleComplete(item));
    handleClearSelection();
  };

  const handleBulkDelete = () => {
    if (onDeleteItem) {
      selectedIds.forEach(id => onDeleteItem(id));
    }
    handleClearSelection();
  };

  const handleBulkPriority = (priority: TaskPriority) => {
    if (onUpdateItem) {
      selectedIds.forEach(id => onUpdateItem(id, { priority }));
    }
    handleClearSelection();
  };

  const handleBulkReschedule = (dateStr: string) => {
    if (onUpdateItem) {
      selectedIds.forEach(id => onUpdateItem(id, { due_date: dateStr }));
    }
    handleClearSelection();
  };

  // 1-Tap Reschedule
  const handleReschedule = (item: WorkItem, newDate: string | null) => {
    if (onUpdateItem) {
      onUpdateItem(item.id, { due_date: newDate });
    }
  };

  // Kanban Drag-and-Drop
  const handleDropOnColumn = (targetStatus: TaskStatus, itemId: string) => {
    if (!itemId || !onUpdateItem) return;
    haptics.medium();
    if (targetStatus === 'done') {
      onUpdateItem(itemId, { status: 'done', is_completed: true });
    } else {
      onUpdateItem(itemId, { status: targetStatus, is_completed: false });
    }
  };

  const toggleSectionCollapse = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Quick Refine with AI
  const handleQuickRefine = async (item: WorkItem) => {
    setRefiningItemId(item.id);
    try {
      const res = await api.improveTask(item.title, item.description || undefined, item.entity_type);
      if (res.success && res.data) {
        const updates: WorkItemUpdatePayload = {
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

  // AI Board Organizer
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

  // AI Polish New Item
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

  const handleAiAutoFill = async (item: WorkItem) => {
    setIsAiExpanding(true);
    try {
      const res = await api.autoFillTask(item.title, item.description || undefined);
      if (res.success && res.data) {
        const updates: WorkItemUpdatePayload = {
          description: res.data.description,
          priority: (res.data.priority as TaskPriority) || item.priority,
          estimated_minutes: res.data.estimated_minutes || item.estimated_minutes
        };

        if ((!item.subtasks || item.subtasks.length === 0) && res.data.subtasks && res.data.subtasks.length > 0) {
          updates.subtasks = res.data.subtasks;
        }

        const optimisticSubtasks = updates.subtasks
          ? updates.subtasks.map((st, idx) => ({
              id: `temp_sub_${Date.now()}_${idx}`,
              work_item_id: item.id,
              title: st,
              is_completed: false,
              position: idx
            }))
          : item.subtasks;

        setSelectedItem({ ...item, ...updates, subtasks: optimisticSubtasks } as WorkItem);
        if (onUpdateItem) {
          onUpdateItem(item.id, updates);
        } else {
          const updated = await api.updateItem(item.id, updates);
          if (updated) setSelectedItem(updated);
          onRefresh();
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAiExpanding(false);
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
      context_tags: newContextTags || undefined,
      project_id: newProjectId || undefined,
      milestone_id: newMilestoneId || undefined,
      estimated_minutes: newEstimatedMinutes || 30,
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
    setNewContextTags('');
    setNewProjectId('');
    setNewMilestoneId('');
    setNewEstimatedMinutes(30);
    setGeneratedSubtasks([]);
    setIsCreating(false);
  };

  const handleDelete = (id: string) => {
    if (selectedItem?.id === id) setSelectedItem(null);
    if (onDeleteItem) {
      onDeleteItem(id);
    } else {
      api.deleteItem(id).then(() => onRefresh());
    }
  };

  const kanbanColumns: { id: TaskStatus; label: string; desk: string }[] = [
    { id: 'todo', label: 'Assignments', desk: 'DESK I' },
    { id: 'in_progress', label: 'In Proofing', desk: 'DESK II' },
    { id: 'blocked', label: 'Under Hold', desk: 'HOLD' },
    { id: 'done', label: 'Published', desk: 'DESK III' },
  ];

  return (
    <PullToRefresh onRefresh={onRefresh} className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12">
      {/* Natural-language quick add */}
      <QuickAddBar
        projects={projects}
        onQuickAdd={(itemData) => onCreateItem?.(itemData)}
        onOpenAiBrainDump={() => onOpenBrainDump?.()}
      />

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-1">
        <div>
          <h1 className="screen-title">Tasks</h1>
          <p className="text-meta text-ink-3 mt-0.5">
            {[
              `${items.length} total`,
              smartGroups.overdue.length > 0 ? `${smartGroups.overdue.length} overdue` : null,
              smartGroups.today.length > 0 ? `${smartGroups.today.length} due today` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          {/* View Toggle (List vs Kanban vs Timeline) */}
          <div className="bg-sunken rounded-control p-0.5 flex items-center">
            <button
              onClick={() => setViewMode('list')}
              aria-label="List View"
              className={`px-2 py-1 rounded-control text-meta transition-colors ${
                viewMode === 'list' 
                  ? 'bg-surface text-ink font-medium shadow-sm'
                  : 'text-ink-2 hover:text-ink'
              }`}
              title="List View"
            >
              List
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              aria-label="Kanban Board View"
              className={`px-2 py-1 rounded-control text-meta transition-colors ${
                viewMode === 'kanban' 
                  ? 'bg-surface text-ink font-medium shadow-sm'
                  : 'text-ink-2 hover:text-ink'
              }`}
              title="Kanban Board"
            >
              Board
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              aria-label="Daily Timeline Calendar"
              className={`px-2 py-1 rounded-control text-meta transition-colors ${
                viewMode === 'timeline' 
                  ? 'bg-surface text-ink font-medium shadow-sm'
                  : 'text-ink-2 hover:text-ink'
              }`}
              title="Daily Timeline Calendar"
            >
              Timeline
            </button>
          </div>

          {/* Smart Grouping Toggle (for List View) */}
          {viewMode === 'list' && (
            <button
              onClick={() => setSmartGrouping(!smartGrouping)}
              title={smartGrouping ? "Smart Grouping Enabled (Overdue, Today, Upcoming)" : "Flat List (Smart Grouping Off)"}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-control border text-meta transition-colors ${
                smartGrouping
                  ? 'bg-accent-500/15 text-accent-600 dark:text-accent-300 border-transparent'
                  : 'bg-sunken text-ink-2 border-transparent hover:text-ink'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{smartGrouping ? 'Grouped' : 'Flat'}</span>
            </button>
          )}

          {/* Sort Dropdown */}
          <div className="relative flex items-center bg-paper-aged dark:bg-stone-900 border border-stone-300 dark:border-stone-800 rounded-control px-2 py-1 text-meta">
            <ArrowUpDown className="w-3.5 h-3.5 text-ink-3 mr-1.5" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-meta text-stone-800 dark:text-stone-200 focus:outline-none cursor-pointer"
            >
              <option value="due_date">Due date</option>
              <option value="priority" className="bg-paper-base text-stone-900 dark:bg-stone-900 dark:text-stone-200">Priority</option>
              <option value="title" className="bg-paper-base text-stone-900 dark:bg-stone-900 dark:text-stone-200">TITLE (A-Z)</option>
              <option value="created_at" className="bg-paper-base text-stone-900 dark:bg-stone-900 dark:text-stone-200">Newest</option>
            </select>
          </div>

          {/* Multi-Select Mode Toggle */}
          {viewMode === 'list' && (
            <button
              onClick={() => {
                if (isSelectMode) {
                  handleClearSelection();
                } else {
                  setIsSelectMode(true);
                }
              }}
              className={`px-2.5 py-1.5 rounded-control border text-meta transition-colors ${
                isSelectMode
                  ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700 font-bold'
                  : 'bg-paper-aged dark:bg-stone-900 text-ink-3 dark:text-stone-400 border-stone-300 dark:border-stone-800 hover:text-stone-900'
              }`}
            >
              {isSelectMode ? 'Cancel' : 'Select'}
            </button>
          )}

          {/* AI Board Organizer */}
          <button
            onClick={handleOpenBoardOrganizer}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-paper-aged dark:bg-stone-900 hover:bg-stone-200 dark:hover:bg-stone-800 text-amber-800 dark:text-amber-400 border border-stone-300 dark:border-stone-700 rounded-control text-meta transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span className="hidden sm:inline">AI Organize</span>
          </button>

          {/* Manual New Item Button */}
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-control bg-amber-600 hover:bg-amber-500 text-stone-950 text-meta font-bold border border-amber-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New task</span>
          </button>
        </div>
      </div>

      {/* Filter Chips & GTD Context Tags */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar pb-1">
          {[
            { id: 'all', label: 'All' },
            { id: 'task', label: 'Tasks' },
            { id: 'event', label: 'Events' },
            { id: 'reminder', label: 'Reminders' },
            { id: 'milestone', label: 'Milestones' },
          ].map((chip) => (
            <button
              key={chip.id}
              onClick={() => setFilterType(chip.id)}
              className={`px-3 py-1.5 rounded-control text-meta whitespace-nowrap transition-colors border ${
                filterType === chip.id
                  ? 'bg-accent-500 text-white font-medium border-transparent'
                  : 'text-ink-2 hover:text-ink bg-sunken border-transparent'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* GTD Context Tag Filters */}
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-1 text-meta">
          <span className="text-ink-3 dark:text-stone-500 font-bold text-caption pr-1 flex items-center gap-1">
            <Tag className="w-3.5 h-3.5" /> Context
          </span>
          {['all', '@errands', '@computer', '@phone', '@home', '@deep-work'].map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag === 'all' ? null : tag)}
              className={`px-2 py-0.5 rounded-control text-caption transition-colors whitespace-nowrap border ${
                (tag === 'all' && !selectedTag) || selectedTag === tag
                  ? 'bg-accent-500 text-white font-medium border-transparent'
                  : 'bg-sunken text-ink-2 hover:text-ink border-transparent'
              }`}
            >
              {tag === 'all' ? 'All' : tag}
            </button>
          ))}
        </div>

        {/* Project Filter Chips */}
        {projects.length > 0 && (
          <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-1 text-meta">
            <span className="text-ink-3 dark:text-stone-500 font-bold text-caption pr-1 flex items-center gap-1">
              <Folder className="w-3.5 h-3.5" /> Project
            </span>
            <button
              onClick={() => setSelectedProjectId('all')}
              className={`px-2 py-0.5 rounded-control text-caption transition-colors whitespace-nowrap border ${
                selectedProjectId === 'all'
                  ? 'bg-accent-500 text-white font-medium border-transparent'
                  : 'bg-sunken text-ink-2 hover:text-ink border-transparent'
              }`}
            >
              All Projects
            </button>
            <button
              onClick={() => setSelectedProjectId('inbox')}
              className={`px-2 py-0.5 rounded-control text-caption transition-colors whitespace-nowrap border ${
                selectedProjectId === 'inbox'
                  ? 'bg-accent-500 text-white font-medium border-transparent'
                  : 'bg-sunken text-ink-2 hover:text-ink border-transparent'
              }`}
            >
              Inbox (Unassigned)
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className={`px-2 py-0.5 rounded-control text-caption transition-colors whitespace-nowrap border ${
                  selectedProjectId === p.id
                    ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700 font-bold'
                    : 'bg-paper-aged dark:bg-stone-900 text-ink-3 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 border-stone-300 dark:border-stone-800'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-control" style={{ backgroundColor: p.color || '#d97706' }} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Milestones View if selected */}
      {filterType === 'milestone' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {milestones.length === 0 ? (
            <div className="col-span-2 text-center py-12 text-ink-2 text-meta">
              No milestones created yet.
            </div>
          ) : (
            milestones.map((m) => (
              <div key={m.id} className="bg-surface border border-hairline p-5 rounded-2xl space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{m.title}</h3>
                    <p className="text-meta text-ink-2 mt-0.5">Target Due Date: {m.due_date}</p>
                  </div>
                  <span className="text-caption font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                    {m.status}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-meta text-ink-2 font-medium">
                    <span>Progress ({m.completed_task_count}/{m.linked_task_count} tasks)</span>
                    <span>{m.progress_percentage}%</span>
                  </div>
                  <div className="w-full bg-sunken h-2 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full rounded-full" style={{ width: `${m.progress_percentage}%` }} />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : viewMode === 'list' ? (
        /* List View (Smart Date Grouping or Flat List with ListRow) */
        <div className="space-y-4">
          {sortedItems.length === 0 ? (
            isLoading ? (
              <div className="space-y-2">
                <Skeleton variant="row" count={5} />
              </div>
            ) : (
              <div className="text-center py-12 text-ink-2 text-meta">
                No items match this filter. Use the Quick Add bar above!
              </div>
            )
          ) : smartGrouping ? (
            /* Smart Sections: Overdue, Today, Upcoming, Backlog */
            <div className="space-y-6">
              {/* Overdue Section */}
              {smartGroups.overdue.length > 0 && (
                <div className="space-y-2">
                  <button
                    onClick={() => toggleSectionCollapse('overdue')}
                    className="flex items-center gap-2 text-meta font-semibold text-late-500 dark:text-late-400 px-1 cursor-pointer select-none"
                  >
                    {collapsedSections['overdue'] ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    <AlertCircle className="w-4 h-4" />
                    <span>Overdue</span>
                    <span className="text-caption px-2 py-0.5 rounded-full bg-late-500/15 tabular">
                      {smartGroups.overdue.length}
                    </span>
                  </button>

                  {!collapsedSections['overdue'] && (
                    <div className="space-y-2 pl-1">
                      {smartGroups.overdue.map((item, idx) => {
                        const { blocked, blockerTitles } = isItemBlocked(item);
                        return (
                          <ListRow
                            key={item.id}
                            item={item}
                            projects={projects}
                            isSelected={selectedIds.has(item.id)}
                            isSelectMode={isSelectMode}
                            isHighlighted={highlightedIndex === idx}
                            isBlocked={blocked}
                            blockerTitles={blockerTitles}
                            isRefining={refiningItemId === item.id}
                            onToggleSelect={handleToggleSelect}
                            onToggleComplete={onToggleComplete}
                            onDelete={(id) => setDeletingItemId(id)}
                            onClick={(item) => setSelectedItem(item)}
                            onRefine={handleQuickRefine}
                            onReschedule={handleReschedule}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Today Section */}
              <div className="space-y-2">
                <button
                  onClick={() => toggleSectionCollapse('today')}
                  className="flex items-center gap-2 text-meta font-semibold text-ink-2 px-1 cursor-pointer select-none"
                >
                  {collapsedSections['today'] ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  <Sun className="w-4 h-4 text-ink-3" />
                  <span>Today</span>
                  <span className="text-caption px-2 py-0.5 rounded-full bg-sunken text-ink-3 tabular">
                    {smartGroups.today.length}
                  </span>
                </button>

                {!collapsedSections['today'] && (
                  <div className="space-y-2 pl-1">
                    {smartGroups.today.length === 0 ? (
                      <p className="text-meta text-ink-3 italic py-2 px-3">No tasks due today. You are all caught up!</p>
                    ) : (
                      smartGroups.today.map((item, idx) => {
                        const { blocked, blockerTitles } = isItemBlocked(item);
                        const globalIdx = smartGroups.overdue.length + idx;
                        return (
                          <ListRow
                            key={item.id}
                            item={item}
                            projects={projects}
                            isSelected={selectedIds.has(item.id)}
                            isSelectMode={isSelectMode}
                            isHighlighted={highlightedIndex === globalIdx}
                            isBlocked={blocked}
                            blockerTitles={blockerTitles}
                            isRefining={refiningItemId === item.id}
                            onToggleSelect={handleToggleSelect}
                            onToggleComplete={onToggleComplete}
                            onDelete={(id) => setDeletingItemId(id)}
                            onClick={(item) => setSelectedItem(item)}
                            onRefine={handleQuickRefine}
                            onReschedule={handleReschedule}
                          />
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Upcoming Section */}
              {smartGroups.upcoming.length > 0 && (
                <div className="space-y-2">
                  <button
                    onClick={() => toggleSectionCollapse('upcoming')}
                    className="flex items-center gap-2 text-meta font-semibold text-ink-2 px-1 cursor-pointer select-none"
                  >
                    {collapsedSections['upcoming'] ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    <Calendar className="w-4 h-4 text-blue-400" />
                    <span>Upcoming (Next 7 Days)</span>
                    <span className="text-caption px-2 py-0.5 rounded-full bg-sunken text-ink-3 tabular">
                      {smartGroups.upcoming.length}
                    </span>
                  </button>

                  {!collapsedSections['upcoming'] && (
                    <div className="space-y-2 pl-1">
                      {smartGroups.upcoming.map((item, idx) => {
                        const { blocked, blockerTitles } = isItemBlocked(item);
                        const globalIdx = smartGroups.overdue.length + smartGroups.today.length + idx;
                        return (
                          <ListRow
                            key={item.id}
                            item={item}
                            projects={projects}
                            isSelected={selectedIds.has(item.id)}
                            isSelectMode={isSelectMode}
                            isHighlighted={highlightedIndex === globalIdx}
                            isBlocked={blocked}
                            blockerTitles={blockerTitles}
                            isRefining={refiningItemId === item.id}
                            onToggleSelect={handleToggleSelect}
                            onToggleComplete={onToggleComplete}
                            onDelete={(id) => setDeletingItemId(id)}
                            onClick={(item) => setSelectedItem(item)}
                            onRefine={handleQuickRefine}
                            onReschedule={handleReschedule}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Backlog / No Date Section */}
              {smartGroups.backlog.length > 0 && (
                <div className="space-y-2">
                  <button
                    onClick={() => toggleSectionCollapse('backlog')}
                    className="flex items-center gap-2 text-meta font-semibold text-ink-2 px-1 cursor-pointer select-none"
                  >
                    {collapsedSections['backlog'] ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    <Folder className="w-4 h-4 text-ink-2" />
                    <span>No Date / Backlog</span>
                    <span className="text-caption px-2 py-0.5 rounded-full bg-sunken text-ink-3 tabular">
                      {smartGroups.backlog.length}
                    </span>
                  </button>

                  {!collapsedSections['backlog'] && (
                    <div className="space-y-2 pl-1">
                      {smartGroups.backlog.map((item, idx) => {
                        const { blocked, blockerTitles } = isItemBlocked(item);
                        const globalIdx = smartGroups.overdue.length + smartGroups.today.length + smartGroups.upcoming.length + idx;
                        return (
                          <ListRow
                            key={item.id}
                            item={item}
                            projects={projects}
                            isSelected={selectedIds.has(item.id)}
                            isSelectMode={isSelectMode}
                            isHighlighted={highlightedIndex === globalIdx}
                            isBlocked={blocked}
                            blockerTitles={blockerTitles}
                            isRefining={refiningItemId === item.id}
                            onToggleSelect={handleToggleSelect}
                            onToggleComplete={onToggleComplete}
                            onDelete={(id) => setDeletingItemId(id)}
                            onClick={(item) => setSelectedItem(item)}
                            onRefine={handleQuickRefine}
                            onReschedule={handleReschedule}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Flat Sorted List */
            <div className="space-y-2">
              {sortedItems.map((item, idx) => {
                const { blocked, blockerTitles } = isItemBlocked(item);
                return (
                  <ListRow
                    key={item.id}
                    item={item}
                    projects={projects}
                    isSelected={selectedIds.has(item.id)}
                    isSelectMode={isSelectMode}
                    isHighlighted={highlightedIndex === idx}
                    isBlocked={blocked}
                    blockerTitles={blockerTitles}
                    isRefining={refiningItemId === item.id}
                    onToggleSelect={handleToggleSelect}
                    onToggleComplete={onToggleComplete}
                    onDelete={(id) => setDeletingItemId(id)}
                    onClick={(item) => setSelectedItem(item)}
                    onRefine={handleQuickRefine}
                    onReschedule={handleReschedule}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : viewMode === 'kanban' ? (
        /* Board view */
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 overflow-x-auto pb-4">
          {kanbanColumns.map((col) => {
            const colItems = sortedItems.filter(i => {
              if (col.id === 'done') return i.is_completed || i.status === 'done';
              return !i.is_completed && i.status === col.id;
            });

            return (
              <div 
                key={col.id} 
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const droppedId = e.dataTransfer.getData('text/plain');
                  handleDropOnColumn(col.id, droppedId);
                }}
                className="bg-sunken border border-stone-300 dark:border-stone-800 rounded-control p-3.5 flex flex-col transition-colors hover:border-stone-400 dark:hover:border-stone-700 relative"
              >                <div className="flex items-center justify-between mb-3 border-b border-stone-300 dark:border-stone-800/80 pb-2">
                  <div>
                    <div className="text-caption text-amber-700 dark:text-amber-500 font-bold">{col.desk}</div>
                    <span className="text-sm font-bold text-stone-900 dark:text-stone-100 tracking-wide">{col.label}</span>
                  </div>
                  <span className="text-caption px-1.5 py-0.5 rounded-control bg-paper-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-800">
                    {colItems.length}
                  </span>
                </div>

                <div className="space-y-2 flex-1 overflow-y-auto max-h-[600px] pr-1">
                  {colItems.map((item) => {
                    const { blocked, blockerTitles } = isItemBlocked(item);
                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', item.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => setSelectedItem(item)}
                        className={`bg-surface border p-2.5 rounded-control cursor-grab active:cursor-grabbing shadow-sm transition-colors space-y-2 select-none ${
                          blocked
                            ? 'border-amber-600/40 opacity-80 hover:opacity-100'
                            : 'border-stone-300 dark:border-stone-800 hover:border-stone-400 dark:hover:border-stone-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {blocked && (
                              <span title={`Blocked by: ${blockerTitles.join(', ')}`} className="text-amber-600 dark:text-amber-500 shrink-0 text-caption font-bold">
                                [BLOCKED]
                              </span>
                            )}
                            <span className={` text-meta font-semibold truncate ${item.is_completed ? 'line-through text-ink-2 dark:text-stone-500 italic' : 'text-stone-900 dark:text-stone-100'}`}>
                              {item.title}
                            </span>
                          </div>
                          <div className="flex items-center space-x-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickRefine(item);
                              }}
                              disabled={refiningItemId === item.id}
                              title="Polish with AI"
                              className="text-ink-3 hover:text-amber-600 dark:hover:text-amber-400 p-0.5 rounded-control transition-colors"
                            >
                              {refiningItemId === item.id ? (
                                <RotateCw className="w-3 h-3 animate-spin text-amber-500" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                            </button>
                            <span
                              className={`text-caption font-bold px-1 py-0.2 rounded-control border ${
                                item.priority === 'urgent'
                                  ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
                                  : 'bg-paper-aged dark:bg-stone-900 text-stone-700 dark:text-stone-400 border-stone-300 dark:border-stone-800'
                              }`}
                            >
                              {item.priority}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.project_id && (() => {
                            const p = projects.find(proj => proj.id === item.project_id);
                            if (!p) return null;
                            return (
                              <div 
                                className="text-caption px-1.5 py-0.5 rounded-control border border-stone-300 dark:border-stone-700 flex items-center gap-1 font-medium"
                                style={{
                                  backgroundColor: `${p.color || '#d97706'}20`,
                                  color: p.color || '#d97706'
                                }}
                              >
                                <span className="w-1.5 h-1.5 rounded-control" style={{ backgroundColor: p.color || '#d97706' }} />
                                <span className="truncate max-w-[100px]">{p.name}</span>
                              </div>
                            );
                          })()}
                          {(item.due_date || itemMoment(item)) && (
                            <span className="text-caption text-ink-3 dark:text-zinc-400">
                              📅 {formatWhen(item)}
                            </span>
                          )}
                          {item.context_tags && (
                            <div className="text-caption text-ink-3 dark:text-zinc-400 flex items-center gap-0.5 bg-paper-base dark:bg-zinc-800/80 px-1.5 py-0.5 rounded-control border border-stone-200 dark:border-stone-700">
                              <Tag className="w-2.5 h-2.5 text-ink-2" />
                              <span>{item.context_tags}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Timeline View */
        <TimeBlockingCalendar
          items={items}
          projects={projects}
          onSelectItem={setSelectedItem}
          onUpdateItem={onUpdateItem || (() => {})}
          onCreateItem={onCreateItem || (() => {})}
        />
      )}

      {/* Floating Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        onClearSelection={handleClearSelection}
        onBulkComplete={handleBulkComplete}
        onBulkDelete={handleBulkDelete}
        onBulkPriority={handleBulkPriority}
        onBulkReschedule={handleBulkReschedule}
      />

{/* Create Modal */}
      <Modal
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
        title="Create New Item"
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-meta text-ink-2">Title</label>
                  <button
                    type="button"
                    onClick={handleAiPolishNewItem}
                    disabled={isAiPolishing || !newTitle.trim()}
                    className="flex items-center space-x-1 text-meta text-blue-400 hover:text-blue-300 disabled:opacity-40 font-medium px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 transition-all"
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
                  className="w-full bg-sunken border border-hairline rounded-lg px-3 py-2 text-meta text-ink focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Generated Subtasks Preview in Create Modal */}
              {generatedSubtasks.length > 0 && (
                <div className="bg-paper-aged/40 dark:bg-stone-900/60 p-3 rounded border border-ink-base/15 dark:border-stone-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-meta font-semibold text-blue-400 flex items-center space-x-1.5">
                      <Sparkles className="w-3 h-3" />
                      <span>AI Generated Action Checklist ({generatedSubtasks.length})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setGeneratedSubtasks([])}
                      className="text-caption text-ink-3 hover:text-ink-2"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="space-y-1">
                    {generatedSubtasks.map((st, i) => (
                      <div key={i} className="flex items-center justify-between text-meta bg-sunken/60 px-2.5 py-1.5 rounded-lg border border-hairline/60 text-ink">
                        <span>{st}</span>
                        <button
                          type="button"
                          onClick={() => setGeneratedSubtasks(generatedSubtasks.filter((_, idx) => idx !== i))}
                          className="text-ink-3 hover:text-red-400"
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
                  <label className="block text-meta text-ink-2 mb-1">Type</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as EntityType)}
                    className="w-full bg-sunken border border-hairline rounded-lg px-3 py-2 text-meta text-ink"
                  >
                    <option value="task">Task</option>
                    <option value="event">Event</option>
                    <option value="reminder">Reminder</option>
                  </select>
                </div>

                <div>
                  <label className="block text-meta text-ink-2 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full bg-sunken border border-hairline rounded-lg px-3 py-2 text-meta text-ink"
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
                  <label className="block text-meta text-ink-2 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full bg-sunken border border-hairline rounded-lg px-3 py-2 text-meta text-ink"
                  />
                </div>

                <div>
                  <label className="block text-meta text-ink-2 mb-1">Recurrence (Optional)</label>
                  <select
                    value={newRepeatRule}
                    onChange={(e) => setNewRepeatRule(e.target.value)}
                    className="w-full bg-sunken border border-hairline rounded-lg px-3 py-2 text-meta text-ink"
                  >
                    <option value="">None (One-time)</option>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays (Mon-Fri)</option>
                    <option value="weekly:mon">Every Monday</option>
                    <option value="monthly:1">Monthly (1st of month)</option>
                  </select>
                </div>
              </div>

              {/* Project & Milestone Assignment */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-meta text-ink-2 mb-1">Project</label>
                  <select
                    value={newProjectId}
                    onChange={(e) => {
                      setNewProjectId(e.target.value);
                      setNewMilestoneId('');
                    }}
                    className="w-full bg-sunken border border-hairline rounded-lg px-3 py-2 text-meta text-ink focus:outline-none focus:border-blue-500"
                  >
                    <option value="">No Project (Inbox)</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>● {p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-meta text-ink-2 mb-1">Milestone (Optional)</label>
                  <select
                    value={newMilestoneId}
                    onChange={(e) => setNewMilestoneId(e.target.value)}
                    disabled={!newProjectId}
                    className="w-full bg-sunken border border-hairline rounded-lg px-3 py-2 text-meta text-ink focus:outline-none focus:border-blue-500 disabled:opacity-40"
                  >
                    <option value="">None</option>
                    {milestones
                      .filter(m => m.project_id === newProjectId)
                      .map(m => (
                        <option key={m.id} value={m.id}>🏁 {m.title}</option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Estimated Duration Quick Select */}
              <div>
                <label className="block text-meta text-ink-2 mb-1">Estimated Duration</label>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {[15, 30, 45, 60, 90, 120].map(mins => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setNewEstimatedMinutes(mins)}
                      className={`px-2.5 py-1 rounded-lg text-meta font-mono transition-all ${
                        newEstimatedMinutes === mins
                          ? 'bg-blue-600 text-white font-bold shadow-sm'
                          : 'bg-sunken text-ink-2 border border-hairline hover:text-ink'
                      }`}
                    >
                      {mins < 60 ? `${mins}m` : `${mins / 60}h${mins % 60 ? `${mins % 60}m` : ''}`}
                    </button>
                  ))}
                  <div className="flex items-center gap-1 text-meta text-ink-2 ml-1">
                    <input
                      type="number"
                      min={5}
                      max={480}
                      value={newEstimatedMinutes}
                      onChange={e => setNewEstimatedMinutes(Math.max(5, parseInt(e.target.value) || 30))}
                      className="w-16 bg-sunken border border-hairline rounded-lg px-2 py-1 text-meta text-ink text-right"
                    />
                    <span>min</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-meta text-ink-2 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Optional context or notes..."
                  className="w-full bg-sunken border border-hairline rounded-lg px-3 py-2 text-meta text-ink"
                />
              </div>

              <div>
                <label className="block text-meta text-ink-2 mb-1">GTD Context Tag (Optional)</label>
                <div className="flex flex-wrap gap-1.5">
                  {['@errands', '@computer', '@phone', '@home', '@deep-work'].map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setNewContextTags(newContextTags === tag ? '' : tag)}
                      className={`px-2 py-0.5 rounded-lg text-meta font-mono transition-all ${
                        newContextTags === tag
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 font-bold'
                          : 'bg-sunken text-ink-2 border border-hairline hover:text-ink'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 rounded-lg text-meta text-ink-2 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-meta font-semibold"
                >
                  Save Item
                </button>
              </div>
            </form>
      </Modal>

      {/* Item Detail & AI Auto-Fill Modal / Drawer */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface border border-hairline rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-caption font-mono text-blue-400">
                  {selectedItem.entity_type} • {selectedItem.priority}
                </span>
                <h2 className="text-base font-bold text-ink mt-0.5">{selectedItem.title}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const id = selectedItem.id;
                    setSelectedItem(null);
                    setDeletingItemId(id);
                  }}
                  aria-label={`Delete task: ${selectedItem.title}`}
                  className="p-1.5 text-ink-2 hover:text-rose-400 hover:bg-sunken rounded-lg transition-colors"
                  title="Delete task"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedItem(null)}
                  aria-label="Close task details"
                  className="text-ink-2 hover:text-ink text-meta px-2 py-1 rounded-lg hover:bg-sunken transition-colors"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Description */}
            <div className="bg-paper-aged/40 dark:bg-stone-900/60 p-3.5 rounded border border-ink-base/15 dark:border-stone-800">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-meta font-semibold text-ink-2">Description & Context</span>
                {/* AI Detail Filling Button */}
                <button
                  onClick={() => handleAiAutoFill(selectedItem)}
                  disabled={isAiExpanding}
                  className="flex items-center space-x-1 text-meta text-blue-400 hover:text-blue-300 font-medium"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isAiExpanding ? 'AI Generating...' : 'AI Auto-Fill Details'}</span>
                </button>
              </div>
              <p className="text-meta text-ink-2 whitespace-pre-wrap">
                {selectedItem.description || "No description provided. Click 'AI Auto-Fill Details' to have Raspberry Pi 5 generate one!"}
              </p>
            </div>

            {/* Subtasks Checklist */}
            <div className="space-y-2">
              <span className="text-meta font-semibold text-ink-2">Actionable Checklist</span>
              {selectedItem.subtasks.length === 0 ? (
                <p className="text-meta text-ink-2 italic">No checklist items yet.</p>
              ) : (
                selectedItem.subtasks.map((st) => (
                  <div
                    key={st.id}
                    onClick={() => handleToggleSubtask(st.id)}
                    className="flex items-center space-x-2.5 p-2 rounded-lg bg-sunken/60 border border-hairline/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={st.is_completed}
                      onChange={() => handleToggleSubtask(st.id)}
                      className="w-3.5 h-3.5 rounded text-blue-600 bg-sunken border-zinc-600 cursor-pointer"
                    />
                    <span className={`text-meta ${st.is_completed ? 'line-through text-ink-2' : 'text-ink'}`}>
                      {st.title}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* GTD Context Tags Selector */}
            <div className="space-y-1.5 border-t border-hairline pt-3">
              <span className="text-meta font-semibold text-ink-2 flex items-center gap-1">
                <Tag className="w-3 h-3 text-ink-2" /> GTD Context Tag
              </span>
              <div className="flex flex-wrap gap-1.5">
                {['@errands', '@computer', '@phone', '@home', '@deep-work'].map(tag => {
                  const isActive = selectedItem.context_tags?.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        const current = selectedItem.context_tags ? selectedItem.context_tags.split(' ').filter(Boolean) : [];
                        const next = isActive ? current.filter(t => t !== tag) : [...current, tag];
                        const nextStr = next.join(' ');
                        setSelectedItem({ ...selectedItem, context_tags: nextStr });
                        onUpdateItem?.(selectedItem.id, { context_tags: nextStr });
                      }}
                      className={`px-2 py-0.5 rounded-lg text-meta font-mono transition-all ${
                        isActive 
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 font-bold'
                          : 'bg-sunken text-ink-2 border border-hairline hover:text-ink'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Project & Milestone Reassignment Section */}
            <div className="space-y-3 border-t border-hairline pt-3">
              <span className="text-meta font-semibold text-ink-2 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-blue-400" /> Project & Milestone Assignment
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-meta text-ink-2 mb-1">Project</label>
                  <select
                    value={selectedItem.project_id || ''}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      const updated = { ...selectedItem, project_id: val, milestone_id: null };
                      setSelectedItem(updated);
                      onUpdateItem?.(selectedItem.id, { project_id: val as any, milestone_id: null as any });
                    }}
                    className="w-full bg-sunken border border-hairline rounded-lg px-2.5 py-1.5 text-meta text-ink focus:outline-none focus:border-blue-500"
                  >
                    <option value="">No Project (Inbox)</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>● {p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-meta text-ink-2 mb-1">Milestone</label>
                  <select
                    value={selectedItem.milestone_id || ''}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      const updated = { ...selectedItem, milestone_id: val };
                      setSelectedItem(updated);
                      onUpdateItem?.(selectedItem.id, { milestone_id: val as any });
                    }}
                    disabled={!selectedItem.project_id}
                    className="w-full bg-sunken border border-hairline rounded-lg px-2.5 py-1.5 text-meta text-ink focus:outline-none focus:border-blue-500 disabled:opacity-40"
                  >
                    <option value="">None</option>
                    {milestones
                      .filter(m => m.project_id === selectedItem.project_id)
                      .map(m => (
                        <option key={m.id} value={m.id}>🏁 {m.title}</option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Estimated Duration Quick Editor */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-meta text-ink-2 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-ink-3" /> Estimated Duration:
                </span>
                <div className="flex items-center gap-1.5">
                  {[15, 30, 45, 60, 120].map(mins => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => {
                        const updated = { ...selectedItem, estimated_minutes: mins };
                        setSelectedItem(updated);
                        onUpdateItem?.(selectedItem.id, { estimated_minutes: mins });
                      }}
                      className={`px-2 py-0.5 rounded text-caption font-mono transition-all ${
                        selectedItem.estimated_minutes === mins
                          ? 'bg-blue-600 text-white font-bold shadow-sm'
                          : 'bg-sunken text-ink-2 hover:text-white'
                      }`}
                    >
                      {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Task Dependencies & Blockers Section */}
            <div className="space-y-2 border-t border-hairline pt-3">
              <div className="flex items-center justify-between">
                <span className="text-meta font-semibold text-ink-2 flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-amber-400" /> Task Dependencies & Blockers
                </span>
              </div>

              {/* Show blocker warning if blocked */}
              {(() => {
                const { blocked, blockerTitles } = isItemBlocked(selectedItem);
                if (blocked) {
                  return (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-meta flex items-center gap-2">
                      <Lock className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>Blocked until: <strong>{blockerTitles.join(', ')}</strong> is completed.</span>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Current dependencies list */}
              {selectedItem.depends_on && selectedItem.depends_on.length > 0 ? (
                <div className="space-y-1">
                  {selectedItem.depends_on.map(depId => {
                    const depItem = items.find(i => i.id === depId);
                    return (
                      <div key={depId} className="flex items-center justify-between p-2 rounded-lg bg-sunken/60 border border-hairline/60 text-meta">
                        <div className="flex items-center gap-2 truncate">
                          {depItem?.is_completed ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <span className={`truncate ${depItem?.is_completed ? 'line-through text-ink-3' : 'text-ink'}`}>
                            {depItem ? depItem.title : depId}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newDeps = selectedItem.depends_on.filter(d => d !== depId);
                            setSelectedItem({ ...selectedItem, depends_on: newDeps });
                            onUpdateItem?.(selectedItem.id, { depends_on: newDeps });
                          }}
                          className="text-ink-3 hover:text-rose-400 p-0.5 rounded"
                          title="Remove dependency"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-meta text-ink-3 italic">No prerequisites. This task can be started immediately.</p>
              )}

              {/* Add dependency dropdown */}
              <div className="flex items-center gap-2 pt-1">
                <select
                  defaultValue=""
                  onChange={e => {
                    const addId = e.target.value;
                    if (!addId) return;
                    const cur = selectedItem.depends_on || [];
                    if (!cur.includes(addId)) {
                      const next = [...cur, addId];
                      setSelectedItem({ ...selectedItem, depends_on: next });
                      onUpdateItem?.(selectedItem.id, { depends_on: next });
                    }
                    e.target.value = '';
                  }}
                  className="w-full bg-sunken border border-hairline rounded-lg px-2.5 py-1.5 text-meta text-ink-2 focus:outline-none focus:border-blue-500"
                >
                  <option value="" disabled>+ Add blocker task dependency...</option>
                  {items
                    .filter(i => i.id !== selectedItem.id && !selectedItem.depends_on?.includes(i.id))
                    .map(i => (
                      <option key={i.id} value={i.id}>
                        {i.is_completed ? '✓ ' : ''}{i.title}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* When it happens. The time is the whole point of a reminder, so
                it is shown and editable rather than hidden behind the date. */}
            <div className="space-y-2 border-t border-hairline pt-3">
              <div className="flex items-center justify-between text-meta text-ink-2">
                <span>{formatWhen(selectedItem)}</span>
                <span>{selectedItem.repeat_rule ? `🔄 Recurrence: ${selectedItem.repeat_rule}` : 'One-time item'}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={selectedItem.due_date || ''}
                  onChange={e => {
                    const next = withTimeOfDay(
                      selectedItem.entity_type,
                      e.target.value || null,
                      timeInputValue(itemMoment(selectedItem)) || null
                    );
                    setSelectedItem({ ...selectedItem, ...next });
                    onUpdateItem?.(selectedItem.id, next);
                  }}
                  className="flex-1 bg-sunken border border-hairline rounded-lg px-2.5 py-1.5 text-meta text-ink-2 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="time"
                  value={timeInputValue(itemMoment(selectedItem))}
                  onChange={e => {
                    const next = withTimeOfDay(
                      selectedItem.entity_type,
                      selectedItem.due_date || getTodayDateString(),
                      e.target.value || null
                    );
                    setSelectedItem({ ...selectedItem, ...next });
                    onUpdateItem?.(selectedItem.id, next);
                  }}
                  className="w-28 bg-sunken border border-hairline rounded-lg px-2.5 py-1.5 text-meta text-ink-2 focus:outline-none focus:border-blue-500"
                />
              </div>
              <p className="text-caption text-ink-3">
                {itemMoment(selectedItem)
                  ? 'You will be reminded at this time.'
                  : 'Add a time and this will remind you.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* AI Board Organizer Modal */}
      <Modal
        isOpen={isBoardOrganizerOpen}
        onClose={() => setIsBoardOrganizerOpen(false)}
        title="Executive Board Organizer"
        icon={<Sparkles className="w-4 h-4 text-blue-400" />}
        maxWidth="max-w-xl"
      >
        <div className="space-y-5">

            {isOrganizingBoard ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <RotateCw className="w-6 h-6 animate-spin text-blue-400" />
                <p className="text-meta text-ink-2">Analyzing tasks and strategic priorities...</p>
              </div>
            ) : boardOrgData ? (
              <div className="space-y-4">
                {/* Executive Summary Card */}
                <div className="bg-gradient-to-br from-blue-950/40 via-zinc-900 to-zinc-900 border border-blue-500/20 rounded-xl p-3.5 space-y-1.5">
                  <span className="text-caption font-mono text-blue-400 font-semibold">
                    Workload Synthesis
                  </span>
                  <p className="text-meta text-ink leading-relaxed">
                    {boardOrgData.executive_summary}
                  </p>
                </div>

                {/* Top 3 Big Rocks */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-1.5 text-meta font-semibold text-ink-2">
                    <Target className="w-4 h-4 text-red-400" />
                    <span>Today's Strategic Big 3 (High Leverage)</span>
                  </div>
                  <div className="space-y-1.5">
                    {boardOrgData.big_rocks.length === 0 ? (
                      <p className="text-meta text-ink-2 italic">No pending tasks on the board.</p>
                    ) : (
                      boardOrgData.big_rocks.map((task: any, idx: number) => (
                        <div
                          key={task.id || idx}
                          className="flex items-center justify-between p-2.5 rounded border border-ink-base/15 dark:border-stone-800 bg-paper-aged/50 dark:bg-stone-900 text-meta"
                        >
                          <div className="flex items-center space-x-2 min-w-0 flex-1">
                            <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center font-bold text-caption">
                              {idx + 1}
                            </span>
                            <span className="font-medium text-ink truncate">{task.title}</span>
                          </div>
                          <span className={`text-caption font-bold px-2 py-0.5 rounded ml-2 ${
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
                  <div className="space-y-2 pt-2 border-t border-hairline/80">
                    <div className="flex items-center justify-between">
                      <span className="text-meta font-semibold text-ink-2 flex items-center space-x-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                        <span>Recommended Title Improvements ({boardOrgData.title_improvements.length})</span>
                      </span>
                      <button
                        onClick={handleApplyAllTitleImprovements}
                        className="text-meta text-blue-400 hover:text-blue-300 font-semibold px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20"
                      >
                        Polish All
                      </button>
                    </div>

                    <div className="space-y-2">
                      {boardOrgData.title_improvements.map((ti: any) => (
                        <div
                          key={ti.id}
                          className="flex items-center justify-between p-2.5 rounded border border-ink-base/15 dark:border-stone-800 bg-paper-aged/50 dark:bg-stone-900 text-meta gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-meta text-ink-2 line-through truncate">{ti.current_title}</div>
                            <div className="font-semibold text-emerald-400 truncate mt-0.5">{ti.improved_title}</div>
                          </div>
                          <button
                            onClick={() => handleApplyTitleImprovement(ti.id, ti.improved_title)}
                            className="px-2.5 py-1 rounded bg-sunken hover:bg-hairline text-ink text-meta font-medium shrink-0 flex items-center space-x-1"
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
                    className="px-4 py-2 bg-sunken hover:bg-hairline text-ink text-meta font-semibold rounded-lg"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingItemId}
        title="Delete Task"
        message={`Are you sure you want to delete "${items.find(i => i.id === deletingItemId)?.title || 'this task'}"? This can be undone from the undo notification or with Ctrl+Z.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => {
          if (deletingItemId) {
            handleDelete(deletingItemId);
            setDeletingItemId(null);
          }
        }}
        onCancel={() => setDeletingItemId(null)}
      />
    </PullToRefresh>
  );
};
