import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  confirmLabel?: string;
  cancelText?: string;
  isDestructive?: boolean;
  confirmVariant?: 'danger' | 'primary' | string;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Delete',
  confirmLabel,
  cancelText = 'Cancel',
  isDestructive = true,
  confirmVariant,
  isLoading = false,
  onConfirm,
  onCancel
}) => {
  const label = confirmLabel || confirmText;
  const isDanger = confirmVariant === 'danger' || isDestructive;
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      cancelBtnRef.current?.focus();
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
    >
      <div 
        className="w-full max-w-md bg-surface border border-stone-300 dark:border-stone-700 rounded-control p-5 sm:p-6 shadow-lg space-y-4 animate-in zoom-in-95 duration-150 relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="-mx-5 -mt-5 sm:-mx-6 sm:-mt-6 px-4 py-1.5 bg-paper-aged dark:bg-sunken border-b border-stone-300 dark:border-stone-800 text-caption text-amber-700 dark:text-amber-500 flex justify-between items-center">
          <span>{isDestructive ? 'This cannot be undone' : 'Please confirm'}</span>
          <span className="text-ink-3">ESC TO CANCEL</span>
        </div>

        <div className="flex items-start gap-3.5 pt-2">
          <div className={`p-2 rounded-control border shrink-0 ${
            isDestructive 
              ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800' 
              : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
          }`}>
            {isDestructive ? <Trash2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="confirm-dialog-title" className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 tracking-tight">
              {title}
            </h3>
            <div id="confirm-dialog-message" className="text-meta text-ink-3 dark:text-stone-300 mt-1 leading-relaxed">
              {message}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-ink-3 hover:text-stone-800 dark:hover:text-stone-300 p-1 border border-stone-300 dark:border-stone-800 hover:bg-black/5 dark:hover:bg-stone-800 rounded-control transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stone-200 dark:border-stone-800">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 rounded-control text-meta text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white bg-paper-aged dark:bg-stone-900 hover:bg-stone-200 dark:hover:bg-stone-800 border border-stone-300 dark:border-stone-700 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 rounded-control text-meta font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 border ${
              isDanger
                ? 'bg-rose-700 hover:bg-rose-800 text-white border-rose-800 dark:bg-rose-950 dark:hover:bg-rose-900 dark:text-rose-200 dark:border-rose-700'
                : 'bg-amber-600 hover:bg-amber-500 text-stone-950 border-amber-600 font-black'
            }`}
          >
            {isLoading && (
              <span className="w-3 h-3 border border-stone-400 border-t-stone-100 rounded-full animate-spin" />
            )}
            <span>{label}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
