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
  ArrowLeft
} from 'lucide-react';
import { Whiteboard, WhiteboardListItem, Project } from '../../types';

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
}

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
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(board.title);
  const [showBoardsDropdown, setShowBoardsDropdown] = useState(false);
  const [showProjectsDropdown, setShowProjectsDropdown] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);

  const boardsDropdownRef = useRef<HTMLDivElement>(null);
  const projectsDropdownRef = useRef<HTMLDivElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
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

  return (
    <header className="absolute top-0 left-0 right-0 z-30 h-14 px-4 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 flex items-center justify-between select-none">
      {/* LEFT SECTION: Back button + Board Switcher & Title */}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 rounded-xl transition-colors"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
        )}

        {/* Board Switcher Dropdown */}
        <div ref={boardsDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setShowBoardsDropdown((prev) => !prev)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-sm font-semibold transition-colors"
          >
            <span className="max-w-[140px] md:max-w-[200px] truncate">{board.title || 'Untitled'}</span>
            <ChevronDown size={14} className="text-zinc-400" />
          </button>

          {showBoardsDropdown && (
            <div className="absolute top-full left-0 mt-2 w-64 p-1.5 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-2 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                My Whiteboards
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
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-left transition-colors ${
                      b.id === board.id
                        ? 'bg-blue-600/20 text-blue-400 font-medium'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    <span className="truncate">{b.title}</span>
                    {b.id === board.id && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                  </button>
                ))}
              </div>
              <div className="h-px bg-zinc-800 my-1" />
              <button
                type="button"
                onClick={() => {
                  onCreateNewBoard();
                  setShowBoardsDropdown(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors"
              >
                <Plus size={15} />
                <span>New Whiteboard</span>
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
            className="px-2 py-0.5 text-sm font-semibold bg-zinc-800 border border-blue-500 rounded-lg text-white focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingTitle(true)}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Rename Board"
          >
            <Edit2 size={13} />
          </button>
        )}

        {/* Project Link Dropdown */}
        <div ref={projectsDropdownRef} className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setShowProjectsDropdown((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-xl text-xs font-medium border transition-colors ${
              currentProject
                ? 'bg-zinc-900 border-zinc-700 text-zinc-200'
                : 'bg-zinc-900/40 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
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
            <div className="absolute top-full left-0 mt-2 w-56 p-1.5 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-2 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Assign Project
              </div>
              <button
                type="button"
                onClick={() => {
                  onUpdateProject(null);
                  setShowProjectsDropdown(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs text-left transition-colors ${
                  !board.project_id
                    ? 'bg-zinc-800 text-white font-medium'
                    : 'text-zinc-400 hover:bg-zinc-800/60'
                }`}
              >
                <span>No Project</span>
                {!board.project_id && <Check size={14} />}
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
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs text-left transition-colors ${
                      board.project_id === p.id
                        ? 'bg-zinc-800 text-white font-medium'
                        : 'text-zinc-300 hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: p.color || '#3b82f6' }}
                      />
                      <span className="truncate">{p.name}</span>
                    </div>
                    {board.project_id === p.id && <Check size={14} className="text-blue-400 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Auto-save Status */}
        <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 ml-1 hidden md:flex">
          {isSaving ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Saved</span>
            </>
          )}
        </div>
      </div>

      {/* RIGHT SECTION: Zoom Controls + Export + Delete */}
      <div className="flex items-center gap-2">
        {/* Zoom Controls */}
        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl px-1 py-0.5">
          <button
            type="button"
            onClick={onZoomOut}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            title="Zoom Out"
          >
            <ZoomOut size={15} />
          </button>
          <button
            type="button"
            onClick={onResetZoom}
            className="px-2 py-0.5 text-xs font-semibold text-zinc-300 hover:text-white transition-colors"
            title="Reset to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            title="Zoom In"
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            onClick={onFitToContent}
            className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors border-l border-zinc-800 ml-0.5 pl-1.5"
            title="Fit to Content"
          >
            <Maximize2 size={13} />
          </button>
        </div>

        {/* Export Dropdown */}
        <div ref={exportDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setShowExportDropdown((prev) => !prev)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-medium transition-colors"
            title="Export Whiteboard"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>

          {showExportDropdown && (
            <div className="absolute top-full right-0 mt-2 w-48 p-1.5 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <button
                type="button"
                onClick={() => {
                  onExportPNG();
                  setShowExportDropdown(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
              >
                <Download size={14} className="text-blue-400" />
                <div>
                  <div className="font-semibold">Export PNG</div>
                  <div className="text-[10px] text-zinc-500">High-res raster image</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportSVG();
                  setShowExportDropdown(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
              >
                <Share2 size={14} className="text-emerald-400" />
                <div>
                  <div className="font-semibold">Export SVG</div>
                  <div className="text-[10px] text-zinc-500">Lossless vector format</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Delete Board Button */}
        <button
          type="button"
          onClick={onDeleteCurrentBoard}
          className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
          title="Delete this whiteboard"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </header>
  );
};
