import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Loader2, ShieldAlert, CheckCircle, LayoutList, Plus, RotateCcw } from 'lucide-react';

import { api } from './services/api';
import { STATUSES } from './services/mockDb';
import { ToastProvider, useToast } from './context/ToastContext';
import { notificationService } from './services/notificationService';

import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
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
import { ProjectMapView } from './components/project-map/ProjectMapView';
import { TrashModal } from './components/modals/TrashModal';
import { SyncDiagnosticsModal } from './components/modals/SyncDiagnosticsModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { ConflictResolutionModal } from './components/modals/ConflictResolutionModal';
import { FilterBar } from './components/common/FilterBar';
import { TaskInspector } from './components/tasks/TaskInspector';
import { CreateTaskModal } from './components/tasks/CreateTaskModal';

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
  const [presentationMode, setPresentationMode] = useState('board');
  const [filters, setFilters] = useState({ search: '', entityType: 'all', priority: 'all', status: 'all' });
  const [lifeContext, setLifeContext] = useState<'work'|'personal'>('work');
  
  // Data State
  const [workItems, setWorkItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [activeConflict, setActiveConflict] = useState<any>(null);

  const { showToast, dismissToast, toasts } = useToast();

  // Handle Theme
  useEffect(() => { 
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('sage-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Handle Responsive Sidebar, Reminder Watcher, Conflict & Entity Sync Listeners
  useEffect(() => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
    notificationService.startReminderWatcher();

    const unsubConflict = api.sync.onConflict((c: any) => {
      setActiveConflict(c);
    });

    const unsubEntity = api.sync.onEntityChange(() => {
      fetchWorkItems(false);
    });

    // Replicate all latest data from Google Sheets into IndexedDB on startup (non-blocking)
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      api.sync.fetchAll().then(() => {
        fetchWorkItems(false);
      }).catch(err => {
        console.warn('[Sync] Startup cloud replication skipped:', err);
      });
    }

    return () => {
      unsubConflict();
      unsubEntity();
    };
  }, []);

  // Global Keyboard Shortcuts (N or C = Create, / = Search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      if (!isInput) {
        if (e.key === 'n' || e.key === 'N' || e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          setIsCreateModalOpen(true);
        } else if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) {
          e.preventDefault();
          const searchInput = document.querySelector('input[type="text"][placeholder*="Search"]') as HTMLInputElement;
          if (searchInput) searchInput.focus();
        }
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

  useEffect(() => { 
    const debounceTimer = setTimeout(() => {
      fetchWorkItems(true);
    }, 250);
    return () => clearTimeout(debounceTimer);
  }, [filters, activeWorkspace, lifeContext, fetchWorkItems]);

  // Mutations with Universal Undo
  const handleTransitionStatus = async (item: any, newStatus: string) => {
    const oldItem = { ...item };
    setWorkItems(prev => prev.map(t => t.id === item.id ? { ...t, status: newStatus } : t));
    try {
      await api.workItems.transitionStatus(item.id, newStatus, item.version);
      
      // Provide Universal 8-Second Undo on State Changes
      showToast(
        `Moved to ${(STATUSES as any)[newStatus]?.label || newStatus}`, 
        'success',
        {
          label: 'Undo',
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
      await api.workItems.create(payload);
      showToast("Item created");
      fetchWorkItems(false);
    } catch (e: any) {
      showToast(e.message, 'error');
      throw e;
    }
  };

  return (
    <div className={`h-screen w-full flex overflow-hidden transition-colors duration-300 font-sans bg-[#ffffff] text-gray-900 dark:bg-[#000000] dark:text-gray-100`}>
      <Sidebar 
        isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}
        activeView={activeView} setActiveView={setActiveView}
        activeWorkspace={activeWorkspace} setActiveWorkspace={setActiveWorkspace}
        isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode}
        lifeContext={lifeContext} setLifeContext={setLifeContext}
        setIsTrashOpen={setIsTrashOpen}
        setIsDiagnosticsOpen={setIsDiagnosticsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
      />

      <main className={`flex-1 flex flex-col h-full overflow-hidden relative transition-colors duration-500 ${lifeContext === 'personal' ? 'bg-[#fffdfa] dark:bg-[#0a0500]' : 'bg-[#ffffff] dark:bg-[#000000]'}`}>
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

        <div className="flex-1 overflow-y-auto custom-scrollbar relative">
          <div className="p-4 md:p-8 min-h-full">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-gray-400 py-32"><Loader2 className="animate-spin" size={32}/></div>
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
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 py-20">
                    <div className="bg-gray-100 dark:bg-white/5 p-4 rounded-full mb-4">
                      <LayoutList size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No items found</h3>
                    <p className="text-[15px] font-medium max-w-sm text-center">
                      {(filters.search || filters.entityType !== 'all' || filters.priority !== 'all' || filters.status !== 'all') ? "Try adjusting your filter options above." : "Create your first item or press N to add one."}
                    </p>
                    <button onClick={() => setIsCreateModalOpen(true)} className="mt-6 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md flex items-center gap-2">
                      <Plus size={16} /> Add Item (N)
                    </button>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div key={presentationMode + activeWorkspace} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                      <LayoutGroup>
                        {presentationMode === 'list' && <ListView tasks={workItems} onSelect={setSelectedItemId} selectedId={selectedItemId} onTransition={handleTransitionStatus} />}
                        {presentationMode === 'board' && <BoardView tasks={workItems.filter(i=>i.entityType==='task')} onSelect={setSelectedItemId} onTransition={handleTransitionStatus} />}
                        {presentationMode === 'map' && (
                          <ProjectMapView 
                            items={workItems} 
                            project={activeWorkspace !== 'all' ? api.sync.getState().projects.find(p => p.id === activeWorkspace) : null} 
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
          </div>
        </div>

        {/* Mobile Add Item Floating Action Button */}
        <button 
          onClick={() => setIsCreateModalOpen(true)} 
          className="md:hidden fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-blue-600 text-white shadow-2xl flex items-center justify-center active:scale-95 transition-transform" 
          aria-label="Add Item"
        >
          <Plus size={24} />
        </button>
      </main>

      <AnimatePresence>
        {selectedItemId && (
          <TaskInspector taskId={selectedItemId} onClose={() => setSelectedItemId(null)} onTransition={handleTransitionStatus} onUpdateDetails={handleUpdateItemDetails} onDelete={handleSoftDelete} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeConflict && (
          <ConflictResolutionModal
            conflict={activeConflict}
            onResolved={() => {
              setActiveConflict(null);
              fetchWorkItems(false);
            }}
            onClose={() => setActiveConflict(null)}
          />
        )}
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

      {/* Interactive Toasts with 8-Second Undo Safety Net */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast: any) => (
             <motion.div key={toast.id} initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                className={`px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3.5 pointer-events-auto border border-white/10 ${toast.type==='error'?'bg-red-600 text-white':'bg-gray-900/95 dark:bg-white/95 text-white dark:text-black backdrop-blur-xl'}`}>
               {toast.type === 'error' ? <ShieldAlert size={18} /> : <CheckCircle size={18} className="text-emerald-400 dark:text-emerald-600" />}
               <span className="text-xs font-bold">{toast.message}</span>
               {toast.action && (
                 <button 
                   onClick={() => { toast.action?.onAction(); dismissToast(toast.id); }}
                   className="px-2.5 py-1 bg-white/20 hover:bg-white/30 dark:bg-black/10 dark:hover:bg-black/20 font-extrabold text-[11px] rounded-lg transition-colors flex items-center gap-1 active:scale-95"
                 >
                   <RotateCcw size={11} />
                   <span>{toast.action.label}</span>
                 </button>
               )}
             </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.4); border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); }
      `}} />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <MainApp />
    </ToastProvider>
  );
}
