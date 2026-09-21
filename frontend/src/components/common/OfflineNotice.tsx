import React from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { describeAsOf } from '../../services/snapshot';

interface OfflineNoticeProps {
  /** ISO time the shown data was taken from the Pi, or null when it is live. */
  asOf: string | null;
  onRetry: () => void;
  isRetrying?: boolean;
}

/*
 * A quiet line saying the screen is a memory, not a feed.
 *
 * It appears only when the live request failed and there was a snapshot to
 * fall back on, so it is never noise: if it is there, what is underneath it
 * is genuinely old.
 */
export const OfflineNotice: React.FC<OfflineNoticeProps> = ({ asOf, onRetry, isRetrying = false }) => {
  if (!asOf) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-sunken border-b border-hairline text-caption text-ink-2">
      <CloudOff className="w-3.5 h-3.5 shrink-0 text-late-500 dark:text-late-400" aria-hidden="true" />
      <span className="min-w-0 truncate">
        Can&rsquo;t reach the Pi. Showing your last sync, {describeAsOf(asOf)}.
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="ml-auto shrink-0 inline-flex items-center gap-1.5 text-caption font-medium
                   text-accent-600 dark:text-accent-400 hover:underline disabled:opacity-40
                   disabled:no-underline"
      >
        <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} aria-hidden="true" />
        {isRetrying ? 'Trying' : 'Try again'}
      </button>
    </div>
  );
};
