import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface FailedWrite {
  id: string;
  /** What the user was doing, in their words: "Renaming the car insurance". */
  description: string;
  /** Run the same request again. Resolves when it finally lands. */
  retry: () => Promise<unknown>;
  failedAt: number;
}

interface SaveState {
  isSaving: boolean;
  /** Set for a few seconds after a write lands, so a save is visibly a save. */
  justSaved: boolean;
  failures: FailedWrite[];
  isRetrying: boolean;
}

interface SaveStateValue extends SaveState {
  beginSave: () => void;
  endSave: () => void;
  /** Record a write that did not land, with a way to run it again. */
  recordFailure: (failure: Omit<FailedWrite, 'id' | 'failedAt'>) => void;
  retryAll: () => void;
  dismissFailures: () => void;
}

const SaveStateContext = createContext<SaveStateValue | null>(null);

/*
 * Whether your work is actually on the Pi.
 *
 * Two problems this exists for. A save used to be silent: the detail sheet
 * writes every field on change or blur and said nothing, so on a Pi behind a
 * tunnel there was no way to tell a slow save from a lost one. And a failed
 * write became a toast, which vanished after a few seconds taking with it any
 * record of what had been lost or any way to try it again.
 *
 * So: saves are visible while they happen and for a moment after, and a
 * failure stays on screen, naming what did not save, until it either succeeds
 * or is dismissed on purpose.
 */
export const SaveStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [savingCount, setSavingCount] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const [failures, setFailures] = useState<FailedWrite[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginSave = useCallback(() => {
    setSavingCount((c) => c + 1);
    setJustSaved(false);
  }, []);

  const endSave = useCallback(() => {
    setSavingCount((c) => {
      const next = Math.max(0, c - 1);
      if (next === 0) {
        setJustSaved(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setJustSaved(false), 2200);
      }
      return next;
    });
  }, []);

  const recordFailure = useCallback((failure: Omit<FailedWrite, 'id' | 'failedAt'>) => {
    setFailures((prev) => [
      ...prev,
      { ...failure, id: `fail_${Date.now()}_${Math.random()}`, failedAt: Date.now() },
    ]);
  }, []);

  const retryAll = useCallback(() => {
    setIsRetrying(true);
    setFailures((current) => {
      // Take the list and clear it; anything that fails again comes back
      // through recordFailure, so a second failure is not double-counted.
      const pending = current;
      Promise.allSettled(pending.map((f) => f.retry())).finally(() => setIsRetrying(false));
      return [];
    });
  }, []);

  const dismissFailures = useCallback(() => setFailures([]), []);

  const value = useMemo<SaveStateValue>(
    () => ({
      isSaving: savingCount > 0,
      justSaved,
      failures,
      isRetrying,
      beginSave,
      endSave,
      recordFailure,
      retryAll,
      dismissFailures,
    }),
    [savingCount, justSaved, failures, isRetrying, beginSave, endSave, recordFailure, retryAll, dismissFailures]
  );

  return <SaveStateContext.Provider value={value}>{children}</SaveStateContext.Provider>;
};

export function useSaveState(): SaveStateValue {
  const ctx = useContext(SaveStateContext);
  if (!ctx) {
    throw new Error('useSaveState must be used inside a SaveStateProvider');
  }
  return ctx;
}
