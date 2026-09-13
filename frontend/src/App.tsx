import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/layout/Navbar';
import { DashboardView } from './components/dashboard/DashboardView';
import { TasksView } from './components/tasks/TasksView';
import { FinanceView } from './components/finance/FinanceView';
import { ShortcutsModal } from './components/shortcuts/ShortcutsModal';
import { BrainDumpModal } from './components/layout/BrainDumpModal';
import { api } from './services/api';
import { useLiveSync } from './services/websocket';
import { 
  WorkItem, 
  Milestone, 
  DailyPerformance, 
  FinanceSummary, 
  Transaction, 
  AiGreetingResponse,
  WeatherData,
  TaskStatus,
  FinanceAccount
} from './types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tasks' | 'finance' | 'shortcuts'>('dashboard');
  const [isBrainDumpOpen, setIsBrainDumpOpen] = useState(false);

  // Core Data State
  const [items, setItems] = useState<WorkItem[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
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
      const [fetchedItems, fetchedMilestones, fetchedPerf, fetchedFin, fetchedTx, fetchedGreet, fetchedWeather] = await Promise.all([
        api.getItems().catch(() => []),
        api.getMilestones().catch(() => []),
        api.getTodayDashboard().catch(() => null),
        api.getFinanceSummary().catch(() => null),
        api.getTransactions().catch(() => []),
        api.getAiGreeting().catch(() => null),
        api.getWeather().catch(() => null),
      ]);

      setItems(fetchedItems);
      setMilestones(fetchedMilestones);
      setDailyPerformance(fetchedPerf);
      setFinanceSummary(fetchedFin);
      setTransactions(fetchedTx);
      setGreetingData(fetchedGreet);
      setWeatherData(fetchedWeather);
    } catch (e) {
      console.error('Failed to load Sage OS data', e);
    }
  }, []);

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

  useEffect(() => {
    loadData();

    // Global keyboard shortcut for PC: Ctrl+K or Cmd+K to open AI Brain Dump
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsBrainDumpOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loadData]);

  // ==========================================
  // OPTIMISTIC TASK & EVENT HANDLERS
  // ==========================================

  // Toggle Item Completion (Instant 0ms UI reflection)
  const handleToggleComplete = (item: WorkItem) => {
    const newCompleted = !item.is_completed;
    const nowIso = new Date().toISOString();

    // 1. Immediately update items state
    setItems(prev => prev.map(i => i.id === item.id ? {
      ...i,
      is_completed: newCompleted,
      status: (newCompleted ? 'done' : 'todo') as TaskStatus,
      completed_at: newCompleted ? nowIso : null
    } : i));

    // 2. Immediately update Daily Performance ring and metrics
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

    // 3. Save to Pi in background
    startSync();
    api.updateItem(item.id, { is_completed: newCompleted })
      .catch(err => {
        console.error('Failed to sync item toggle to Pi', err);
        // Rollback on failure
        setItems(prev => prev.map(i => i.id === item.id ? item : i));
      })
      .finally(endSync);
  };

  // Create Item (Instant 0ms UI reflection)
  const handleCreateItem = (itemData: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => {
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
      })
      .catch(err => {
        console.error('Failed to create item on Pi', err);
        setItems(prev => prev.filter(i => i.id !== tempId));
      })
      .finally(endSync);
  };

  // Delete Item (Instant 0ms UI reflection)
  const handleDeleteItem = (id: string) => {
    const toDelete = items.find(i => i.id === id);
    setItems(prev => prev.filter(i => i.id !== id));

    if (toDelete && (toDelete.due_date === todayStr || toDelete.priority === 'urgent')) {
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

    startSync();
    api.deleteItem(id)
      .catch(err => {
        console.error('Failed to delete item on Pi', err);
        if (toDelete) setItems(prev => [toDelete, ...prev]);
      })
      .finally(endSync);
  };

  // Update Item details
  const handleUpdateItem = (id: string, updates: Partial<WorkItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
    startSync();
    api.updateItem(id, updates)
      .then(realItem => {
        setItems(prev => prev.map(i => i.id === id ? realItem : i));
      })
      .catch(err => {
        console.error('Failed to update item on Pi', err);
      })
      .finally(endSync);
  };

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
      })
      .finally(endSync);
  };

  // ==========================================
  // OPTIMISTIC FINANCE HANDLERS
  // ==========================================

  // Create Account (Instant 0ms UI reflection)
  const handleCreateAccount = (accData: { name: string; account_type: string; balance: number; currency?: string }) => {
    const tempId = `acc_temp_${Date.now()}`;
    const nowIso = new Date().toISOString();
    const optimisticAcc: FinanceAccount = {
      id: tempId,
      name: accData.name,
      account_type: accData.account_type as any,
      balance: accData.balance || 0,
      currency: accData.currency || 'INR',
      updated_at: nowIso,
    };

    setFinanceSummary(prev => {
      if (!prev) return prev;
      const newAccounts = [...prev.accounts, optimisticAcc];
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
      })
      .catch(err => {
        console.error('Failed to create account on Pi', err);
        setFinanceSummary(prev => prev ? {
          ...prev,
          accounts: prev.accounts.filter(a => a.id !== tempId)
        } : prev);
      })
      .finally(endSync);
  };

  // Update Account (Instant 0ms UI reflection)
  const handleUpdateAccount = (id: string, updates: { name?: string; balance?: number }) => {
    setFinanceSummary(prev => {
      if (!prev) return prev;
      const newAccounts = prev.accounts.map(a => a.id === id ? { ...a, ...updates } : a);
      const newNetWorth = newAccounts.reduce((sum, a) => sum + (a.account_type === 'credit' ? -a.balance : a.balance), 0);
      return {
        ...prev,
        accounts: newAccounts,
        net_worth: newNetWorth,
      };
    });

    startSync();
    api.updateAccount(id, updates)
      .catch(err => {
        console.error('Failed to update account on Pi', err);
      })
      .finally(endSync);
  };

  // Delete Account (Instant 0ms UI reflection)
  const handleDeleteAccount = (id: string) => {
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
      .catch(err => {
        console.error('Failed to delete account on Pi', err);
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
      })
      .catch(err => {
        console.error('Failed to create transaction on Pi', err);
        setTransactions(prev => prev.filter(t => t.id !== tempId));
      })
      .finally(endSync);
  };

  // Delete Transaction (Instant 0ms UI reflection)
  const handleDeleteTransaction = (id: string) => {
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
      .catch(err => {
        console.error('Failed to delete transaction on Pi', err);
        if (txToDelete) setTransactions(prev => [txToDelete, ...prev]);
      })
      .finally(endSync);
  };

  const todayTasks = items.filter(i => i.due_date === todayStr || (!i.is_completed && i.priority === 'urgent'));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isLiveConnected={isConnected}
        isSyncing={isSyncing}
        onOpenQuickCapture={() => setIsBrainDumpOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 px-4 sm:px-6 md:px-8 pt-4 md:pt-6">
        {activeTab === 'dashboard' && (
          <DashboardView
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
            items={items}
            milestones={milestones}
            onRefresh={loadData}
            onToggleComplete={handleToggleComplete}
            onCreateItem={handleCreateItem}
            onDeleteItem={handleDeleteItem}
            onUpdateItem={handleUpdateItem}
            onToggleSubtask={handleToggleSubtask}
          />
        )}

        {activeTab === 'finance' && (
          <FinanceView
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

      {/* AI Brain Dump Quick Capture Modal */}
      <BrainDumpModal
        isOpen={isBrainDumpOpen}
        onClose={() => setIsBrainDumpOpen(false)}
        onItemsCreated={() => {
          loadData();
        }}
      />
    </div>
  );
};
