import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  description?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | string;
  children: React.ReactNode;
  hasUnsavedChanges?: boolean;
  className?: string;
  hideCloseButton?: boolean;
}

const MAX_WIDTH_CLASSES: { [key: string]: string } = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  full: 'max-w-4xl'
};

/* Everything inside the panel that a Tab can land on. */
const FOCUSABLE =
  'a[href]:not([hidden]), button:not([disabled]):not([hidden]), ' +
  'input:not([disabled]):not([type="hidden"]):not([hidden]), ' +
  'select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), ' +
  '[tabindex]:not([tabindex="-1"]):not([hidden])';

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  description,
  maxWidth = 'lg',
  children,
  hasUnsavedChanges = false,
  className = '',
  hideCloseButton = false
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  /*
   * Read through a ref so the key handler below can be installed once, for as
   * long as the modal is open. It used to depend on `hasUnsavedChanges`, which
   * meant the effect tore down and rebuilt itself the moment a form went from
   * clean to dirty — and its cleanup put focus back on whatever opened the
   * modal. Typing the first character into a new task threw the caret out of
   * the field; every keystroke after it went nowhere.
   */
  const unsavedRef = useRef(hasUnsavedChanges);
  useEffect(() => {
    unsavedRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const handleAttemptClose = useCallback(() => {
    if (unsavedRef.current) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleAttemptClose();
        return;
      }

      /*
       * Focus stays inside the sheet. Without this, Tab walks straight out of
       * a dialog into the page behind it, which a screen reader then reads
       * while the dialog is still covering it.
       */
      if (e.key === 'Tab') {
        const panel = modalRef.current;
        if (!panel) return;
        // The selector already skips disabled and hidden controls, and the
        // sheet renders nothing it does not mean to show, so what it returns
        // is the real tab order. No offsetParent check: that reads null for a
        // fixed-position subtree and would empty the list.
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusable.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
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
  }, [isOpen, handleAttemptClose]);

  /*
   * Opening moves focus in, closing puts it back where it came from. Kept
   * apart from the key handler above so a re-render never re-runs it.
   */
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;

    const panel = modalRef.current;
    const preferred = panel?.querySelector<HTMLElement>('[data-autofocus], [autofocus]');
    (preferred || panel)?.focus();

    return () => {
      opener?.focus?.();
    };
  }, [isOpen]);

  /* The page behind a sheet should not scroll under it. */
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-ink/25 dark:bg-black/55 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto"
        onClick={handleAttemptClose}
      >
        <div
          ref={modalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? 'modal-dialog-title' : undefined}
          aria-describedby={description ? 'modal-dialog-desc' : undefined}
          onClick={e => e.stopPropagation()}
          style={{ marginBottom: 'var(--keyboard-offset, 0px)' }}
          className={`w-full ${MAX_WIDTH_CLASSES[maxWidth] || maxWidth} bg-surface border border-hairline rounded-t-surface sm:rounded-surface p-5 sm:p-6 shadow-lg space-y-4 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 ease-settle max-h-[92vh] sm:max-h-[88vh] overflow-y-auto focus:outline-none relative ${className}`}
        >
          {/* Grab handle — the sheet comes from the edge it will return to */}
          <div className="sm:hidden w-9 h-1 rounded-full bg-hairline mx-auto -mt-1 mb-1" />

          {(title || !hideCloseButton) && (
            <div className="flex items-start justify-between gap-3 border-b border-hairline pb-3">
              <div>
                {title && (
                  <div className="flex items-center gap-2">
                    {icon && <span className="shrink-0 text-ink-3">{icon}</span>}
                    <h2 id="modal-dialog-title" className="text-title font-semibold text-ink">
                      {title}
                    </h2>
                  </div>
                )}
                {description && (
                  <p id="modal-dialog-desc" className="text-meta text-ink-2 mt-1">
                    {description}
                  </p>
                )}
              </div>
              {!hideCloseButton && (
                <button
                  type="button"
                  onClick={handleAttemptClose}
                  className="w-9 h-9 flex items-center justify-center text-ink-3 hover:text-ink hover:bg-sunken rounded-control transition-colors shrink-0 -mr-1.5 -mt-1.5"
                  aria-label="Close modal"
                >
                  <X className="w-[18px] h-[18px]" />
                </button>
              )}
            </div>
          )}

          <div>{children}</div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDiscardConfirm}
        title="Discard your changes?"
        message="This form has text you have not saved. Closing now loses it."
        confirmText="Discard"
        cancelText="Keep editing"
        isDestructive={true}
        onConfirm={() => {
          setShowDiscardConfirm(false);
          onClose();
        }}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </>
  );
};
