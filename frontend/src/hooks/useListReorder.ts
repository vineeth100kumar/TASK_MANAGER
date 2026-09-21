import { useCallback, useRef, useState } from 'react';

export interface ReorderTarget {
  /** The row the pointer is currently over. */
  overId: string;
  /** Whether the dragged row would land above or below it. */
  edge: 'above' | 'below';
}

export interface ReorderDrop {
  id: string;
  /** The row that ends up above the dropped one, if any. */
  beforeId: string | null;
  /** The row that ends up below it, if any. */
  afterId: string | null;
}

interface Options {
  /** The rows, in the order they are drawn. */
  order: string[];
  onDrop: (drop: ReorderDrop) => void;
}

/*
 * Dragging a row to a new place in a list.
 *
 * Pointer events rather than HTML5 drag-and-drop, for two reasons: the rows
 * already use a horizontal drag for swipe-to-complete, and HTML5 dragging does
 * not exist on touch at all — which on a phone-first app would have meant
 * reordering worked only at a desk.
 *
 * The drag starts from a grip rather than the row body, so a tap still opens
 * the task and a horizontal swipe still completes it.
 */
export function useListReorder({ order, onDrop }: Options) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<ReorderTarget | null>(null);
  const targetRef = useRef<ReorderTarget | null>(null);
  const draggingRef = useRef<string | null>(null);

  const setTargetBoth = (next: ReorderTarget | null) => {
    targetRef.current = next;
    setTarget(next);
  };

  const finish = useCallback(() => {
    const id = draggingRef.current;
    const landing = targetRef.current;
    draggingRef.current = null;
    targetRef.current = null;
    setDraggingId(null);
    setTarget(null);

    if (!id || !landing || landing.overId === id) return;

    // Work out the neighbours in the list as it will be once the dragged row
    // has left its old place. Sending neighbours rather than an index means
    // the drop still lands correctly if another device re-sorted the list
    // while the finger was down.
    const without = order.filter((other) => other !== id);
    const overIndex = without.indexOf(landing.overId);
    if (overIndex === -1) return;

    const insertAt = landing.edge === 'above' ? overIndex : overIndex + 1;
    const beforeId = insertAt > 0 ? without[insertAt - 1] : null;
    const afterId = insertAt < without.length ? without[insertAt] : null;

    if (beforeId === null && afterId === null) return;
    onDrop({ id, beforeId, afterId });
  }, [order, onDrop]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const row = element?.closest('[data-reorder-id]') as HTMLElement | null;
    if (!row) return;

    const overId = row.getAttribute('data-reorder-id');
    if (!overId || overId === draggingRef.current) {
      setTargetBoth(null);
      return;
    }

    const box = row.getBoundingClientRect();
    const edge: 'above' | 'below' = event.clientY < box.top + box.height / 2 ? 'above' : 'below';
    const current = targetRef.current;
    if (!current || current.overId !== overId || current.edge !== edge) {
      setTargetBoth({ overId, edge });
    }
  }, []);

  const start = useCallback(
    (id: string, event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();

      draggingRef.current = id;
      setDraggingId(id);
      setTargetBoth(null);

      const onMove = (e: PointerEvent) => handlePointerMove(e);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        finish();
      };
      const onCancel = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        draggingRef.current = null;
        targetRef.current = null;
        setDraggingId(null);
        setTarget(null);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [finish, handlePointerMove]
  );

  /*
   * The same move from the keyboard, so reordering does not require a pointer
   * at all. One step up or down is expressible as the pair of neighbours the
   * row lands between, exactly as a drop is.
   */
  const moveBy = useCallback(
    (id: string, delta: -1 | 1) => {
      const from = order.indexOf(id);
      if (from === -1) return;
      const to = from + delta;
      if (to < 0 || to >= order.length) return;

      const without = order.filter((other) => other !== id);
      const beforeId = to > 0 ? without[to - 1] : null;
      const afterId = to < without.length ? without[to] : null;
      if (beforeId === null && afterId === null) return;
      onDrop({ id, beforeId, afterId });
    },
    [order, onDrop]
  );

  return { draggingId, target, start, moveBy };
}
