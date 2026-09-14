import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../../services/api';
import {
  Whiteboard,
  WhiteboardListItem,
  WhiteboardElement,
  StickyElement,
  ImageElement,
  TextElement,
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
import { WhiteboardMinimap } from './WhiteboardMinimap';
import { WhiteboardBottomSheet } from './WhiteboardBottomSheet';
import { StickyNoteOverlay } from './StickyNoteOverlay';
import { WhiteboardFloatingBar } from './WhiteboardFloatingBar';
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const [activeFillColor, setActiveFillColor] = useState<string | null>(null);
  const [highlighterColor, setHighlighterColor] = useState<string>('#facc15');
  const [highlighterSize, setHighlighterSize] = useState<number>(22);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());

  // Mobile Bottom Sheet
  const [isMoreSheetOpen, setIsMoreSheetOpen] = useState(false);

  // Drafting Settings
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
    setSelectedElementIds(new Set([newSticky.id]));
    setActiveTool('select');
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
  // 6. IMAGE INSERTION (Paste & Drag-and-Drop)
  // -------------------------------------------------------------
  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const insertImageFile = useCallback(
    async (file: File) => {
      if (!board) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        const img = new Image();
        img.onload = () => {
          const maxW = 480;
          const maxH = 360;
          const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
          const w = Math.round(img.width * ratio);
          const h = Math.round(img.height * ratio);
          const cx = (window.innerWidth / 2 - viewState.panX) / viewState.zoom;
          const cy = (window.innerHeight / 2 - viewState.panY) / viewState.zoom;

          const newImg: ImageElement = {
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'image',
            x: Math.round(cx - w / 2),
            y: Math.round(cy - h / 2),
            width: w,
            height: h,
            dataUrl,
          };

          handleElementsChange([...board.elements, newImg], true);
          setSelectedElementId(newImg.id);
          setSelectedElementIds(new Set([newImg.id]));
          setActiveTool('select');
          toast.success('Image clipping placed onto canvas');
        };
        img.src = dataUrl;
      } catch (err) {
        console.error('Failed to load image file', err);
        toast.error('Could not load image file');
      }
    },
    [board, viewState, handleElementsChange, toast]
  );

  // Global Clipboard Paste Listener
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept paste if typing in an input or textarea
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      const items = Array.from(e.clipboardData?.items || []);
      const imgItem = items.find((i) => i.type.startsWith('image/'));
      if (!imgItem) return;

      e.preventDefault();
      const file = imgItem.getAsFile();
      if (file) insertImageFile(file);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [insertImageFile]);

  // -------------------------------------------------------------
  // 7. BOARD MANAGEMENT
  // -------------------------------------------------------------
  const handleSelectBoard = async (boardId: string) => {
    try {
      setLoading(true);
      const full = await api.getWhiteboard(boardId);
      setBoard(full);
      setViewState(full.view_state || { panX: 0, panY: 0, zoom: 1 });
      setUndoStack([]);
      setRedoStack([]);
      setSelectedElementId(null);
      setSelectedElementIds(new Set());
    } catch (err) {
      console.error('Failed to fetch board:', err);
      toast.error('Failed to switch boards');
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
      setBoardsList((prev) => [
        ...prev,
        {
          id: created.id,
          title: created.title,
          project_id: created.project_id,
          thumbnail_data: created.thumbnail_data,
          created_at: created.created_at,
          updated_at: created.updated_at,
        },
      ]);
      setBoard(created);
      setViewState({ panX: 0, panY: 0, zoom: 1 });
      setUndoStack([]);
      setRedoStack([]);
      setSelectedElementId(null);
      setSelectedElementIds(new Set());
      toast.success('New drafting board created');
    } catch (err) {
      console.error('Failed to create board:', err);
      toast.error('Could not create board');
    }
  };

  const handleDeleteCurrentBoard = async () => {
    if (!board) return;
    if (boardsList.length <= 1) {
      toast.warning('Cannot delete the last remaining drawing board.');
      return;
    }

    try {
      await api.deleteWhiteboard(board.id);
      const remaining = boardsList.filter((b) => b.id !== board.id);
      setBoardsList(remaining);
      if (remaining.length > 0) {
        handleSelectBoard(remaining[0].id);
      }
      toast.success('Drafting board deleted');
    } catch (err) {
      console.error('Failed to delete board:', err);
      toast.error('Could not delete board');
    }
  };

  const handleUpdateTitle = async (newTitle: string) => {
    if (!board || !newTitle.trim()) return;
    setBoard((prev) => (prev ? { ...prev, title: newTitle.trim() } : null));
    setBoardsList((prev) =>
      prev.map((b) => (b.id === board.id ? { ...b, title: newTitle.trim() } : b))
    );
    scheduleAutoSave(board.elements, viewState, newTitle.trim());
  };

  const handleUpdateProject = async (projId: string | null) => {
    if (!board) return;
    const proj = projects.find((p) => p.id === projId);
    setBoard((prev) =>
      prev
        ? {
            ...prev,
            project_id: projId,
            project_name: proj?.name || null,
            project_color: proj?.color || null,
          }
        : null
    );
    setBoardsList((prev) =>
      prev.map((b) =>
        b.id === board.id
          ? {
              ...b,
              project_id: projId,
              project_name: proj?.name || null,
              project_color: proj?.color || null,
            }
          : b
      )
    );
    scheduleAutoSave(board.elements, viewState, undefined, projId);
  };

  // -------------------------------------------------------------
  // 8. EXPORT ACTIONS
  // -------------------------------------------------------------
  const handleExportPNG = async () => {
    if (!canvasRef.current || !board) return;
    try {
      const dataUrl = await canvasRef.current.exportToPNG();
      if (!dataUrl) {
        toast.warning('Drawing board is empty.');
        return;
      }
      const link = document.createElement('a');
      link.download = `${board.title.replace(/\s+/g, '_')}_blueprint.png`;
      link.href = dataUrl;
      link.click();
      toast.success('Exported PNG Blueprint snapshot');
    } catch (err) {
      console.error('Export PNG failed:', err);
      toast.error('Failed to export PNG');
    }
  };

  const handleExportSVG = () => {
    if (!canvasRef.current || !board) return;
    try {
      const svg = canvasRef.current.exportToSVG();
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${board.title.replace(/\s+/g, '_')}_vector.svg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Exported SVG Vector Blueprint');
    } catch (err) {
      console.error('Export SVG failed:', err);
      toast.error('Failed to export SVG');
    }
  };

  // -------------------------------------------------------------
  // 8. SELECTION MANIPULATION (Floating Bar & In-Place Editing)
  // -------------------------------------------------------------
  const currentSelectedElements = useMemo(() => {
    if (!board) return [];
    if (selectedElementIds && selectedElementIds.size > 0) {
      return board.elements.filter((el) => selectedElementIds.has(el.id));
    }
    if (selectedElementId) {
      const el = board.elements.find((item) => item.id === selectedElementId);
      return el ? [el] : [];
    }
    return [];
  }, [board, selectedElementId, selectedElementIds]);

  const handleUpdateSelectedElements = useCallback(
    (updated: WhiteboardElement[]) => {
      if (!board) return;
      const updateMap = new Map(updated.map((u) => [u.id, u]));
      const nextElements = board.elements.map((el) => updateMap.get(el.id) || el);
      handleElementsChange(nextElements, true);
    },
    [board, handleElementsChange]
  );

  const handleDeleteSelectedElements = useCallback(() => {
    if (!board || currentSelectedElements.length === 0) return;
    const deleteIds = new Set(currentSelectedElements.map((el) => el.id));
    const nextElements = board.elements.filter((el) => !deleteIds.has(el.id));
    handleElementsChange(nextElements, true);
    setSelectedElementId(null);
    setSelectedElementIds(new Set());
    toast.success(`Deleted ${currentSelectedElements.length} element${currentSelectedElements.length > 1 ? 's' : ''}`);
  }, [board, currentSelectedElements, handleElementsChange, toast]);

  const handleDuplicateSelectedElements = useCallback(() => {
    if (!board || currentSelectedElements.length === 0) return;
    const offset = 24 / viewState.zoom;
    const newSelectedIds = new Set<string>();
    const duplicated: WhiteboardElement[] = currentSelectedElements.map((el) => {
      const newId = `${el.type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      newSelectedIds.add(newId);
      if (el.type === 'shape' || el.type === 'text' || el.type === 'image' || el.type === 'sticky') {
        return {
          ...el,
          id: newId,
          x: el.x + offset,
          y: el.y + offset,
        };
      } else if (el.type === 'stroke') {
        return {
          ...el,
          id: newId,
          points: el.points.map((p) => ({
            ...p,
            x: p.x + offset,
            y: p.y + offset,
          })),
        };
      }
      return { ...(el as any), id: newId };
    });

    handleElementsChange([...board.elements, ...duplicated], true);
    setSelectedElementIds(newSelectedIds);
    if (newSelectedIds.size === 1) {
      setSelectedElementId(Array.from(newSelectedIds)[0]);
    }
    toast.success(`Duplicated ${currentSelectedElements.length} element${currentSelectedElements.length > 1 ? 's' : ''}`);
  }, [board, currentSelectedElements, viewState.zoom, handleElementsChange, toast]);

  const handleBringToFront = useCallback(() => {
    if (!board || currentSelectedElements.length === 0) return;
    const targetIds = new Set(currentSelectedElements.map((el) => el.id));
    const nonSelected = board.elements.filter((el) => !targetIds.has(el.id));
    const selected = board.elements.filter((el) => targetIds.has(el.id));
    handleElementsChange([...nonSelected, ...selected], true);
  }, [board, currentSelectedElements, handleElementsChange]);

  const handleSendToBack = useCallback(() => {
    if (!board || currentSelectedElements.length === 0) return;
    const targetIds = new Set(currentSelectedElements.map((el) => el.id));
    const nonSelected = board.elements.filter((el) => !targetIds.has(el.id));
    const selected = board.elements.filter((el) => targetIds.has(el.id));
    handleElementsChange([...selected, ...nonSelected], true);
  }, [board, currentSelectedElements, handleElementsChange]);

  const handleEditText = useCallback((textEl: TextElement) => {
    canvasRef.current?.editTextElement(textEl.id);
  }, []);

  const handleToolbarColorChange = useCallback(
    (newColor: string) => {
      setActiveColor(newColor);
      if (currentSelectedElements.length > 0 && board) {
        const selectedIds = new Set(currentSelectedElements.map((e) => e.id));
        const next = board.elements.map((el) => {
          if (selectedIds.has(el.id) && (el.type === 'shape' || el.type === 'stroke' || el.type === 'text')) {
            return { ...el, color: newColor };
          }
          return el;
        });
        handleElementsChange(next, true);
      }
    },
    [currentSelectedElements, board, handleElementsChange]
  );

  const handleToolbarSizeChange = useCallback(
    (newSize: number) => {
      setActiveSize(newSize);
      if (currentSelectedElements.length > 0 && board) {
        const selectedIds = new Set(currentSelectedElements.map((e) => e.id));
        const next = board.elements.map((el) => {
          if (selectedIds.has(el.id)) {
            if (el.type === 'stroke') return { ...el, size: newSize };
            if (el.type === 'shape') return { ...el, strokeWidth: newSize };
            if (el.type === 'text') return { ...el, fontSize: Math.max(16, newSize * 4.5) };
          }
          return el;
        });
        handleElementsChange(next, true);
      }
    },
    [currentSelectedElements, board, handleElementsChange]
  );

  const handleToolbarFillChange = useCallback(
    (newFill: string | null) => {
      setActiveFillColor(newFill);
      if (currentSelectedElements.length > 0 && board) {
        const selectedIds = new Set(currentSelectedElements.map((e) => e.id));
        const next = board.elements.map((el) => {
          if (selectedIds.has(el.id) && el.type === 'shape') {
            return { ...el, fillColor: newFill ?? undefined };
          }
          return el;
        });
        handleElementsChange(next, true);
      }
    },
    [currentSelectedElements, board, handleElementsChange]
  );

  // Keyboard Shortcuts (Undo / Redo / Delete / Duplicate)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicateSelectedElements();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (currentSelectedElements.length > 0) {
          e.preventDefault();
          handleDeleteSelectedElements();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleUndo,
    handleRedo,
    handleDuplicateSelectedElements,
    handleDeleteSelectedElements,
    currentSelectedElements.length,
  ]);

  if (loading || !board) {
    return (
      <div
        className={`w-full h-[calc(100dvh-4rem)] md:h-[calc(100dvh-3.5rem)] flex flex-col items-center justify-center ${
          edition === 'night' ? 'bg-[#141311] text-stone-300' : 'bg-[#F5F1E8] text-ink-primary'
        }`}
      >
        <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs font-ledger uppercase tracking-wider font-bold">
          Synchronizing Drafting Room from Pi...
        </p>
      </div>
    );
  }

  // Filter sticky elements for DOM overlay
  const stickyElements = board.elements.filter(
    (el): el is StickyElement => el.type === 'sticky'
  );

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith('image/')) {
          insertImageFile(file);
        }
      }}
      className={`relative w-full h-[calc(100dvh-4rem)] md:h-[calc(100dvh-3.5rem)] overflow-hidden select-none ${
        edition === 'night' ? 'bg-[#141311]' : 'bg-[#F5F1E8]'
      }`}
    >
      {/* Hidden File Input for Image Upload */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            insertImageFile(file);
            e.target.value = '';
          }
        }}
      />

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
        setActiveTool={setActiveTool}
        activeColor={activeColor}
        activeSize={activeSize}
        activeShape={activeShape}
        activeFillColor={activeFillColor}
        highlighterColor={highlighterColor}
        highlighterSize={highlighterSize}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        selectedElementId={selectedElementId}
        onSelectElementId={setSelectedElementId}
        selectedElementIds={selectedElementIds}
        onSelectElementIds={setSelectedElementIds}
        edition={edition}
        gridType={gridType}
        stylusOnly={stylusOnly}
        onStylusDetected={() => setStylusOnly(true)}
        onCanvasDoubleClick={(pt) => handleAddSticky('yellow', pt)}
      />

      {/* FLOATING CONTEXTUAL ACTION BAR FOR SELECTED ELEMENTS */}
      {currentSelectedElements.length > 0 && (
        <WhiteboardFloatingBar
          selectedElements={currentSelectedElements}
          viewState={viewState}
          onUpdateElements={handleUpdateSelectedElements}
          onDeleteElements={handleDeleteSelectedElements}
          onDuplicateElements={handleDuplicateSelectedElements}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          onEditText={handleEditText}
          edition={edition}
        />
      )}

      {/* 3. STICKY NOTES DOM OVERLAY */}
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

      {/* 4. OVERVIEW MINIMAP (Desktop / Tablet) */}
      <div className="hidden sm:block absolute bottom-20 right-4 z-30 pointer-events-auto">
        <WhiteboardMinimap
          elements={board.elements}
          viewState={viewState}
          canvasWidth={typeof window !== 'undefined' ? window.innerWidth : 1200}
          canvasHeight={typeof window !== 'undefined' ? window.innerHeight : 800}
          onPanTo={(panX, panY) => setViewState((prev) => ({ ...prev, panX, panY }))}
          edition={edition}
        />
      </div>

      {/* 5. PHYSICAL DRAFTING RACK TOOLBAR */}
      <WhiteboardToolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        activeColor={activeColor}
        setActiveColor={handleToolbarColorChange}
        activeSize={activeSize}
        setActiveSize={handleToolbarSizeChange}
        activeShape={activeShape}
        setActiveShape={setActiveShape}
        activeFillColor={activeFillColor}
        setActiveFillColor={handleToolbarFillChange}
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
        onTriggerImageUpload={() => fileInputRef.current?.click()}
        onOpenMoreSheet={() => setIsMoreSheetOpen(true)}
        edition={edition}
      />

      {/* 6. MOBILE EXPANDED BOTTOM SHEET */}
      <WhiteboardBottomSheet
        isOpen={isMoreSheetOpen}
        onClose={() => setIsMoreSheetOpen(false)}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onClear={() => {
          if (board.elements.length === 0) return;
          setShowClearConfirm(true);
        }}
        onTriggerImageUpload={() => fileInputRef.current?.click()}
        edition={edition}
      />

      {/* Clear Board Cautionary Notice */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear Drawing Canvas?"
        message="All inking strokes, geometry shapes, images, and sticky clippings on this drafting board will be cleared. This action can be undone with Ctrl+Z."
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
