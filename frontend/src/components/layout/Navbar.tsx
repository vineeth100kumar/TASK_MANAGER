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

export const NAV_TABS: { id: NavTabId; label: string; sectionNum: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Front Page', sectionNum: 'I', icon: LayoutDashboard },
  { id: 'tasks', label: 'Clippings', sectionNum: 'II', icon: CheckSquare },
  { id: 'whiteboard', label: 'Drafting Room', sectionNum: 'III', icon: PenTool },
  { id: 'projects', label: 'Projects', sectionNum: 'IV', icon: Folder },
  { id: 'finance', label: 'The Ledger', sectionNum: 'V', icon: Wallet },
  { id: 'shortcuts', label: 'Wire & Siri', sectionNum: 'VI', icon: Smartphone },
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
  edition?: 'day' | 'night';
  onToggleEdition?: () => void;
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
  redoTooltip = '',
  edition = 'day',
  onToggleEdition,
}) => {
  const currentHour = new Date().getHours();
  const isEvening = currentHour >= 17 || currentHour < 5;

  return (
    <>
      {/* Mobile Top Navigation Header */}
      <header className="md:hidden flex items-center justify-between px-3.5 py-2 border-b-2 border-stone-800 bg-[#0d0d10] sticky top-0 z-40">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-none bg-amber-600 border border-amber-400 flex items-center justify-center font-masthead font-black text-stone-950 text-xs">
            S
          </div>
          <div>
            <span className="font-masthead font-bold text-stone-100 text-xs tracking-wider uppercase">The Sage Daily</span>
            <span className="text-[9px] ml-1.5 px-1 py-0.2 rounded-none bg-stone-900 text-amber-500 font-ledger border border-stone-800">{APP_VERSION}</span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          {/* Global Search Button */}
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              aria-label="Search and Command Palette (Ctrl+K)"
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-none border border-stone-700 bg-stone-900 text-stone-300 active:scale-95 transition-all"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Undo Button */}
          {onUndo && canUndo && (
            <button
              onClick={onUndo}
              aria-label={`Undo: ${undoTooltip || 'Last action'}`}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-none border border-amber-600/50 bg-stone-900 text-amber-400 active:scale-95 transition-all"
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
              className={`p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-none border ${
                isEvening ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700' : 'bg-amber-950/60 text-amber-300 border-amber-700'
              }`}
              title={isEvening ? "Evening Debrief" : "Morning Kickoff"}
            >
              {isEvening ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
            </button>
          )}

          {/* Day / Night Edition Toggle */}
          {onToggleEdition && (
            <button
              onClick={onToggleEdition}
              aria-label={`Switch to ${edition === 'day' ? 'Night' : 'Day'} edition`}
              title={`Current: ${edition === 'day' ? 'Day' : 'Night'} Edition. Click to switch.`}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-none border border-stone-700 bg-stone-900 text-stone-200 text-xs font-ledger uppercase tracking-wider active:scale-95 transition-all"
            >
              <span>{edition === 'day' ? '🌙' : '☀️'}</span>
            </button>
          )}

          {/* Unified Mobile Status Cluster */}
          <div className="flex items-center space-x-1 pl-1">
            {isSyncing && (
              <div 
                title="Saving changes to Pi 5..."
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded-none text-[9px] font-ledger border border-amber-600/40 bg-amber-950/40 text-amber-400 animate-pulse"
              >
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              </div>
            )}
            <div 
              title={isLiveConnected ? "Connected live to Raspberry Pi 5" : "Reconnecting to Pi 5..."}
              className={`flex items-center space-x-1 px-1.5 py-0.5 rounded-none text-[9px] font-ledger border ${
                isLiveConnected 
                  ? 'bg-stone-900 text-emerald-400 border-stone-800' 
                  : 'bg-amber-950/40 text-amber-400 border-amber-800'
              }`}
            >
              {isLiveConnected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5 animate-pulse" />}
              <span>{isLiveConnected ? 'RPi5' : 'OFFLINE'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Desktop Top Navigation Bar (Broadsheet Section Ribbon) */}
      <header className="hidden md:flex items-center justify-between px-6 py-2.5 border-b-2 border-stone-800 bg-[#0c0c0e] sticky top-0 z-40">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-none bg-amber-600 border border-amber-400 flex items-center justify-center font-masthead font-black text-stone-950 text-sm">
              S
            </div>
            <div>
              <div className="font-masthead font-black text-stone-100 text-sm tracking-wider uppercase">The Sage Daily</div>
              <div className="text-[9px] font-ledger text-stone-400 uppercase tracking-widest">
                VOL. II &bull; RPi5 &bull; {APP_VERSION}
              </div>
            </div>
          </div>

          {/* Unified Desktop Tab Links (Broadsheet Sections) */}
          <nav className="flex items-center space-x-1">
            {NAV_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-none text-xs font-ledger uppercase tracking-wider transition-colors border ${
                    isActive
                      ? 'bg-stone-100 text-stone-950 font-bold border-stone-100'
                      : 'text-stone-400 hover:text-stone-200 hover:bg-stone-900 border-transparent hover:border-stone-800'
                  }`}
                >
                  <span className={isActive ? 'text-amber-700 font-bold' : 'text-stone-500'}>{tab.sectionNum}.</span>
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
              className="flex items-center space-x-2 px-2.5 py-1.5 rounded-none bg-stone-900 hover:bg-stone-800 border border-stone-700 text-stone-300 text-xs font-ledger transition-colors"
            >
              <Search className="w-3.5 h-3.5 text-stone-400" />
              <span>SEARCH...</span>
              <kbd className="text-[9px] bg-stone-800 border border-stone-700 text-stone-400 px-1 py-0.5 rounded-none font-ledger">⌘K</kbd>
            </button>
          )}

          {/* Morning / Evening Wizard */}
          {onOpenWizard && (
            <button
              onClick={() => onOpenWizard(isEvening ? 'evening' : 'morning')}
              title={isEvening ? "Open Evening Debrief Wizard" : "Open Morning Kickoff Wizard"}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-none border text-xs font-ledger uppercase tracking-wider transition-colors ${
                isEvening
                  ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700 hover:bg-indigo-900/60'
                  : 'bg-amber-950/60 text-amber-300 border-amber-700 hover:bg-amber-900/60'
              }`}
            >
              {isEvening ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
              <span>{isEvening ? 'Evening Debrief' : 'Morning Kickoff'}</span>
            </button>
          )}

          {/* Undo / Redo Global Controls */}
          <div className="flex items-center bg-stone-900 border border-stone-800 rounded-none p-0.5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              aria-label={canUndo ? `Undo: ${undoTooltip} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)'}
              title={canUndo ? `Undo: ${undoTooltip} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)'}
              className={`p-1.5 rounded-none transition-colors ${
                canUndo
                  ? 'text-stone-300 hover:text-white hover:bg-stone-800 active:scale-95 cursor-pointer'
                  : 'text-stone-600 cursor-not-allowed opacity-30'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <div className="w-[1px] h-3.5 bg-stone-800 mx-0.5" />
            <button
              onClick={onRedo}
              disabled={!canRedo}
              aria-label={canRedo ? `Redo: ${redoTooltip} (Ctrl+Y)` : 'Nothing to redo (Ctrl+Y)'}
              title={canRedo ? `Redo: ${redoTooltip} (Ctrl+Y)` : 'Nothing to redo (Ctrl+Y)'}
              className={`p-1.5 rounded-none transition-colors ${
                canRedo
                  ? 'text-stone-300 hover:text-white hover:bg-stone-800 active:scale-95 cursor-pointer'
                  : 'text-stone-600 cursor-not-allowed opacity-30'
              }`}
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Capture (The Wire) */}
          <button
            onClick={onOpenQuickCapture}
            aria-label="The Wire Quick Capture (Ctrl+B)"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-none bg-amber-600 hover:bg-amber-500 text-stone-950 border border-amber-500 text-xs font-ledger font-bold uppercase tracking-wider transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-stone-950" />
            <span>The Wire</span>
          </button>

          {/* Day / Night Edition Toggle */}
          {onToggleEdition && (
            <button
              onClick={onToggleEdition}
              aria-label={`Switch to ${edition === 'day' ? 'Night' : 'Day'} edition`}
              title={`Current: ${edition === 'day' ? 'Day' : 'Night'} Edition. Click to switch.`}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-none border border-stone-700 bg-stone-900 hover:bg-stone-800 text-stone-300 hover:text-white text-xs font-ledger uppercase tracking-wider transition-colors cursor-pointer"
            >
              <span>{edition === 'day' ? '🌙 Night ed.' : '☀️ Day ed.'}</span>
            </button>
          )}

          {/* Unified Desktop Status Cluster */}
          <div className="flex items-center space-x-1.5 font-ledger text-[10px] uppercase">
            {isSyncing && (
              <div 
                title="Saving changes in background to Raspberry Pi..."
                className="flex items-center space-x-1.5 px-2 py-1 rounded-none border border-amber-600/40 bg-amber-950/40 text-amber-400"
              >
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>SYNC</span>
              </div>
            )}
            <div 
              title={isLiveConnected ? "Connected live to Raspberry Pi 5" : "Reconnecting to Pi 5..."}
              className={`flex items-center space-x-1.5 px-2 py-1 rounded-none border ${
                isLiveConnected 
                  ? 'bg-stone-900 text-emerald-400 border-stone-800' 
                  : 'bg-amber-950/40 text-amber-400 border-amber-800'
              }`}
            >
              {isLiveConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3 animate-pulse" />}
              <span>{isLiveConnected ? 'RPi5 Live' : 'Offline'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* iOS & Mobile Bottom Tab Navigation (Consolidated & 44pt Tap Targets) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0d0d10] border-t-2 border-stone-800 pb-safe">
        <div className="flex items-center justify-around py-1">
          {NAV_TABS.slice(0, 3).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
                className={`flex flex-col items-center justify-center min-w-[44px] min-h-[44px] py-1 px-1 transition-colors ${
                  isActive ? 'text-amber-500 font-bold' : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-[9px] font-ledger uppercase tracking-wider mt-0.5">{tab.label}</span>
              </button>
            );
          })}

          {/* The Wire Quick Capture Button */}
          <button
            onClick={onOpenQuickCapture}
            aria-label="The Wire Quick Capture"
            className="flex items-center justify-center w-11 h-11 -mt-3 rounded-none bg-amber-600 border border-amber-400 text-stone-950 active:scale-95 transition-transform"
          >
            <Sparkles className="w-5 h-5 stroke-[2.5]" />
          </button>

          {NAV_TABS.slice(3).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
                className={`flex flex-col items-center justify-center min-w-[44px] min-h-[44px] py-1 px-1 transition-colors ${
                  isActive ? 'text-amber-500 font-bold' : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-[9px] font-ledger uppercase tracking-wider mt-0.5">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
