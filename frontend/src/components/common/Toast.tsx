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
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-3 w-full sm:w-auto min-w-[280px] max-w-full ${
              isError
                ? 'bg-rose-950/95 border-rose-500/40 text-rose-100 shadow-rose-950/50'
                : isSuccess
                ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-100 shadow-emerald-950/50'
                : isWarning
                ? 'bg-amber-950/95 border-amber-500/40 text-amber-100 shadow-amber-950/50'
                : isAction
                ? 'bg-zinc-900/95 border-zinc-700/80 text-zinc-100 shadow-black/80'
                : 'bg-zinc-900/95 border-zinc-700/80 text-zinc-100 shadow-black/80'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="shrink-0">
                {isError && <AlertCircle className="w-4 h-4 text-rose-400" />}
                {isSuccess && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                {isWarning && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                {isAction && <RotateCcw className="w-4 h-4 text-blue-400" />}
                {toast.type === 'info' && <Info className="w-4 h-4 text-blue-400" />}
              </span>
              <div className="min-w-0 flex-1">
                {toast.title && (
                  <p className="text-xs font-bold leading-tight truncate">{toast.title}</p>
                )}
                <p className="text-xs font-medium leading-tight truncate">{toast.message}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    onDismiss(toast.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all flex items-center gap-1 shadow-sm active:scale-95"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{toast.action.label}</span>
                </button>
              )}
              <button
                onClick={() => onDismiss(toast.id)}
                className="text-zinc-400 hover:text-white p-1 rounded transition-colors"
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
