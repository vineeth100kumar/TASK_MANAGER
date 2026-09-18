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
      className="fixed bottom-36 md:bottom-6 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none w-full max-w-md px-4"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isSuccess = toast.type === 'success';
        const isWarning = toast.type === 'warning';
        const isAction = toast.type === 'action';

        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center justify-between gap-3 w-full sm:w-auto sm:min-w-[300px] max-w-full
                       px-3.5 py-2.5 rounded-surface bg-surface border border-hairline shadow-lg
                       animate-in fade-in slide-in-from-bottom-2 duration-200 ease-settle"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="shrink-0">
                {isError && <AlertCircle className="w-[18px] h-[18px] text-danger-600 dark:text-danger-400" />}
                {isSuccess && <CheckCircle2 className="w-[18px] h-[18px] text-done-500 dark:text-done-400" />}
                {isWarning && <AlertTriangle className="w-[18px] h-[18px] text-late-500 dark:text-late-400" />}
                {isAction && <RotateCcw className="w-[18px] h-[18px] text-ink-3" />}
                {toast.type === 'info' && <Info className="w-[18px] h-[18px] text-ink-3" />}
              </span>
              <div className="min-w-0 flex-1">
                {toast.title && (
                  <p className="text-meta font-semibold text-ink leading-snug truncate">{toast.title}</p>
                )}
                <p className="text-meta text-ink-2 leading-snug">{toast.message}</p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    onDismiss(toast.id);
                  }}
                  className="px-2.5 py-1.5 rounded-control text-meta font-medium text-accent-500 hover:bg-sunken active:scale-95 transition-all duration-150 ease-settle"
                >
                  {toast.action.label}
                </button>
              )}
              <button
                onClick={() => onDismiss(toast.id)}
                className="w-8 h-8 flex items-center justify-center text-ink-3 hover:text-ink rounded-control hover:bg-sunken transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
