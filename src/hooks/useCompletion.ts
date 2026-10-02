import { useCallback, useState } from 'react';
import { api } from '../services/api';
import { WorkItem } from '../services/types';
import { useToast } from '../context/ToastContext';
import { countDoneToday, doneMessage, haptic } from '../utils/progress';

// A short spin, then the tick fills; the save waits for both so the row doesn't
// vanish (the list refreshes as soon as the item saves) before the tick lands.
const SPIN_MS = 320;
const SETTLE_MS = 380;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Completing an item: the tick spins and the row strikes through, the tick
// fills, then the item is saved (which removes it) and a toast offers Undo.
export function useCompletion(onChanged?: () => void) {
  const [completing, setCompleting] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const { showToast } = useToast();

  const without = (set: Set<string>, id: string) => {
    const next = new Set(set);
    next.delete(id);
    return next;
  };
  const release = (id: string) => setCompleting(prev => without(prev, id));

  const complete = useCallback(async (item: WorkItem) => {
    if (completing.has(item.id)) return;
    haptic(12);
    setCompleting(prev => new Set(prev).add(item.id));
    setSaving(prev => new Set(prev).add(item.id));
    const previousStatus = item.status && item.status !== 'done' ? item.status : 'todo';
    await wait(SPIN_MS);
    setSaving(prev => without(prev, item.id));
    await wait(SETTLE_MS);
    try {
      await api.workItems.transitionStatus(item.id, 'done', item.version);
      showToast(doneMessage(countDoneToday()), 'success', {
        label: 'Undo',
        group: 'done',
        onAction: async () => {
          await api.workItems.transitionStatus(item.id, previousStatus);
          onChanged?.();
        },
      });
      onChanged?.();
    } catch (e: any) {
      showToast(e?.message || 'Could not complete that', 'error');
    } finally {
      // The list reload removes the row; releasing afterwards avoids a flash back.
      setTimeout(() => release(item.id), 400);
    }
  }, [completing, onChanged, showToast]);

  return {
    completing,
    complete,
    isCompleting: (id: string) => completing.has(id),
    isSaving: (id: string) => saving.has(id),
  };
}
