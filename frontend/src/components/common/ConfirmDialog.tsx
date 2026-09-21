import React, { useEffect, useRef } from 'react';

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

/*
 * The question asked before something is thrown away.
 *
 * Deliberately plain: a sentence naming what is about to happen, and two
 * buttons. No warning stripe, no icon in a coloured box, no shouting about
 * permanence — the app can undo almost everything, and a dialog that panics
 * about a deletion you can reverse teaches you to stop reading dialogs.
 * Keeping it quiet is what makes the red button mean something.
 */
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
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Cancel takes focus, so the safe answer is the one a stray Return picks.
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      // Two buttons, so the trap is just the two of them.
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>('button:not([disabled])')
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !panel.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-ink/25 dark:bg-black/55 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-sm bg-surface rounded-t-surface sm:rounded-surface p-5 sm:p-6
                   shadow-lift-3 space-y-4 animate-in slide-in-from-bottom-4 sm:zoom-in-95
                   duration-200 ease-settle"
        onClick={e => e.stopPropagation()}
      >
        <div className="sm:hidden w-9 h-1 rounded-full bg-hairline mx-auto -mt-1" />

        <div>
          <h2 id="confirm-dialog-title" className="text-lead font-semibold text-ink">
            {title}
          </h2>
          <div id="confirm-dialog-message" className="text-meta text-ink-2 mt-1.5 leading-relaxed">
            {message}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="h-10 px-4 rounded-control text-meta font-medium text-ink-2 hover:text-ink
                       hover:bg-sunken transition-colors disabled:opacity-40"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`h-10 px-4 rounded-control text-meta font-medium text-white
                        inline-flex items-center gap-2 transition-all duration-200 ease-spring
                        active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none ${
                          isDanger
                            ? 'bg-danger-600 hover:bg-danger-700'
                            : 'bg-accent-500 hover:bg-accent-600'
                        }`}
          >
            {isLoading && (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            <span>{label}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
