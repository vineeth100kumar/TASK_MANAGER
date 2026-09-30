import { useCallback, useState } from 'react';
import { api } from '../services/api';
import { WorkItem } from '../services/types';
import { useToast } from '../context/ToastContext';
import { countDoneToday, doneMessage, haptic } from '../utils/progress';

// Long enough for the tick to pop and the row to strike through before it leaves.
const SETTLE_MS = 480;

// Completing an item: the tick fills and the row strikes through at once, then
// the item is saved (which removes it from the list) and a toast offers Undo.
export function useCompletion(onChanged?: () => void) {
  const [completing, setCompleting] = useState<Set<string>>(() => new Set());
  const { showToast } = useToast();

  const release = (id: string) => setCompleting(prev => {
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  const complete = useCallback((item: WorkItem) => {
    if (completing.has(item.id)) return;
    haptic(12);
    setCompleting(prev => new Set(prev).add(item.id));
    const previousStatus = item.status && item.status !== 'done' ? item.status : 'todo';
    setTimeout(async () => {
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
    }, SETTLE_MS);
  }, [completing, onChanged, showToast]);

  return { completing, complete, isCompleting: (id: string) => completing.has(id) };
}
