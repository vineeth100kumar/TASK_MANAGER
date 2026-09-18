import React, { useEffect, useRef, useState } from 'react';
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
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const handleAttemptClose = () => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;

      // Handle Escape key
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleAttemptClose();
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      // Focus modal container
      modalRef.current?.focus();

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        previouslyFocusedRef.current?.focus?.();
      };
    }
  }, [isOpen, hasUnsavedChanges]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-ink/25 dark:bg-black/55 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto"
        onClick={handleAttemptClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-dialog-title' : undefined}
        aria-describedby={description ? 'modal-dialog-desc' : undefined}
      >
        <div
          ref={modalRef}
          tabIndex={-1}
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

      {/* Discard Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDiscardConfirm}
        title="Discard Unsaved Changes?"
        message="You have unsaved text or selections in this form. If you close now, your changes will be lost."
        confirmText="Discard Changes"
        cancelText="Keep Editing"
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
