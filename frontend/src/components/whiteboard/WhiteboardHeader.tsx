import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Plus,
  Folder,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Check,
  Edit2,
  Share2,
  Trash2,
  ArrowLeft,
  Grid,
  PenTool
} from 'lucide-react';
import { Whiteboard, WhiteboardListItem, Project, WhiteboardGridType } from '../../types';

interface WhiteboardHeaderProps {
  board: Whiteboard;
  boardsList: WhiteboardListItem[];
  projects: Project[];
  onSelectBoard: (boardId: string) => void;
  onCreateNewBoard: () => void;
  onDeleteCurrentBoard: () => void;
  onUpdateTitle: (title: string) => void;
  onUpdateProject: (projectId: string | null) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToContent: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  isSaving: boolean;
  onBack?: () => void;
  gridType?: WhiteboardGridType;
  onSelectGrid?: (grid: WhiteboardGridType) => void;
  stylusOnly?: boolean;
  onToggleStylusOnly?: () => void;
}

/*
 * The paper under the drawing, named for what it looks like.
 *
 * These read "Architect Dots", "Blueprint Graph" and "Pure unlined
 * parchment". The board is a place to think, not a period drama, so each one
 * now says what it is.
 */
const GRID_OPTIONS: { type: WhiteboardGridType; label: string; desc: string }[] = [
  { type: 'dots', label: 'Dots', desc: 'Alignment dots every 28px' },
  { type: 'graph', label: 'Graph', desc: 'A fine square grid' },
  { type: 'ruled', label: 'Ruled', desc: 'Horizontal lines, like paper' },
  { type: 'blank', label: 'Blank', desc: 'Nothing at all' },
];

/* One control, one height, so the row lines up and every target is tappable. */
const CONTROL =
  'h-9 inline-flex items-center gap-1.5 px-2.5 rounded-control border border-hairline ' +
  'bg-surface text-ink-2 hover:text-ink hover:bg-sunken transition-colors';
const ICON_CONTROL =
  'w-9 h-9 grid place-items-center rounded-control border border-hairline ' +
  'bg-surface text-ink-2 hover:text-ink hover:bg-sunken transition-colors';
const MENU =
  'absolute top-full mt-2 p-1.5 bg-surface border border-hairline rounded-surface shadow-lift-2 ' +
  'z-50 animate-in fade-in slide-in-from-top-1 duration-150';
const MENU_HEADING = 'px-2 py-1 text-caption text-ink-3';
const MENU_ITEM =
  'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-control text-meta ' +
  'text-left text-ink-2 hover:text-ink hover:bg-sunken transition-colors';
const MENU_ITEM_ON = 'bg-sunken text-ink font-medium';

export const WhiteboardHeader: React.FC<WhiteboardHeaderProps> = ({
  board,
  boardsList,
  projects,
  onSelectBoard,
  onCreateNewBoard,
  onDeleteCurrentBoard,
  onUpdateTitle,
  onUpdateProject,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToContent,
  onExportPNG,
  onExportSVG,
  isSaving,
  onBack,
  gridType = 'dots',
  onSelectGrid,
  stylusOnly = false,
  onToggleStylusOnly,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(board.title);
  const [showBoardsDropdown, setShowBoardsDropdown] = useState(false);
  const [showProjectsDropdown, setShowProjectsDropdown] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [showGridDropdown, setShowGridDropdown] = useState(false);

  const boardsDropdownRef = useRef<HTMLDivElement>(null);
  const projectsDropdownRef = useRef<HTMLDivElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const gridDropdownRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleInput(board.title);
  }, [board.title]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Click outside listener
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (boardsDropdownRef.current && !boardsDropdownRef.current.contains(e.target as Node)) {
        setShowBoardsDropdown(false);
      }
      if (projectsDropdownRef.current && !projectsDropdownRef.current.contains(e.target as Node)) {
        setShowProjectsDropdown(false);
      }
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setShowExportDropdown(false);
      }
      if (gridDropdownRef.current && !gridDropdownRef.current.contains(e.target as Node)) {
        setShowGridDropdown(false);
      }
    };
    window.addEventListener('mousedown', handleDown);
    return () => window.removeEventListener('mousedown', handleDown);
  }, []);

  // Escape closes whichever menu is open, before the canvas hears the key.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showBoardsDropdown || showProjectsDropdown || showExportDropdown || showGridDropdown) {
        e.stopPropagation();
        setShowBoardsDropdown(false);
        setShowProjectsDropdown(false);
        setShowExportDropdown(false);
        setShowGridDropdown(false);
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [showBoardsDropdown, showProjectsDropdown, showExportDropdown, showGridDropdown]);

  const handleTitleSubmit = () => {
    const trimmed = titleInput.trim();
    if (trimmed && trimmed !== board.title) {
      onUpdateTitle(trimmed);
    } else {
      setTitleInput(board.title);
    }
    setIsEditingTitle(false);
  };

  const currentProject = projects.find((p) => p.id === board.project_id);

  return (
    /*
     * The bar sits on the app's own surface rather than on a hand-mixed
     * near-black, so it follows Light, Dark and System like every other
     * screen instead of being dark in a light app.
     */
    <header className="absolute top-0 left-0 right-0 z-30 h-14 px-3 sm:px-4 flex items-center justify-between select-none bg-surface/90 backdrop-blur-xl border-b border-hairline text-ink">
      {/* LEFT: back, which board, what it is called, what it belongs to */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        {onBack && (
          <button type="button" onClick={onBack} className={ICON_CONTROL} title="Back to projects" aria-label="Back to projects">
            <ArrowLeft size={16} />
          </button>
        )}

        {/* Board switcher */}
        <div ref={boardsDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setShowBoardsDropdown((prev) => !prev)}
            className={CONTROL}
            aria-haspopup="menu"
            aria-expanded={showBoardsDropdown}
          >
            <span className="max-w-[120px] sm:max-w-[180px] truncate text-meta font-medium text-ink">
              {board.title || 'Untitled board'}
            </span>
            <ChevronDown size={13} className="text-ink-3" />
          </button>

          {showBoardsDropdown && (
            <div className={`${MENU} left-0 w-64`} role="menu">
              <div className={MENU_HEADING}>Boards</div>
              <div className="max-h-60 overflow-y-auto space-y-0.5">
                {boardsList.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSelectBoard(b.id);
                      setShowBoardsDropdown(false);
                    }}
                    className={`${MENU_ITEM} ${b.id === board.id ? MENU_ITEM_ON : ''}`}
                  >
                    <span className="truncate">{b.title}</span>
                    {b.id === board.id && <Check size={13} className="shrink-0 text-accent-500" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-hairline my-1" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCreateNewBoard();
                  setShowBoardsDropdown(false);
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-control text-meta font-medium text-accent-600 dark:text-accent-400 hover:bg-sunken transition-colors"
              >
                <Plus size={14} />
                <span>New board</span>
              </button>
            </div>
          )}
        </div>

        {/* Rename */}
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            aria-label="Board name"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSubmit();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setTitleInput(board.title);
                setIsEditingTitle(false);
              }
            }}
            className="h-9 px-2.5 text-meta bg-surface border border-accent-500 rounded-control text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingTitle(true)}
            className={`${ICON_CONTROL} border-transparent bg-transparent`}
            title="Rename this board"
            aria-label="Rename this board"
          >
            <Edit2 size={14} />
          </button>
        )}

        {/* Project link */}
        <div ref={projectsDropdownRef} className="relative hidden md:block">
          <button
            type="button"
            onClick={() => setShowProjectsDropdown((prev) => !prev)}
            className={CONTROL}
            aria-haspopup="menu"
            aria-expanded={showProjectsDropdown}
          >
            <Folder
              size={13}
              style={{ color: currentProject?.color || undefined }}
              className={currentProject?.color ? undefined : 'text-ink-3'}
            />
            <span className="max-w-[120px] truncate text-meta">
              {currentProject ? currentProject.name : 'No project'}
            </span>
            <ChevronDown size={11} className="text-ink-3" />
          </button>

          {showProjectsDropdown && (
            <div className={`${MENU} left-0 w-56`} role="menu">
              <div className={MENU_HEADING}>Project</div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onUpdateProject(null);
                  setShowProjectsDropdown(false);
                }}
                className={`${MENU_ITEM} ${!board.project_id ? MENU_ITEM_ON : ''}`}
              >
                <span>No project</span>
                {!board.project_id && <Check size={13} className="text-accent-500" />}
              </button>
              <div className="max-h-48 overflow-y-auto space-y-0.5 mt-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onUpdateProject(p.id);
                      setShowProjectsDropdown(false);
                    }}
                    className={`${MENU_ITEM} ${board.project_id === p.id ? MENU_ITEM_ON : ''}`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: p.color || 'currentColor' }}
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                    {board.project_id === p.id && <Check size={13} className="shrink-0 text-accent-500" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/*
         * Saved state. It used to shout SAVING... and DRAFT SAVED in caps at
         * all times; the steady state of a board is saved, so the quiet word
         * is enough and the dot carries the change.
         */}
        <div className="hidden lg:flex items-center gap-1.5 ml-1 text-caption text-ink-3" aria-live="polite">
          <span
            className={`w-1.5 h-1.5 rounded-full ${isSaving ? 'bg-late-500 animate-pulse' : 'bg-done-500'}`}
            aria-hidden="true"
          />
          <span>{isSaving ? 'Saving' : 'Saved'}</span>
        </div>
      </div>

      {/* RIGHT: the paper, the pen, the zoom, and what leaves the app */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {onSelectGrid && (
          <div ref={gridDropdownRef} className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setShowGridDropdown((prev) => !prev)}
              className={CONTROL}
              title="Change the grid"
              aria-haspopup="menu"
              aria-expanded={showGridDropdown}
            >
              <Grid size={13} />
              <span className="text-meta capitalize">{gridType}</span>
              <ChevronDown size={11} className="text-ink-3" />
            </button>

            {showGridDropdown && (
              <div className={`${MENU} right-0 w-52`} role="menu">
                <div className={MENU_HEADING}>Grid</div>
                {GRID_OPTIONS.map((g) => (
                  <button
                    key={g.type}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSelectGrid(g.type);
                      setShowGridDropdown(false);
                    }}
                    className={`w-full flex flex-col px-2 py-1.5 rounded-control text-left transition-colors text-ink-2 hover:text-ink hover:bg-sunken ${
                      gridType === g.type ? MENU_ITEM_ON : ''
                    }`}
                  >
                    <span className="flex items-center justify-between w-full text-meta">
                      <span>{g.label}</span>
                      {gridType === g.type && <Check size={12} className="text-accent-500" />}
                    </span>
                    <span className="text-caption text-ink-3">{g.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/*
         * Palm rejection. The label says what the board will do with a
         * finger, which is the thing being chosen.
         */}
        {onToggleStylusOnly && (
          <button
            type="button"
            onClick={onToggleStylusOnly}
            aria-pressed={stylusOnly}
            className={
              stylusOnly
                ? 'h-9 inline-flex items-center gap-1.5 px-2.5 rounded-control border border-accent-500 bg-accent-500 text-white transition-colors'
                : CONTROL
            }
            title={stylusOnly ? 'Pen draws; a finger pans and zooms' : 'A finger draws as well as the pen'}
          >
            <PenTool size={13} />
            <span className="hidden md:inline text-meta">{stylusOnly ? 'Pen only' : 'Pen and touch'}</span>
          </button>
        )}

        {/* Zoom */}
        <div className="h-9 flex items-center rounded-control border border-hairline bg-surface text-ink-2">
          <button type="button" onClick={onZoomOut} className="w-8 h-full grid place-items-center hover:text-ink transition-colors" title="Zoom out" aria-label="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={onResetZoom}
            className="px-1.5 text-meta tabular-nums hover:text-ink transition-colors"
            title="Back to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={onZoomIn} className="w-8 h-full grid place-items-center hover:text-ink transition-colors" title="Zoom in" aria-label="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={onFitToContent}
            className="w-8 h-full grid place-items-center border-l border-hairline hover:text-ink transition-colors"
            title="Fit everything on screen"
            aria-label="Fit everything on screen"
          >
            <Maximize2 size={12} />
          </button>
        </div>

        {/* Export */}
        <div ref={exportDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setShowExportDropdown((prev) => !prev)}
            className={CONTROL}
            title="Export this board"
            aria-haspopup="menu"
            aria-expanded={showExportDropdown}
          >
            <Download size={13} />
            <span className="hidden sm:inline text-meta">Export</span>
          </button>

          {showExportDropdown && (
            <div className={`${MENU} right-0 w-52`} role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onExportPNG();
                  setShowExportDropdown(false);
                }}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-control text-left text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
              >
                <Download size={13} className="shrink-0" />
                <span>
                  <span className="block text-meta">PNG</span>
                  <span className="block text-caption text-ink-3">A picture of the board</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onExportSVG();
                  setShowExportDropdown(false);
                }}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-control text-left text-ink-2 hover:text-ink hover:bg-sunken transition-colors"
              >
                <Share2 size={13} className="shrink-0" />
                <span>
                  <span className="block text-meta">SVG</span>
                  <span className="block text-caption text-ink-3">Stays sharp at any size</span>
                </span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onDeleteCurrentBoard}
          className="w-9 h-9 grid place-items-center rounded-control border border-transparent text-ink-3 hover:text-danger-600 hover:bg-danger-500/10 transition-colors"
          title="Delete this board"
          aria-label="Delete this board"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </header>
  );
};
