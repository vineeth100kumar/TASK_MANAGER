import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import {
  Whiteboard,
  WhiteboardListItem,
  WhiteboardElement,
  StickyElement,
  WhiteboardTool,
  ShapeType,
  StickyColor,
  ViewState,
  Project,
} from '../../types';
import { WhiteboardCanvas, WhiteboardCanvasRef } from './WhiteboardCanvas';
import { WhiteboardToolbar } from './WhiteboardToolbar';
import { WhiteboardHeader } from './WhiteboardHeader';
import { StickyNoteOverlay } from './StickyNoteOverlay';
import { useToast } from '../../context/ToastContext';

interface WhiteboardViewProps {
  initialProjectId?: string | null;
  projects?: Project[];
  onBack?: () => void;
  onTaskCreated?: () => void;
}

export const WhiteboardView: React.FC<WhiteboardViewProps> = ({
  initialProjectId,
  projects = [],
  onBack,
  onTaskCreated,
}) => {
  const toast = useToast();
  const canvasRef = useRef<WhiteboardCanvasRef | null>(null);

  // Board Data
  const [board, setBoard] = useState<Whiteboard | null>(null);
  const [boardsList, setBoardsList] = useState<WhiteboardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Canvas Tools & State
  const [activeTool, setActiveTool] = useState<WhiteboardTool>('pen');
  const [activeColor, setActiveColor] = useState<string>('#3b82f6');
  const [activeSize, setActiveSize] = useState<number>(4);
  const [activeShape, setActiveShape] = useState<ShapeType>('rectangle');
  const [highlighterColor, setHighlighterColor] = useState<string>('#facc15');
  const [highlighterSize, setHighlighterSize] = useState<number>(22);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // View state (pan & zoom)
  const [viewState, setViewState] = useState<ViewState>({ panX: 0, panY: 0, zoom: 1 });

  // Undo / Redo history stacks
  const [undoStack, setUndoStack] = useState<WhiteboardElement[][]>([]);
  const [redoStack, setRedoStack] = useState<WhiteboardElement[][]>([]);

  // Debounced auto-save timer ref
  const saveTimeoutRef = useRef<number | null>(null);

  // -------------------------------------------------------------
  // 1. LOAD WHITEBOARDS FROM RASPBERRY PI
  // -------------------------------------------------------------
  const loadBoards = useCallback(async () => {
    try {
      setLoading(true);
      const list = await api.getWhiteboards();
      setBoardsList(list);

      let targetBoardId: string | null = null;

      if (initialProjectId) {
        const found = list.find((b) => b.project_id === initialProjectId);
        if (found) targetBoardId = found.id;
      }

      if (!targetBoardId && list.length > 0) {
        targetBoardId = list[0].id;
      }

      if (targetBoardId) {
        const fullBoard = await api.getWhiteboard(targetBoardId);
        setBoard(fullBoard);
        setViewState(fullBoard.view_state || { panX: 0, panY: 0, zoom: 1 });
      } else {
        // Create initial default whiteboard
        const created = await api.createWhiteboard({
          title: 'Main Drawing Board',
          project_id: initialProjectId || null,
          elements: [],
          view_state: { panX: 0, panY: 0, zoom: 1 },
        });
        setBoard(created);
        setBoardsList([
          {
            id: created.id,
            title: created.title,
            project_id: created.project_id,
            thumbnail_data: created.thumbnail_data,
            created_at: created.created_at,
            updated_at: created.updated_at,
          },
        ]);
        setViewState({ panX: 0, panY: 0, zoom: 1 });
      }
    } catch (err: any) {
      console.error('Failed to load whiteboards:', err);
      toast.error('Could not load whiteboards from server');
    } finally {
      setLoading(false);
    }
  }, [initialProjectId, toast]);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  // -------------------------------------------------------------
  // 2. AUTO-SAVE WITH DEBOUNCE (1s)
  // -------------------------------------------------------------
  const scheduleAutoSave = useCallback(
    (elementsToSave: WhiteboardElement[], viewStateToSave: ViewState, titleToSave?: string, projectToSave?: string | null) => {
      if (!board) return;
      setIsSaving(true);
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = window.setTimeout(async () => {
        try {
          await api.updateWhiteboard(board.id, {
            elements: elementsToSave,
            view_state: viewStateToSave,
            title: titleToSave !== undefined ? titleToSave : board.title,
            project_id: projectToSave !== undefined ? projectToSave : board.project_id,
          });
          setIsSaving(false);
        } catch (err) {
          console.error('Auto-save whiteboard failed:', err);
          setIsSaving(false);
        }
      }, 1000);
    },
    [board]
  );

  // -------------------------------------------------------------
  // 3. ELEMENT MODIFICATIONS & HISTORY
  // -------------------------------------------------------------
  const handleElementsChange = useCallback(
    (newElements: WhiteboardElement[], recordHistory = false) => {
      if (!board) return;

      if (recordHistory) {
        setUndoStack((prev) => [...prev.slice(-49), board.elements]);
        setRedoStack([]);
      }

      const updatedBoard = { ...board, elements: newElements };
      setBoard(updatedBoard);
      scheduleAutoSave(newElements, viewState);
    },
    [board, viewState, scheduleAutoSave]
  );

  const handleViewStateChange = useCallback(
    (newView: ViewState) => {
      setViewState(newView);
      if (board) {
        scheduleAutoSave(board.elements, newView);
      }
    },
    [board, scheduleAutoSave]
  );

  // Undo & Redo Handlers
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !board) return;
    const previous = undoStack[undoStack.length - 1];
    const newUndo = undoStack.slice(0, -1);

    setRedoStack((prev) => [...prev, board.elements]);
    setUndoStack(newUndo);

    const updated = { ...board, elements: previous };
    setBoard(updated);
    scheduleAutoSave(previous, viewState);
  }, [undoStack, board, viewState, scheduleAutoSave]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || !board) return;
    const next = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);

    setUndoStack((prev) => [...prev, board.elements]);
    setRedoStack(newRedo);

    const updated = { ...board, elements: next };
    setBoard(updated);
    scheduleAutoSave(next, viewState);
  }, [redoStack, board, viewState, scheduleAutoSave]);

  // -------------------------------------------------------------
  // 4. STICKY NOTES ACTIONS & CONVERT TO TASK
  // -------------------------------------------------------------
  const handleAddSticky = (color: StickyColor) => {
    if (!board) return;

    // Spawn note in center of current screen
    const screenCenterW = window.innerWidth / 2;
    const screenCenterH = window.innerHeight / 2;
    const worldX = Math.round((screenCenterW - viewState.panX) / viewState.zoom - 100);
    const worldY = Math.round((screenCenterH - viewState.panY) / viewState.zoom - 80);

    const newSticky: StickyElement = {
      id: `sticky_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'sticky',
      x: worldX,
      y: worldY,
      width: 200,
      height: 180,
      color,
      text: '',
    };

    handleElementsChange([...board.elements, newSticky], true);
    setSelectedElementId(newSticky.id);
  };

  const handleConvertToTask = async (sticky: StickyElement) => {
    if (!sticky.text.trim()) {
      toast.warning('Type a note before converting to a task');
      return;
    }

    try {
      const createdItem = await api.createItem({
        title: sticky.text.trim(),
        entity_type: 'task',
        priority: 'medium',
        project_id: board?.project_id || undefined,
        description: `Created from Whiteboard "${board?.title || 'Drawing Board'}"`,
      });

      // Mark sticky with task ID
      if (board) {
        const updated = board.elements.map((el) => {
          if (el.id === sticky.id && el.type === 'sticky') {
            return { ...el, convertedTaskId: createdItem.id };
          }
          return el;
        });
        handleElementsChange(updated, false);
      }

      toast.success(`Task "${createdItem.title}" created in Sage OS!`);
      onTaskCreated?.();
    } catch (err: any) {
      console.error('Failed to convert sticky to task:', err);
      toast.error('Could not convert sticky note to task');
    }
  };

  // -------------------------------------------------------------
  // 5. BOARD MANAGEMENT (Create, Select, Delete, Update Title)
  // -------------------------------------------------------------
  const handleSelectBoard = async (boardId: string) => {
    try {
      const b = await api.getWhiteboard(boardId);
      setBoard(b);
      setViewState(b.view_state || { panX: 0, panY: 0, zoom: 1 });
      setUndoStack([]);
      setRedoStack([]);
      setSelectedElementId(null);
    } catch (err) {
      console.error('Failed to switch whiteboard:', err);
      toast.error('Failed to switch whiteboard');
    }
  };

  const handleCreateNewBoard = async () => {
    try {
      const created = await api.createWhiteboard({
        title: `Whiteboard ${boardsList.length + 1}`,
        project_id: initialProjectId || null,
        elements: [],
        view_state: { panX: 0, panY: 0, zoom: 1 },
      });
      setBoard(created);
      setBoardsList((prev) => [
        {
          id: created.id,
          title: created.title,
          project_id: created.project_id,
          thumbnail_data: created.thumbnail_data,
          created_at: created.created_at,
          updated_at: created.updated_at,
        },
        ...prev,
      ]);
      setViewState({ panX: 0, panY: 0, zoom: 1 });
      setUndoStack([]);
      setRedoStack([]);
      toast.success(`Created "${created.title}"`);
    } catch (err) {
      console.error('Failed to create whiteboard:', err);
      toast.error('Could not create whiteboard');
    }
  };

  const handleDeleteCurrentBoard = async () => {
    if (!board) return;
    if (boardsList.length <= 1) {
      toast.warning('Cannot delete the only whiteboard');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete "${board.title}"?`)) {
      return;
    }

    try {
      await api.deleteWhiteboard(board.id);
      toast.info('Whiteboard deleted');
      const remaining = boardsList.filter((b) => b.id !== board.id);
      setBoardsList(remaining);
      if (remaining.length > 0) {
        handleSelectBoard(remaining[0].id);
      }
    } catch (err) {
      console.error('Failed to delete whiteboard:', err);
      toast.error('Failed to delete whiteboard');
    }
  };

  const handleUpdateTitle = async (newTitle: string) => {
    if (!board) return;
    const updated = { ...board, title: newTitle };
    setBoard(updated);
    setBoardsList((prev) =>
      prev.map((b) => (b.id === board.id ? { ...b, title: newTitle } : b))
    );
    scheduleAutoSave(board.elements, viewState, newTitle);
  };

  const handleUpdateProject = async (projectId: string | null) => {
    if (!board) return;
    const proj = projects.find((p) => p.id === projectId);
    const updated: Whiteboard = {
      ...board,
      project_id: projectId,
      project_name: proj?.name || null,
      project_color: proj?.color || null,
    };
    setBoard(updated);
    setBoardsList((prev) =>
      prev.map((b) =>
        b.id === board.id
          ? {
              ...b,
              project_id: projectId,
              project_name: proj?.name || null,
              project_color: proj?.color || null,
            }
          : b
      )
    );
    scheduleAutoSave(board.elements, viewState, board.title, projectId);
    toast.info(projectId ? `Linked to ${proj?.name}` : 'Unlinked from project');
  };

  // -------------------------------------------------------------
  // 6. EXPORT ACTIONS
  // -------------------------------------------------------------
  const handleExportPNG = async () => {
    if (!canvasRef.current || !board) return;
    try {
      const dataUrl = await canvasRef.current.exportToPNG();
      if (!dataUrl) return;
      const link = document.createElement('a');
      link.download = `${board.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Exported PNG image successfully');
    } catch (err) {
      console.error('Export PNG failed:', err);
      toast.error('Failed to export PNG');
    }
  };

  const handleExportSVG = () => {
    if (!canvasRef.current || !board) return;
    try {
      const svgString = canvasRef.current.exportToSVG();
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${board.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.svg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Exported SVG successfully');
    } catch (err) {
      console.error('Export SVG failed:', err);
      toast.error('Failed to export SVG');
    }
  };

  // -------------------------------------------------------------
  // 7. KEYBOARD SHORTCUTS
  // -------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool('select');
          break;
        case 'p':
          setActiveTool('pen');
          break;
        case 'h':
          setActiveTool('highlighter');
          break;
        case 'e':
          setActiveTool('eraser');
          break;
        case 's':
          setActiveTool('shape');
          break;
        case 'n':
          handleAddSticky('yellow');
          break;
        case 't':
          setActiveTool('text');
          break;
        case 'delete':
        case 'backspace':
          if (selectedElementId && board) {
            const remaining = board.elements.filter((el) => el.id !== selectedElementId);
            handleElementsChange(remaining, true);
            setSelectedElementId(null);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [board, selectedElementId, handleUndo, handleRedo, handleElementsChange]);

  if (loading || !board) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-medium">Loading Whiteboard from Pi...</p>
      </div>
    );
  }

  // Filter sticky elements for DOM overlay
  const stickyElements = board.elements.filter(
    (el): el is StickyElement => el.type === 'sticky'
  );

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] md:h-[calc(100vh-3.5rem)] bg-zinc-950 overflow-hidden select-none">
      {/* 1. TOP HEADER */}
      <WhiteboardHeader
        board={board}
        boardsList={boardsList}
        projects={projects}
        onSelectBoard={handleSelectBoard}
        onCreateNewBoard={handleCreateNewBoard}
        onDeleteCurrentBoard={handleDeleteCurrentBoard}
        onUpdateTitle={handleUpdateTitle}
        onUpdateProject={handleUpdateProject}
        zoom={viewState.zoom}
        onZoomIn={() => canvasRef.current?.zoomIn()}
        onZoomOut={() => canvasRef.current?.zoomOut()}
        onResetZoom={() => canvasRef.current?.resetView()}
        onFitToContent={() => canvasRef.current?.fitToContent()}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        isSaving={isSaving}
        onBack={onBack}
      />

      {/* 2. INFINITE VECTOR CANVAS */}
      <WhiteboardCanvas
        ref={canvasRef}
        elements={board.elements}
        onElementsChange={handleElementsChange}
        activeTool={activeTool}
        activeColor={activeColor}
        activeSize={activeSize}
        activeShape={activeShape}
        highlighterColor={highlighterColor}
        highlighterSize={highlighterSize}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        selectedElementId={selectedElementId}
        onSelectElementId={setSelectedElementId}
      />

      {/* 3. STICKY NOTES DOM OVERLAY (Synchronized via CSS Transform) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          style={{
            transform: `translate(${viewState.panX}px, ${viewState.panY}px) scale(${viewState.zoom})`,
            transformOrigin: '0 0',
            width: '100%',
            height: '100%',
            position: 'absolute',
          }}
        >
          {stickyElements.map((sticky) => (
            <StickyNoteOverlay
              key={sticky.id}
              sticky={sticky}
              isSelected={selectedElementId === sticky.id}
              onSelect={() => setSelectedElementId(sticky.id)}
              onUpdate={(updated) => {
                const nextElements = board.elements.map((el) =>
                  el.id === sticky.id ? ({ ...el, ...updated } as WhiteboardElement) : el
                );
                handleElementsChange(nextElements, false);
              }}
              onDelete={() => {
                const nextElements = board.elements.filter((el) => el.id !== sticky.id);
                handleElementsChange(nextElements, true);
                if (selectedElementId === sticky.id) setSelectedElementId(null);
              }}
              onConvertToTask={handleConvertToTask}
              zoom={viewState.zoom}
            />
          ))}
        </div>
      </div>

      {/* 4. SIGNATURE MICROSOFT WHITEBOARD FLOATING BOTTOM TOOLBAR */}
      <WhiteboardToolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        activeColor={activeColor}
        setActiveColor={setActiveColor}
        activeSize={activeSize}
        setActiveSize={setActiveSize}
        activeShape={activeShape}
        setActiveShape={setActiveShape}
        highlighterColor={highlighterColor}
        setHighlighterColor={setHighlighterColor}
        highlighterSize={highlighterSize}
        setHighlighterSize={setHighlighterSize}
        onAddSticky={handleAddSticky}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onClear={() => {
          if (board.elements.length === 0) return;
          if (window.confirm('Clear all drawings and notes on this whiteboard?')) {
            handleElementsChange([], true);
          }
        }}
      />
    </div>
  );
};
