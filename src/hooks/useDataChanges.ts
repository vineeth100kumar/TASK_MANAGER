import { useEffect, useRef } from 'react';
import { api } from '../services/api';

// Calls `onChange` after the local data changes, whether this tab changed it or
// sync pulled it in from another device. Changes arrive in bursts (a sync
// batch, a bulk edit), so it waits for them to settle before calling.
export function useDataChanges(onChange: () => void, delayMs = 150): void {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = api.sync.onAnyChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => latest.current(), delayMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [delayMs]);
}
