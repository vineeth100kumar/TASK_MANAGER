import React from 'react';
import { 
  LayoutDashboard, 
  CheckSquare, 
  Wallet, 
  Sparkles, 
  Smartphone, 
  Wifi, 
  WifiOff,
  RefreshCw
} from 'lucide-react';

interface NavbarProps {
  activeTab: 'dashboard' | 'tasks' | 'finance' | 'shortcuts';
  setActiveTab: (tab: 'dashboard' | 'tasks' | 'finance' | 'shortcuts') => void;
  isLiveConnected: boolean;
  isSyncing?: boolean;
  onOpenQuickCapture: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  isLiveConnected,
  isSyncing = false,
  onOpenQuickCapture
}) => {
  return (
    <>
      {/* PC Top Navigation Bar */}
      <header className="hidden md:flex items-center justify-between px-6 py-3 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
              S
            </div>
            <div>
              <span className="font-semibold text-zinc-100 text-sm tracking-tight">Sage OS</span>
              <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">RPi5</span>
            </div>
          </div>

          <nav className="flex items-center space-x-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('tasks')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'tasks'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>Tasks & Events</span>
            </button>

            <button
              onClick={() => setActiveTab('finance')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'finance'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>Finance Tracker</span>
            </button>

            <button
              onClick={() => setActiveTab('shortcuts')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'shortcuts'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>iOS & Siri</span>
            </button>
          </nav>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onOpenQuickCapture}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 text-xs font-medium transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Brain Dump</span>
            <kbd className="hidden lg:inline text-[10px] bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded ml-1">Ctrl+K</kbd>
          </button>

          {isSyncing ? (
            <div 
              title="Saving changes in background to Raspberry Pi..."
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-sm shadow-blue-500/10"
            >
              <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />
              <span>Saving to Pi...</span>
            </div>
          ) : (
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
          )}
        </div>
      </header>

      {/* iOS & Mobile Bottom Tab Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/80 pb-safe">
        <div className="flex items-center justify-around py-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex flex-col items-center py-1 px-3 transition-colors ${
              activeTab === 'dashboard' ? 'text-blue-500' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1">Today</span>
          </button>

          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center py-1 px-3 transition-colors ${
              activeTab === 'tasks' ? 'text-blue-500' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <CheckSquare className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1">Tasks</span>
          </button>

          {/* Quick Capture Floating Button */}
          <button
            onClick={onOpenQuickCapture}
            className="flex items-center justify-center w-11 h-11 -mt-4 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-500/40 active:scale-95 transition-transform"
          >
            <Sparkles className="w-5 h-5" />
          </button>

          <button
            onClick={() => setActiveTab('finance')}
            className={`flex flex-col items-center py-1 px-3 transition-colors ${
              activeTab === 'finance' ? 'text-blue-500' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Wallet className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1">Finance</span>
          </button>

          <button
            onClick={() => setActiveTab('shortcuts')}
            className={`flex flex-col items-center py-1 px-3 transition-colors ${
              activeTab === 'shortcuts' ? 'text-blue-500' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Smartphone className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1">Siri & Pi</span>
          </button>
        </div>
      </div>
    </>
  );
};
