import React from 'react';
import { CloudOff, X } from 'lucide-react';
import { useSaveState } from '../../context/SaveStateContext';

/*
 * What did not reach the Pi, and the button that tries again.
 *
 * A failed write used to be a toast: it named the failure for four seconds
 * and then took the only record of it away, leaving a screen showing an
 * edit the Pi had never accepted. This stays until it succeeds or until
 * it is dismissed deliberately.
 */
export const UnsavedBanner: React.FC = () => {
  const { failures, retryAll, dismissFailures, isRetrying } = useSaveState();

  if (failures.length === 0) return null;

  const first = failures[0];
  const extra = failures.length - 1;

  return (
    <div
      role="alert"
      className="fixed left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-md
                 bg-surface rounded-control shadow-lift-3 px-3.5 py-3
                 flex items-start gap-3 animate-in slide-in-from-bottom-4 duration-200 ease-settle"
      style={{ bottom: 'calc(var(--keyboard-offset, 0px) + 4.75rem)' }}
    >
      <CloudOff
        className="w-4 h-4 mt-0.5 shrink-0 text-late-500 dark:text-late-400"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="text-meta text-ink">
          {failures.length === 1 ? 'One change did not save' : `${failures.length} changes did not save`}
        </p>
        <p className="text-caption text-ink-2 mt-0.5 truncate">
          {first.description}
          {extra > 0 && ` and ${extra} more`}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={retryAll}
          disabled={isRetrying}
          className="h-8 px-3 rounded-control bg-accent-500 hover:bg-accent-600 text-white
                     text-meta font-medium transition-colors disabled:opacity-40
                     disabled:pointer-events-none"
        >
          {isRetrying ? 'Trying' : 'Try again'}
        </button>
        <button
          type="button"
          onClick={dismissFailures}
          aria-label="Dismiss"
          className="w-8 h-8 grid place-items-center rounded-control text-ink-3
                     hover:text-ink hover:bg-sunken transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
