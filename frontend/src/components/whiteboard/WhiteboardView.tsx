import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import {
  Whiteboard,
  WhiteboardListItem,
  WhiteboardElement,
  StickyElement,
  WhiteboardTool,
  WhiteboardGridType,
  ShapeType,
  StickyColor,
  ViewState,
  Project,
  Point,
} from '../../types';
import { WhiteboardCanvas, WhiteboardCanvasRef } from './WhiteboardCanvas';
import { WhiteboardToolbar } from './WhiteboardToolbar';
import { WhiteboardHeader } from './WhiteboardHeader';
import { StickyNoteOverlay } from './StickyNoteOverlay';
import { useToast } from '../../context/ToastContext';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface WhiteboardViewProps {
  initialProjectId?: string | null;
  projects?: Project[];
  onBack?: () => void;
  onTaskCreated?: () => void;
  edition?: 'day' | 'night';
}

export const WhiteboardView: React.FC<WhiteboardViewProps> = ({
  initialProjectId,
  projects = [],
  onBack,
  onTaskCreated,
  edition = 'day',
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
  const [activeColor, setActiveColor] = useState<string>(edition === 'night' ? '#FFFFFF' : '#1A1814');
  const [activeSize, setActiveSize] = useState<number>(4);
  const [activeShape, setActiveShape] = useState<ShapeType>('rectangle');
  const [highlighterColor, setHighlighterColor] = useState<string>('#facc15');
  const [highlighterSize, setHighlighterSize] = useState<number>(22);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // New Drafting Features
  const [gridType, setGridType] = useState<WhiteboardGridType>('dots');
  const [stylusOnly, setStylusOnly] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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

  // Sync pen color when edition flips
  useEffect(() => {
    if (edition === 'night' && activeColor === '#1A1814') {
      setActiveColor('#FFFFFF');
    } else if (edition === 'day' && activeColor === '#FFFFFF') {
      setActiveColor('#1A1814');
    }
  }, [edition]);

  // -------------------------------------------------------------
  // 2. AUTO-SAVE WITH DEBOUNCE (1s)
  // -------------------------------------------------------------
  const scheduleAutoSave = useCallback(
    (elementsToSave: WhiteboardElement[], viewToSave: ViewState, titleToSave?: string, projId?: string | null) => {
      if (!board) return;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      setIsSaving(true);
      saveTimeoutRef.current = window.setTimeout(async () => {
        try {
          // Generate thumbnail snapshot if elements exist
          let thumb: string | undefined = undefined;
          if (canvasRef.current && elementsToSave.length > 0) {
            try {
              thumb = await canvasRef.current.exportToPNG();
            } catch (e) {
              // Ignore thumbnail failure
            }
          }

          await api.updateWhiteboard(board.id, {
            title: titleToSave !== undefined ? titleToSave : board.title,
            project_id: projId !== undefined ? projId : board.project_id,
            elements: elementsToSave,
            view_state: viewToSave,
            thumbnail_data: thumb,
          });

          setIsSaving(false);
        } catch (err) {
          console.error('Auto-save whiteboard failed:', err);
          setIsSaving(false);
          toast.error('Auto-save failed. Check connection to Pi.');
        }
      }, 1000);
    },
    [board, toast]
  );

  // -------------------------------------------------------------
  // 3. ELEMENT MUTATION & UNDO/REDO
  // -------------------------------------------------------------
  const handleElementsChange = useCallback(
    (newElements: WhiteboardElement[], recordHistory: boolean = false) => {
      if (!board) return;

      if (recordHistory) {
        setUndoStack((prev) => [...prev.slice(-30), board.elements]);
        setRedoStack([]);
      }

      setBoard((prev) => (prev ? { ...prev, elements: newElements } : null));
      scheduleAutoSave(newElements, viewState);
    },
    [board, viewState, scheduleAutoSave]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !board) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, board.elements]);

    setBoard((prev) => (prev ? { ...prev, elements: previous } : null));
    scheduleAutoSave(previous, viewState);
  }, [undoStack, board, viewState, scheduleAutoSave]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || !board) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, board.elements]);

    setBoard((prev) => (prev ? { ...prev, elements: next } : null));
    scheduleAutoSave(next, viewState);
  }, [redoStack, board, viewState, scheduleAutoSave]);

  // -------------------------------------------------------------
  // 4. VIEW STATE CHANGE (Pan & Zoom)
  // -------------------------------------------------------------
  const handleViewStateChange = useCallback(
    (newView: ViewState) => {
      setViewState(newView);
      if (board) {
        scheduleAutoSave(board.elements, newView);
      }
    },
    [board, scheduleAutoSave]
  );

  // -------------------------------------------------------------
  // 5. STICKY NOTES DISPATCH & CREATION
  // -------------------------------------------------------------
  const handleAddSticky = (color: StickyColor, customPos?: Point) => {
    if (!board) return;

    let posX = -viewState.panX / viewState.zoom + 200;
    let posY = -viewState.panY / viewState.zoom + 160;

    if (customPos) {
      posX = customPos.x - 100;
      posY = customPos.y - 70;
    }

    const newSticky: StickyElement = {
      id: `sticky_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'sticky',
      x: Math.round(posX),
      y: Math.round(posY),
      width: 220,
      height: 160,
      color,
      text: '',
    };

    const nextElements = [...board.elements, newSticky];
    handleElementsChange(nextElements, true);
    setSelectedElementId(newSticky.id);
  };

  const handleConvertToTask = async (sticky: StickyElement) => {
    const trimmed = sticky.text.trim();
    if (!trimmed) {
      toast.warning('Type some text in the note before dispatching as a task.');
      return;
    }

    try {
      const created = await api.createItem({
        title: trimmed,
        project_id: board?.project_id || undefined,
        entity_type: 'task',
        priority: 'medium',
        status: 'todo',
      });

      // Stamp the sticky note as converted
      const nextElements = board?.elements.map((el) =>
        el.id === sticky.id ? ({ ...el, convertedTaskId: created.id } as WhiteboardElement) : el
      );

      if (nextElements) {
        handleElementsChange(nextElements, true);
      }

      toast.success('Dispatched to Docket: Task created!');
      if (onTaskCreated) onTaskCreated();
    } catch (err) {
      console.error('Failed to convert sticky to task:', err);
      toast.error('Failed to dispatch task to server');
    }
  };

  // -------------------------------------------------------------
  // 6. BOARD MANAGEMENT
  // -------------------------------------------------------------
  const handleSelectBoard = async (boardId: string) => {
    try {
      setLoading(true);
      const full = await api.getWhiteboard(boardId);
      setBoard(full);
      setViewState(full.view_state || { panX: 0, panY: 0, zoom: 1 });
      setUndoStack([]);
      setRedoStack([]);
    } catch (e) {
      toast.error('Failed to load selected whiteboard');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewBoard = async () => {
    try {
      const created = await api.createWhiteboard({
        title: `Drafting Board ${boardsList.length + 1}`,
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
      toast.success('New drafting board created');
    } catch (e) {
      toast.error('Failed to create new board');
    }
  };

  const handleDeleteCurrentBoard = async () => {
    if (!board) return;
    if (boardsList.length <= 1) {
      toast.warning('Cannot delete the last remaining whiteboard.');
      return;
    }

    try {
      await api.deleteWhiteboard(board.id);
      toast.info('Drafting board deleted');
      const nextList = boardsList.filter((b) => b.id !== board.id);
      setBoardsList(nextList);
      if (nextList.length > 0) {
        handleSelectBoard(nextList[0].id);
      }
    } catch (e) {
      toast.error('Failed to delete whiteboard');
    }
  };

  const handleUpdateTitle = (newTitle: string) => {
    if (!board) return;
    const updated = { ...board, title: newTitle };
    setBoard(updated);
    setBoardsList((prev) => prev.map((b) => (b.id === board.id ? { ...b, title: newTitle } : b)));
    scheduleAutoSave(board.elements, viewState, newTitle);
  };

  const handleUpdateProject = (projectId: string | null) => {
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
  // 7. EXPORT ACTIONS
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
  // 8. KEYBOARD SHORTCUTS
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
        case 'l':
          setActiveTool('laser');
          break;
        case 'm':
          setActiveTool('highlighter');
          break;
        case 'e':
          setActiveTool('eraser');
          break;
        case 'u':
          setActiveTool('shape');
          break;
        case 's':
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
      <div className={`w-full h-full flex flex-col items-center justify-center ${edition === 'night' ? 'bg-[#141311] text-stone-400' : 'bg-paper-base text-ink-muted'}`}>
        <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs font-ledger uppercase tracking-wider font-bold">Synchronizing Drafting Room from Pi...</p>
      </div>
    );
  }

  // Filter sticky elements for DOM overlay
  const stickyElements = board.elements.filter(
    (el): el is StickyElement => el.type === 'sticky'
  );

  return (
    <div className={`relative w-full h-[calc(100vh-4rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden select-none ${edition === 'night' ? 'bg-[#141311]' : 'bg-[#F5F1E8]'}`}>
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
        gridType={gridType}
        onSelectGrid={setGridType}
        stylusOnly={stylusOnly}
        onToggleStylusOnly={() => setStylusOnly((prev) => !prev)}
        edition={edition}
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
        edition={edition}
        gridType={gridType}
        stylusOnly={stylusOnly}
        onCanvasDoubleClick={(pt) => handleAddSticky('yellow', pt)}
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

      {/* 4. PHYSICAL DRAFTING RACK TOOLBAR */}
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
        onAddSticky={(col) => handleAddSticky(col)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onClear={() => {
          if (board.elements.length === 0) return;
          setShowClearConfirm(true);
        }}
        edition={edition}
      />

      {/* Clear Board Cautionary Notice */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear Drawing Canvas?"
        message="All inking strokes, geometry shapes, and sticky clippings on this drafting board will be cleared. This action can be undone with Ctrl+Z."
        confirmText="Clear Canvas"
        cancelText="Cancel"
        isDestructive={true}
        onConfirm={() => {
          handleElementsChange([], true);
          setShowClearConfirm(false);
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
};
