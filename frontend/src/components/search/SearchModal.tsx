import React, { useState, useEffect, useRef } from 'react';
import { Search, CheckSquare, Folder, Wallet, Sparkles, Sun, Moon, ArrowRight, BookOpen } from 'lucide-react';
import { WorkItem, Project, Transaction } from '../../types';
import { Modal } from '../common/Modal';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: WorkItem[];
  projects: Project[];
  transactions?: Transaction[];
  onSelectTask?: (task: WorkItem) => void;
  onSelectProject?: (projectId: string) => void;
  onNavigateTab?: (tab: 'dashboard' | 'tasks' | 'projects' | 'finance' | 'shortcuts') => void;
  onOpenWizard?: (mode: 'morning' | 'evening') => void;
  onOpenBrainDump?: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  tasks,
  projects,
  transactions = [],
  onSelectTask,
  onSelectProject,
  onNavigateTab,
  onOpenWizard,
  onOpenBrainDump
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const q = query.toLowerCase().trim();

  // Filter Tasks
  const matchedTasks = tasks
    .filter(t => t.title.toLowerCase().includes(q))
    .slice(0, 5);

  // Filter Projects
  const matchedProjects = projects
    .filter(p => p.name.toLowerCase().includes(q))
    .slice(0, 3);

  // Actions
  const actions = [
    { id: 'act_brain_dump', title: 'Quick capture', category: 'Capture', icon: <Sparkles className="w-4 h-4 text-amber-500" />, onSelect: () => onOpenBrainDump?.() },
    { id: 'act_morning', title: 'Morning Edition — Daily Kickoff', category: 'Routine', icon: <Sun className="w-4 h-4 text-amber-500" />, onSelect: () => onOpenWizard?.('morning') },
    { id: 'act_evening', title: 'Evening review', category: 'Routine', icon: <Moon className="w-4 h-4 text-indigo-400" />, onSelect: () => onOpenWizard?.('evening') },
    { id: 'act_nav_tasks', title: 'Tasks', category: 'Go to', icon: <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />, onSelect: () => onNavigateTab?.('tasks') },
    { id: 'act_nav_projects', title: 'Section IV — Dossiers & Projects Hub', category: 'Go to', icon: <Folder className="w-4 h-4 text-purple-600 dark:text-purple-400" />, onSelect: () => onNavigateTab?.('projects') },
    { id: 'act_nav_finance', title: 'Money', category: 'Go to', icon: <Wallet className="w-4 h-4 text-amber-600 dark:text-amber-400" />, onSelect: () => onNavigateTab?.('finance') }
  ].filter(a => !q || a.title.toLowerCase().includes(q));

  const allResults = [
    ...matchedTasks.map(t => ({
      type: 'docket' as const,
      id: t.id,
      title: t.title,
      sub: t.due_date ? `Due ${t.due_date}` : 'Unscheduled bg-surface',
      icon: <CheckSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
      action: () => onSelectTask?.(t)
    })),
    ...matchedProjects.map(p => ({
      type: 'dossier' as const,
      id: p.id,
      title: p.name,
      sub: `${p.total_task_count || 0} items filed`,
      icon: <Folder className="w-4 h-4" style={{ color: p.color || '#d97706' }} />,
      action: () => {
        onNavigateTab?.('projects');
        onSelectProject?.(p.id);
      }
    })),
    ...actions.map(a => ({
      type: 'action' as const,
      id: a.id,
      title: a.title,
      sub: a.category,
      icon: a.icon,
      action: a.onSelect
    }))
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, allResults.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + allResults.length) % Math.max(1, allResults.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = allResults[selectedIndex];
      if (item) {
        item.action();
        onClose();
      }
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="xl" hideCloseButton>
      <div className="space-y-3" onKeyDown={handleKeyDown}>
        {/* Newspaper Archive Registry Header */}
        <div className="flex items-center justify-between border-b border-ink-base/15 dark:border-paper-light/15 pb-2 px-1">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-ink-muted dark:text-stone-400" />
            <span className="text-caption text-ink-muted dark:text-stone-400 font-bold">
              THE SAGE DAILY • ARCHIVE & INDEX REGISTRY
            </span>
          </div>
          <kbd className="hidden sm:inline text-caption px-1.5 py-0.5 rounded border border-ink-base/20 dark:border-paper-light/20 bg-paper-aged dark:bg-stone-800 text-ink-muted dark:text-stone-400">
            ESC TO DISMISS
          </kbd>
        </div>

        {/* Search Input Bar */}
        <div className="flex items-center space-x-3 px-3.5 py-2.5 rounded-lg bg-paper-aged/50 dark:bg-black/40 border border-ink-base/20 dark:border-paper-light/15">
          <Search className="w-4 h-4 text-ink-muted dark:text-stone-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search action dockets, dossiers, or press commands... (Cmd+K)"
            className="flex-1 bg-transparent text-meta sm:text-sm text-ink-base dark:text-paper-light placeholder-ink-muted/50 dark:placeholder-stone-500 focus:outline-none"
          />
        </div>

        {/* Results List */}
        <div className="max-h-[380px] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
          {allResults.length === 0 ? (
            <div className="text-center py-8 text-meta italic text-ink-muted dark:text-stone-500">
              No archival records matching "{query}"
            </div>
          ) : (
            allResults.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => {
                  item.action();
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-colors border ${
                  selectedIndex === idx
                    ? 'bg-paper-aged/70 dark:bg-stone-800/80 border-ink-base/30 dark:border-stone-600 text-ink-base dark:text-paper-light shadow-sm'
                    : 'border-transparent text-ink-muted dark:text-stone-300 hover:bg-paper-aged/40 dark:hover:bg-stone-800/40'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-7 h-7 rounded border border-ink-base/15 dark:border-stone-700 bg-paper-white dark:bg-stone-900 flex items-center justify-center shrink-0">
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-meta font-bold truncate text-ink-base dark:text-paper-light">{item.title}</p>
                    <p className="text-caption text-ink-muted dark:text-stone-400">{item.sub}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 text-ink-muted dark:text-stone-400">
                  <span className="text-caption px-1.5 py-0.5 rounded border border-ink-base/20 dark:border-stone-700 bg-paper-aged dark:bg-stone-900">
                    {item.type}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 opacity-60" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
};
