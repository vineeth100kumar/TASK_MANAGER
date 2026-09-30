import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Search, Plus, LayoutList, Columns, Table as TableIcon, CalendarDays, ChevronDown, GanttChartSquare, Cloud, RefreshCw, AlertTriangle, WifiOff, Network } from 'lucide-react';
import { api } from '../../services/api';
import { SyncEngineStatus } from '../../services/syncEngine';

const VIEWS = [
  { id: 'list', icon: LayoutList, label: 'List' },
  { id: 'board', icon: Columns, label: 'Board' },
  { id: 'map', icon: Network, label: 'Map' },
  { id: 'timeline', icon: GanttChartSquare, label: 'Timeline' },
  { id: 'table', icon: TableIcon, label: 'Table' },
  { id: 'calendar', icon: CalendarDays, label: 'Calendar' }
];

interface HeaderProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  activeView: string;
  activeWorkspace: string;
  filters: any;
  setFilters: (filters: any) => void;
  setActiveView: (view: string) => void;
  presentationMode: string;
  setPresentationMode: (mode: string) => void;
  setIsCreateModalOpen: (isOpen: boolean) => void;
  setIsDiagnosticsOpen?: (isOpen: boolean) => void;
  lifeContext?: 'work' | 'personal';
}

function SyncBadge({ onClick }: { onClick?: () => void }) {
  const [status, setStatus] = useState<SyncEngineStatus>(api.sync.getStatus());

  useEffect(() => {
    const update = async () => {
      const detailed = await api.sync.getDetailedStatus();
      setStatus(detailed);
    };
    update();
    const unsub = api.sync.subscribeStatus(() => update());
    return unsub;
  }, []);

  if (status.state === 'offline') {
    return (
      <button onClick={onClick} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs font-semibold border border-amber-200/50 dark:border-amber-700/30 hover:opacity-80 transition-opacity" title="Click for Data & Sync diagnostics">
        <WifiOff size={12} />
        <span className="hidden sm:inline">{status.pendingCount > 0 ? `Offline (${status.pendingCount} queued)` : 'Offline'}</span>
      </button>
    );
  }

  if (status.pendingCount > 0) {
    return (
      <button onClick={onClick} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-xs font-semibold border border-amber-200/50 dark:border-amber-700/40 hover:opacity-90 transition-opacity" title="Unsynced changes queued for cloud upload">
        <RefreshCw size={12} className={status.state === 'syncing' ? 'animate-spin' : ''} />
        <span>{status.pendingCount} unsynced</span>
      </button>
    );
  }

  if (status.state === 'retrying' || status.state === 'error' || status.failedCount > 0) {
    return (
      <button onClick={onClick} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-semibold border border-red-200/50 dark:border-red-700/30 hover:opacity-80 transition-opacity" title="Click for Data & Sync diagnostics">
        <AlertTriangle size={12} />
        <span className="hidden sm:inline">Retrying ({status.failedCount || 1})</span>
      </button>
    );
  }

  return (
    <button onClick={onClick} className="hidden sm:flex items-center gap-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-white text-xs px-2.5 py-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors" title="All changes saved. Click for diagnostics.">
      <Cloud size={13} className="text-emerald-500" />
      <span className="text-[11px] font-semibold">Synced</span>
    </button>
  );
}

export function Header({ 
  isSidebarOpen, setIsSidebarOpen, 
  activeView, activeWorkspace, 
  filters, setFilters, 
  setActiveView, 
  presentationMode, setPresentationMode, 
  setIsCreateModalOpen, 
  setIsDiagnosticsOpen,
  lifeContext = 'work' 
}: HeaderProps) {
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [activeTitle, setActiveTitle] = useState('All Work Items');

  useEffect(() => {
    if (activeView === 'dashboard') {
      setActiveTitle(lifeContext === 'personal' ? 'Today · Life Space' : 'Today · Work Space');
    } else if (activeView === 'inbox') {
      setActiveTitle(lifeContext === 'personal' ? 'Personal Inbox' : 'Work Inbox');
    } else if (activeView === 'focus') {
      setActiveTitle('Focus Space');
    } else if (activeView === 'waiting_for') {
      setActiveTitle('Waiting For & Delegations');
    } else if (activeView === 'notes') {
      setActiveTitle('Notes & Docs');
    } else if (activeView === 'canvas') {
      setActiveTitle('Canvas');
    } else if (activeWorkspace === 'all') {
      setActiveTitle(lifeContext === 'personal' ? 'All Personal Items' : 'All Work Items');
    } else {
      const state = api.sync.getState();
      const proj = state.projects.find(p => p.id === activeWorkspace);
      const area = state.areas.find(a => a.id === activeWorkspace);
      if (proj) setActiveTitle(proj.name);
      else if (area) setActiveTitle(area.name);
      else setActiveTitle(activeWorkspace);
    }
  }, [activeView, activeWorkspace, lifeContext]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters({ ...filters, search: e.target.value });
    if (e.target.value && activeView !== 'tasks') setActiveView('tasks');
  };

  const currentViewObj = VIEWS.find(v => v.id === presentationMode);
  const CurrentViewIcon = currentViewObj?.icon || LayoutList;

  return (
    <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-8 border-b border-gray-200/60 dark:border-white/[0.06] sticky top-0 bg-white/70 dark:bg-[#0a0a0b]/65 backdrop-blur-xl backdrop-saturate-150 z-20">
      <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
        {!isSidebarOpen && <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 md:ml-0 text-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 shrink-0" aria-label="Open sidebar"><Menu size={20} /></button>}
        <h1 className="sm:hidden text-[17px] font-semibold tracking-[-0.02em] text-gray-900 dark:text-white truncate">{activeTitle}</h1>
        <div className="relative hidden sm:flex items-center gap-1.5 text-[14px] font-medium text-gray-400 min-w-0 overflow-hidden">
           <span className="hidden lg:inline shrink-0">{lifeContext === 'personal' ? 'Life Space' : 'Workspace'}</span> <ChevronDown size={14} className="hidden lg:block opacity-50 -rotate-90 shrink-0" />
           <AnimatePresence mode="popLayout" initial={false}>
             <motion.span key={activeTitle} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
               className="text-gray-900 dark:text-white font-semibold tracking-[-0.015em] truncate">
               {activeTitle}
             </motion.span>
           </AnimatePresence>
        </div>
      </div>
      
      <div className="flex items-center gap-2 md:gap-3 justify-end">
        {/* Interactive Sync Diagnostics Badge */}
        <SyncBadge onClick={() => setIsDiagnosticsOpen && setIsDiagnosticsOpen(true)} />

        <div className="hidden md:flex items-center h-9 px-3 rounded-xl bg-gray-100/80 dark:bg-white/5 border border-transparent transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] w-44 lg:w-60 focus-within:w-56 lg:focus-within:w-72 hover:bg-gray-100 dark:hover:bg-white/[0.07] focus-within:bg-white dark:focus-within:bg-white/[0.08] focus-within:border-blue-500/40 focus-within:ring-4 focus-within:ring-blue-500/10">
          <Search size={15} className="text-gray-400 shrink-0" />
          <input type="text" placeholder="Search items..." value={filters.search} onChange={handleSearchChange} className="w-full bg-transparent border-none focus:ring-0 text-[13px] ml-2 outline-none text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500" />
          {!filters.search && <kbd className="kbd ml-1 shrink-0">/</kbd>}
        </div>

        {activeView === 'tasks' && (
          <>
            {/* Desktop View Switcher */}
            <div className="hidden lg:flex bg-gray-100 dark:bg-white/5 p-0.5 rounded-xl">
              {VIEWS.map(view => (
                <button key={view.id} onClick={() => setPresentationMode(view.id)} aria-label={`${view.label} view`} aria-pressed={presentationMode === view.id}
                  title={view.label} className={`relative p-1.5 rounded-[9px] transition-colors ${presentationMode === view.id ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}>
                  {presentationMode === view.id && <motion.span layoutId="view-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-[9px] bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 dark:ring-white/5" />}
                  <view.icon size={16} className="relative" />
                </button>
              ))}
            </div>

            {/* Mobile/Tablet View Switcher Dropdown */}
            <div className="lg:hidden relative">
              <button onClick={() => setIsViewMenuOpen(!isViewMenuOpen)} className="flex items-center gap-2 h-9 px-2.5 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-white/10 transition-colors">
                <CurrentViewIcon size={16} />
                <span className="sr-only">{currentViewObj?.label} view</span>
                <ChevronDown size={14} />
              </button>
              
              {isViewMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsViewMenuOpen(false)}></div>
                  <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 mt-2 w-44 surface-float rounded-xl z-20 p-1 overflow-hidden origin-top-right">
                    {VIEWS.map(view => (
                      <button key={view.id} onClick={() => { setPresentationMode(view.id); setIsViewMenuOpen(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium text-left hover:bg-gray-100 dark:hover:bg-white/5 ${presentationMode === view.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
                        <view.icon size={16} /> {view.label}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </div>
          </>
        )}

        <button onClick={() => setIsCreateModalOpen(true)} title="New item (N)" aria-label="New item" className="hidden md:flex shrink-0 items-center gap-1.5 h-9 bg-gradient-to-b from-gray-800 to-gray-950 hover:from-gray-700 hover:to-gray-900 dark:from-white dark:to-gray-200 dark:hover:from-white dark:hover:to-gray-100 text-white dark:text-black px-3 md:px-3.5 rounded-xl text-[13.5px] font-semibold transition-all active:scale-[0.97] shadow-sm shadow-black/20 ring-1 ring-inset ring-white/10 dark:ring-black/5">
          <Plus size={16} /> <span className="hidden lg:inline">New Item</span>
        </button>
      </div>
    </header>
  );
}
