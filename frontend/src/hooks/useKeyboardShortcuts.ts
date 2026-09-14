import { useEffect } from 'react';

export interface ShortcutHandlers {
  onMoveDown?: () => void;
  onMoveUp?: () => void;
  onToggleComplete?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSetToday?: () => void;
  onSetTomorrow?: () => void;
  onQuickAdd?: () => void;
  onSearch?: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onMoveDown,
  onMoveUp,
  onToggleComplete,
  onEdit,
  onDelete,
  onSetToday,
  onSetTomorrow,
  onQuickAdd,
  onSearch,
  enabled = true
}: ShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input, textarea, or contentEditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Check global Command/Ctrl shortcuts first
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onSearch?.();
        return;
      }

      // Single-key navigation shortcuts
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        onMoveDown?.();
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        onMoveUp?.();
      } else if (e.key === ' ' || e.key === 'x') {
        e.preventDefault();
        onToggleComplete?.();
      } else if (e.key === 'e') {
        e.preventDefault();
        onEdit?.();
      } else if (e.key === 'd' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete?.();
      } else if (e.key === 't') {
        e.preventDefault();
        onSetToday?.();
      } else if (e.key === 'm') {
        e.preventDefault();
        onSetTomorrow?.();
      } else if (e.key === 'n' || e.key === 'q') {
        e.preventDefault();
        onQuickAdd?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onMoveDown, onMoveUp, onToggleComplete, onEdit, onDelete, onSetToday, onSetTomorrow, onQuickAdd, onSearch]);
}
