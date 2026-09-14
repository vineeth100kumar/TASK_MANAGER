import { useState, useEffect } from 'react';

export function usePersistedState<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const item = window.localStorage.getItem(`sage_${key}`);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`sage_${key}`, JSON.stringify(state));
      }
    } catch (err) {
      console.warn(`Error persisting state for key "sage_${key}":`, err);
    }
  }, [key, state]);

  return [state, setState];
}
