import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Navbar } from './components/layout/Navbar';
import { DashboardView } from './components/dashboard/DashboardView';
import { TasksView } from './components/tasks/TasksView';
import { ProjectsHub } from './components/projects/ProjectsHub';
import { FinanceView } from './components/finance/FinanceView';
import { ShortcutsModal } from './components/shortcuts/ShortcutsModal';
import { BrainDumpModal } from './components/layout/BrainDumpModal';
import { MorningEveningWizard } from './components/planner/MorningEveningWizard';
// The canvas is the single largest thing in the app and most sessions never
// open it, so the Pi should not have to send it on every load.
const WhiteboardView = lazy(() =>
  import('./components/whiteboard/WhiteboardView').then((m) => ({ default: m.WhiteboardView }))
);
import { SearchModal } from './components/search/SearchModal';
import { CelebrationModal } from './components/common/CelebrationModal';

import { api } from './services/api';
import { useLiveSync } from './services/websocket';
import { useToast } from './context/ToastContext';
import { useVisualViewport } from './hooks/useVisualViewport';
import { storage } from './utils/storage';

import { useUndoRedo } from './hooks/useUndoRedo';
import { useTasksState } from './hooks/useTasksState';
import { useFinanceState } from './hooks/useFinanceState';

import {
  AiGreetingResponse,
  WeatherData
} from './types';

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

  /*
   * Theme. The `dark` class on <html> is what actually drives every token, so it
   * is the single source of truth. It used to be hardcoded in index.html and
   * never toggled, which meant every `dark:` variant was permanently on and the
   * light theme never actually rendered. index.html now resolves it before
   * first paint; this keeps it in sync.
   */
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = storage.get('sage_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.backgroundColor = theme === 'dark' ? '#0e0f12' : '#f6f6f8';
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      storage.set('sage_theme', next);
      return next;
    });
  }, []);

  // Track iOS Visual Viewport & Keyboard offset dynamically
  useVisualViewport();

  // Background sync tracking
  const [syncingCount, setSyncingCount] = useState(0);
  const isSyncing = syncingCount > 0;
  const startSync = useCallback(() => setSyncingCount(c => c + 1), []);
  const endSync = useCallback(() => setSyncingCount(c => Math.max(0, c - 1)), []);

  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Undo / Redo Hook
  const {
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    undoTooltip,
    redoTooltip,
    handleUndo,
    handleRedo,
    pushHistoryAction,
  } = useUndoRedo();

  // 2. Tasks & Projects Domain Hook
  const {
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
    handleAddSubtask,
    handleDeleteSubtask,
    handleCreateProject,
    handleDeleteProject,
    handleCreateMilestone,
    handleDeleteMilestone,
    handleWsTaskEvent,
  } = useTasksState({
    todayStr,
    startSync,
    endSync,
    pushHistoryAction,
    onAllTodayCompleted: () => setIsCelebrationOpen(true),
  });

  // 3. Finance Domain Hook
  const {
    financeSummary,
    setFinanceSummary,
    transactions,
    setTransactions,
    handleCreateAccount,
    handleUpdateAccount,
    handleDeleteAccount,
    handleCreateTransaction,
    handleDeleteTransaction,
    handleWsFinanceEvent,
  } = useFinanceState({
    todayStr,
    startSync,
    endSync,
    pushHistoryAction,
  });

  // Dashboard Weather & AI Greeting State
  const [greetingData, setGreetingData] = useState<AiGreetingResponse | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);

  // Load all data with per-resource error handling (Promise.allSettled)
  const loadData = useCallback(async () => {
    const results = await Promise.allSettled([
      api.getItems(),
      api.getMilestones(),
      api.getProjects(),
      api.getTodayDashboard(),
      api.getFinanceSummary(),
      api.getTransactions(),
      api.getAiGreeting(),
      api.getWeather(),
    ]);

    const [itemsRes, milestonesRes, projectsRes, perfRes, finRes, txRes, greetRes, weatherRes] = results;
    const failedResources: string[] = [];

    if (itemsRes.status === 'fulfilled') setItems(itemsRes.value);
    else failedResources.push('Tasks');

    if (milestonesRes.status === 'fulfilled') setMilestones(milestonesRes.value);
    else failedResources.push('Milestones');

    if (projectsRes.status === 'fulfilled') setProjects(projectsRes.value);
    else failedResources.push('Projects');

    if (perfRes.status === 'fulfilled') setDailyPerformance(perfRes.value);
    else failedResources.push('Dashboard');

    if (finRes.status === 'fulfilled') setFinanceSummary(finRes.value);
    else failedResources.push('Finance Summary');

    if (txRes.status === 'fulfilled') setTransactions(txRes.value);
    else failedResources.push('Transactions');

    if (greetRes.status === 'fulfilled') setGreetingData(greetRes.value);
    if (weatherRes.status === 'fulfilled') setWeatherData(weatherRes.value);

    if (failedResources.length > 0) {
      toast.action(
        `Failed to sync ${failedResources.join(', ')} from Raspberry Pi`,
        'Retry',
        () => { loadData(); },
        8000
      );
    }

    setIsInitialLoading(false);
  }, [setItems, setMilestones, setProjects, setDailyPerformance, setFinanceSummary, setTransactions, toast]);

  // Debounced live sync fallback for unhandled events
  const syncDebounceRef = useRef<any>(null);
  const debouncedLoadData = useCallback(() => {
    if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
    syncDebounceRef.current = setTimeout(() => {
      loadData();
    }, 1200);
  }, [loadData]);

  // Real-time live sync hook with selective patch routing
  const handleWsMessage = useCallback((event: { type: string; data: any }) => {
    const handledTask = handleWsTaskEvent(event);
    const handledFinance = handleWsFinanceEvent(event);
    if (!handledTask && !handledFinance) {
      debouncedLoadData();
    }
  }, [handleWsTaskEvent, handleWsFinanceEvent, debouncedLoadData]);

  const { isConnected } = useLiveSync(handleWsMessage);

  useEffect(() => {
    loadData();

    // Global keyboard shortcuts
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

    const isMorningWindow = (currentHour === 7 && currentMin >= 30) || currentHour === 8 || (currentHour === 9 && currentMin <= 30);
    const isEveningWindow = (currentHour === 20 && currentMin >= 30) || currentHour === 21 || (currentHour === 22 && currentMin <= 30);

    if (isMorningWindow && !storage.get(`sage_morning_done_${today}`)) {
      setWizardMode('morning');
      setIsWizardOpen(true);
    } else if (isEveningWindow && !storage.get(`sage_evening_done_${today}`)) {
      setWizardMode('evening');
      setIsWizardOpen(true);
    }

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loadData, handleUndo, handleRedo]);

  const todayTasks = items.filter(i => i.due_date === todayStr || (!i.is_completed && i.priority === 'urgent'));

  return (
    <div className="min-h-screen flex flex-col bg-ground text-ink relative">
      {/* Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isLiveConnected={isConnected}
        isSyncing={isSyncing}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenQuickCapture={() => setIsBrainDumpOpen(true)}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenWizard={(mode) => {
          setWizardMode(mode || (new Date().getHours() >= 17 ? 'evening' : 'morning'));
          setIsWizardOpen(true);
        }}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        undoTooltip={undoTooltip}
        redoTooltip={redoTooltip}
      />

      {/* Main Content Area */}
      {/*
        Bottom padding clears the mobile capture row and tab bar. The Today
        screen and the canvas manage their own spacing.
      */}
      <main
        className={`flex-1 ${
          activeTab === 'dashboard' || activeTab === 'whiteboard'
            ? ''
            : 'px-5 sm:px-6 md:px-8 pt-3 md:pt-6 pb-40 md:pb-16'
        }`}
      >
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
            onAddSubtask={handleAddSubtask}
            onDeleteSubtask={handleDeleteSubtask}
            onOpenBrainDump={() => setIsBrainDumpOpen(true)}
            onCelebrationTrigger={() => setIsCelebrationOpen(true)}
          />
        )}

        {activeTab === 'whiteboard' && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-24 text-meta text-ink-3">
                Opening canvas…
              </div>
            }
          >
            <WhiteboardView
              initialProjectId={activeWhiteboardProjectId}
              projects={projects}
              edition={theme === 'dark' ? 'night' : 'day'}
              onBack={() => setActiveTab('projects')}
              onTaskCreated={loadData}
            />
          </Suspense>
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
            onToggleSubtask={handleToggleSubtask}
            onAddSubtask={handleAddSubtask}
            onDeleteSubtask={handleDeleteSubtask}
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
