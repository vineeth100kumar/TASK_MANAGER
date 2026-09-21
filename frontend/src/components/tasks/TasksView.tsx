import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus,
  RotateCw,
  Sparkles,
  Check,
  X,
  Tag,
  Folder,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
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
import { QuickAddBar, QuickAddBarHandle, CONTEXT_TAGS } from './QuickAddBar';
import { BulkActionBar } from './BulkActionBar';
import { TaskDetailSheet } from './TaskDetailSheet';
import { KeyboardHelpModal } from './KeyboardHelpModal';
import { RepeatEditor } from './RepeatEditor';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useListReorder } from '../../hooks/useListReorder';
import { 
  groupTasksBySmartDate, 
  getTodayDateString, 
  getTomorrowDateString, 
  isOverdue, 
  isDueToday,
  itemMoment,
  formatWhen,
  compareBySchedule,
  formatDuration,
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
  onReorderItem?: (id: string, move: { before_id: string | null; after_id: string | null }) => void;
  onToggleSubtask?: (itemId: string, subtaskId: string) => void;
  onAddSubtask?: (itemId: string, title: string) => void;
  onDeleteSubtask?: (itemId: string, subtaskId: string) => void;
  onOpenBrainDump?: () => void;
  onCelebrationTrigger?: () => void;
}

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: 'task', label: 'Task' },
  { value: 'event', label: 'Event' },
  { value: 'reminder', label: 'Reminder' },
];

/* What each type actually does, said once, where the choice is made. */
const ENTITY_HINTS: Record<EntityType, string> = {
  task: 'Something to get done. Sits in your list until you tick it off.',
  event: 'Something that happens at a time. Gets a slot on the calendar.',
  reminder: 'A nudge at a moment. Notifies you and then gets out of the way.',
};

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
  onReorderItem,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onOpenBrainDump,
  onCelebrationTrigger
}) => {
  // Persisted view settings
  const [filterType, setFilterType] = usePersistedState<string>('tasks_filter_type', 'all');
  const [viewMode, setViewMode] = usePersistedState<'list' | 'kanban' | 'timeline'>('tasks_view_mode', 'list');
  const [selectedTag, setSelectedTag] = usePersistedState<string | null>('tasks_selected_tag', null);
  const [selectedProjectId, setSelectedProjectId] = usePersistedState<string>('tasks_selected_project', 'all');
  const [sortBy, setSortBy] = usePersistedState<'due_date' | 'priority' | 'title' | 'created_at' | 'manual'>('tasks_sort_by', 'due_date');
  const [smartGrouping, setSmartGrouping] = usePersistedState<boolean>('tasks_smart_grouping', true);
  const [sortDir, setSortDir] = usePersistedState<'asc' | 'desc'>('tasks_sort_dir', 'asc');
  const [showCompleted, setShowCompleted] = usePersistedState<boolean>('tasks_show_completed', false);

  // Interaction State
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isAiExpanding, setIsAiExpanding] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [collapsedSections, setCollapsedSections] = useState<{ [key: string]: boolean }>({});
  const [newDetailSubtaskTitle, setNewDetailSubtaskTitle] = useState('');
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const quickAddRef = useRef<QuickAddBarHandle>(null);

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
  // An event with no clock on it is not an event. The form used to collect a
  // date and nothing else, so anything made here as an "Event" landed in the
  // day with no time and no end, and the calendar had nowhere to draw it.
  const [newTime, setNewTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newAllDay, setNewAllDay] = useState(false);
  const [newRepeatUntil, setNewRepeatUntil] = useState<string | null>(null);
  const [newRepeatCount, setNewRepeatCount] = useState<number | null>(null);

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

  /*
   * Filtering happens once, against every rule the chips express, so the
   * completed list and the open list can never disagree about what matches.
   */
  const matchesFilters = useCallback((item: WorkItem) => {
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
  }, [filterType, selectedTag, selectedProjectId]);

  const hasActiveFilters = filterType !== 'all' || !!selectedTag || selectedProjectId !== 'all';

  const clearFilters = () => {
    setFilterType('all');
    setSelectedTag(null);
    setSelectedProjectId('all');
  };

  // What is still open. Finished work is kept apart rather than struck
  // through in place, where it goes on taking up the list.
  const filteredItems = useMemo(
    () => items.filter((item) => matchesFilters(item) && !item.is_completed),
    [items, matchesFilters]
  );

  const completedItems = useMemo(
    () =>
      items
        .filter((item) => matchesFilters(item) && item.is_completed)
        .sort((a, b) => (b.completed_at || b.updated_at || '').localeCompare(a.completed_at || a.updated_at || '')),
    [items, matchesFilters]
  );

  // Sort items
  const priorityWeights: { [key: string]: number } = { urgent: 4, high: 3, medium: 2, low: 1 };

  const sortedItems = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...filteredItems].sort((a, b) => {
      if (sortBy === 'manual') {
        // Hand-chosen order. Anything without a position yet — created
        // before the column existed, or while offline — sits at the end in
        // creation order rather than jumping to the top.
        const left = a.position;
        const right = b.position;
        if (left == null && right == null) {
          return new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime();
        }
        if (left == null) return 1;
        if (right == null) return -1;
        return direction * (left - right);
      }
      if (sortBy === 'priority') {
        // Most urgent first is the useful direction, so ascending means that.
        return direction * ((priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0));
      }
      if (sortBy === 'title') {
        return direction * a.title.localeCompare(b.title);
      }
      if (sortBy === 'created_at') {
        return direction * (new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());
      }
      // Default: when it happens, which includes the time of day. Sorting on
      // the date alone left everything due today in an arbitrary order.
      return direction * compareBySchedule(a, b);
    });
  }, [filteredItems, sortBy, sortDir]);

  // Smart Date Groups
  const smartGroups = useMemo(() => {
    return groupTasksBySmartDate(sortedItems);
  }, [sortedItems]);

  /*
   * The sections exactly as the list draws them. Keyboard navigation walks
   * this, so the row the arrow keys land on is the row the eye is on — which
   * grouping and flat order had previously disagreed about.
   */
  // Manual order and smart grouping cannot both be true: one says the order
  // is yours, the other says it is the calendar's.
  const isManualOrder = sortBy === 'manual';

  const sections = useMemo(() => {
    const open = smartGrouping && !isManualOrder
      ? [
          { key: 'overdue', label: 'Overdue', tone: 'late' as const, items: smartGroups.overdue },
          { key: 'today', label: 'Today', tone: 'plain' as const, items: smartGroups.today },
          { key: 'upcoming', label: 'Next 7 days', tone: 'plain' as const, items: smartGroups.upcoming },
          { key: 'backlog', label: 'Someday', tone: 'plain' as const, items: smartGroups.backlog },
        ]
      : [{ key: 'all', label: null, tone: 'plain' as const, items: sortedItems }];

    const completed = showCompleted && completedItems.length > 0
      ? [{ key: 'completed', label: 'Completed', tone: 'plain' as const, items: completedItems }]
      : [];

    return [...open, ...completed].filter((section) => section.items.length > 0);
  }, [smartGrouping, isManualOrder, smartGroups, sortedItems, showCompleted, completedItems]);

  const visibleItems = useMemo(
    () => sections.filter((section) => !collapsedSections[section.key]).flatMap((section) => section.items),
    [sections, collapsedSections]
  );

  const highlightedItem = highlightedIndex >= 0 ? visibleItems[highlightedIndex] : undefined;

  const reorderOrder = useMemo(() => visibleItems.map((i) => i.id), [visibleItems]);

  const handleReorderDrop = useCallback(
    ({ id, beforeId, afterId }: { id: string; beforeId: string | null; afterId: string | null }) => {
      haptics.light();
      if (onReorderItem) {
        onReorderItem(id, { before_id: beforeId, after_id: afterId });
      } else {
        api.reorderItem(id, { before_id: beforeId, after_id: afterId }).then(() => onRefresh());
      }
    },
    [onReorderItem, onRefresh]
  );

  const reorder = useListReorder({ order: reorderOrder, onDrop: handleReorderDrop });

  // A list that shortened under the cursor should not leave it past the end.
  useEffect(() => {
    if (highlightedIndex >= visibleItems.length) {
      setHighlightedIndex(visibleItems.length - 1);
    }
  }, [visibleItems.length, highlightedIndex]);

  const withHighlighted = (fn: (item: WorkItem) => void) => () => {
    if (highlightedItem) fn(highlightedItem);
  };

  // Keyboard Navigation Shortcuts
  useKeyboardShortcuts({
    enabled: viewMode === 'list' && !isCreating && !selectedItem && !isBoardOrganizerOpen && !isHelpOpen && !renamingItemId,
    onMoveDown: () => setHighlightedIndex(prev => Math.min(visibleItems.length - 1, prev + 1)),
    onMoveUp: () => setHighlightedIndex(prev => Math.max(0, prev - 1)),
    onToggleComplete: withHighlighted(onToggleComplete),
    onEdit: withHighlighted(setSelectedItem),
    onRename: withHighlighted((item) => setRenamingItemId(item.id)),
    onDelete: withHighlighted((item) => setDeletingItemId(item.id)),
    onSetToday: withHighlighted((item) => onUpdateItem?.(item.id, { due_date: getTodayDateString() })),
    onSetTomorrow: withHighlighted((item) => onUpdateItem?.(item.id, { due_date: getTomorrowDateString() })),
    onSetPriority: (priority) => {
      if (highlightedItem) onUpdateItem?.(highlightedItem.id, { priority });
    },
    onToggleSelect: () => setIsSelectMode(prev => !prev),
    onQuickAdd: () => quickAddRef.current?.focus(),
    onShowHelp: () => setIsHelpOpen(true),
    onEscape: () => {
      if (selectedIds.size > 0 || isSelectMode) {
        handleClearSelection();
      } else {
        setHighlightedIndex(-1);
      }
    },
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

  // Rename in place, from a double click on the title or the r shortcut.
  const handleRename = (item: WorkItem, title: string) => {
    setRenamingItemId(null);
    if (title !== item.title) {
      onUpdateItem?.(item.id, { title });
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
      const res = await api.improveTask(newTitle, newDescription, newType, newProjectId || undefined);
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
      const res = await api.autoFillTask(item.title, item.description || undefined, item.project_id || undefined);
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

  const handleAddDetailSubtask = async (e?: React.FormEvent, explicitTitle?: string) => {
    if (e) e.preventDefault();
    const title = (explicitTitle ?? newDetailSubtaskTitle).trim();
    if (!title || !selectedItem) return;
    setNewDetailSubtaskTitle('');
    if (onAddSubtask) {
      onAddSubtask(selectedItem.id, title);
    } else {
      const created = await api.addSubtask(selectedItem.id, title);
      if (created) {
        setSelectedItem({
          ...selectedItem,
          subtasks: [...(selectedItem.subtasks || []), created]
        });
        onRefresh();
      }
    }
  };

  const handleDeleteDetailSubtask = async (subtaskId: string) => {
    if (!selectedItem) return;
    if (onDeleteSubtask) {
      onDeleteSubtask(selectedItem.id, subtaskId);
    } else {
      await api.deleteSubtask(subtaskId);
      setSelectedItem({
        ...selectedItem,
        subtasks: (selectedItem.subtasks || []).filter(s => s.id !== subtaskId)
      });
      onRefresh();
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    // The same helper the detail sheet uses, so a task created here and one
    // edited later end up with identical fields on the row.
    // An all-day item has a date and no clock, so the times are dropped
    // rather than saved alongside a flag that contradicts them.
    const moment = newAllDay
      ? { due_date: newDueDate || null, start_at: null, remind_at: null }
      : withTimeOfDay(newType, newDueDate || null, newTime || null);
    const endAt =
      !newAllDay && newType === 'event' && newDueDate && newEndTime
        ? `${newDueDate}T${newEndTime}:00`
        : null;

    const itemData = {
      title: newTitle.trim(),
      entity_type: newType,
      priority: newPriority,
      due_date: moment.due_date || undefined,
      start_at: moment.start_at || undefined,
      end_at: endAt || undefined,
      remind_at: moment.remind_at || undefined,
      is_all_day: newAllDay,
      location: newType === 'event' && newLocation.trim() ? newLocation.trim() : undefined,
      repeat_rule: newRepeatRule || undefined,
      repeat_until: newRepeatUntil || undefined,
      repeat_count: newRepeatCount || undefined,
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
    setNewTime('');
    setNewEndTime('');
    setNewLocation('');
    setNewAllDay(false);
    setNewRepeatRule('');
    setNewRepeatUntil(null);
    setNewRepeatCount(null);
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

  // The same four names the detail sheet uses, so a status reads the same
  // wherever it is shown.
  const kanbanColumns: { id: TaskStatus; label: string }[] = [
    { id: 'todo', label: 'To do' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'blocked', label: 'On hold' },
    { id: 'done', label: 'Done' },
  ];

  return (
    <PullToRefresh onRefresh={onRefresh} className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12">
      {/* Natural-language quick add */}
      <QuickAddBar
        ref={quickAddRef}
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
              `${filteredItems.length} open`,
              smartGroups.overdue.length > 0 ? `${smartGroups.overdue.length} overdue` : null,
              smartGroups.today.length > 0 ? `${smartGroups.today.length} today` : null,
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

          {/* Sort */}
          <div className="relative flex items-center bg-sunken rounded-control px-2 py-1 text-meta">
            <ArrowUpDown className="w-3.5 h-3.5 text-ink-3 mr-1.5" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              aria-label="Sort by"
              className="bg-transparent text-meta text-ink-2 focus:outline-none cursor-pointer"
            >
              <option value="due_date">Due date</option>
              <option value="priority">Priority</option>
              <option value="title">Title</option>
              <option value="created_at">Created</option>
              <option value="manual">Manual order</option>
            </select>
            <button
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              aria-label={sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
              title={sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
              className="ml-1.5 pl-1.5 border-l border-hairline text-ink-3 hover:text-ink transition-colors"
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          {/*
           * Everything else the view can do, behind one control. Five toggles
           * across the top competed with the tasks for attention; only the
           * thing you came to do, and the two you change often, stay out.
           */}
          <div className="relative">
            <button
              onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
              aria-label="View options"
              aria-expanded={isViewMenuOpen}
              className="w-9 h-9 grid place-items-center rounded-control bg-sunken text-ink-2 hover:text-ink transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {isViewMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsViewMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-40 w-56 bg-surface border border-hairline rounded-control shadow-lg py-1">
                  {viewMode === 'list' && (
                    <>
                      <button
                        onClick={() => { setSmartGrouping(!smartGrouping); setIsViewMenuOpen(false); }}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-meta text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
                      >
                        <span>Group by date</span>
                        {smartGrouping && <Check className="w-3.5 h-3.5 text-accent-500" />}
                      </button>
                      <button
                        onClick={() => { setShowCompleted(!showCompleted); setIsViewMenuOpen(false); }}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-meta text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
                      >
                        <span>Show completed</span>
                        {showCompleted && <Check className="w-3.5 h-3.5 text-accent-500" />}
                      </button>
                      <button
                        onClick={() => {
                          if (isSelectMode) handleClearSelection(); else setIsSelectMode(true);
                          setIsViewMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-meta text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
                      >
                        <span>{isSelectMode ? 'Stop selecting' : 'Select several'}</span>
                        <kbd className="text-caption text-ink-3 font-mono">S</kbd>
                      </button>
                      <div className="h-px bg-hairline my-1" />
                    </>
                  )}

                  <button
                    onClick={() => { setIsViewMenuOpen(false); handleOpenBoardOrganizer(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-meta text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Organize with AI</span>
                  </button>
                  <button
                    onClick={() => { setIsViewMenuOpen(false); setIsHelpOpen(true); }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-meta text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
                  >
                    <span>Keyboard shortcuts</span>
                    <kbd className="text-caption text-ink-3 font-mono">?</kbd>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Manual New Item Button */}
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-control bg-accent-500 hover:bg-accent-600 text-white text-meta font-medium transition-colors"
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
          {['all', ...CONTEXT_TAGS].map((tag) => (
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
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-control text-caption transition-colors whitespace-nowrap border ${
                  selectedProjectId === p.id
                    ? 'bg-accent-500 text-white font-medium border-transparent'
                    : 'bg-sunken text-ink-2 hover:text-ink border-transparent'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: p.color || 'currentColor' }} />
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
                    <h3 className="text-body font-medium text-ink">{m.title}</h3>
                    <p className="text-meta text-ink-3 mt-0.5">Due {m.due_date}</p>
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
        /* List view: the sections exactly as `sections` describes them */
        <div className="space-y-4">
          {isLoading && visibleItems.length === 0 ? (
            <div className="space-y-2">
              <Skeleton variant="row" count={5} />
            </div>
          ) : sections.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              {hasActiveFilters ? (
                <>
                  <p className="text-body text-ink-2">Nothing matches these filters.</p>
                  <button
                    onClick={clearFilters}
                    className="text-meta text-accent-600 dark:text-accent-400 hover:underline"
                  >
                    Clear filters
                  </button>
                </>
              ) : completedItems.length > 0 ? (
                <>
                  <p className="text-body text-ink-2">Everything here is done.</p>
                  <button
                    onClick={() => setShowCompleted(true)}
                    className="text-meta text-accent-600 dark:text-accent-400 hover:underline"
                  >
                    Show the {completedItems.length} completed
                  </button>
                </>
              ) : (
                <>
                  <p className="text-body text-ink-2">Nothing to do yet.</p>
                  <button
                    onClick={() => quickAddRef.current?.focus()}
                    className="text-meta text-accent-600 dark:text-accent-400 hover:underline"
                  >
                    Write the first one
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {sections.map((section) => (
                <div key={section.key} className="space-y-1">
                  {section.label && (
                    <button
                      onClick={() => toggleSectionCollapse(section.key)}
                      aria-expanded={!collapsedSections[section.key]}
                      className={`flex items-center gap-2 text-meta font-semibold px-1 py-1 select-none ${
                        section.tone === 'late' ? 'text-late-500 dark:text-late-400' : 'text-ink-2'
                      }`}
                    >
                      {collapsedSections[section.key] ? (
                        <ChevronRight className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                      <span>{section.label}</span>
                      <span className="text-caption text-ink-3 tabular">{section.items.length}</span>
                    </button>
                  )}

                  {!collapsedSections[section.key] && (
                    <div>
                      {section.items.map((item) => {
                        const { blocked, blockerTitles } = isItemBlocked(item);
                        return (
                          <ListRow
                            key={item.id}
                            item={item}
                            projects={projects}
                            isSelected={selectedIds.has(item.id)}
                            isSelectMode={isSelectMode}
                            isHighlighted={highlightedItem?.id === item.id}
                            isBlocked={blocked}
                            blockerTitles={blockerTitles}
                            isRefining={refiningItemId === item.id}
                            isRenaming={renamingItemId === item.id}
                            onToggleSelect={handleToggleSelect}
                            onStartRename={(target) => setRenamingItemId(target.id)}
                            onRename={handleRename}
                            onCancelRename={() => setRenamingItemId(null)}
                            onToggleComplete={onToggleComplete}
                            onDelete={(id) => setDeletingItemId(id)}
                            onClick={(target) => setSelectedItem(target)}
                            onRefine={handleQuickRefine}
                            onReschedule={handleReschedule}
                            isReorderable={isManualOrder}
                            isDragging={reorder.draggingId === item.id}
                            dropEdge={reorder.target?.overId === item.id ? reorder.target.edge : null}
                            onReorderStart={(target, event) => reorder.start(target.id, event)}
                            onReorderNudge={(target, delta) => reorder.moveBy(target.id, delta)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : viewMode === 'kanban' ? (
        /* Board view: four quiet columns, dragged between */
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 overflow-x-auto pb-4">
          {kanbanColumns.map((col) => {
            const colItems = (col.id === 'done' ? [...sortedItems, ...completedItems] : sortedItems).filter(i => {
              if (col.id === 'done') return i.is_completed || i.status === 'done';
              return !i.is_completed && i.status === col.id;
            });

            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverColumn(col.id);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverColumn(null);
                  handleDropOnColumn(col.id, e.dataTransfer.getData('text/plain'));
                }}
                className={`rounded-surface p-3 flex flex-col transition-colors ${
                  dragOverColumn === col.id ? 'bg-accent-500/10' : 'bg-sunken'
                }`}
              >
                <div className="flex items-center justify-between pb-2 mb-1">
                  <span className="text-meta font-semibold text-ink-2">{col.label}</span>
                  <span className="text-caption text-ink-3 tabular">{colItems.length}</span>
                </div>

                <div className="space-y-2 flex-1 overflow-y-auto max-h-[600px]">
                  {colItems.length === 0 ? (
                    <p className="text-caption text-ink-3 py-6 text-center">Drop something here</p>
                  ) : colItems.map((item) => {
                    const { blocked, blockerTitles } = isItemBlocked(item);
                    const project = projects.find(proj => proj.id === item.project_id);
                    return (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', item.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => setSelectedItem(item)}
                        className="group bg-surface rounded-control p-3 cursor-grab active:cursor-grabbing space-y-1.5 select-none shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={`text-meta min-w-0 ${item.is_completed ? 'line-through text-ink-3' : 'text-ink'}`}>
                            {item.title}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickRefine(item);
                            }}
                            disabled={refiningItemId === item.id}
                            title="Polish with AI"
                            aria-label={`Polish ${item.title} with AI`}
                            className="shrink-0 w-6 h-6 grid place-items-center rounded-control text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ink transition-opacity"
                          >
                            {refiningItemId === item.id ? (
                              <RotateCw className="w-3.5 h-3.5 animate-spin text-accent-500" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {/* One quiet line, the same one the list rows carry */}
                        <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap text-caption text-ink-3">
                          {blocked && (
                            <span title={`Blocked by ${blockerTitles.join(', ')}`} className="text-late-500 dark:text-late-400">
                              Blocked
                            </span>
                          )}
                          {item.priority === 'urgent' && !item.is_completed && (
                            <span className="text-late-500 dark:text-late-400">Urgent</span>
                          )}
                          {project && (
                            <span className="flex items-center gap-1 min-w-0">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: project.color || 'currentColor' }} />
                              <span className="truncate max-w-[110px]">{project.name}</span>
                            </span>
                          )}
                          {(item.due_date || itemMoment(item)) && <span>{formatWhen(item)}</span>}
                          {item.context_tags && <span className="truncate">{item.context_tags}</span>}
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

      {/* New task, when the quick-add line is not the right shape for it */}
      <Modal
        isOpen={isCreating}
        onClose={() => setIsCreating(false)}
        title={newType === 'event' ? 'New event' : newType === 'reminder' ? 'New reminder' : 'New task'}
        maxWidth="lg"
        hasUnsavedChanges={!!newTitle.trim() || !!newDescription.trim()}
      >
        <form onSubmit={handleCreate} className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="new-task-title" className="label">Title</label>
              <button
                type="button"
                onClick={handleAiPolishNewItem}
                disabled={isAiPolishing || !newTitle.trim()}
                className="flex items-center gap-1.5 text-meta text-ink-2 hover:text-ink disabled:opacity-40 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {isAiPolishing ? 'Polishing…' : 'Polish with AI'}
              </button>
            </div>
            <input
              id="new-task-title"
              type="text"
              required
              autoFocus
              placeholder="What needs doing"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="field"
            />
          </div>

          {generatedSubtasks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="label">Suggested steps · {generatedSubtasks.length}</span>
                <button
                  type="button"
                  onClick={() => setGeneratedSubtasks([])}
                  className="text-meta text-ink-3 hover:text-ink"
                >
                  Clear
                </button>
              </div>
              {generatedSubtasks.map((st, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1 text-meta text-ink">
                  <span className="min-w-0 truncate">{st}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${st}`}
                    onClick={() => setGeneratedSubtasks(generatedSubtasks.filter((_, idx) => idx !== i))}
                    className="w-8 h-8 grid place-items-center text-ink-3 hover:text-ink rounded-control shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Type decides the shape of the rest of the form, so it comes first
              and reads as a choice rather than a dropdown to go hunting in. */}
          <div className="space-y-1.5">
            <span className="label">Type</span>
            <div className="bg-sunken rounded-control p-0.5 flex items-center" role="group" aria-label="Type">
              {ENTITY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={newType === t.value}
                  onClick={() => setNewType(t.value)}
                  className={`flex-1 px-2 py-1.5 rounded-control text-meta transition-colors ${
                    newType === t.value
                      ? 'bg-surface text-ink font-medium shadow-sm'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-caption text-ink-3">{ENTITY_HINTS[newType]}</p>
          </div>

          {/* When */}
          <div className="space-y-1.5">
            <span className="label">{newType === 'event' ? 'When' : 'Due'}</span>
            <div className="flex items-center gap-2">
              <input
                id="new-task-due"
                type="date"
                aria-label={newType === 'event' ? 'Date' : 'Due date'}
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="field flex-1"
              />
              {!newAllDay && (
                <input
                  type="time"
                  aria-label={newType === 'event' ? 'Starts at' : 'Time'}
                  value={newTime}
                  disabled={!newDueDate}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="field w-32 disabled:opacity-40"
                />
              )}
            </div>

            <label className="flex items-center gap-2.5 text-meta text-ink-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={newAllDay}
                onChange={(e) => {
                  setNewAllDay(e.target.checked);
                  if (e.target.checked) {
                    setNewTime('');
                    setNewEndTime('');
                  }
                }}
                className="rounded border-hairline text-accent-500 focus:ring-accent-500"
              />
              All day
            </label>

            {newType === 'event' && !newAllDay && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-meta text-ink-2 shrink-0">Ends</span>
                <input
                  type="time"
                  aria-label="Ends at"
                  value={newEndTime}
                  disabled={!newTime}
                  onChange={(e) => setNewEndTime(e.target.value)}
                  className="field w-32 disabled:opacity-40"
                />
                {newEndTime && newTime && newEndTime <= newTime && (
                  <span className="text-caption text-late-500 dark:text-late-400">
                    Ends before it starts
                  </span>
                )}
              </div>
            )}

            {!newDueDate && (
              <p className="text-caption text-ink-3">
                Leave the date empty and this waits in Someday.
              </p>
            )}
          </div>

          {newType === 'event' && (
            <div className="space-y-1.5">
              <label htmlFor="new-task-location" className="label">Location</label>
              <input
                id="new-task-location"
                type="text"
                placeholder="Where is it"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                className="field"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="new-task-priority" className="label">Priority</label>
              <select
                id="new-task-priority"
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                className="field"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
            </select>
          </div>

          <RepeatEditor
            idPrefix="new-task-repeat"
            anchorDate={newDueDate || null}
            value={{ rule: newRepeatRule, until: newRepeatUntil, count: newRepeatCount }}
            onChange={(next) => {
              setNewRepeatRule(next.rule);
              setNewRepeatUntil(next.until);
              setNewRepeatCount(next.count);
            }}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="new-task-project" className="label">Project</label>
              <select
                id="new-task-project"
                value={newProjectId}
                onChange={(e) => {
                  setNewProjectId(e.target.value);
                  setNewMilestoneId('');
                }}
                className="field"
              >
                <option value="">Inbox</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="new-task-milestone" className="label">Milestone</label>
              <select
                id="new-task-milestone"
                value={newMilestoneId}
                onChange={(e) => setNewMilestoneId(e.target.value)}
                disabled={!newProjectId}
                className="field disabled:opacity-40"
              >
                <option value="">None</option>
                {milestones
                  .filter(m => m.project_id === newProjectId)
                  .map(m => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
              </select>
            </div>
          </div>

          {newType !== 'event' && (
          <div className="space-y-1.5">
            <span className="label">Estimate</span>
            <div className="flex flex-wrap gap-1.5">
              {[15, 30, 45, 60, 90, 120].map(mins => (
                <button
                  key={mins}
                  type="button"
                  aria-pressed={newEstimatedMinutes === mins}
                  onClick={() => setNewEstimatedMinutes(newEstimatedMinutes === mins ? 0 : mins)}
                  className={`px-2.5 py-1 rounded-control text-meta tabular transition-colors ${
                    newEstimatedMinutes === mins
                      ? 'bg-accent-500 text-white'
                      : 'bg-sunken text-ink-2 hover:text-ink'
                  }`}
                >
                  {formatDuration(mins)}
                </button>
              ))}
            </div>
          </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="new-task-notes" className="label">Notes</label>
            <textarea
              id="new-task-notes"
              rows={2}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Leave blank and one will be drafted from the project"
              className="field resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <span className="label">Context</span>
            <div className="flex flex-wrap gap-1.5">
              {CONTEXT_TAGS.map(tag => {
                // Multi-select, the same as the detail sheet. Creating a task
                // used to allow exactly one context and editing it allowed
                // several, so a second tag could only be added after saving.
                const selected = newContextTags.split(' ').filter(Boolean);
                const isActive = selected.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() =>
                      setNewContextTags(
                        (isActive ? selected.filter(t => t !== tag) : [...selected, tag]).join(' ')
                      )
                    }
                    className={`px-2.5 py-1 rounded-control text-meta transition-colors ${
                      isActive
                        ? 'bg-accent-500 text-white'
                        : 'bg-sunken text-ink-2 hover:text-ink'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="h-10 px-4 rounded-control text-meta font-medium text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newTitle.trim()}
              className="h-10 px-4 rounded-control bg-accent-500 hover:bg-accent-600 disabled:opacity-40 disabled:pointer-events-none text-white text-meta font-medium transition-all duration-200 ease-spring active:scale-[0.97]"
            >
              Add {newType}
            </button>
          </div>
        </form>
      </Modal>

      {/* Everything a task is, editable in one sheet */}
      {selectedItem && (
        <TaskDetailSheet
          item={selectedItem}
          items={items}
          projects={projects}
          milestones={milestones}
          isAiExpanding={isAiExpanding}
          onClose={() => setSelectedItem(null)}
          onUpdate={(updates) => {
            setSelectedItem((prev) => (prev ? { ...prev, ...updates } as WorkItem : prev));
            onUpdateItem?.(selectedItem.id, updates);
          }}
          onDelete={() => {
            const id = selectedItem.id;
            setSelectedItem(null);
            setDeletingItemId(id);
          }}
          onAiAutoFill={() => handleAiAutoFill(selectedItem)}
          onToggleSubtask={handleToggleSubtask}
          onAddSubtask={(title) => handleAddDetailSubtask(undefined, title)}
          onDeleteSubtask={handleDeleteDetailSubtask}
        />
      )}


      {/* What to do first, when the list is too long to read */}
      <Modal
        isOpen={isBoardOrganizerOpen}
        onClose={() => setIsBoardOrganizerOpen(false)}
        title="What matters today"
        maxWidth="xl"
      >
        {isOrganizingBoard ? (
          <div className="py-14 flex flex-col items-center justify-center gap-3">
            <RotateCw className="w-5 h-5 animate-spin text-ink-3" aria-hidden="true" />
            <p className="text-meta text-ink-2">Reading your list on the Pi…</p>
          </div>
        ) : boardOrgData ? (
          <div className="space-y-6">
            <p className="text-body text-ink leading-relaxed">
              {boardOrgData.executive_summary}
            </p>

            <div className="space-y-2">
              <span className="label">The three worth doing first</span>
              {boardOrgData.big_rocks.length === 0 ? (
                <p className="text-meta text-ink-3">Nothing open on the board.</p>
              ) : (
                <div className="divide-y divide-hairline">
                  {boardOrgData.big_rocks.map((task: any, idx: number) => (
                    <div key={task.id || idx} className="flex items-center gap-3 py-2.5">
                      <span className="w-6 h-6 rounded-full bg-sunken text-ink-2 grid place-items-center text-caption font-medium shrink-0 tabular">
                        {idx + 1}
                      </span>
                      <span className="flex-1 min-w-0 text-meta text-ink truncate">{task.title}</span>
                      <span className="text-caption text-ink-3 shrink-0 capitalize">
                        {task.priority || 'medium'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {boardOrgData.title_improvements && boardOrgData.title_improvements.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="label">
                    Clearer wording · {boardOrgData.title_improvements.length}
                  </span>
                  <button
                    type="button"
                    onClick={handleApplyAllTitleImprovements}
                    className="text-meta text-ink-2 hover:text-ink transition-colors"
                  >
                    Apply all
                  </button>
                </div>

                <div className="divide-y divide-hairline">
                  {boardOrgData.title_improvements.map((ti: any) => (
                    <div key={ti.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-caption text-ink-3 line-through truncate">
                          {ti.current_title}
                        </div>
                        <div className="text-meta text-ink truncate mt-0.5">{ti.improved_title}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleApplyTitleImprovement(ti.id, ti.improved_title)}
                        aria-label={`Rename to ${ti.improved_title}`}
                        className="h-9 px-3 rounded-control bg-sunken hover:bg-hairline text-ink text-meta font-medium shrink-0 transition-colors"
                      >
                        Use
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setIsBoardOrganizerOpen(false)}
                className="h-10 px-4 rounded-control bg-accent-500 hover:bg-accent-600 text-white text-meta font-medium transition-all duration-200 ease-spring active:scale-[0.97]"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <KeyboardHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deletingItemId}
        title="Delete this task?"
        message={`"${items.find(i => i.id === deletingItemId)?.title || 'This task'}" will go. Ctrl+Z brings it back.`}
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
