import React, { useState, useEffect, useRef } from 'react';
import { parseLocalDate } from '../../utils/dateUtils';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Sun, Moon, LayoutDashboard, Inbox, Target, Activity, FileText, Loader2, Trash2, ExternalLink, Download, Database, Hourglass, Layers, Settings, ChevronUp, PenLine } from 'lucide-react';
import { api } from '../../services/api';
import { Project, Area, Goal, Habit, Note, LifeFilter } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';

interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  activeView: string;
  setActiveView: (view: string) => void;
  activeWorkspace: string;
  setActiveWorkspace: (ws: string) => void;
  isDarkMode: boolean;
  setIsDarkMode: (dark: boolean) => void;
  lifeContext: LifeFilter;
  setLifeContext: (ctx: LifeFilter) => void;
  setIsTrashOpen?: (open: boolean) => void;
  setIsDiagnosticsOpen?: (open: boolean) => void;
  setIsSettingsOpen?: (open: boolean) => void;
}

const COLOR_OPTIONS = [
  'bg-blue-500',
  'bg-indigo-500',
  'bg-purple-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-pink-500'
];

export function Sidebar({ 
  isSidebarOpen, setIsSidebarOpen, 
  activeView, setActiveView, 
  activeWorkspace, setActiveWorkspace, 
  isDarkMode, setIsDarkMode, 
  lifeContext, setLifeContext,
  setIsTrashOpen,
  setIsDiagnosticsOpen,
  setIsSettingsOpen
}: SidebarProps) {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSettingsMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) setIsSettingsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsSettingsMenuOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isSettingsMenuOpen]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [focusCount, setFocusCount] = useState(0);
  const [waitingCount, setWaitingCount] = useState(0);

  // Modals state
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [isAddAreaOpen, setIsAddAreaOpen] = useState(false);
  const [activeGrowthTab, setActiveGrowthTab] = useState<'goals' | 'habits' | 'notes' | null>(null);

  // New Project Form
  const [newProjName, setNewProjName] = useState('');
  const [newProjKey, setNewProjKey] = useState('');
  const [newProjColor, setNewProjColor] = useState('bg-indigo-500');
  const [isCreatingProj, setIsCreatingProj] = useState(false);

  // New Area Form
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaColor, setNewAreaColor] = useState('bg-purple-500');
  const [isCreatingArea, setIsCreatingArea] = useState(false);

  // Growth Data
  const [growthTitle, setGrowthTitle] = useState('');
  const [growthTarget, setGrowthTarget] = useState(5);
  const [growthDate, setGrowthDate] = useState('');

  const scope = lifeContext === 'all' ? undefined : lifeContext;
  const loadNavData = async () => {
    try {
      const [pList, aList, gList, hList, nList, inbox, focus, waiting] = await Promise.all([
        api.projects.list(),
        api.areas.list(),
        api.goals.list(),
        api.habits.list(),
        api.notes.list(),
        api.inbox.list(scope),
        api.focus.list(scope),
        api.waitingFor.list(scope)
      ]);
      setProjects(pList);
      setAreas(aList);
      setGoals(gList);
      setHabits(hList);
      setNotes(nList);
      setInboxCount(inbox.length);
      setFocusCount(focus.length);
      setWaitingCount(waiting.length);
    } catch (e) {
      console.warn('Failed to load navigation data:', e);
    }
  };

  useEffect(() => {
    loadNavData();
  }, [lifeContext]);
  useDataChanges(loadNavData);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim() || !newProjKey.trim()) return;
    setIsCreatingProj(true);
    try {
      const created = await api.projects.create({
        name: newProjName.trim(),
        key: newProjKey.trim().toUpperCase(),
        color: newProjColor
      });
      setNewProjName('');
      setNewProjKey('');
      setIsAddProjectOpen(false);
      await loadNavData();
      setActiveView('tasks');
      setActiveWorkspace(created.id);
      showToast(`Project "${created.name}" created!`);
    } catch (err: any) {
      showToast(err.message || 'Failed to create project', 'error');
    } finally {
      setIsCreatingProj(false);
    }
  };

  const handleCreateArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAreaName.trim()) return;
    setIsCreatingArea(true);
    try {
      const created = await api.areas.create({
        name: newAreaName.trim(),
        color: newAreaColor
      });
      setNewAreaName('');
      setIsAddAreaOpen(false);
      await loadNavData();
      setActiveView('tasks');
      setActiveWorkspace(created.id);
      showToast(`Life Area "${created.name}" created!`);
    } catch (err: any) {
      showToast(err.message || 'Failed to create area', 'error');
    } finally {
      setIsCreatingArea(false);
    }
  };

  const handleAddGrowthItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!growthTitle.trim()) return;
    try {
      if (activeGrowthTab === 'goals') {
        await api.goals.create({ title: growthTitle, targetDate: growthDate || new Date().toISOString() });
        showToast('Goal added!');
      } else if (activeGrowthTab === 'habits') {
        await api.habits.create({ name: growthTitle, targetCount: Number(growthTarget) || 5 });
        showToast('Habit added!');
      } else if (activeGrowthTab === 'notes') {
        await api.notes.create({ title: growthTitle });
        showToast('Note added!');
      }
      setGrowthTitle('');
      await loadNavData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add item', 'error');
    }
  };

  const handleDeleteProject = async (projId: string, projName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete project "${projName}"?`)) return;
    try {
      await api.projects.delete(projId);
      if (activeWorkspace === projId) {
        setActiveWorkspace('all');
      }
      await loadNavData();
      showToast(`Project "${projName}" deleted`);
    } catch (err: any) {
      showToast(err.message || 'Failed to delete project', 'error');
    }
  };

  const handleDeleteArea = async (areaId: string, areaName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete life area "${areaName}"?`)) return;
    try {
      await api.areas.delete(areaId);
      if (activeWorkspace === areaId) {
        setActiveWorkspace('all');
      }
      await loadNavData();
      showToast(`Life Area "${areaName}" deleted`);
    } catch (err: any) {
      showToast(err.message || 'Failed to delete area', 'error');
    }
  };

  const handleDeleteGrowth = async (type: 'goals' | 'habits' | 'notes', id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (type === 'goals') await api.goals.delete(id);
      if (type === 'habits') await api.habits.delete(id);
      if (type === 'notes') await api.notes.delete(id);
      await loadNavData();
      showToast('Item deleted');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete item', 'error');
    }
  };

  return (
    <>
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div key="sidebar-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="md:hidden fixed inset-0 z-[35] bg-gray-900/30 dark:bg-black/60 backdrop-blur-[2px]"
            onClick={() => setIsSidebarOpen(false)} aria-hidden />
        )}
      </AnimatePresence>
      <motion.aside
        initial={false} 
        animate={{ width: isSidebarOpen ? 280 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        className={`fixed md:relative z-40 h-full flex flex-col overflow-hidden backdrop-blur-3xl border-r border-gray-200/60 dark:border-white/[0.06] shadow-[inset_-1px_0_0_rgb(255_255_255/0.6)] dark:shadow-none transition-[background-color] duration-500 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} ${lifeContext === 'personal' ? 'bg-gradient-to-b from-orange-50/95 to-[#f7f4f0]/95 dark:from-[#1a130c]/95 dark:to-[#141210]/95' : 'bg-gradient-to-b from-[#f7f7f9]/95 to-[#f1f1f4]/95 dark:from-[#18181b]/95 dark:to-[#131315]/95'}`}
      >
        <div className="w-[280px] h-full flex flex-col">
          <div className="px-6 pt-6 pb-4 flex items-center relative">
            <img src="/logo-light.png" alt="Sage" className="h-9 w-auto block dark:hidden select-none" draggable={false} />
            <img src="/logo-dark.png" alt="Sage" className="h-9 w-auto hidden dark:block select-none" draggable={false} />
            <button onClick={() => setIsSidebarOpen(false)} className="absolute right-4 md:hidden p-2 text-gray-500 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" aria-label="Close sidebar">
              <X size={20} />
            </button>
          </div>

          <div className="px-4 py-2 flex-1 overflow-y-auto space-y-6 custom-scrollbar">
            
            <div className="bg-gray-200/60 dark:bg-white/5 p-1 rounded-xl flex items-center">
              {(['all', 'work', 'personal'] as const).map(ctx => {
                const active = lifeContext === ctx;
                return (
                  <button key={ctx} onClick={() => setLifeContext(ctx)} aria-pressed={active}
                    className={`relative flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-colors ${active ? (ctx === 'personal' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white') : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                    {active && <motion.span layoutId="context-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-lg bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 dark:ring-white/5" />}
                    <span className="relative">{ctx === 'all' ? 'All' : ctx === 'work' ? 'Work' : 'Personal'}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-0.5">
              {[ 
                { id: 'dashboard', name: 'Today', icon: LayoutDashboard },
                { id: 'inbox', name: 'Inbox', icon: Inbox, count: inboxCount, highlight: inboxCount > 0 },
                { id: 'focus', name: 'Focus', icon: Target, count: focusCount, color: 'text-amber-500' },
                { id: 'waiting_for', name: 'Waiting For', icon: Hourglass, count: waitingCount, color: 'text-purple-500' },
                { id: 'all', name: 'All Items', icon: Layers },
                { id: 'notes', name: 'Notes & Docs', icon: FileText },
                { id: 'canvas', name: 'Canvas', icon: PenLine }
              ].map((item) => {
                const isActive = 
                  item.id === 'notes' ? activeView === 'notes' : 
                  item.id === 'canvas' ? activeView === 'canvas' : 
                  item.id === 'inbox' ? activeView === 'inbox' :
                  item.id === 'focus' ? activeView === 'focus' :
                  item.id === 'waiting_for' ? activeView === 'waiting_for' :
                  item.id === 'dashboard' ? activeView === 'dashboard' : 
                  (activeView === 'tasks' && activeWorkspace === item.id);

                return (
                  <button key={item.id} onClick={() => { 
                    if (item.id === 'notes') {
                      setActiveView('notes');
                    } else if (item.id === 'canvas') {
                      setActiveView('canvas');
                    } else if (item.id === 'inbox') {
                      setActiveView('inbox');
                    } else if (item.id === 'focus') {
                      setActiveView('focus');
                    } else if (item.id === 'waiting_for') {
                      setActiveView('waiting_for');
                    } else if (item.id === 'dashboard') {
                      setActiveView('dashboard');
                    } else {
                      setActiveView('tasks');
                      setActiveWorkspace(item.id);
                    }
                    if(window.innerWidth < 768) setIsSidebarOpen(false); 
                  }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative w-full flex items-center justify-between px-3 py-2 rounded-xl transition-colors group font-medium ${isActive ? 'text-gray-900 dark:text-white' : 'hover:bg-black/[0.04] dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}>
                    {isActive && <motion.span layoutId="nav-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-xl bg-white dark:bg-white/10 shadow-sm ring-1 ring-black/5 dark:ring-white/[0.04]" />}
                    <div className="relative flex items-center gap-3">
                      <item.icon size={17} className={item.color || (isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300')} />
                      <span className="text-[14px]">{item.name}</span>
                    </div>
                    {item.count !== undefined && item.count > 0 && (
                      <span className={`relative min-w-5 px-1.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums text-center ${
                        item.highlight 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-gray-300'
                      }`}>
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="space-y-6">
              {lifeContext !== 'personal' && (
                <div className="space-y-1">
                  <div className="px-3 flex items-center justify-between mb-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">Projects</h4>
                    <button onClick={() => setIsAddProjectOpen(true)} className="text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md p-1 transition-colors" title="Add Project" aria-label="Add Project"><Plus size={16}/></button>
                  </div>
                  {projects.map((project) => {
                    const isActive = activeView === 'tasks' && activeWorkspace === project.id;
                    return (
                      <div key={project.id} className="relative group/proj">
                        <button onClick={() => { setActiveView('tasks'); setActiveWorkspace(project.id); if(window.innerWidth < 768) setIsSidebarOpen(false); }}
                          aria-current={isActive ? 'page' : undefined}
                          className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${isActive ? 'text-gray-900 dark:text-white' : 'hover:bg-black/[0.04] dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}>
                          {isActive && <motion.span layoutId="nav-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-xl bg-white dark:bg-white/10 shadow-sm ring-1 ring-black/5 dark:ring-white/[0.04]" />}
                          <div className={`relative w-2 h-2 rounded-full ring-[3px] ring-black/[0.04] dark:ring-white/[0.06] ${project.color || 'bg-indigo-500'}`} />
                          <span className="relative text-[14px] truncate flex-1 text-left font-medium">{project.name}</span>
                          <span className="relative text-[10px] font-semibold tracking-wide text-gray-400 group-hover/proj:opacity-0 transition-opacity">{project.key}</span>
                        </button>
                        <button onClick={(e) => handleDeleteProject(project.id, project.name, e)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 rounded-lg opacity-0 group-hover/proj:opacity-100 transition-opacity" title="Delete Project">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )
                  })}
                  {projects.length === 0 && (
                    <div className="text-xs text-gray-400 px-3 py-2">No projects yet. Click + to add one.</div>
                  )}
                </div>
              )}

              {lifeContext !== 'work' && (
                <div className="space-y-6">
                  <div className="space-y-1">
                    <div className="px-3 flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-orange-400">Life Areas</h4>
                      <button onClick={() => setIsAddAreaOpen(true)} className="text-orange-400 hover:text-orange-600 dark:hover:text-orange-300 rounded-md p-1 transition-colors" title="Add Area" aria-label="Add Area"><Plus size={16}/></button>
                    </div>
                    {areas.map((area) => {
                      const isActive = activeView === 'tasks' && activeWorkspace === area.id;
                      return (
                        <div key={area.id} className="relative group/area">
                          <button onClick={() => { setActiveView('tasks'); setActiveWorkspace(area.id); if(window.innerWidth < 768) setIsSidebarOpen(false); }}
                            aria-current={isActive ? 'page' : undefined}
                            className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${isActive ? 'text-gray-900 dark:text-white' : 'hover:bg-black/[0.04] dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}>
                            {isActive && <motion.span layoutId="nav-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-xl bg-white dark:bg-white/10 shadow-sm ring-1 ring-black/5 dark:ring-white/[0.04]" />}
                            <div className={`relative w-2 h-2 rounded-full ring-[3px] ring-black/[0.04] dark:ring-white/[0.06] ${area.color || 'bg-purple-500'}`} />
                            <span className="relative text-[14px] truncate flex-1 text-left font-medium">{area.name}</span>
                          </button>
                          <button onClick={(e) => handleDeleteArea(area.id, area.name, e)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 rounded-lg opacity-0 group-hover/area:opacity-100 transition-opacity" title="Delete Area">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )
                    })}
                    {areas.length === 0 && (
                      <div className="text-xs text-gray-400 px-3 py-2">No life areas yet. Click + to add one.</div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="px-3 flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-orange-400">Growth & Routine</h4>
                    </div>
                    <button onClick={() => setActiveGrowthTab('goals')} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors group hover:bg-black/[0.04] dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
                      <Target size={16} className="text-blue-500" />
                      <span className="text-[14px] truncate flex-1 text-left font-medium">Goals</span>
                      <span className="text-[11px] font-semibold text-gray-400">{goals.length}</span>
                    </button>
                    <button onClick={() => setActiveGrowthTab('habits')} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors group hover:bg-black/[0.04] dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
                      <Activity size={16} className="text-emerald-500" />
                      <span className="text-[14px] truncate flex-1 text-left font-medium">Habits</span>
                      <span className="text-[11px] font-semibold text-gray-400">{habits.length}</span>
                    </button>
                    <button onClick={() => setActiveGrowthTab('notes')} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors group hover:bg-black/[0.04] dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
                      <FileText size={16} className="text-amber-500" />
                      <span className="text-[14px] truncate flex-1 text-left font-medium">Notes</span>
                      <span className="text-[11px] font-semibold text-gray-400">{notes.length}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="p-3 mt-auto border-t border-gray-200/50 dark:border-white/5">
            <div ref={settingsMenuRef} className="relative flex items-center gap-1">
              <AnimatePresence>
                {isSettingsMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    role="menu"
                    className="absolute bottom-full left-0 right-0 mb-2 p-1 rounded-xl surface-float origin-bottom z-10">
                    {[
                      { label: 'Settings & Migration', icon: Settings, onClick: () => setIsSettingsOpen?.(true) },
                      { label: 'Data & Sync', icon: Database, onClick: () => setIsDiagnosticsOpen?.(true) },
                      { label: 'Trash & Archive', icon: Trash2, onClick: () => setIsTrashOpen?.(true) },
                      { label: 'Export Backup (JSON)', icon: Download, onClick: () => { api.exportBackup(); showToast('Backup downloaded'); } },
                    ].map(entry => (
                      <button key={entry.label} role="menuitem" onClick={() => { setIsSettingsMenuOpen(false); entry.onClick(); }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                        <entry.icon size={15} className="text-gray-400" /> {entry.label}
                      </button>
                    ))}
                    <a href="https://docs.google.com/spreadsheets" target="_blank" rel="noopener noreferrer" role="menuitem" onClick={() => setIsSettingsMenuOpen(false)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                      <span className="flex items-center gap-3"><ExternalLink size={15} className="text-gray-400" /> Google Sheet</span>
                      <span className="text-[10px] text-emerald-500 font-semibold">Live</span>
                    </a>
                    <div className="px-3 pt-2 pb-1 mt-1 border-t border-gray-100 dark:border-white/5 text-[10px] font-medium text-gray-400 tracking-wide">v6.0 · Local-first</div>
                  </motion.div>
                )}
              </AnimatePresence>
              <button onClick={() => setIsSettingsMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={isSettingsMenuOpen}
                className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${isSettingsMenuOpen ? 'bg-black/[0.05] dark:bg-white/10 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-black/[0.04] dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'}`}>
                <Settings size={16} /> <span className="flex-1 text-left">Settings</span>
                <ChevronUp size={14} className={`text-gray-400 transition-transform ${isSettingsMenuOpen ? '' : 'rotate-180'}`} />
              </button>
              <button onClick={() => setIsDarkMode(!isDarkMode)} title={isDarkMode ? 'Light mode' : 'Dark mode'} aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-black/[0.04] dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors">
                {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Modal: Add Project */}
      <AnimatePresence>
        {isAddProjectOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 scrim" onClick={() => !isCreatingProj && setIsAddProjectOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#1c1c1e] w-full max-w-md rounded-3xl shadow-2xl p-6 relative z-10 space-y-4 border border-gray-100 dark:border-white/10">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">New Project</h3>
                <button onClick={() => setIsAddProjectOpen(false)}><X size={20} className="text-gray-400 hover:text-gray-600" /></button>
              </div>
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div>
                  <label className="field-label mb-1.5">Project Name</label>
                  <input autoFocus type="text" placeholder="e.g. Website Redesign, Mobile App" value={newProjName} onChange={e => {
                    setNewProjName(e.target.value);
                    if (!newProjKey) setNewProjKey(e.target.value.substring(0, 4).toUpperCase());
                  }} className="field" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="field-label mb-1.5">Key Prefix</label>
                    <input type="text" placeholder="e.g. WEB" value={newProjKey} onChange={e => setNewProjKey(e.target.value.toUpperCase())} className="field uppercase" required maxLength={6} />
                  </div>
                  <div>
                    <label className="field-label mb-1.5">Color</label>
                    <div className="flex gap-1.5 pt-1.5 flex-wrap">
                      {COLOR_OPTIONS.slice(0, 5).map(c => (
                        <div key={c} onClick={() => setNewProjColor(c)} className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${c} ${newProjColor === c ? 'ring-2 ring-blue-500 scale-110' : 'opacity-70 hover:opacity-100'}`} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setIsAddProjectOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">Cancel</button>
                  <button type="submit" disabled={isCreatingProj || !newProjName.trim()} className="px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 shadow-sm shadow-blue-600/20 transition-colors disabled:opacity-50">
                    {isCreatingProj ? <Loader2 size={16} className="animate-spin" /> : 'Create Project'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Add Life Area */}
      <AnimatePresence>
        {isAddAreaOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 scrim" onClick={() => !isCreatingArea && setIsAddAreaOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#1c1c1e] w-full max-w-md rounded-3xl shadow-2xl p-6 relative z-10 space-y-4 border border-gray-100 dark:border-white/10">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">New Life Area</h3>
                <button onClick={() => setIsAddAreaOpen(false)}><X size={20} className="text-gray-400 hover:text-gray-600" /></button>
              </div>
              <form onSubmit={handleCreateArea} className="space-y-4">
                <div>
                  <label className="field-label mb-1.5">Area Name</label>
                  <input autoFocus type="text" placeholder="e.g. Health & Fitness, Finance, Studies" value={newAreaName} onChange={e => setNewAreaName(e.target.value)} className="field field-personal" required />
                </div>
                <div>
                  <label className="field-label mb-1.5">Color Tag</label>
                  <div className="flex gap-2 pt-1 flex-wrap">
                    {COLOR_OPTIONS.map(c => (
                      <div key={c} onClick={() => setNewAreaColor(c)} className={`w-7 h-7 rounded-full cursor-pointer transition-transform ${c} ${newAreaColor === c ? 'ring-2 ring-orange-500 scale-110' : 'opacity-70 hover:opacity-100'}`} />
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setIsAddAreaOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">Cancel</button>
                  <button type="submit" disabled={isCreatingArea || !newAreaName.trim()} className="px-5 py-2 rounded-xl text-sm font-bold bg-orange-600 text-white flex items-center gap-2">
                    {isCreatingArea ? <Loader2 size={16} className="animate-spin" /> : 'Create Area'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Personal Growth (Goals, Habits, Notes) */}
      <AnimatePresence>
        {activeGrowthTab && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 scrim" onClick={() => setActiveGrowthTab(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#1c1c1e] w-full max-w-xl rounded-3xl shadow-2xl p-6 relative z-10 space-y-6 max-h-[85vh] flex flex-col border border-gray-100 dark:border-white/10">
              <div className="flex justify-between items-center">
                <div className="flex gap-2">
                  <button onClick={() => setActiveGrowthTab('goals')} className={`px-4 py-1.5 rounded-xl font-bold text-sm ${activeGrowthTab === 'goals' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400'}`}>Goals</button>
                  <button onClick={() => setActiveGrowthTab('habits')} className={`px-4 py-1.5 rounded-xl font-bold text-sm ${activeGrowthTab === 'habits' ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400'}`}>Habits</button>
                  <button onClick={() => setActiveGrowthTab('notes')} className={`px-4 py-1.5 rounded-xl font-bold text-sm ${activeGrowthTab === 'notes' ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400'}`}>Notes</button>
                </div>
                <button onClick={() => setActiveGrowthTab(null)}><X size={20} className="text-gray-400 hover:text-gray-600" /></button>
              </div>

              {/* Add form */}
              <form onSubmit={handleAddGrowthItem} className="flex gap-2">
                <input type="text" placeholder={`Add new ${activeGrowthTab.slice(0, -1)}...`} value={growthTitle} onChange={e => setGrowthTitle(e.target.value)} className="flex-1 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm font-semibold outline-none focus:border-blue-500" required />
                {activeGrowthTab === 'habits' && (
                  <input type="number" min={1} max={7} value={growthTarget} onChange={e => setGrowthTarget(Number(e.target.value))} className="w-20 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm font-semibold text-center outline-none" title="Days per week" />
                )}
                {activeGrowthTab === 'goals' && (
                  <input type="date" value={growthDate} onChange={e => setGrowthDate(e.target.value)} className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs font-semibold outline-none" />
                )}
                <button type="submit" className="px-4 py-2 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black font-bold text-sm">Add</button>
              </form>

              {/* List */}
              <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
                {activeGrowthTab === 'goals' && (
                  goals.map(g => (
                    <div key={g.id} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 flex justify-between items-center border border-gray-100 dark:border-white/5 group/gitem">
                      <div>
                        <h4 className="font-semibold text-sm text-gray-900 dark:text-white">{g.title}</h4>
                        <span className="text-xs text-gray-400">Target: {g.targetDate ? parseLocalDate(g.targetDate).toLocaleDateString() : 'Ongoing'}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-blue-500">{g.progress}%</span>
                        <input type="range" min={0} max={100} value={g.progress} onChange={async (e) => {
                          const val = Number(e.target.value);
                          await api.goals.updateProgress(g.id, val);
                          loadNavData();
                        }} className="w-24 cursor-pointer" />
                        <button onClick={(e) => handleDeleteGrowth('goals', g.id, e)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-colors" title="Delete Goal">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {activeGrowthTab === 'habits' && (
                  habits.map(h => (
                    <div key={h.id} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 flex justify-between items-center border border-gray-100 dark:border-white/5 group/hitem">
                      <div>
                        <h4 className="font-semibold text-sm text-gray-900 dark:text-white">{h.name}</h4>
                        <span className="text-xs text-gray-400">{h.history?.length || 0} / {h.targetCount || 5} days this week</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => (
                            <button key={day} onClick={async () => {
                              await api.habits.toggleDay(h.id, day);
                              loadNavData();
                            }} className={`w-7 h-7 rounded-lg text-[10px] font-semibold uppercase transition-colors ${h.history?.includes(day) ? 'bg-emerald-500 text-white' : 'bg-gray-200 dark:bg-white/10 text-gray-400'}`}>
                              {day[0]}
                            </button>
                          ))}
                        </div>
                        <button onClick={(e) => handleDeleteGrowth('habits', h.id, e)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-colors" title="Delete Habit">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {activeGrowthTab === 'notes' && (
                  notes.map(n => (
                    <div key={n.id} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 flex justify-between items-start border border-gray-100 dark:border-white/5 group/nitem">
                      <div>
                        <h4 className="font-semibold text-sm text-gray-900 dark:text-white">{n.title}</h4>
                        <p className="text-xs text-gray-500 mt-1">{n.content || 'No content yet'}</p>
                      </div>
                      <button onClick={(e) => handleDeleteGrowth('notes', n.id, e)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-colors" title="Delete Note">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
                )}

                {((activeGrowthTab === 'goals' && goals.length === 0) || (activeGrowthTab === 'habits' && habits.length === 0) || (activeGrowthTab === 'notes' && notes.length === 0)) && (
                  <div className="text-center text-gray-400 py-8 text-sm">No items yet. Add one above!</div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
