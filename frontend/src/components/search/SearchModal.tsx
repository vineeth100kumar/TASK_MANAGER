import React, { useState, useEffect, useRef } from 'react';
import { Search, CheckSquare, Folder, Wallet, Sparkles, Sun, Moon, ArrowRight, X } from 'lucide-react';
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
    { id: 'act_brain_dump', title: 'Open AI Brain Dump', category: 'Action', icon: <Sparkles className="w-4 h-4 text-blue-400" />, onSelect: () => onOpenBrainDump?.() },
    { id: 'act_morning', title: 'Start Morning Kickoff Wizard', category: 'Action', icon: <Sun className="w-4 h-4 text-amber-400" />, onSelect: () => onOpenWizard?.('morning') },
    { id: 'act_evening', title: 'Start Evening Debrief Wizard', category: 'Action', icon: <Moon className="w-4 h-4 text-indigo-400" />, onSelect: () => onOpenWizard?.('evening') },
    { id: 'act_nav_tasks', title: 'Go to Tasks & Events', category: 'Navigation', icon: <CheckSquare className="w-4 h-4 text-emerald-400" />, onSelect: () => onNavigateTab?.('tasks') },
    { id: 'act_nav_projects', title: 'Go to Projects Hub', category: 'Navigation', icon: <Folder className="w-4 h-4 text-purple-400" />, onSelect: () => onNavigateTab?.('projects') },
    { id: 'act_nav_finance', title: 'Go to Finance Tracker', category: 'Navigation', icon: <Wallet className="w-4 h-4 text-amber-400" />, onSelect: () => onNavigateTab?.('finance') }
  ].filter(a => !q || a.title.toLowerCase().includes(q));

  const allResults = [
    ...matchedTasks.map(t => ({
      type: 'task' as const,
      id: t.id,
      title: t.title,
      sub: t.due_date ? `Due ${t.due_date}` : 'No date',
      icon: <CheckSquare className="w-4 h-4 text-blue-400" />,
      action: () => onSelectTask?.(t)
    })),
    ...matchedProjects.map(p => ({
      type: 'project' as const,
      id: p.id,
      title: p.name,
      sub: `${p.total_task_count || 0} tasks`,
      icon: <Folder className="w-4 h-4" style={{ color: p.color || '#3b82f6' }} />,
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
        {/* Search Input Bar */}
        <div className="flex items-center space-x-3 px-3 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <Search className="w-5 h-5 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search tasks, projects, or actions... (Cmd+K)"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">ESC</kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[380px] overflow-y-auto space-y-1 pr-1">
          {allResults.length === 0 ? (
            <div className="text-center py-8 text-xs text-zinc-500">
              No results found for "{query}"
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
                className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-colors ${
                  selectedIndex === idx ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{item.title}</p>
                    <p className="text-[10px] text-zinc-500">{item.sub}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 text-zinc-500">
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
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
