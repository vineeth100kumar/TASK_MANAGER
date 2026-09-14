import React from 'react';
import { 
  LayoutDashboard, 
  CheckSquare, 
  Folder, 
  Wallet, 
  Smartphone, 
  Sparkles, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Sun, 
  Moon, 
  RotateCcw, 
  RotateCw,
  Search,
  PenTool
} from 'lucide-react';
import { APP_VERSION } from '../../version';

export type NavTabId = 'dashboard' | 'tasks' | 'whiteboard' | 'projects' | 'finance' | 'shortcuts';

export const NAV_TABS: { id: NavTabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Today', icon: LayoutDashboard },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'whiteboard', label: 'Draw', icon: PenTool },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'finance', label: 'Finance', icon: Wallet },
  { id: 'shortcuts', label: 'Siri & Pi', icon: Smartphone },
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
}

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
  redoTooltip = ''
}) => {
  const currentHour = new Date().getHours();
  const isEvening = currentHour >= 17 || currentHour < 5;

  return (
    <>
      {/* Mobile Top Navigation Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white text-xs shadow-lg shadow-blue-500/20">
            S
          </div>
          <div>
            <span className="font-semibold text-zinc-100 text-sm tracking-tight">Sage OS</span>
            <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">RPi5</span>
            <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono font-semibold border border-blue-500/20">{APP_VERSION}</span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          {/* Global Search Button */}
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              aria-label="Search and Command Palette (Ctrl+K)"
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg border bg-zinc-800/80 text-zinc-300 border-zinc-700/60 active:scale-95 transition-all"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Undo Button */}
          {onUndo && canUndo && (
            <button
              onClick={onUndo}
              aria-label={`Undo: ${undoTooltip || 'Last action'}`}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg border bg-zinc-800/80 text-blue-400 border-blue-500/30 active:scale-95 transition-all"
              title={`Undo: ${undoTooltip || 'Last action'}`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Morning / Evening Wizard Launcher */}
          {onOpenWizard && (
            <button
              onClick={() => onOpenWizard(isEvening ? 'evening' : 'morning')}
              aria-label={isEvening ? "Evening Debrief" : "Morning Kickoff"}
              className={`p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg border ${
                isEvening ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }`}
              title={isEvening ? "Evening Debrief" : "Morning Kickoff"}
            >
              {isEvening ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
            </button>
          )}

          {/* Unified Mobile Status Cluster */}
          <div className="flex items-center space-x-1.5 pl-1">
            {isSyncing && (
              <div 
                title="Saving changes in background to Raspberry Pi..."
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono border bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse"
              >
                <RefreshCw className="w-2.5 h-2.5 animate-spin text-blue-400" />
              </div>
            )}
            <div 
              title={isLiveConnected ? "Connected live to Raspberry Pi 5" : "Reconnecting to Pi 5..."}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                isLiveConnected 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {isLiveConnected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5 animate-pulse" />}
              <span>{isLiveConnected ? 'RPi5' : 'Offline'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Desktop Top Navigation Bar */}
      <header className="hidden md:flex items-center justify-between px-6 py-3 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
              S
            </div>
            <div>
              <span className="font-semibold text-zinc-100 text-sm tracking-tight">Sage OS</span>
              <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">RPi5</span>
              <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono font-semibold border border-blue-500/20">{APP_VERSION}</span>
            </div>
          </div>

          {/* Unified Desktop Tab Links */}
          <nav className="flex items-center space-x-1">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center space-x-2.5">
          {/* Desktop Search Button */}
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-all"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search...</span>
              <kbd className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">Cmd+K</kbd>
            </button>
          )}

          {/* Morning / Evening Wizard */}
          {onOpenWizard && (
            <button
              onClick={() => onOpenWizard(isEvening ? 'evening' : 'morning')}
              title={isEvening ? "Open Evening Debrief Wizard" : "Open Morning Kickoff Wizard"}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                isEvening
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-600/30'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30'
              }`}
            >
              {isEvening ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
              <span>{isEvening ? 'Evening Debrief' : 'Morning Kickoff'}</span>
            </button>
          )}

          {/* Undo / Redo Global Controls */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 shadow-sm">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              aria-label={canUndo ? `Undo: ${undoTooltip} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)'}
              title={canUndo ? `Undo: ${undoTooltip} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)'}
              className={`p-1.5 rounded-md transition-all ${
                canUndo
                  ? 'text-zinc-300 hover:text-white hover:bg-zinc-800 active:scale-95 cursor-pointer'
                  : 'text-zinc-600 cursor-not-allowed opacity-40'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <div className="w-[1px] h-3.5 bg-zinc-800 mx-0.5" />
            <button
              onClick={onRedo}
              disabled={!canRedo}
              aria-label={canRedo ? `Redo: ${redoTooltip} (Ctrl+Y)` : 'Nothing to redo (Ctrl+Y)'}
              title={canRedo ? `Redo: ${redoTooltip} (Ctrl+Y)` : 'Nothing to redo (Ctrl+Y)'}
              className={`p-1.5 rounded-md transition-all ${
                canRedo
                  ? 'text-zinc-300 hover:text-white hover:bg-zinc-800 active:scale-95 cursor-pointer'
                  : 'text-zinc-600 cursor-not-allowed opacity-40'
              }`}
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Capture (AI Brain Dump) */}
          <button
            onClick={onOpenQuickCapture}
            aria-label="AI Brain Dump Quick Capture (Ctrl+B)"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 text-xs font-medium transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Brain Dump</span>
          </button>

          {/* Unified Desktop Status Cluster */}
          <div className="flex items-center space-x-2">
            {isSyncing && (
              <div 
                title="Saving changes in background to Raspberry Pi..."
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-sm shadow-blue-500/10 animate-in fade-in"
              >
                <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />
                <span>Saving...</span>
              </div>
            )}
            <div 
              title={isLiveConnected ? "Connected live to Raspberry Pi 5" : "Reconnecting to Pi 5..."}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border ${
                isLiveConnected 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {isLiveConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3 animate-pulse" />}
              <span>{isLiveConnected ? 'RPi5 Live' : 'Connecting'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* iOS & Mobile Bottom Tab Navigation (Consolidated & 44pt Tap Targets) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/80 pb-safe">
        <div className="flex items-center justify-around py-1.5">
          {NAV_TABS.slice(0, 3).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
                className={`flex flex-col items-center justify-center min-w-[44px] min-h-[44px] py-1 px-1.5 transition-colors ${
                  isActive ? 'text-blue-500 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] mt-0.5">{tab.label}</span>
              </button>
            );
          })}

          {/* Quick Capture Floating Button */}
          <button
            onClick={onOpenQuickCapture}
            aria-label="AI Brain Dump Quick Capture"
            className="flex items-center justify-center w-11 h-11 -mt-4 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-500/40 active:scale-95 transition-transform"
          >
            <Sparkles className="w-5 h-5" />
          </button>

          {NAV_TABS.slice(3).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
                className={`flex flex-col items-center justify-center min-w-[44px] min-h-[44px] py-1 px-1.5 transition-colors ${
                  isActive ? 'text-blue-500 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] mt-0.5">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
