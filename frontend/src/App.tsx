import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/layout/Navbar';
import { DashboardView } from './components/dashboard/DashboardView';
import { TasksView } from './components/tasks/TasksView';
import { ProjectsHub } from './components/projects/ProjectsHub';
import { FinanceView } from './components/finance/FinanceView';
import { ShortcutsModal } from './components/shortcuts/ShortcutsModal';
import { BrainDumpModal } from './components/layout/BrainDumpModal';
import { MorningEveningWizard } from './components/planner/MorningEveningWizard';
import { WhiteboardView } from './components/whiteboard/WhiteboardView';
import { api } from './services/api';
import { useLiveSync } from './services/websocket';
import { useToast } from './context/ToastContext';
import { SearchModal } from './components/search/SearchModal';
import { CelebrationModal } from './components/common/CelebrationModal';
import { useVisualViewport } from './hooks/useVisualViewport';
import { isDueToday } from './utils/dateHelpers';
import { 
  WorkItem, 
  WorkItemUpdatePayload,
  Milestone, 
  Project,
  DailyPerformance, 
  FinanceSummary, 
  Transaction, 
  AiGreetingResponse,
  WeatherData,
  TaskStatus,
  FinanceAccount
} from './types';

export interface HistoryAction {
  id: string;
  description: string;
  undo: () => any;
  redo: () => any;
  timestamp: number;
}

export const App: React.FC = () => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tasks' | 'whiteboard' | 'projects' | 'finance' | 'shortcuts'>('dashboard');
  const [activeWhiteboardProjectId, setActiveWhiteboardProjectId] = useState<string | null>(null);
  const [isBrainDumpOpen, setIsBrainDumpOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCelebrationOpen, setIsCelebrationOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<'morning' | 'evening'>('morning');
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // Track iOS Visual Viewport & Keyboard offset dynamically
  useVisualViewport();

  // Core Data State
  const [items, setItems] = useState<WorkItem[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dailyPerformance, setDailyPerformance] = useState<DailyPerformance | null>(null);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [greetingData, setGreetingData] = useState<AiGreetingResponse | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);

  // Background sync tracking
  const [syncingCount, setSyncingCount] = useState(0);
  const isSyncing = syncingCount > 0;
  const startSync = () => setSyncingCount(c => c + 1);
  const endSync = () => setSyncingCount(c => Math.max(0, c - 1));

  const todayStr = new Date().toISOString().split('T')[0];

  // Load all data from Raspberry Pi 5
  const loadData = useCallback(async () => {
    try {
      const [fetchedItems, fetchedMilestones, fetchedProjects, fetchedPerf, fetchedFin, fetchedTx, fetchedGreet, fetchedWeather] = await Promise.all([
        api.getItems().catch(() => []),
        api.getMilestones().catch(() => []),
        api.getProjects().catch(() => []),
        api.getTodayDashboard().catch(() => null),
        api.getFinanceSummary().catch(() => null),
        api.getTransactions().catch(() => []),
        api.getAiGreeting().catch(() => null),
        api.getWeather().catch(() => null),
      ]);

      setItems(fetchedItems);
      setMilestones(fetchedMilestones);
      setProjects(fetchedProjects);
      setDailyPerformance(fetchedPerf);
      setFinanceSummary(fetchedFin);
      setTransactions(fetchedTx);
      setGreetingData(fetchedGreet);
      setWeatherData(fetchedWeather);
    } catch (e) {
      console.error('Failed to load Sage OS data', e);
      toast.error('Failed to load Sage OS data from Raspberry Pi', 'Sync Error');
    } finally {
      setIsInitialLoading(false);
    }
  }, [toast]);

  // Debounced live sync to prevent websocket broadcasts from stuttering optimistic UI
  const syncDebounceRef = useRef<any>(null);
  const debouncedLoadData = useCallback(() => {
    if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
    syncDebounceRef.current = setTimeout(() => {
      loadData();
    }, 1200);
  }, [loadData]);

  // Real-time live sync hook
  const { isConnected } = useLiveSync(useCallback(() => {
    debouncedLoadData();
  }, [debouncedLoadData]));

  // ==========================================
  // GLOBAL UNDO / REDO ARCHITECTURE
  // ==========================================
  const [undoStack, setUndoStack] = useState<HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);

  const undoStackRef = useRef<HistoryAction[]>([]);
  undoStackRef.current = undoStack;
  const redoStackRef = useRef<HistoryAction[]>([]);
  redoStackRef.current = redoStack;

  const handleUndo = useCallback(async () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);
    try {
      await action.undo();
      toast.info(`Undid: ${action.description}`);
    } catch (e) {
      console.error('Failed to undo action:', e);
      toast.error('Failed to undo action');
    }
  }, [toast]);

  const handleRedo = useCallback(async () => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, action]);
    try {
      await action.redo();
      toast.info(`Redid: ${action.description}`);
    } catch (e) {
      console.error('Failed to redo action:', e);
      toast.error('Failed to redo action');
    }
  }, [toast]);

  const pushHistoryAction = useCallback((action: HistoryAction) => {
    setUndoStack(prev => [...prev.slice(-30), action]);
    setRedoStack([]); // Clear redo stack on new action
    
    toast.action(action.description, 'Undo', () => {
      handleUndo();
    }, 6000);
  }, [handleUndo, toast]);

  useEffect(() => {
    loadData();

    // Global keyboard shortcuts:
    // Ctrl+K / Cmd+K: AI Brain Dump
    // Ctrl+Z / Cmd+Z: Undo
    // Ctrl+Y / Cmd+Shift+Z / Ctrl+Shift+Z: Redo
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = (target?.tagName || '').toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || target?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsBrainDumpOpen(prev => !prev);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Automatic Morning / Evening Wizard trigger based on schedule
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const today = now.toISOString().split('T')[0];

    // Morning window: 7:30 AM to 9:30 AM
    const isMorningWindow = (currentHour === 7 && currentMin >= 30) || currentHour === 8 || (currentHour === 9 && currentMin <= 30);
    // Evening window: 8:30 PM to 10:30 PM
    const isEveningWindow = (currentHour === 20 && currentMin >= 30) || currentHour === 21 || (currentHour === 22 && currentMin <= 30);

    if (isMorningWindow && !localStorage.getItem(`sage_morning_done_${today}`)) {
      setWizardMode('morning');
      setIsWizardOpen(true);
    } else if (isEveningWindow && !localStorage.getItem(`sage_evening_done_${today}`)) {
      setWizardMode('evening');
      setIsWizardOpen(true);
    }

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loadData, handleUndo, handleRedo]);

  // ==========================================
  // OPTIMISTIC TASK & EVENT HANDLERS (WITH UNDO/REDO)
  // ==========================================

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
  }, [toast]);

  const handleToggleComplete = useCallback((item: WorkItem) => {
    const newCompleted = !item.is_completed;
    executeToggleComplete(item.id, newCompleted);

    // Micro-Celebration Trigger: If this was a task due today and completing it finishes all today's tasks
    if (newCompleted && isDueToday(item.due_date)) {
      const remainingToday = items.filter(i => i.id !== item.id && isDueToday(i.due_date) && !i.is_completed);
      if (remainingToday.length === 0) {
        setIsCelebrationOpen(true);
      }
    }

    pushHistoryAction({
      id: `act_${Date.now()}_${Math.random()}`,
      description: `${newCompleted ? 'Completed' : 'Uncompleted'} "${item.title}"`,
      undo: () => executeToggleComplete(item.id, !newCompleted),
      redo: () => executeToggleComplete(item.id, newCompleted),
      timestamp: Date.now()
    });
  }, [executeToggleComplete, pushHistoryAction, items]);

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
  }, [toast]);

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
  }, [toast]);

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
  }, [todayStr, pushHistoryAction, executeDeleteItem, executeRestoreItem, toast]);

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
  }, [items, pushHistoryAction, toast]);

  // Toggle Subtask
  const handleToggleSubtask = (itemId: string, subtaskId: string) => {
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
  };

  // ==========================================
  // PROJECT & MILESTONE HANDLERS (WITH UNDO/REDO)
  // ==========================================
  const handleCreateProject = async (proj: { name: string; color?: string; description?: string }) => {
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
  };

  const handleDeleteProject = async (id: string, recordHistory = true) => {
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
  };

  const handleCreateMilestone = async (m: { project_id?: string; title: string; due_date: string }) => {
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
  };

  const handleDeleteMilestone = async (id: string, recordHistory = true) => {
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
  };

  // ==========================================
  // OPTIMISTIC FINANCE HANDLERS (WITH UNDO/REDO)
  // ==========================================

  // Create Account (Instant 0ms UI reflection)
  const handleCreateAccount = (accData: { name: string; account_type: string; balance: number; currency?: string; is_upi_default?: boolean }) => {
    const tempId = `acc_temp_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const optimisticAcc: FinanceAccount = {
      id: tempId,
      name: accData.name,
      account_type: accData.account_type as any,
      balance: accData.balance || 0,
      currency: accData.currency || 'INR',
      is_upi_default: Boolean(accData.is_upi_default),
      updated_at: nowIso,
    };

    setFinanceSummary(prev => {
      if (!prev) return prev;
      let newAccounts = accData.is_upi_default
        ? prev.accounts.map(a => ({ ...a, is_upi_default: false }))
        : [...prev.accounts];
      newAccounts = [...newAccounts, optimisticAcc];
      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
      };
    });

    startSync();
    api.createAccount(accData)
      .then(realAcc => {
        setFinanceSummary(prev => prev ? {
          ...prev,
          accounts: prev.accounts.map(a => a.id === tempId ? realAcc : a)
        } : prev);
        toast.success(`Account "${realAcc.name}" created`);
        pushHistoryAction({
          id: `act_${Date.now()}_${Math.random()}`,
          description: `Created account "${realAcc.name}"`,
          undo: () => handleDeleteAccount(realAcc.id, false),
          redo: () => handleCreateAccount(accData),
          timestamp: Date.now()
        });
      })
      .catch(err => {
        console.error('Failed to create account on Pi', err);
        toast.error('Failed to create account on Raspberry Pi');
        setFinanceSummary(prev => prev ? {
          ...prev,
          accounts: prev.accounts.filter(a => a.id !== tempId)
        } : prev);
      })
      .finally(endSync);
  };

  // Update Account (Instant 0ms UI reflection)
  const handleUpdateAccount = (id: string, updates: { name?: string; balance?: number; is_upi_default?: boolean }) => {
    setFinanceSummary(prev => {
      if (!prev) return prev;
      let newAccounts = prev.accounts.map(a => {
        if (a.id === id) {
          return { ...a, ...updates };
        }
        if (updates.is_upi_default) {
          return { ...a, is_upi_default: false };
        }
        return a;
      });
      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
      };
    });

    startSync();
    api.updateAccount(id, updates as any)
      .then(() => toast.info('Account updated'))
      .catch(err => {
        console.error('Failed to update account on Pi', err);
        toast.error('Failed to update account');
      })
      .finally(endSync);
  };

  // Delete Account (Instant 0ms UI reflection with Undo)
  const handleDeleteAccount = (id: string, recordHistory = true) => {
    const targetAcc = financeSummary?.accounts.find(a => a.id === id);
    if (!targetAcc) return;

    setFinanceSummary(prev => {
      if (!prev) return prev;
      const newAccounts = prev.accounts.filter(a => a.id !== id);
      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
      };
    });

    startSync();
    api.deleteAccount(id)
      .then(() => {
        toast.info(`Deleted account "${targetAcc.name}"`);
        if (recordHistory) {
          pushHistoryAction({
            id: `act_${Date.now()}_${Math.random()}`,
            description: `Deleted account "${targetAcc.name}"`,
            undo: async () => {
              startSync();
              try {
                const created = await api.createAccount({
                  name: targetAcc.name,
                  account_type: targetAcc.account_type,
                  balance: targetAcc.balance,
                  currency: targetAcc.currency,
                  is_upi_default: targetAcc.is_upi_default
                });
                setFinanceSummary(prev => prev ? {
                  ...prev,
                  accounts: [...prev.accounts, created],
                  net_worth: prev.net_worth + (created.account_type === 'credit' ? -created.balance : created.balance)
                } : prev);
                toast.info(`Restored account "${created.name}"`);
              } catch (e) {
                toast.error('Failed to restore account');
              } finally {
                endSync();
              }
            },
            redo: () => handleDeleteAccount(id, false),
            timestamp: Date.now()
          });
        }
      })
      .catch(err => {
        console.error('Failed to delete account on Pi', err);
        toast.error('Failed to delete account on Raspberry Pi');
        setFinanceSummary(prev => prev ? {
          ...prev,
          accounts: [...prev.accounts, targetAcc],
          net_worth: prev.net_worth + (targetAcc.account_type === 'credit' ? -targetAcc.balance : targetAcc.balance)
        } : prev);
      })
      .finally(endSync);
  };

  // Create Transaction (Instant 0ms UI reflection)
  const handleCreateTransaction = (txData: any) => {
    const tempId = `tx_temp_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const targetAcc = financeSummary?.accounts.find(a => a.id === txData.account_id);
    const targetCat = financeSummary?.categories.find(c => c.id === txData.category_id);
    const targetDstAcc = txData.transfer_to_account_id ? financeSummary?.accounts.find(a => a.id === txData.transfer_to_account_id) : undefined;

    const optimisticTx: Transaction = {
      id: tempId,
      account_id: txData.account_id,
      account_name: targetAcc?.name,
      category_id: txData.category_id,
      category_name: targetCat?.name,
      type: txData.type,
      amount: txData.amount,
      payment_mode: txData.payment_mode,
      description: txData.description,
      transfer_to_account_id: txData.transfer_to_account_id,
      transfer_to_account_name: targetDstAcc?.name,
      date: txData.date || todayStr,
      created_at: nowIso,
    };

    setTransactions(prev => [optimisticTx, ...prev]);

    setFinanceSummary(prev => {
      if (!prev) return prev;
      const newAccounts = prev.accounts.map(acc => {
        if (acc.id === txData.account_id) {
          const delta = txData.type === 'expense' ? -txData.amount : txData.type === 'income' ? txData.amount : -txData.amount;
          return { ...acc, balance: acc.balance + delta };
        }
        if (txData.type === 'transfer' && acc.id === txData.transfer_to_account_id) {
          return { ...acc, balance: acc.balance + txData.amount };
        }
        return acc;
      });

      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      const isToday = (txData.date || todayStr) === todayStr;
      const addedTodaySpend = (isToday && txData.type === 'expense') ? txData.amount : 0;

      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
        today_spend: prev.today_spend + addedTodaySpend,
      };
    });

    startSync();
    api.createTransaction(txData)
      .then(realTx => {
        setTransactions(prev => prev.map(t => t.id === tempId ? realTx : t));
        toast.success(`Logged ₹${realTx.amount} ${realTx.type}`);
        pushHistoryAction({
          id: `act_${Date.now()}_${Math.random()}`,
          description: `Logged ₹${realTx.amount} (${realTx.description || realTx.type})`,
          undo: () => handleDeleteTransaction(realTx.id, false),
          redo: () => handleCreateTransaction(txData),
          timestamp: Date.now()
        });
      })
      .catch(err => {
        console.error('Failed to create transaction on Pi', err);
        toast.error('Failed to save transaction to Raspberry Pi');
        setTransactions(prev => prev.filter(t => t.id !== tempId));
      })
      .finally(endSync);
  };

  // Delete Transaction (Instant 0ms UI reflection with Undo)
  const handleDeleteTransaction = (id: string, recordHistory = true) => {
    const txToDelete = transactions.find(t => t.id === id);
    if (!txToDelete) return;
    setTransactions(prev => prev.filter(t => t.id !== id));

    setFinanceSummary(prev => {
      if (!prev) return prev;
      const newAccounts = prev.accounts.map(acc => {
        if (acc.id === txToDelete.account_id) {
          const revDelta = txToDelete.type === 'expense' ? txToDelete.amount : txToDelete.type === 'income' ? -txToDelete.amount : txToDelete.amount;
          return { ...acc, balance: acc.balance + revDelta };
        }
        if (txToDelete.type === 'transfer' && acc.id === txToDelete.transfer_to_account_id) {
          return { ...acc, balance: acc.balance - txToDelete.amount };
        }
        return acc;
      });

      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      const isToday = txToDelete.date === todayStr;
      const subTodaySpend = (isToday && txToDelete.type === 'expense') ? txToDelete.amount : 0;

      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
        today_spend: Math.max(0, prev.today_spend - subTodaySpend),
      };
    });

    startSync();
    api.deleteTransaction(id)
      .then(() => {
        toast.info(`Deleted transaction ₹${txToDelete.amount}`);
        if (recordHistory) {
          pushHistoryAction({
            id: `act_${Date.now()}_${Math.random()}`,
            description: `Deleted ₹${txToDelete.amount} (${txToDelete.description || txToDelete.type})`,
            undo: async () => {
              startSync();
              try {
                const restored = await api.createTransaction({
                  account_id: txToDelete.account_id,
                  category_id: txToDelete.category_id || undefined,
                  type: txToDelete.type,
                  amount: txToDelete.amount,
                  payment_mode: txToDelete.payment_mode,
                  description: txToDelete.description || undefined,
                  transfer_to_account_id: txToDelete.transfer_to_account_id || undefined,
                  date: txToDelete.date
                });
                setTransactions(prev => [restored, ...prev]);
                toast.info(`Restored transaction ₹${txToDelete.amount}`);
              } catch (e) {
                toast.error('Failed to restore transaction');
              } finally {
                endSync();
              }
            },
            redo: () => handleDeleteTransaction(id, false),
            timestamp: Date.now()
          });
        }
      })
      .catch(err => {
        console.error('Failed to delete transaction on Pi', err);
        toast.error('Failed to delete transaction on Raspberry Pi');
        if (txToDelete) setTransactions(prev => [txToDelete, ...prev]);
      })
      .finally(endSync);
  };

  const todayTasks = items.filter(i => i.due_date === todayStr || (!i.is_completed && i.priority === 'urgent'));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans relative">
      {/* Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isLiveConnected={isConnected}
        isSyncing={isSyncing}
        onOpenQuickCapture={() => setIsBrainDumpOpen(true)}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenWizard={(mode) => {
          setWizardMode(mode || (new Date().getHours() >= 17 ? 'evening' : 'morning'));
          setIsWizardOpen(true);
        }}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        undoTooltip={undoStack[undoStack.length - 1]?.description || ''}
        redoTooltip={redoStack[redoStack.length - 1]?.description || ''}
      />

      {/* Main Content Area */}
      <main className="flex-1 px-4 sm:px-6 md:px-8 pt-4 md:pt-6">
        {activeTab === 'dashboard' && (
          <DashboardView
            isLoading={isInitialLoading}
            performance={dailyPerformance}
            greetingData={greetingData}
            weatherData={weatherData}
            financeSummary={financeSummary}
            todayTasks={todayTasks}
            onToggleTask={handleToggleComplete}
            onNavigateToTab={setActiveTab}
          />
        )}

        {activeTab === 'tasks' && (
          <TasksView
            isLoading={isInitialLoading}
            items={items}
            projects={projects}
            milestones={milestones}
            onRefresh={loadData}
            onToggleComplete={handleToggleComplete}
            onCreateItem={handleCreateItem}
            onDeleteItem={handleDeleteItem}
            onUpdateItem={handleUpdateItem}
            onToggleSubtask={handleToggleSubtask}
            onOpenBrainDump={() => setIsBrainDumpOpen(true)}
            onCelebrationTrigger={() => setIsCelebrationOpen(true)}
          />
        )}

        {activeTab === 'whiteboard' && (
          <WhiteboardView
            initialProjectId={activeWhiteboardProjectId}
            projects={projects}
            onBack={() => setActiveTab('projects')}
            onTaskCreated={loadData}
          />
        )}

        {activeTab === 'projects' && (
          <ProjectsHub
            isLoading={isInitialLoading}
            projects={projects}
            milestones={milestones}
            items={items}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            onCreateMilestone={handleCreateMilestone}
            onDeleteMilestone={handleDeleteMilestone}
            onSelectItem={() => setActiveTab('tasks')}
            onCreateItem={handleCreateItem}
            onToggleComplete={handleToggleComplete}
            onOpenWhiteboard={(projId) => {
              setActiveWhiteboardProjectId(projId);
              setActiveTab('whiteboard');
            }}
          />
        )}

        {activeTab === 'finance' && (
          <FinanceView
            isLoading={isInitialLoading}
            summary={financeSummary}
            transactions={transactions}
            onRefresh={loadData}
            onCreateAccount={handleCreateAccount}
            onUpdateAccount={handleUpdateAccount}
            onDeleteAccount={handleDeleteAccount}
            onCreateTransaction={handleCreateTransaction}
            onDeleteTransaction={handleDeleteTransaction}
          />
        )}

        {activeTab === 'shortcuts' && (
          <ShortcutsModal />
        )}
      </main>

      {/* Morning Kickoff & Evening Debrief Wizard */}
      <MorningEveningWizard
        isOpen={isWizardOpen}
        initialMode={wizardMode}
        onClose={() => setIsWizardOpen(false)}
        onTasksUpdated={loadData}
      />

      {/* AI Brain Dump Quick Capture Modal */}
      <BrainDumpModal
        isOpen={isBrainDumpOpen}
        onClose={() => setIsBrainDumpOpen(false)}
        onItemsCreated={() => {
          loadData();
        }}
      />

      {/* Global Command & Search Palette (Cmd/Ctrl+K) */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        tasks={items}
        projects={projects}
        transactions={transactions}
        onSelectTask={() => setActiveTab('tasks')}
        onSelectProject={() => setActiveTab('projects')}
        onNavigateTab={(tab) => setActiveTab(tab)}
        onOpenWizard={(mode) => {
          setWizardMode(mode);
          setIsWizardOpen(true);
        }}
        onOpenBrainDump={() => setIsBrainDumpOpen(true)}
      />

      {/* All Clear Daily Celebration Micro-Interaction */}
      <CelebrationModal
        isOpen={isCelebrationOpen}
        onClose={() => setIsCelebrationOpen(false)}
        streakDays={dailyPerformance?.streak_days || 1}
      />
    </div>
  );
};
