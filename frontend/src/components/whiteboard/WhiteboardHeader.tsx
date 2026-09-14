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
  edition?: 'day' | 'night';
}

const GRID_OPTIONS: { type: WhiteboardGridType; label: string; desc: string }[] = [
  { type: 'dots', label: 'Architect Dots', desc: 'Neat 28px alignment dots' },
  { type: 'graph', label: 'Blueprint Graph', desc: 'Millimeter technical grid' },
  { type: 'ruled', label: 'Ruled Paper', desc: 'Lined tracing paper' },
  { type: 'blank', label: 'Blank Slate', desc: 'Pure unlined parchment' },
];

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
  edition = 'day',
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
  const isNight = edition === 'night';

  const headerBg = isNight
    ? 'bg-[#0c0c0e]/95 border-b-2 border-stone-800 text-[#edece8]'
    : 'bg-paper-aged/95 border-b-2 border-ink-primary text-ink-primary';

  const dropdownBg = isNight
    ? 'bg-[#141418] border border-stone-700 text-stone-200'
    : 'bg-paper-white border-2 border-ink-primary text-ink-primary';

  const btnBg = isNight
    ? 'bg-stone-900 hover:bg-stone-800 border-stone-700 text-stone-300'
    : 'bg-paper-white hover:bg-paper-cream border-ink-rule text-ink-primary';

  return (
    <header className={`absolute top-0 left-0 right-0 z-30 h-14 px-3 sm:px-4 backdrop-blur-md flex items-center justify-between select-none ${headerBg}`}>
      {/* LEFT SECTION: Back button + Board Switcher & Title */}
      <div className="flex items-center gap-2 sm:gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={`p-1.5 border rounded-[1px] transition-colors ${btnBg}`}
            title="Back to Projects"
          >
            <ArrowLeft size={16} />
          </button>
        )}

        {/* Section Roman Numeral Eyebrow */}
        <div className="hidden lg:flex items-center gap-1.5 font-ledger text-[10px] uppercase font-bold tracking-wider text-ink-muted border-r border-ink-rule pr-2.5">
          <span className="text-amber-600 font-bold">III.</span>
          <span>DRAFTING ROOM</span>
        </div>

        {/* Board Switcher Dropdown */}
        <div ref={boardsDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setShowBoardsDropdown((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-[1px] text-xs font-ledger font-bold uppercase tracking-wider transition-colors ${btnBg}`}
          >
            <span className="max-w-[120px] sm:max-w-[180px] truncate">{board.title || 'Drafting Canvas'}</span>
            <ChevronDown size={13} className="opacity-60" />
          </button>

          {showBoardsDropdown && (
            <div className={`absolute top-full left-0 mt-2 w-64 p-2 border-2 shadow-2xl rounded-[1px] z-50 animate-in fade-in slide-in-from-top-1 duration-150 ${dropdownBg}`}>
              <div className="px-2 py-1 text-[9px] font-ledger font-bold uppercase tracking-wider text-ink-muted border-b border-ink-rule/30 mb-1">
                Drafting Canvases
              </div>
              <div className="max-h-60 overflow-y-auto space-y-0.5">
                {boardsList.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      onSelectBoard(b.id);
                      setShowBoardsDropdown(false);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[1px] text-xs font-editorial text-left transition-colors ${
                      b.id === board.id
                        ? isNight ? 'bg-amber-600/30 text-amber-300 font-bold' : 'bg-ink-primary text-paper-white font-bold'
                        : isNight ? 'text-stone-300 hover:bg-stone-800' : 'text-ink-primary hover:bg-paper-aged'
                    }`}
                  >
                    <span className="truncate">{b.title}</span>
                    {b.id === board.id && <Check size={13} className="shrink-0 ml-1" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-ink-rule/40 my-1" />
              <button
                type="button"
                onClick={() => {
                  onCreateNewBoard();
                  setShowBoardsDropdown(false);
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-[1px] text-xs font-ledger uppercase font-bold text-amber-600 hover:bg-amber-600/10 transition-colors"
              >
                <Plus size={14} />
                <span>New Drawing Canvas</span>
              </button>
            </div>
          )}
        </div>

        {/* Title Edit Quick Trigger */}
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSubmit();
              if (e.key === 'Escape') {
                setTitleInput(board.title);
                setIsEditingTitle(false);
              }
            }}
            className="px-2 py-0.5 text-xs font-ledger uppercase font-bold bg-paper-white border border-amber-500 rounded-[1px] text-ink-primary outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingTitle(true)}
            className="p-1 text-ink-muted hover:text-ink-primary transition-colors"
            title="Rename Canvas"
          >
            <Edit2 size={13} />
          </button>
        )}

        {/* Project Link Dropdown */}
        <div ref={projectsDropdownRef} className="relative hidden md:block">
          <button
            type="button"
            onClick={() => setShowProjectsDropdown((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-[1px] text-xs font-ledger uppercase border transition-colors ${btnBg}`}
          >
            <Folder
              size={13}
              style={{ color: currentProject ? currentProject.color || '#3b82f6' : 'currentColor' }}
            />
            <span className="max-w-[120px] truncate">
              {currentProject ? currentProject.name : 'Link Project'}
            </span>
            <ChevronDown size={11} className="opacity-60" />
          </button>

          {showProjectsDropdown && (
            <div className={`absolute top-full left-0 mt-2 w-56 p-1.5 border-2 shadow-2xl rounded-[1px] z-50 animate-in fade-in slide-in-from-top-1 duration-150 ${dropdownBg}`}>
              <div className="px-2 py-1 text-[9px] font-ledger uppercase tracking-wider font-bold text-ink-muted border-b border-ink-rule/30 mb-1">
                Assign Project Dossier
              </div>
              <button
                type="button"
                onClick={() => {
                  onUpdateProject(null);
                  setShowProjectsDropdown(false);
                }}
                className={`w-full flex items-center justify-between px-2 py-1 rounded-[1px] text-xs font-ledger transition-colors ${
                  !board.project_id ? 'font-bold text-amber-600' : 'text-ink-muted hover:text-ink-primary'
                }`}
              >
                <span>Standalone (No Project)</span>
                {!board.project_id && <Check size={13} />}
              </button>
              <div className="max-h-48 overflow-y-auto space-y-0.5 mt-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onUpdateProject(p.id);
                      setShowProjectsDropdown(false);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1 rounded-[1px] text-xs font-editorial text-left transition-colors ${
                      board.project_id === p.id ? 'font-bold text-amber-600' : 'hover:bg-paper-aged'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className="w-2 h-2 rounded-[1px] shrink-0"
                        style={{ backgroundColor: p.color || '#3b82f6' }}
                      />
                      <span className="truncate">{p.name}</span>
                    </div>
                    {board.project_id === p.id && <Check size={13} className="shrink-0 ml-1" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Auto-save Status */}
        <div className="text-[10px] font-ledger uppercase tracking-wider text-ink-muted flex items-center gap-1.5 ml-1 hidden lg:flex">
          {isSaving ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>SAVING...</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
              <span>DRAFT SAVED</span>
            </>
          )}
        </div>
      </div>

      {/* RIGHT SECTION: Grid selector + Stylus Palm Rejection + Zoom Controls + Export + Delete */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Grid Selector Dropdown */}
        {onSelectGrid && (
          <div ref={gridDropdownRef} className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setShowGridDropdown((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2 py-1 border rounded-[1px] text-xs font-ledger uppercase tracking-wider transition-colors ${btnBg}`}
              title="Change Canvas Grid Surface"
            >
              <Grid size={13} />
              <span className="capitalize">{gridType}</span>
              <ChevronDown size={11} className="opacity-60" />
            </button>

            {showGridDropdown && (
              <div className={`absolute top-full right-0 mt-2 w-52 p-1.5 border-2 shadow-2xl rounded-[1px] z-50 animate-in fade-in slide-in-from-top-1 duration-150 ${dropdownBg}`}>
                <div className="px-2 py-1 text-[9px] font-ledger uppercase tracking-wider font-bold text-ink-muted border-b border-ink-rule/30 mb-1">
                  Drafting Surface
                </div>
                {GRID_OPTIONS.map((g) => (
                  <button
                    key={g.type}
                    type="button"
                    onClick={() => {
                      onSelectGrid(g.type);
                      setShowGridDropdown(false);
                    }}
                    className={`w-full flex flex-col px-2 py-1.5 rounded-[1px] text-left transition-colors ${
                      gridType === g.type
                        ? isNight ? 'bg-amber-600/30 text-amber-300' : 'bg-ink-primary text-paper-white font-bold'
                        : isNight ? 'text-stone-300 hover:bg-stone-800' : 'text-ink-primary hover:bg-paper-aged'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-ledger uppercase">
                      <span>{g.label}</span>
                      {gridType === g.type && <Check size={12} />}
                    </div>
                    <span className="text-[9px] opacity-70 font-sans">{g.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stylus / Palm Rejection Mode Toggle */}
        {onToggleStylusOnly && (
          <button
            type="button"
            onClick={onToggleStylusOnly}
            className={`flex items-center gap-1 px-2 py-1 border rounded-[1px] text-xs font-ledger uppercase tracking-wider transition-colors ${
              stylusOnly
                ? 'bg-amber-600 text-stone-950 border-amber-500 font-bold'
                : btnBg
            }`}
            title={stylusOnly ? 'Stylus Mode Active: Touches only pan/zoom' : 'All Input: Touch draws and pans'}
          >
            <PenTool size={13} />
            <span className="hidden md:inline">{stylusOnly ? 'Stylus Only' : 'Touch+Pen'}</span>
          </button>
        )}

        {/* Zoom Controls */}
        <div className={`flex items-center border rounded-[1px] px-1 py-0.5 ${btnBg}`}>
          <button
            type="button"
            onClick={onZoomOut}
            className="p-1 hover:opacity-100 opacity-60 transition-opacity"
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={onResetZoom}
            className="px-1.5 py-0.5 text-xs font-ledger font-bold tabular-nums"
            title="Reset to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            className="p-1 hover:opacity-100 opacity-60 transition-opacity"
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={onFitToContent}
            className="p-1 border-l border-ink-rule/40 ml-0.5 pl-1 hover:opacity-100 opacity-60 transition-opacity"
            title="Fit to Content"
          >
            <Maximize2 size={12} />
          </button>
        </div>

        {/* Export Dropdown */}
        <div ref={exportDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setShowExportDropdown((prev) => !prev)}
            className={`flex items-center gap-1 px-2.5 py-1.5 border rounded-[1px] text-xs font-ledger uppercase font-bold tracking-wider transition-colors ${btnBg}`}
            title="Export Drafting Room"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Export</span>
          </button>

          {showExportDropdown && (
            <div className={`absolute top-full right-0 mt-2 w-48 p-1.5 border-2 shadow-2xl rounded-[1px] z-50 animate-in fade-in slide-in-from-top-1 duration-150 ${dropdownBg}`}>
              <button
                type="button"
                onClick={() => {
                  onExportPNG();
                  setShowExportDropdown(false);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[1px] text-xs font-editorial text-left hover:bg-paper-aged transition-colors"
              >
                <Download size={13} className="text-amber-600" />
                <div>
                  <div className="font-bold">Export PNG Image</div>
                  <div className="text-[9px] text-ink-muted">High-res broadsheet raster</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportSVG();
                  setShowExportDropdown(false);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[1px] text-xs font-editorial text-left hover:bg-paper-aged transition-colors"
              >
                <Share2 size={13} className="text-emerald-600" />
                <div>
                  <div className="font-bold">Export SVG Vector</div>
                  <div className="text-[9px] text-ink-muted">Scalable vector blueprint</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Delete Board Button */}
        <button
          type="button"
          onClick={onDeleteCurrentBoard}
          className="p-1.5 border border-transparent hover:border-ink-danger text-ink-muted hover:text-ink-danger hover:bg-rose-950/20 rounded-[1px] transition-colors"
          title="Delete current canvas"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </header>
  );
};
