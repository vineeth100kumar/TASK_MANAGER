import { useState, useCallback } from 'react';
import { api } from '../services/api';
import { useToast } from '../context/ToastContext';
import { isDueToday } from '../utils/dateHelpers';
import {
  WorkItem,
  WorkItemUpdatePayload,
  Milestone,
  Project,
  DailyPerformance,
  TaskStatus
} from '../types';
import { HistoryAction } from './useUndoRedo';

interface UseTasksStateProps {
  todayStr: string;
  startSync: () => void;
  endSync: () => void;
  pushHistoryAction: (action: HistoryAction) => void;
  onAllTodayCompleted?: () => void;
}

export function useTasksState({
  todayStr,
  startSync,
  endSync,
  pushHistoryAction,
  onAllTodayCompleted,
}: UseTasksStateProps) {
  const toast = useToast();

  const [items, setItems] = useState<WorkItem[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dailyPerformance, setDailyPerformance] = useState<DailyPerformance | null>(null);

  // Base toggle completion
  const executeToggleComplete = useCallback((itemId: string, newCompleted: boolean) => {
    const nowIso = new Date().toISOString();

    setItems(prev => prev.map(i => i.id === itemId ? {
      ...i,
      is_completed: newCompleted,
      status: (newCompleted ? 'done' : 'todo') as TaskStatus,
      completed_at: newCompleted ? nowIso : null
    } : i));

    setDailyPerformance(prev => {
      if (!prev) return prev;
      const newCompletedCount = Math.max(0, prev.tasks_completed + (newCompleted ? 1 : -1));
      const planned = prev.tasks_planned;
      const newScore = planned > 0 ? Math.round((newCompletedCount / planned) * 100) : (newCompletedCount > 0 ? 100 : 0);
      return {
        ...prev,
        tasks_completed: newCompletedCount,
        productivity_score: newScore,
      };
    });

    startSync();
    return api.updateItem(itemId, { is_completed: newCompleted })
      .catch(err => {
        console.error('Failed to sync item toggle to Pi', err);
        toast.error('Failed to sync task status to Pi');
      })
      .finally(endSync);
  }, [startSync, endSync, toast]);

  const handleToggleComplete = useCallback((item: WorkItem) => {
    const newCompleted = !item.is_completed;
    executeToggleComplete(item.id, newCompleted);

    if (newCompleted && isDueToday(item.due_date)) {
      const remainingToday = items.filter(i => i.id !== item.id && isDueToday(i.due_date) && !i.is_completed);
      if (remainingToday.length === 0 && onAllTodayCompleted) {
        onAllTodayCompleted();
      }
    }

    pushHistoryAction({
      id: `act_${Date.now()}_${Math.random()}`,
      description: `${newCompleted ? 'Completed' : 'Uncompleted'} "${item.title}"`,
      undo: () => executeToggleComplete(item.id, !newCompleted),
      redo: () => executeToggleComplete(item.id, newCompleted),
      timestamp: Date.now()
    });
  }, [executeToggleComplete, items, onAllTodayCompleted, pushHistoryAction]);

  // Base delete and restore
  const executeDeleteItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    startSync();
    return api.deleteItem(id)
      .catch(err => {
        console.error('Failed to delete item on Pi', err);
        toast.error('Failed to delete task on Pi');
      })
      .finally(endSync);
  }, [startSync, endSync, toast]);

  const executeRestoreItem = useCallback((item: WorkItem) => {
    setItems(prev => [item, ...prev]);
    startSync();
    return api.createItem({
      title: item.title,
      description: item.description || undefined,
      entity_type: item.entity_type,
      status: item.status,
      priority: item.priority,
      energy: item.energy,
      due_date: item.due_date || undefined,
      repeat_rule: item.repeat_rule || undefined,
      project_id: item.project_id || undefined,
      milestone_id: item.milestone_id || undefined,
      estimated_minutes: item.estimated_minutes,
      context_tags: item.context_tags || undefined,
      subtasks: (item.subtasks || []).map(s => s.title)
    }).then(realItem => {
      setItems(prev => prev.map(i => i.id === item.id ? realItem : i));
      toast.info(`Restored "${realItem.title}"`);
    }).catch(err => {
      console.error('Failed to restore item on Pi', err);
      toast.error('Failed to restore task on Pi');
    }).finally(endSync);
  }, [startSync, endSync, toast]);

  // Delete Item
  const handleDeleteItem = useCallback((id: string) => {
    const toDelete = items.find(i => i.id === id);
    if (!toDelete) return;

    executeDeleteItem(id);

    if (toDelete.due_date === todayStr || toDelete.priority === 'urgent') {
      setDailyPerformance(prev => {
        if (!prev) return prev;
        const newPlanned = Math.max(0, prev.tasks_planned - 1);
        const newCompleted = toDelete.is_completed ? Math.max(0, prev.tasks_completed - 1) : prev.tasks_completed;
        const newScore = newPlanned > 0 ? Math.round((newCompleted / newPlanned) * 100) : (newCompleted > 0 ? 100 : 0);
        return {
          ...prev,
          tasks_planned: newPlanned,
          tasks_completed: newCompleted,
          productivity_score: newScore,
        };
      });
    }

    pushHistoryAction({
      id: `act_${Date.now()}_${Math.random()}`,
      description: `Deleted "${toDelete.title}"`,
      undo: () => executeRestoreItem(toDelete),
      redo: () => executeDeleteItem(toDelete.id),
      timestamp: Date.now()
    });
  }, [items, todayStr, executeDeleteItem, executeRestoreItem, pushHistoryAction]);

  // Create Item
  const handleCreateItem = useCallback((itemData: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => {
    const tempId = `temp_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const optimisticItem: WorkItem = {
      id: tempId,
      title: itemData.title || 'Untitled',
      description: itemData.description || null,
      entity_type: itemData.entity_type || 'task',
      status: itemData.status || 'todo',
      priority: itemData.priority || 'medium',
      energy: itemData.energy || 'medium',
      due_date: itemData.due_date || null,
      start_at: null,
      end_at: null,
      remind_at: null,
      repeat_rule: itemData.repeat_rule || null,
      next_occurrence: null,
      project_id: itemData.project_id || null,
      milestone_id: itemData.milestone_id || null,
      estimated_minutes: itemData.estimated_minutes || 30,
      actual_minutes: 0,
      depends_on: [],
      is_completed: false,
      completed_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      subtasks: (itemData.subtasks || []).map((sub: any, idx: number) => ({
        id: `sub_temp_${Date.now()}_${idx}`,
        work_item_id: tempId,
        title: typeof sub === 'string' ? sub : (sub?.title || 'Subtask'),
        is_completed: false,
        position: idx
      })),
    };

    setItems(prev => [optimisticItem, ...prev]);

    if (itemData.due_date === todayStr || itemData.priority === 'urgent') {
      setDailyPerformance(prev => {
        if (!prev) return prev;
        const newPlanned = prev.tasks_planned + 1;
        const newScore = newPlanned > 0 ? Math.round((prev.tasks_completed / newPlanned) * 100) : 0;
        return {
          ...prev,
          tasks_planned: newPlanned,
          productivity_score: newScore,
        };
      });
    }

    startSync();
    api.createItem(itemData)
      .then(realItem => {
        setItems(prev => prev.map(i => i.id === tempId ? realItem : i));
        toast.success(`Created "${realItem.title}"`);
        pushHistoryAction({
          id: `act_${Date.now()}_${Math.random()}`,
          description: `Created "${realItem.title}"`,
          undo: () => executeDeleteItem(realItem.id),
          redo: () => executeRestoreItem(realItem),
          timestamp: Date.now()
        });
      })
      .catch(err => {
        console.error('Failed to create item on Pi', err);
        toast.error('Failed to save task to Raspberry Pi');
        setItems(prev => prev.filter(i => i.id !== tempId));
      })
      .finally(endSync);
  }, [todayStr, startSync, endSync, pushHistoryAction, executeDeleteItem, executeRestoreItem, toast]);

  // Update Item details
  const handleUpdateItem = useCallback((id: string, updates: WorkItemUpdatePayload) => {
    const existing = items.find(i => i.id === id);
    const { subtasks: newSubtaskStrings, ...directUpdates } = updates;

    setItems(prev => prev.map(i => {
      if (i.id !== id) return i;
      let nextSubtasks = i.subtasks;
      if (newSubtaskStrings && newSubtaskStrings.length > 0 && (!i.subtasks || i.subtasks.length === 0)) {
        nextSubtasks = newSubtaskStrings.map((title, idx) => ({
          id: `temp_sub_${Date.now()}_${idx}`,
          work_item_id: id,
          title,
          is_completed: false,
          position: idx
        }));
      }
      return { ...i, ...directUpdates, subtasks: nextSubtasks };
    }));

    if (existing) {
      const existingSnapshot = { ...existing };
      const prevPayload: WorkItemUpdatePayload = {
        title: existing.title,
        description: existing.description,
        entity_type: existing.entity_type,
        status: existing.status,
        priority: existing.priority,
        energy: existing.energy,
        due_date: existing.due_date,
        project_id: existing.project_id,
        milestone_id: existing.milestone_id,
        estimated_minutes: existing.estimated_minutes,
        repeat_rule: existing.repeat_rule,
        context_tags: existing.context_tags,
        is_completed: existing.is_completed
      };

      pushHistoryAction({
        id: `act_${Date.now()}_${Math.random()}`,
        description: `Updated "${existing.title}"`,
        undo: () => {
          setItems(p => p.map(i => i.id === id ? existingSnapshot : i));
          startSync();
          return api.updateItem(id, prevPayload).finally(endSync);
        },
        redo: () => {
          setItems(p => p.map(i => i.id === id ? { ...i, ...directUpdates } : i));
          startSync();
          return api.updateItem(id, updates).finally(endSync);
        },
        timestamp: Date.now()
      });
    }

    startSync();
    api.updateItem(id, updates)
      .then(realItem => {
        setItems(prev => prev.map(i => i.id === id ? realItem : i));
      })
      .catch(err => {
        console.error('Failed to update item on Pi', err);
        toast.error('Failed to update task on Raspberry Pi');
      })
      .finally(endSync);
  }, [items, pushHistoryAction, startSync, endSync, toast]);

  // Toggle Subtask
  const handleToggleSubtask = useCallback((itemId: string, subtaskId: string) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        subtasks: item.subtasks.map(s => s.id === subtaskId ? { ...s, is_completed: !s.is_completed } : s)
      };
    }));
    startSync();
    api.toggleSubtask(subtaskId)
      .catch(err => {
        console.error('Failed to toggle subtask on Pi', err);
        toast.error('Failed to toggle checklist item');
      })
      .finally(endSync);
  }, [startSync, endSync, toast]);

  // Projects
  const handleCreateProject = useCallback(async (proj: { name: string; color?: string; description?: string }) => {
    try {
      startSync();
      const created = await api.createProject(proj);
      const updatedProjects = await api.getProjects();
      setProjects(updatedProjects);
      toast.success(`Project "${proj.name}" created`);
      pushHistoryAction({
        id: `act_${Date.now()}_${Math.random()}`,
        description: `Created project "${proj.name}"`,
        undo: () => handleDeleteProject(created.id, false),
        redo: () => handleCreateProject(proj),
        timestamp: Date.now()
      });
    } catch (e) {
      console.error('Failed to create project', e);
      toast.error('Failed to create project on Raspberry Pi');
    } finally {
      endSync();
    }
  }, [startSync, endSync, pushHistoryAction, toast]);

  const handleDeleteProject = useCallback(async (id: string, recordHistory = true) => {
    const targetProject = projects.find(p => p.id === id);
    if (!targetProject) return;

    setProjects(prev => prev.filter(p => p.id !== id));
    startSync();
    try {
      await api.deleteProject(id);
      toast.info(`Deleted project "${targetProject.name}"`);
      if (recordHistory) {
        pushHistoryAction({
          id: `act_${Date.now()}_${Math.random()}`,
          description: `Deleted project "${targetProject.name}"`,
          undo: async () => {
            startSync();
            try {
              const created = await api.createProject({
                name: targetProject.name,
                color: targetProject.color,
                description: targetProject.description || undefined
              });
              setProjects(prev => [...prev, created]);
              toast.info(`Restored project "${created.name}"`);
            } catch (e) {
              toast.error('Failed to restore project');
            } finally {
              endSync();
            }
          },
          redo: () => handleDeleteProject(id, false),
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.error('Failed to delete project', e);
      toast.error('Failed to delete project on Raspberry Pi');
      setProjects(prev => [...prev, targetProject]);
    } finally {
      endSync();
    }
  }, [projects, startSync, endSync, pushHistoryAction, toast]);

  // Milestones
  const handleCreateMilestone = useCallback(async (m: { project_id?: string; title: string; due_date: string }) => {
    try {
      startSync();
      const created = await api.createMilestone(m);
      const updatedMilestones = await api.getMilestones();
      setMilestones(updatedMilestones);
      toast.success(`Milestone "${m.title}" added`);
      pushHistoryAction({
        id: `act_${Date.now()}_${Math.random()}`,
        description: `Created milestone "${m.title}"`,
        undo: () => handleDeleteMilestone(created.id, false),
        redo: () => handleCreateMilestone(m),
        timestamp: Date.now()
      });
    } catch (e) {
      console.error('Failed to create milestone', e);
      toast.error('Failed to create milestone');
    } finally {
      endSync();
    }
  }, [startSync, endSync, pushHistoryAction, toast]);

  const handleDeleteMilestone = useCallback(async (id: string, recordHistory = true) => {
    const targetMilestone = milestones.find(m => m.id === id);
    if (!targetMilestone) return;

    setMilestones(prev => prev.filter(m => m.id !== id));
    startSync();
    try {
      await api.deleteMilestone(id);
      toast.info(`Deleted milestone "${targetMilestone.title}"`);
      if (recordHistory) {
        pushHistoryAction({
          id: `act_${Date.now()}_${Math.random()}`,
          description: `Deleted milestone "${targetMilestone.title}"`,
          undo: async () => {
            startSync();
            try {
              const created = await api.createMilestone({
                project_id: targetMilestone.project_id || undefined,
                title: targetMilestone.title,
                due_date: targetMilestone.due_date
              });
              setMilestones(prev => [...prev, created]);
              toast.info(`Restored milestone "${created.title}"`);
            } catch (e) {
              toast.error('Failed to restore milestone');
            } finally {
              endSync();
            }
          },
          redo: () => handleDeleteMilestone(id, false),
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.error('Failed to delete milestone', e);
      toast.error('Failed to delete milestone on Raspberry Pi');
      setMilestones(prev => [...prev, targetMilestone]);
    } finally {
      endSync();
    }
  }, [milestones, startSync, endSync, pushHistoryAction, toast]);

  // Handle selective WebSocket event for tasks
  const handleWsTaskEvent = useCallback((event: { type: string; data: any }): boolean => {
    switch (event.type) {
      case 'ITEM_CREATED': {
        const item = event.data as WorkItem;
        if (item && item.id) {
          setItems(prev => {
            if (prev.some(i => i.id === item.id)) return prev;
            return [item, ...prev];
          });
        }
        return true;
      }
      case 'ITEM_UPDATED': {
        const updated = event.data as WorkItem;
        if (updated && updated.id) {
          setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
        }
        return true;
      }
      case 'ITEM_DELETED': {
        const id = event.data?.id;
        if (id) {
          setItems(prev => prev.filter(i => i.id !== id));
        }
        return true;
      }
      case 'SUBTASK_TOGGLED': {
        const { id, is_completed } = event.data || {};
        if (id !== undefined) {
          setItems(prev => prev.map(item => ({
            ...item,
            subtasks: item.subtasks.map(s => s.id === id ? { ...s, is_completed } : s)
          })));
        }
        return true;
      }
      default:
        return false;
    }
  }, []);

  return {
    items,
    setItems,
    milestones,
    setMilestones,
    projects,
    setProjects,
    dailyPerformance,
    setDailyPerformance,
    handleToggleComplete,
    handleDeleteItem,
    handleCreateItem,
    handleUpdateItem,
    handleToggleSubtask,
    handleCreateProject,
    handleDeleteProject,
    handleCreateMilestone,
    handleDeleteMilestone,
    handleWsTaskEvent,
  };
}
