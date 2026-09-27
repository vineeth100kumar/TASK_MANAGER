import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, ArrowRight, X, ShieldAlert, Cloud, Laptop } from 'lucide-react';
import { api } from '../../services/api';
import { ConflictEvent } from '../../services/syncEngine';
import { useToast } from '../../context/ToastContext';

interface ConflictResolutionModalProps {
  conflict: ConflictEvent;
  onResolved: () => void;
  onClose: () => void;
}

export function ConflictResolutionModal({ conflict, onResolved, onClose }: ConflictResolutionModalProps) {
  const { showToast } = useToast();

  const handleKeepLocal = async () => {
    try {
      // Re-save local record with higher revision to force server acceptance
      const local = conflict.localRecord;
      const nextRev = ((local.version || local.revision || 1) + 1);
      await api.sync.discardOperation(conflict.operationId);
      await api.workItems.updateDetails(conflict.entityId, { ...local, version: nextRev });
      showToast('Local version kept and queued for sync');
      onResolved();
    } catch (e: any) {
      showToast('Resolution error: ' + e.message, 'error');
    }
  };

  const handleAcceptCloud = async () => {
    try {
      if (conflict.serverRecord) {
        await api.workItems.updateDetails(conflict.entityId, conflict.serverRecord);
      }
      await api.sync.discardOperation(conflict.operationId);
      showToast('Cloud version accepted');
      onResolved();
    } catch (e: any) {
      showToast('Resolution error: ' + e.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-xl rounded-[32px] shadow-2xl p-6 md:p-8 relative z-10 border border-gray-100 dark:border-white/10 space-y-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-500">
            <AlertTriangle size={16} />
            <span>Sync Conflict Detected</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>

        <div>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">This item changed in the cloud</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Reason: {conflict.reason}. Choose which version you would like to keep.
          </p>
        </div>

        {/* Side by side preview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Local */}
          <div className="p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/30 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400">
              <Laptop size={14} />
              <span>Your Device Version</span>
            </div>
            <h4 className="font-bold text-sm text-gray-900 dark:text-white truncate">
              {conflict.localRecord?.title || 'Local Task'}
            </h4>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
              <div>Status: <span className="font-semibold uppercase">{conflict.localRecord?.status || 'N/A'}</span></div>
              {conflict.localRecord?.dueDate && <div>Due: {conflict.localRecord.dueDate}</div>}
            </div>
          </div>

          {/* Cloud */}
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-gray-400">
              <Cloud size={14} />
              <span>Cloud Spreadsheet Version</span>
            </div>
            <h4 className="font-bold text-sm text-gray-900 dark:text-white truncate">
              {conflict.serverRecord?.title || 'Cloud Task'}
            </h4>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
              <div>Status: <span className="font-semibold uppercase">{conflict.serverRecord?.status || 'N/A'}</span></div>
              {conflict.serverRecord?.dueDate && <div>Due: {conflict.serverRecord.dueDate}</div>}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button
            type="button"
            onClick={handleAcceptCloud}
            className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
          >
            Accept Cloud Version
          </button>
          <button
            type="button"
            onClick={handleKeepLocal}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <Check size={14} /> Keep My Version
          </button>
        </div>
      </motion.div>
    </div>
  );
}
