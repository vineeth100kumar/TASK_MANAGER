import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, RotateCcw, X } from 'lucide-react';
import { ToastItem } from '../../context/ToastContext';

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div 
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none w-full max-w-md px-4"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map(toast => {
        const isError = toast.type === 'error';
        const isSuccess = toast.type === 'success';
        const isWarning = toast.type === 'warning';
        const isAction = toast.type === 'action';

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-2.5 rounded-none border shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-3 w-full sm:w-auto min-w-[290px] max-w-full relative ${
              isError
                ? 'bg-rose-50 dark:bg-rose-950/90 border-rose-600/40 text-rose-900 dark:text-rose-100 shadow-rose-900/20'
                : isSuccess
                ? 'bg-paper-white dark:bg-stone-900 border-emerald-600/40 text-ink-base dark:text-stone-100 shadow-black/15'
                : isWarning
                ? 'bg-paper-aged dark:bg-amber-950/90 border-amber-600/40 text-amber-900 dark:text-amber-100 shadow-amber-950/20'
                : 'bg-paper-white dark:bg-stone-900 border-ink-base/30 dark:border-stone-700 text-ink-base dark:text-stone-100 shadow-black/15'
            }`}
          >
            {/* Top miniature tape strip */}
            <div className="tape-strip top-[-5px] left-8 w-12 h-2.5 pointer-events-none opacity-80" />

            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="shrink-0">
                {isError && <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />}
                {isSuccess && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                {isWarning && <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                {isAction && <RotateCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                {toast.type === 'info' && <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
              </span>
              <div className="min-w-0 flex-1">
                {toast.title && (
                  <p className="text-xs font-editorial font-bold leading-tight truncate">{toast.title}</p>
                )}
                <p className="text-[11px] font-ledger leading-tight truncate opacity-90">{toast.message}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    onDismiss(toast.id);
                  }}
                  className="px-2.5 py-1 rounded bg-ink-base hover:bg-stone-800 text-paper-white dark:bg-paper-light dark:hover:bg-paper-aged dark:text-ink-base text-[10px] font-ledger font-bold uppercase tracking-wider transition-all flex items-center gap-1 shadow-sm active:scale-95"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{toast.action.label}</span>
                </button>
              )}
              <button
                onClick={() => onDismiss(toast.id)}
                className="text-ink-muted hover:text-ink-base dark:text-stone-400 dark:hover:text-stone-200 p-1 rounded transition-colors"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
