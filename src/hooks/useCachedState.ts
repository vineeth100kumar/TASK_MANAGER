import { useCallback, useState } from 'react';

// What each view showed last time, kept for as long as the page is open.
const memory = new Map<string, unknown>();

/**
 * State that outlives the view. Coming back to a view paints what it showed
 * last time straight away, while its own load refreshes it, instead of a
 * blank screen or a wrong "nothing here" headline for a moment.
 *
 * Returns the value, a setter, and whether the value is real data (from this
 * visit or an earlier one) rather than `initial`.
 */
export function useCachedState<T>(key: string, initial: T): [T, (value: T) => void, boolean] {
  const read = (k: string) => ({ key: k, value: (memory.has(k) ? memory.get(k) : initial) as T, known: memory.has(k) });
  const [entry, setEntry] = useState(() => read(key));
  let current = entry;
  if (entry.key !== key) {
    // Switched to another set (Work to Personal, say): show that set's copy.
    current = read(key);
    setEntry(current);
  }
  const set = useCallback((value: T) => {
    memory.set(key, value);
    setEntry({ key, value, known: true });
  }, [key]);
  return [current.value, set, current.known];
}
