import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard, Inbox, Target, Layers, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { useDataChanges } from '../../hooks/useDataChanges';

interface MobileTabBarProps {
  activeView: string;
  activeWorkspace: string;
  lifeContext?: 'work' | 'personal';
  onNavigate: (view: string) => void;
  onCreate: () => void;
}

const TABS = [
  { id: 'dashboard', label: 'Today', icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'create', label: 'Add', icon: Plus },
  { id: 'focus', label: 'Focus', icon: Target },
  { id: 'all', label: 'All Items', icon: Layers },
];

// Bottom navigation shown only on phones (below the md breakpoint).
export function MobileTabBar({ activeView, activeWorkspace, lifeContext, onNavigate, onCreate }: MobileTabBarProps) {
  const [inboxCount, setInboxCount] = useState(0);

  const loadCount = async () => {
    try {
      const inbox = await api.inbox.list(lifeContext);
      setInboxCount(inbox.length);
    } catch { /* count is decorative */ }
  };
  useEffect(() => { loadCount(); }, [lifeContext]);
  useDataChanges(loadCount);

  const isActive = (id: string) =>
    id === 'all' ? activeView === 'tasks' && activeWorkspace === 'all' : activeView === id;

  return (
    <nav aria-label="Primary" className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-gray-200/70 dark:border-white/[0.08] bg-white/85 dark:bg-[#141416]/85 backdrop-blur-2xl shadow-[0_-8px_24px_-16px_rgb(16_24_40/0.12)] dark:shadow-none backdrop-saturate-150 pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-5 h-16">
        {TABS.map(tab => {
          if (tab.id === 'create') {
            return (
              <div key={tab.id} className="flex items-center justify-center">
                <button onClick={onCreate} aria-label="Add item" className={`w-12 h-12 rounded-2xl bg-gradient-to-b text-white shadow-lg ring-1 ring-inset ring-white/20 flex items-center justify-center active:scale-90 transition-transform duration-200 ${lifeContext === 'personal' ? 'from-orange-400 to-orange-600 shadow-orange-600/30' : 'from-blue-500 to-blue-700 shadow-blue-600/30'}`}>
                  <Plus size={24} />
                </button>
              </div>
            );
          }
          const active = isActive(tab.id);
          const accent = lifeContext === 'personal' ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400';
          return (
            <button key={tab.id} onClick={() => onNavigate(tab.id)} aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium tracking-[-0.005em] transition-colors active:scale-95 ${active ? accent : 'text-gray-500 dark:text-gray-400'}`}>
              {active && <motion.span layoutId="tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} className="absolute top-0 h-[3px] w-8 rounded-b-full bg-current" />}
              <span className="relative">
                <tab.icon size={22} strokeWidth={active ? 2.25 : 1.75} />
                {tab.id === 'inbox' && inboxCount > 0 && (
                  <span className={`absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full ${lifeContext === 'personal' ? 'bg-orange-500' : 'bg-blue-600'} text-white text-[10px] font-semibold flex items-center justify-center tabular-nums ring-2 ring-white dark:ring-[#141416]`}>
                    {inboxCount > 99 ? '99+' : inboxCount}
                  </span>
                )}
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
