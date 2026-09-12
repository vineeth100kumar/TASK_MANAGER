import React, { useState, useEffect, useCallback } from 'react';
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
  AiGreetingResponse 
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

  // Load all data
  const loadData = useCallback(async () => {
    try {
      const [fetchedItems, fetchedMilestones, fetchedPerf, fetchedFin, fetchedTx, fetchedGreet] = await Promise.all([
        api.getItems().catch(() => []),
        api.getMilestones().catch(() => []),
        api.getTodayDashboard().catch(() => null),
        api.getFinanceSummary().catch(() => null),
        api.getTransactions().catch(() => []),
        api.getAiGreeting().catch(() => null),
      ]);

      setItems(fetchedItems);
      setMilestones(fetchedMilestones);
      setDailyPerformance(fetchedPerf);
      setFinanceSummary(fetchedFin);
      setTransactions(fetchedTx);
      setGreetingData(fetchedGreet);
    } catch (e) {
      console.error('Failed to load Sage OS data', e);
    }
  }, []);

  // Real-time live sync hook
  const { isConnected } = useLiveSync(useCallback(() => {
    // Whenever server broadcasts any event (created/updated/deleted), refresh data!
    loadData();
  }, [loadData]));

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

  // Toggle Item Completion
  const handleToggleComplete = async (item: WorkItem) => {
    const updated = await api.updateItem(item.id, {
      is_completed: !item.is_completed,
    });
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    // Refresh stats
    loadData();
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const todayTasks = items.filter(i => i.due_date === todayStr || (!i.is_completed && i.priority === 'urgent'));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isLiveConnected={isConnected}
        onOpenQuickCapture={() => setIsBrainDumpOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 px-4 sm:px-6 md:px-8 pt-4 md:pt-6">
        {activeTab === 'dashboard' && (
          <DashboardView
            performance={dailyPerformance}
            greetingData={greetingData}
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
          />
        )}

        {activeTab === 'finance' && (
          <FinanceView
            summary={financeSummary}
            transactions={transactions}
            onRefresh={loadData}
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
