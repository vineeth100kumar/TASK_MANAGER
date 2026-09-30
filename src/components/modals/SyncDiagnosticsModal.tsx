import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, RefreshCw, CheckCircle2, AlertTriangle, WifiOff, Database, Download, Upload, ExternalLink, Trash2, ShieldCheck } from 'lucide-react';
import { api } from '../../services/api';
import { SyncEngineStatus, syncEndpointLabel, syncEngine } from '../../services/syncEngine';
import { SyncOpRecord } from '../../services/db';
import { useToast } from '../../context/ToastContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface SyncDiagnosticsModalProps {
  onClose: () => void;
}

export function SyncDiagnosticsModal({ onClose }: SyncDiagnosticsModalProps) {
  useEscapeKey(onClose);
  const [syncStatus, setSyncStatus] = useState<SyncEngineStatus>(api.sync.getStatus());
  const [operations, setOperations] = useState<SyncOpRecord[]>([]);
  const [isForcing, setIsForcing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'queue'>('overview');
  const { showToast } = useToast();

  const reloadData = async () => {
    const st = await api.sync.getDetailedStatus();
    setSyncStatus(st);
    const ops = await api.sync.getPendingOperations();
    setOperations(ops);
  };

  useEffect(() => {
    reloadData();
    const unsubscribe = api.sync.subscribeStatus((st) => {
      setSyncStatus(st);
      api.sync.getPendingOperations().then(setOperations);
    });
    return unsubscribe;
  }, []);

  const handleForceSync = async () => {
    setIsForcing(true);
    try {
      await api.sync.forceSync();
      await reloadData();
      showToast('Sync cycle completed');
    } catch (e: any) {
      showToast('Sync trigger failed: ' + e.message, 'error');
    } finally {
      setIsForcing(false);
    }
  };

  const handleRetryOp = async (opId: string) => {
    await api.sync.retryOperation(opId);
    await reloadData();
    showToast(`Operation ${opId.substring(0, 8)} queued for retry`);
  };

  const handleDiscardOp = async (opId: string) => {
    await api.sync.discardOperation(opId);
    await reloadData();
    showToast(`Operation ${opId.substring(0, 8)} discarded`);
  };

  const handleExportBackup = async () => {
    await api.exportBackup();
    showToast('Versioned backup downloaded');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const content = ev.target?.result as string;
      if (confirm('Importing this backup will safely replace local records with validated backup data. Proceed?')) {
        const res = await api.importBackup(content);
        if (res.success) {
          showToast(res.message);
          window.location.reload();
        } else {
          showToast(res.message, 'error');
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans">
      <div className="absolute inset-0 scrim" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[88vh] border border-gray-100 dark:border-white/10">
        
        {/* Header */}
        <div className="h-16 border-b border-gray-100 dark:border-white/5 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-2">
            <Database size={20} className="text-blue-500" />
            <h2 className="font-bold text-lg text-gray-900 dark:text-white">Data & Sync Diagnostics</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20}/></button>
        </div>

        {/* Tab Navigator */}
        <div className="flex px-6 pt-3 border-b border-gray-100 dark:border-white/5 gap-4 shrink-0">
          <button onClick={() => setActiveTab('overview')} className={`pb-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'overview' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}>
            Overview & Metrics
          </button>
          <button onClick={() => setActiveTab('queue')} className={`pb-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'queue' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`}>
            Operations Queue ({operations.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {activeTab === 'overview' ? (
            <>
              {/* Status Banner */}
              <div className={`p-4 rounded-2xl border flex items-center justify-between ${
                syncStatus.state === 'synced' ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30' :
                syncStatus.state === 'syncing' ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/30' :
                syncStatus.state === 'offline' ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30' :
                syncStatus.state === 'conflict' ? 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/30' :
                'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30'
              }`}>
                <div className="flex items-center gap-3">
                  {syncStatus.state === 'synced' && <CheckCircle2 size={24} className="text-emerald-500" />}
                  {syncStatus.state === 'syncing' && <RefreshCw size={24} className="text-blue-500 animate-spin" />}
                  {syncStatus.state === 'offline' && <WifiOff size={24} className="text-amber-500" />}
                  {syncStatus.state === 'conflict' && <AlertTriangle size={24} className="text-orange-500" />}
                  {(syncStatus.state === 'retrying' || syncStatus.state === 'error') && <AlertTriangle size={24} className="text-red-500" />}
                  
                  <div>
                    <h4 className="font-bold text-[15px] capitalize text-gray-900 dark:text-white">
                      {syncStatus.state === 'synced' ? 'All Changes Persisted & Synced' :
                       syncStatus.state === 'syncing' ? 'Uploading Changes to Google Sheets...' :
                       syncStatus.state === 'offline' ? 'Offline Mode (Local Persistence Active)' :
                       syncStatus.state === 'conflict' ? 'Conflict Detected (Review Queue)' :
                       'Sync Retrying with Backoff'}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {syncStatus.lastSuccessfulSync ? `Last successful sync: ${new Date(syncStatus.lastSuccessfulSync).toLocaleTimeString()}` : 'Initial sync pending'}
                    </p>
                  </div>
                </div>

                <button onClick={handleForceSync} disabled={isForcing || !navigator.onLine}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-transform active:scale-95 shadow-sm">
                  <RefreshCw size={13} className={isForcing ? 'animate-spin' : ''} /> Force Sync
                </button>
              </div>

              {/* Diagnostic Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Pending Queue</div>
                  <div className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{syncStatus.pendingCount}</div>
                  <div className="text-[10px] text-gray-400">Durable ops</div>
                </div>

                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Failed / Retry</div>
                  <div className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{syncStatus.failedCount}</div>
                  <div className="text-[10px] text-gray-400">In backoff cycle</div>
                </div>

                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Server Rev</div>
                  <div className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">v{syncStatus.serverRevision || 1}</div>
                  <div className="text-[10px] text-gray-400">Cloud sequence</div>
                </div>

                <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Tab Role</div>
                  <div className="text-sm font-bold text-gray-900 dark:text-white mt-1">{syncStatus.isLeader ? 'Leader Worker' : 'Observer Tab'}</div>
                  <div className="text-[10px] text-gray-400">BroadcastChannel</div>
                </div>
              </div>

              {/* Persistence Details */}
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Local Persistence Layer</span>
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <ShieldCheck size={14}/> IndexedDB Transactional
                  </span>
                </div>
                <div className="text-xs font-mono text-gray-600 dark:text-gray-400 truncate">Device ID: {syncStatus.clientId}</div>
                <div className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">Syncing to: {syncEndpointLabel()}</div>
                <div className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">Live updates: {syncEngine.liveStreamLabel()}</div>
                {syncStatus.lastError && (
                  <div className="text-xs font-medium text-red-500 break-words">Last error: {syncStatus.lastError}</div>
                )}
              </div>

              {/* Backup & Tools */}
              <div className="pt-2 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Backup & Storage Management</h4>
                
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleExportBackup} className="flex-1 px-4 py-2.5 rounded-xl font-bold bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 hover:bg-gray-200 text-xs flex items-center justify-center gap-2">
                    <Download size={14} /> Export Backup (JSON)
                  </button>

                  <label className="flex-1 px-4 py-2.5 rounded-xl font-bold bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 hover:bg-gray-200 text-xs flex items-center justify-center gap-2 cursor-pointer">
                    <Upload size={14} /> Import Backup
                    <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
                  </label>

                  <button 
                    onClick={async () => {
                      if (window.confirm('Are you sure you want to clear all local data? This will wipe the local IndexedDB database and reload.')) {
                        await api.clearAllData();
                        showToast('Database wiped');
                        window.location.reload();
                      }
                    }} 
                    className="px-4 py-2.5 rounded-xl font-bold bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 text-xs flex items-center gap-2"
                  >
                    <Trash2 size={14} /> Clear Database
                  </button>

                  <a href="https://docs.google.com/spreadsheets" target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-xl font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 text-xs flex items-center gap-2">
                    <ExternalLink size={14} /> Cloud Sheet
                  </a>
                </div>
              </div>
            </>
          ) : (
            /* Queue Inspector Tab */
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Durable Operations in IndexedDB</h4>
                <button onClick={reloadData} className="text-xs text-blue-500 font-bold flex items-center gap-1 hover:underline">
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>

              {operations.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm font-medium">
                  Queue is completely empty. All operations have been synced to Google Sheets.
                </div>
              ) : (
                <div className="space-y-2">
                  {operations.map((op) => (
                    <div key={op.operationId} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-gray-900 dark:text-white uppercase">{op.operationId.substring(0, 8)}</span>
                          <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                            op.status === 'pending' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                            op.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {op.status}
                          </span>
                          <span className="text-gray-400">· {op.entityType} ({op.operation})</span>
                        </div>
                        {op.lastError && (
                          <div className="text-red-500 text-[11px] font-medium break-words">{op.lastError}</div>
                        )}
                        <div className="text-[10px] text-gray-400">
                          Rev {op.revision || 1} · Attempts: {op.attemptCount || 0} · Created: {new Date(op.createdAt).toLocaleTimeString()}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {op.status === 'failed' && (
                          <button onClick={() => handleRetryOp(op.operationId)} className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg font-semibold text-[11px] hover:bg-blue-700">
                            Retry
                          </button>
                        )}
                        <button onClick={() => handleDiscardOp(op.operationId)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" title="Discard Operation">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-white/5 flex justify-end">
          <button onClick={onClose} className="px-6 py-2 rounded-xl font-bold bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-200 text-xs">
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
