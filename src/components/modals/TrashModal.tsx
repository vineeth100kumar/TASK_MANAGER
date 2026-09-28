import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Trash2, RotateCcw, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem } from '../../services/types';
import { formatDisplayDate } from '../../utils/dateUtils';
import { useToast } from '../../context/ToastContext';

interface TrashModalProps {
  onClose: () => void;
  onRestored: () => void;
}

export function TrashModal({ onClose, onRestored }: TrashModalProps) {
  const [deletedItems, setDeletedItems] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { showToast } = useToast();

  const loadDeleted = async () => {
    setIsLoading(true);
    const list = await api.workItems.getDeleted();
    setDeletedItems(list);
    setIsLoading(false);
  };

  useEffect(() => {
    loadDeleted();
  }, []);

  const handleRestore = async (id: string) => {
    await api.workItems.restore(id);
    setDeletedItems(prev => prev.filter(i => i.id !== id));
    showToast('Item restored successfully');
    onRestored();
  };

  const handlePermanentDelete = async (id: string) => {
    if (confirm('Permanently delete this item? This action cannot be undone.')) {
      await api.workItems.permanentDelete(id);
      setDeletedItems(prev => prev.filter(i => i.id !== id));
      showToast('Item permanently deleted');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[85vh] border border-gray-100 dark:border-white/10">
        
        {/* Header */}
        <div className="h-16 border-b border-gray-100 dark:border-white/5 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-2">
            <Trash2 size={20} className="text-red-500" />
            <h2 className="font-bold text-lg text-gray-900 dark:text-white">Trash & Archive</h2>
            <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-bold px-2 py-0.5 rounded-full ml-2">
              {deletedItems.length} items
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20}/></button>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3">
          {deletedItems.map(item => (
            <div key={item.id} className="p-4 rounded-2xl bg-[#f5f5f7] dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-bold text-gray-400 uppercase">{item.key}</span>
                  <span className="text-[11px] font-semibold text-gray-400">Deleted {formatDisplayDate(item.deletedAt)}</span>
                </div>
                <h4 className="font-bold text-[15px] text-gray-900 dark:text-white truncate">{item.title}</h4>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleRestore(item.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-bold text-xs hover:bg-blue-100 transition-colors">
                  <RotateCcw size={14} /> Restore
                </button>
                <button onClick={() => handlePermanentDelete(item.id)} className="p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" title="Delete Forever">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}

          {deletedItems.length === 0 && !isLoading && (
            <div className="py-16 text-center text-gray-400 font-medium">
              <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500 opacity-60" />
              Trash is empty. All your items are safe.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-white/5 flex justify-end">
          <button onClick={onClose} className="px-6 py-2 rounded-xl font-bold bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-200">
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}
