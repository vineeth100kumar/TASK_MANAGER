import React from 'react';
import {
  CalendarCheck,
  ListTodo,
  Folder,
  Wallet,
  Settings,
  Search,
  Plus,
  Sun,
  Moon,
  Sunrise,
  Sunset,
  RotateCcw,
  RotateCw,
  CloudOff,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';

export type NavTabId = 'dashboard' | 'tasks' | 'whiteboard' | 'projects' | 'finance' | 'shortcuts';

/*
 * Four tabs, named for what they hold.
 *
 * The whiteboard is not here on purpose: it already takes a project id, so it
 * opens from a project rather than sitting in the bar as a sixth destination.
 * Shortcuts moved to Settings in the top bar — it is something you set up once,
 * not somewhere you go daily.
 */
export const NAV_TABS: {
  id: NavTabId;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'dashboard', label: 'Today', icon: CalendarCheck },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'finance', label: 'Money', icon: Wallet },
];

interface NavbarProps {
  activeTab: NavTabId;
  setActiveTab: (tab: NavTabId) => void;
  isLiveConnected: boolean;
  isSyncing?: boolean;
  onOpenQuickCapture: () => void;
  onOpenSearch?: () => void;
  onOpenWizard?: (mode?: 'morning' | 'evening') => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  undoTooltip?: string;
  redoTooltip?: string;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

const iconButton =
  'w-9 h-9 flex items-center justify-center rounded-control text-ink-2 ' +
  'hover:text-ink hover:bg-sunken active:scale-95 transition-all duration-200 ease-spring';

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  isLiveConnected,
  isSyncing = false,
  onOpenQuickCapture,
  onOpenSearch,
  onOpenWizard,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  undoTooltip = '',
  redoTooltip = '',
  theme = 'light',
  onToggleTheme,
}) => {
  const isEvening = new Date().getHours() >= 17 || new Date().getHours() < 5;

  /*
   * Connection state is shown only when it needs attention. A permanent green
   * "connected" badge is noise — you only care when it stops being true.
   */
  const statusPill =
    isSyncing ? (
      <span className="flex items-center gap-1.5 text-caption text-ink-3" title="Saving to the Pi">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span className="hidden sm:inline">Saving</span>
      </span>
    ) : !isLiveConnected ? (
      <span className="flex items-center gap-1.5 text-caption text-late-500 dark:text-late-400" title="Reconnecting to the Pi">
        <CloudOff className="w-3.5 h-3.5" />
        <span>Offline</span>
      </span>
    ) : null;

  return (
    <>
      {/* ---------- Mobile: slim action strip. Each screen owns its own title. ---------- */}
      <header className="md:hidden sticky top-0 z-40 bg-ground/85 backdrop-blur-xl border-b border-hairline pt-safe">
        <div className="flex items-center justify-between px-2 h-12">
          <div className="flex items-center gap-2 pl-2">
            <span className="text-meta font-semibold text-ink-3">Sage</span>
            {statusPill}
          </div>

          <div className="flex items-center gap-0.5">
            {onUndo && canUndo && (
              <button onClick={onUndo} className={iconButton} aria-label={`Undo ${undoTooltip || 'last action'}`}>
                <RotateCcw className="w-[18px] h-[18px]" />
              </button>
            )}
            {onOpenSearch && (
              <button onClick={onOpenSearch} className={iconButton} aria-label="Search">
                <Search className="w-[18px] h-[18px]" />
              </button>
            )}
            {onOpenWizard && (
              <button
                onClick={() => onOpenWizard(isEvening ? 'evening' : 'morning')}
                className={iconButton}
                aria-label={isEvening ? 'Evening review' : 'Morning plan'}
              >
                {isEvening ? <Sunset className="w-[18px] h-[18px]" /> : <Sunrise className="w-[18px] h-[18px]" />}
              </button>
            )}
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                className={iconButton}
                aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              >
                {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
              </button>
            )}
            <button
              onClick={() => setActiveTab('shortcuts')}
              className={`${iconButton} ${activeTab === 'shortcuts' ? 'text-accent-500' : ''}`}
              aria-label="Settings"
            >
              <Settings className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </header>

      {/* ---------- Desktop ---------- */}
      <header className="hidden md:flex items-center justify-between gap-6 px-6 h-14 sticky top-0 z-40 bg-ground/85 backdrop-blur-xl border-b border-hairline">
        <div className="flex items-center gap-7 min-w-0">
          <span className="text-lead font-semibold tracking-tight text-ink shrink-0">Sage</span>

          <nav className="flex items-center gap-1">
            {NAV_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-control text-meta font-medium transition-colors duration-150 ${
                    isActive ? 'bg-sunken text-ink' : 'text-ink-2 hover:text-ink hover:bg-sunken/60'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {statusPill}

          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              className="flex items-center gap-2 pl-3 pr-2 h-9 rounded-control bg-sunken text-ink-3 hover:text-ink-2 text-meta transition-colors"
            >
              <Search className="w-4 h-4" />
              <span>Search</span>
              <kbd className="text-caption text-ink-3 border border-hairline rounded px-1 py-px">⌘K</kbd>
            </button>
          )}

          <div className="flex items-center">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title={canUndo ? `Undo ${undoTooltip}` : 'Nothing to undo'}
              aria-label={canUndo ? `Undo ${undoTooltip}` : 'Nothing to undo'}
              className={`${iconButton} disabled:opacity-25 disabled:pointer-events-none`}
            >
              <RotateCcw className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              title={canRedo ? `Redo ${redoTooltip}` : 'Nothing to redo'}
              aria-label={canRedo ? `Redo ${redoTooltip}` : 'Nothing to redo'}
              className={`${iconButton} disabled:opacity-25 disabled:pointer-events-none`}
            >
              <RotateCw className="w-[18px] h-[18px]" />
            </button>
          </div>

          {onOpenWizard && (
            <button
              onClick={() => onOpenWizard(isEvening ? 'evening' : 'morning')}
              className={iconButton}
              title={isEvening ? 'Evening review' : 'Morning plan'}
              aria-label={isEvening ? 'Evening review' : 'Morning plan'}
            >
              {isEvening ? <Sunset className="w-[18px] h-[18px]" /> : <Sunrise className="w-[18px] h-[18px]" />}
            </button>
          )}

          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              className={iconButton}
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            >
              {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
            </button>
          )}

          <button
            onClick={() => setActiveTab('shortcuts')}
            className={`${iconButton} ${activeTab === 'shortcuts' ? 'text-accent-500' : ''}`}
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>

          <button
            onClick={onOpenQuickCapture}
            className="flex items-center gap-1.5 h-9 pl-2.5 pr-3.5 rounded-control bg-accent-500 hover:bg-accent-600 text-white text-meta font-medium active:scale-[0.98] transition-all duration-200 ease-spring"
          >
            <Plus className="w-4 h-4" />
            <span>Add</span>
          </button>
        </div>
      </header>

      {/*
        ---------- Mobile bottom: capture, then four tabs ----------
        Capture is the most-used action in the app, so it sits as a full-width
        row where the thumb already is — not as a floating blob covering content.
      */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-ground/90 backdrop-blur-xl border-t border-hairline pb-safe">
        <button
          onClick={onOpenQuickCapture}
          className="mx-3 mt-2 mb-1 w-[calc(100%-1.5rem)] flex items-center gap-2.5 px-3.5 h-11 rounded-control bg-sunken text-ink-3 text-body active:scale-[0.99] transition-transform duration-200 ease-spring"
        >
          <Plus className="w-[18px] h-[18px] text-accent-500" />
          <span>Add to today</span>
        </button>

        <nav className="flex items-stretch justify-around px-1 pb-1">
          {NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
                className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-tap py-1.5 transition-colors duration-150 ${
                  isActive ? 'text-accent-500' : 'text-ink-3'
                }`}
              >
                <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.2 : 1.9} />
                <span className="text-caption">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
};
