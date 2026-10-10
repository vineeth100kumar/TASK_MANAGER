import { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'framer-motion';
import { ShieldAlert, CheckCircle, LayoutList, Plus, RotateCcw } from 'lucide-react';

import { api } from './services/api';
import { STATUSES, FOCUS_LIMIT } from './services/constants';
import { LifeFilter } from './services/types';
import { ToastProvider, useToast } from './context/ToastContext';
import { notificationService } from './services/notificationService';
import { refreshSubscription } from './services/pushNotifications';
import { countDoneToday, doneMessage, haptic } from './utils/progress';

import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { MobileTabBar } from './components/layout/MobileTabBar';
import { DashboardView } from './components/views/DashboardView';
import { InboxView } from './components/views/InboxView';
import { FocusView } from './components/views/FocusView';
import { WaitingForView } from './components/views/WaitingForView';
import { ListView } from './components/views/ListView';
import { BoardView } from './components/views/BoardView';
import { TableView } from './components/views/TableView';
import { CalendarView } from './components/views/CalendarView';
import { TimelineView } from './components/views/TimelineView';
import { NotesView } from './components/views/NotesView';
import { CanvasView } from './components/views/CanvasView';
import { ProjectBranchesView } from './components/branches/ProjectBranchesView';
import { TrashModal } from './components/modals/TrashModal';
import { SyncDiagnosticsModal } from './components/modals/SyncDiagnosticsModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { FilterBar } from './components/common/FilterBar';
import { ShortcutSheet } from './components/modals/ShortcutSheet';
import { TaskInspector } from './components/tasks/TaskInspector';
import { CreateTaskModal } from './components/tasks/CreateTaskModal';
import { MorningPickThree } from './components/modals/MorningPickThree';
import { EveningShutdown } from './components/modals/EveningShutdown';
import { PhoneCorner } from './components/common/PhoneCorner';

function MainApp() {
  // Global State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('sage-theme');
    return saved ? saved === 'dark' : false;
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Navigation State
  const [activeView, setActiveView] = useState('dashboard');
  const [activeWorkspace, setActiveWorkspace] = useState('all'); 
  // Boards scroll sideways, which is awkward on a phone, so phones start in the list.
  const [presentationMode, setPresentationMode] = useState(() => window.matchMedia('(max-width: 767px)').matches ? 'list' : 'board');
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [filters, setFilters] = useState({ search: '', entityType: 'all', priority: 'all', status: 'all', tag: '' });
  // Work and personal show together unless the sidebar filter narrows to one.
  const [lifeFilter, setLifeFilterState] = useState<LifeFilter>(() => {
    try {
      const saved = localStorage.getItem('sage-life-filter');
      return saved === 'work' || saved === 'personal' ? saved : 'all';
    } catch { return 'all'; }
  });
  const setLifeFilter = useCallback((f: LifeFilter) => {
    setLifeFilterState(f);
    try { localStorage.setItem('sage-life-filter', f); } catch { /* storage unavailable */ }
  }, []);
  const lifeContext = lifeFilter === 'all' ? undefined : lifeFilter;
  
  // Data State
  const [workItems, setWorkItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isMorningOpen, setIsMorningOpen] = useState(false);
  const [isEveningOpen, setIsEveningOpen] = useState(false);

  const { showToast, dismissToast, toasts } = useToast();

  // Handle Theme
  useEffect(() => { 
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('sage-theme', isDarkMode ? 'dark' : 'light');
    // Match the browser/OS chrome to the app's theme, not the system's.
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', isDarkMode ? '#0a0a0b' : '#ffffff'));
  }, [isDarkMode]);

  // Theme switches reveal as a circle growing from where the user clicked.
  const lastPointer = useRef({ x: window.innerWidth / 2, y: 0 });
  useEffect(() => {
    const onDown = (e: PointerEvent) => { lastPointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);
  const changeTheme = useCallback((dark: boolean) => {
    const doc = document as any;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || reduce) { setIsDarkMode(dark); return; }
    const root = document.documentElement;
    const { x, y } = lastPointer.current;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.classList.add('theme-switching');
    const transition = doc.startViewTransition(() => { flushSync(() => setIsDarkMode(dark)); });
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
    transition.finished.finally(() => root.classList.remove('theme-switching'));
  }, []);

  // The latest fetchWorkItems, which knows the current filters and project. The
  // effect below runs once, so calling its own copy would reload with the
  // filters from the first render and drop yours after every sync.
  const fetchRef = useRef<(showLoading?: boolean) => Promise<void>>(async () => {});

  // Handle Responsive Sidebar, Reminder Watcher & Entity Sync Listeners
  useEffect(() => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
    notificationService.startReminderWatcher();
    refreshSubscription();

    // URL params from notifications (?open=), PWA shortcuts (?action=, ?view=).
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('open');
    const actionParam = params.get('action');
    const viewParam = params.get('view');
    const ritualParam = params.get('ritual');
    if (openId || actionParam || viewParam || ritualParam) {
      params.delete('open');
      params.delete('action');
      params.delete('view');
      params.delete('ritual');
      const rest = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    }
    if (actionParam === 'new-task') setIsCreateModalOpen(true);
    if (ritualParam === 'morning') setIsMorningOpen(true);
    if (ritualParam === 'evening') setIsEveningOpen(true);
    if (viewParam === 'focus') setActiveView('focus');
    else if (viewParam === 'dashboard') setActiveView('dashboard');
    else if (viewParam === 'inbox') setActiveView('inbox');
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'sage-open-item' && typeof event.data.id === 'string') setSelectedItemId(event.data.id);
    };
    navigator.serviceWorker?.addEventListener('message', onWorkerMessage);

    // Another device deleted or more recently changed something edited here.
    const unsubOverruled = api.sync.onOverruled((e) => {
      showToast(e.reason === 'deleted' ? 'That was deleted on another device' : 'Kept the newer copy from another device', 'info');
    });

    const unsubEntity = api.sync.onEntityChange(() => {
      fetchRef.current(false);
    });

    // Replicate all latest data from Google Sheets into IndexedDB on startup (non-blocking)
    // The item from a tapped notification opens once this device has the
    // latest data, which on a fresh install is only after this first pull.
    const openPending = () => { if (openId) setSelectedItemId(openId); };
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      api.sync.fetchAll().then(() => {
        fetchRef.current(false);
        openPending();
      }).catch(err => {
        console.warn('[Sync] Startup cloud replication skipped:', err);
        openPending();
      });
    } else {
      openPending();
    }

    return () => {
      unsubOverruled();
      unsubEntity();
      navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
    };
  }, []);

  // Global Keyboard Shortcuts (N or C = Create, / = Search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select'
        || !!(document.activeElement as HTMLElement | null)?.isContentEditable;

      // Ctrl/Cmd+C is copy and Cmd+N is a new window, not shortcuts of ours.
      if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'n' || e.key === 'N' || e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          setIsCreateModalOpen(true);
        } else if (e.key === '?') {
          e.preventDefault();
          setIsShortcutsOpen(open => !open);
        } else if (e.key === '/') {
          e.preventDefault();
          const searchInput = document.querySelector('input[type="text"][placeholder*="Search"]') as HTMLInputElement;
          if (searchInput) searchInput.focus();
        }
      } else if (!isInput && (e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="text"][placeholder*="Search"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetching
  const fetchWorkItems = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const data = await api.workItems.list({ ...filters, projectId: activeWorkspace, lifeContext });
      setWorkItems(data);
    } catch (e) {
      showToast("Failed to load work items.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [filters, activeWorkspace, lifeContext, showToast]);

  fetchRef.current = fetchWorkItems;

  useEffect(() => { 
    const debounceTimer = setTimeout(() => {
      fetchWorkItems(true);
    }, 250);
    return () => clearTimeout(debounceTimer);
  }, [filters, activeWorkspace, lifeContext, fetchWorkItems]);

  // Tapping a tag shows everything with it, in the list view.
  const filterByTag = (tag: string) => {
    setFilters({ search: '', entityType: 'all', priority: 'all', status: 'all', tag });
    setActiveView('tasks');
    setSelectedItemId(null);
  };

  // Search text belongs to the list. Leaving for another view clears it, so it
  // isn't still filtering when you come back.
  useEffect(() => {
    if (activeView !== 'tasks') setFilters(f => (f.search ? { ...f, search: '' } : f));
  }, [activeView]);

  // Mutations with Universal Undo
  const handleTransitionStatus = async (item: any, newStatus: string) => {
    const oldItem = { ...item };
    setWorkItems(prev => prev.map(t => t.id === item.id ? { ...t, status: newStatus } : t));
    try {
      await api.workItems.transitionStatus(item.id, newStatus, item.version);
      
      // Provide Universal 8-Second Undo on State Changes
      if (newStatus === 'done') haptic(12);
      showToast(
        newStatus === 'done' ? doneMessage(countDoneToday()) : `Moved to ${(STATUSES as any)[newStatus]?.label || newStatus}`, 
        'success',
        {
          label: 'Undo',
          group: newStatus === 'done' ? 'done' : undefined,
          onAction: async () => {
            await api.workItems.transitionStatus(item.id, oldItem.status, oldItem.version);
            showToast('Action undone');
            fetchWorkItems(false);
          }
        }
      );
      fetchWorkItems(false);
    } catch (e: any) {
      setWorkItems(prev => prev.map(t => t.id === item.id ? oldItem : t));
      showToast(e.message, "error");
      throw e;
    }
  };

  const handleUpdateItemDetails = async (item: any, updates: any) => {
    const oldItem = { ...item };
    setWorkItems(prev => prev.map(t => t.id === item.id ? { ...t, ...updates } : t));
    try {
      await api.workItems.updateDetails(item.id, updates, item.version);
      fetchWorkItems(false);
    } catch (e: any) {
      setWorkItems(prev => prev.map(t => t.id === item.id ? oldItem : t));
      showToast(e.message, "error");
      fetchWorkItems(false);
      throw e;
    }
  };

  const handleSoftDelete = async (itemId: string) => {
    const itemToDelete = workItems.find(t => t.id === itemId);
    setWorkItems(prev => prev.filter(t => t.id !== itemId));
    setSelectedItemId(null);
    try {
      await api.workItems.softDelete(itemId);
      showToast(
        'Item moved to trash',
        'info',
        {
          label: 'Undo',
          onAction: async () => {
            if (itemToDelete) {
              await api.workItems.restore(itemId);
              showToast('Item restored');
              fetchWorkItems(false);
            }
          }
        }
      );
    } catch (e: any) {
      if (itemToDelete) setWorkItems(prev => [...prev, itemToDelete]);
      showToast("Delete failed", "error");
      fetchWorkItems(false);
    }
  };

  const handleCreateWorkItem = async (payload: any) => {
    try {
      // Focus holds five. A sixth goes to the Inbox rather than being lost.
      let focusFull = false;
      if (payload.isFocus && (await api.focus.list()).length >= FOCUS_LIMIT) {
        focusFull = true;
        payload = { ...payload, isFocus: false, focusOrder: undefined, isInbox: undefined };
      }
      const created = await api.workItems.create(payload);
      // Say where it went, so nobody wonders whether it saved.
      const today = new Date();
      const isToday = payload.dueDate === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      showToast(focusFull ? `Focus is full (${FOCUS_LIMIT}), so this is in your ${payload.dueDate ? 'list' : 'Inbox'}` : payload.isFocus ? 'Added to Focus' : isToday ? 'Added for today' : payload.dueDate ? `Added for ${new Date(`${payload.dueDate}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Added to Inbox', 'success', { label: 'Undo', group: 'added', onAction: async () => { await api.workItems.softDelete(created.id); fetchWorkItems(false); } });
      fetchWorkItems(false);
    } catch (e: any) {
      showToast(e.message, 'error');
      throw e;
    }
  };

  return (
    <div className="h-screen w-full flex overflow-hidden transition-colors duration-300 font-sans bg-white text-gray-900 dark:bg-[#0a0a0b] dark:text-gray-100">
      <Sidebar 
        isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}
        activeView={activeView} setActiveView={setActiveView}
        activeWorkspace={activeWorkspace} setActiveWorkspace={setActiveWorkspace}
        isDarkMode={isDarkMode} setIsDarkMode={changeTheme}
        lifeContext={lifeFilter} setLifeContext={setLifeFilter}
        setIsTrashOpen={setIsTrashOpen}
        setIsDiagnosticsOpen={setIsDiagnosticsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
      />

      <main data-context={lifeFilter} className={`flex-1 flex flex-col h-full overflow-hidden relative transition-colors duration-500 ${lifeContext === 'personal' ? 'bg-[#fffdfa] dark:bg-[#0c0906]' : 'bg-[#ffffff] dark:bg-[#0a0a0b]'}`}>
        <div className="app-ambient" aria-hidden />
        <Header 
          isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}
          activeView={activeView} activeWorkspace={activeWorkspace}
          filters={filters} setFilters={setFilters}
          setActiveView={setActiveView}
          presentationMode={presentationMode} setPresentationMode={setPresentationMode}
          setIsCreateModalOpen={setIsCreateModalOpen}
          setIsDiagnosticsOpen={setIsDiagnosticsOpen}
          lifeContext={lifeContext}
        />

        {activeView === 'canvas' ? (
          // The canvas pans and zooms itself, so it fills the space instead of scrolling.
          <div className="relative flex-1 min-h-0 p-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:p-6">
            <CanvasView lifeContext={lifeContext} isDarkMode={isDarkMode} />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar relative">
          <motion.div key={`${activeView}:${lifeFilter}:${activeWorkspace}`} className="p-4 pb-28 md:p-8 min-h-full"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
            {isLoading ? (
              <div className="max-w-5xl mx-auto space-y-4" aria-busy="true" aria-label="Loading your items">
                <div className="skeleton h-36 md:h-44" />
                <div className="grid md:grid-cols-2 gap-4"><div className="skeleton h-48" /><div className="skeleton h-48" /></div>
                <div className="skeleton h-16 !rounded-2xl" />
              </div>
            ) : activeView === 'notes' ? (
              <NotesView lifeContext={lifeContext} />
            ) : activeView === 'inbox' ? (
              <InboxView lifeContext={lifeContext} onSelectTask={setSelectedItemId} />
            ) : activeView === 'focus' ? (
              <FocusView lifeContext={lifeContext} onSelectTask={setSelectedItemId} />
            ) : activeView === 'waiting_for' ? (
              <WaitingForView lifeContext={lifeContext} onSelectTask={setSelectedItemId} />
            ) : activeView === 'dashboard' ? (
              <DashboardView 
                workspaceId={activeWorkspace} 
                onSelectTask={(id) => setSelectedItemId(id)} 
                lifeContext={lifeContext}
                onNavigateView={(v) => setActiveView(v)}
              />
            ) : (
              <div>
                {/* Global Quick Filter Bar */}
                <FilterBar filters={filters} setFilters={setFilters} />

                {workItems.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 py-20 stagger">
                    <div className="surface-item p-4 rounded-2xl mb-5 text-gray-500 ring-8 ring-gray-100/70 dark:ring-white/[0.03]">
                      <LayoutList size={28} />
                    </div>
                    <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white mb-1.5">No items found</h3>
                    <p className="text-[14px] text-gray-500 max-w-sm text-center leading-relaxed">
                      {(filters.search || filters.entityType !== 'all' || filters.priority !== 'all' || filters.status !== 'all' || filters.tag) ? "Try adjusting your filter options above." : "Create your first item or press N to add one."}
                    </p>
                    <button onClick={() => setIsCreateModalOpen(true)} className="mt-6 px-5 py-2.5 bg-blue-600 text-white text-[14px] rounded-xl font-semibold hover:bg-blue-700 shadow-sm shadow-blue-600/25 ring-1 ring-inset ring-white/15 transition-all active:scale-[0.98] flex items-center gap-2">
                      <Plus size={16} /> Add Item <span className="ml-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-white/20">N</span>
                    </button>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div key={presentationMode + activeWorkspace} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
                      <LayoutGroup>
                        {presentationMode === 'list' && <ListView tasks={workItems} onSelect={setSelectedItemId} selectedId={selectedItemId} onTransition={handleTransitionStatus} />}
                        {presentationMode === 'board' && <BoardView tasks={workItems.filter(i=>i.entityType==='task')} onSelect={setSelectedItemId} onTransition={handleTransitionStatus} />}
                        {presentationMode === 'branches' && (
                          <ProjectBranchesView
                            items={workItems}
                            lifeContext={lifeContext}
                            activeWorkspace={activeWorkspace}
                            onSelectTask={setSelectedItemId}
                            onRefreshData={() => fetchWorkItems(false)}
                          />
                        )}
                        {presentationMode === 'timeline' && <TimelineView tasks={workItems} onSelect={setSelectedItemId} />}
                        {presentationMode === 'table' && <TableView tasks={workItems.filter(i=>i.entityType==='task')} onSelect={setSelectedItemId} onTransition={handleTransitionStatus} />}
                        {presentationMode === 'calendar' && <CalendarView tasks={workItems} onSelect={setSelectedItemId} />}
                      </LayoutGroup>
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            )}
          </motion.div>
        </div>
        )}

        <MobileTabBar
          activeView={activeView} activeWorkspace={activeWorkspace} lifeContext={lifeContext}
          onCreate={() => setIsCreateModalOpen(true)}
          onNavigate={(view) => {
            if (view === 'all') { setActiveView('tasks'); setActiveWorkspace('all'); }
            else setActiveView(view);
          }}
        />
      </main>

      <AnimatePresence>
        {selectedItemId && (
          <TaskInspector taskId={selectedItemId} onClose={() => setSelectedItemId(null)} onFilterTag={filterByTag} onTransition={handleTransitionStatus} onUpdateDetails={handleUpdateItemDetails} onDelete={handleSoftDelete} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isShortcutsOpen && <ShortcutSheet onClose={() => setIsShortcutsOpen(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsModal
            onClose={() => setIsSettingsOpen(false)}
            lifeContext={lifeContext}
            onDataChanged={() => fetchWorkItems(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCreateModalOpen && (
          <CreateTaskModal 
            onClose={() => setIsCreateModalOpen(false)} 
            onCreate={handleCreateWorkItem} 
            workspaceId={activeWorkspace !== 'all' ? activeWorkspace : (api.sync.getState().projects[0]?.id || '')} 
            lifeContext={lifeContext} 
            defaultFocus={activeView === 'focus'}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isTrashOpen && (
          <TrashModal 
            onClose={() => setIsTrashOpen(false)} 
            onRestored={() => fetchWorkItems(false)} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDiagnosticsOpen && (
          <SyncDiagnosticsModal
            onClose={() => setIsDiagnosticsOpen(false)}
          />
        )}
      </AnimatePresence>

      {isMorningOpen && (
        <MorningPickThree onClose={() => setIsMorningOpen(false)} onNavigateView={setActiveView} />
      )}
      {isEveningOpen && (
        <EveningShutdown onClose={() => setIsEveningOpen(false)} />
      )}

      <PhoneCorner />

      {/* Interactive Toasts with 8-Second Undo Safety Net */}
      <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-16 inset-x-4 md:inset-x-auto md:right-4 z-[100] flex flex-col items-center md:items-end gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast: any) => (
             <motion.div key={toast.id} layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.16 } }}
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                className={`pl-3.5 pr-2 py-2 min-h-11 rounded-2xl shadow-xl shadow-black/15 flex items-center gap-3 pointer-events-auto ring-1 ${toast.type==='error'?'bg-red-600 text-white ring-red-700/40':'bg-gray-900/90 dark:bg-[#26262a]/90 text-white ring-white/10 backdrop-blur-xl backdrop-saturate-150'}`}>
               {toast.type === 'error' ? <ShieldAlert size={17} className="shrink-0" /> : <CheckCircle size={18} className="text-emerald-400 dark:text-emerald-600" />}
               <span className="text-[13px] font-medium tracking-[-0.005em]">{toast.message}</span>
               {toast.action && (
                 <button 
                   onClick={() => { toast.action?.onAction(); dismissToast(toast.id); }}
                   className="px-2.5 py-1 bg-white/15 hover:bg-white/25 font-semibold text-[12px] rounded-lg transition-colors flex items-center gap-1 active:scale-95"
                 >
                   <RotateCcw size={11} />
                   <span>{toast.action.label}</span>
                 </button>
               )}
             </motion.div>
          ))}
        </AnimatePresence>
      </div>

    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <MainApp />
      </ToastProvider>
    </MotionConfig>
  );
}
