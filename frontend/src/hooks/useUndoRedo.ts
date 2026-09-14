import { useState, useCallback, useRef } from 'react';
import { useToast } from '../context/ToastContext';

export interface HistoryAction {
  id: string;
  description: string;
  undo: () => any;
  redo: () => any;
  timestamp: number;
}

export function useUndoRedo() {
  const toast = useToast();
  const [undoStack, setUndoStack] = useState<HistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);

  const undoStackRef = useRef<HistoryAction[]>([]);
  undoStackRef.current = undoStack;
  const redoStackRef = useRef<HistoryAction[]>([]);
  redoStackRef.current = redoStack;

  const handleUndo = useCallback(async () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);
    try {
      await action.undo();
      toast.info(`Undid: ${action.description}`);
    } catch (e) {
      console.error('Failed to undo action:', e);
      toast.error('Failed to undo action');
    }
  }, [toast]);

  const handleRedo = useCallback(async () => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, action]);
    try {
      await action.redo();
      toast.info(`Redid: ${action.description}`);
    } catch (e) {
      console.error('Failed to redo action:', e);
      toast.error('Failed to redo action');
    }
  }, [toast]);

  const pushHistoryAction = useCallback((action: HistoryAction) => {
    setUndoStack(prev => [...prev.slice(-30), action]);
    setRedoStack([]); // Clear redo stack on new action
    
    toast.action(action.description, 'Undo', () => {
      handleUndo();
    }, 6000);
  }, [handleUndo, toast]);

  return {
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoTooltip: undoStack[undoStack.length - 1]?.description || '',
    redoTooltip: redoStack[redoStack.length - 1]?.description || '',
    handleUndo,
    handleRedo,
    pushHistoryAction,
  };
}
