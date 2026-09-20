import { useEffect, useRef } from 'react';
import { TaskPriority } from '../types';

export interface ShortcutHandlers {
  onMoveDown?: () => void;
  onMoveUp?: () => void;
  onToggleComplete?: () => void;
  onEdit?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onSetToday?: () => void;
  onSetTomorrow?: () => void;
  onSetPriority?: (priority: TaskPriority) => void;
  onToggleSelect?: () => void;
  onQuickAdd?: () => void;
  onSearch?: () => void;
  onShowHelp?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}

/*
 * The shortcut set for the task list.
 *
 * The digits follow the same p1–p4 order the quick-add bar already parses, so
 * "1" means urgent in both places rather than meaning one thing typed and
 * another pressed.
 */
export const SHORTCUT_HELP: { keys: string[]; description: string }[] = [
  { keys: ['J', '↓'], description: 'Next task' },
  { keys: ['K', '↑'], description: 'Previous task' },
  { keys: ['X', 'Space'], description: 'Complete or reopen' },
  { keys: ['Enter', 'E'], description: 'Open details' },
  { keys: ['R'], description: 'Rename in place' },
  { keys: ['T'], description: 'Due today' },
  { keys: ['M'], description: 'Due tomorrow' },
  { keys: ['1', '2', '3', '4'], description: 'Urgent, high, medium, low' },
  { keys: ['S'], description: 'Select mode' },
  { keys: ['N'], description: 'New task' },
  { keys: ['D', 'Delete'], description: 'Delete' },
  { keys: ['⌘K'], description: 'Search' },
  { keys: ['?'], description: 'This list' },
  { keys: ['Esc'], description: 'Clear selection' },
];

const PRIORITY_BY_DIGIT: { [key: string]: TaskPriority } = {
  '1': 'urgent',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
};

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const { enabled = true } = handlers;

  // Keep the latest handlers in a ref so the listener is attached once rather
  // than torn down and rebuilt on every render of the list.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current;

      // Ignore if the user is currently typing in an input, textarea, or
      // contentEditable — except for Escape, which should still get them out.
      const target = e.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        h.onSearch?.();
        return;
      }

      if (isTyping) return;

      // A modifier other than Shift means the key belongs to the browser.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          h.onMoveDown?.();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          h.onMoveUp?.();
          break;
        case ' ':
        case 'x':
          e.preventDefault();
          h.onToggleComplete?.();
          break;
        case 'Enter':
        case 'e':
          e.preventDefault();
          h.onEdit?.();
          break;
        case 'r':
          e.preventDefault();
          h.onRename?.();
          break;
        case 'd':
        case 'Backspace':
        case 'Delete':
          e.preventDefault();
          h.onDelete?.();
          break;
        case 't':
          e.preventDefault();
          h.onSetToday?.();
          break;
        case 'm':
          e.preventDefault();
          h.onSetTomorrow?.();
          break;
        case 's':
          e.preventDefault();
          h.onToggleSelect?.();
          break;
        case 'n':
        case 'q':
          e.preventDefault();
          h.onQuickAdd?.();
          break;
        case '?':
          e.preventDefault();
          h.onShowHelp?.();
          break;
        case 'Escape':
          e.preventDefault();
          h.onEscape?.();
          break;
        default:
          if (PRIORITY_BY_DIGIT[e.key]) {
            e.preventDefault();
            h.onSetPriority?.(PRIORITY_BY_DIGIT[e.key]);
          }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
