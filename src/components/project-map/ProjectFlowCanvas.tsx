import React, { useState, useRef, useEffect } from 'react';
import { CheckCircle2, Circle, AlertTriangle, Plus, Flag, Clock, Move, Eye, Camera } from 'lucide-react';
import { WorkItem, Project } from '../../services/types';
import { ProjectGap } from '../../utils/projectGapAnalyzer';
import { downloadFlowCanvasImage } from '../../utils/imageExport';
import { useToast } from '../../context/ToastContext';

interface ProjectFlowCanvasProps {
  items: WorkItem[];
  project?: Project | null;
  gaps: ProjectGap[];
  flowMode: 'view' | 'edit';
  onSelectTask: (id: string) => void;
  onLinkDependency: (fromId: string, toId: string) => void;
  onUnlinkDependency: (fromId: string, toId: string) => void;
  onUpdateLayout: (layout: { [nodeId: string]: { x: number; y: number } }) => void;
}

export function ProjectFlowCanvas({
  items,
  project,
  gaps,
  flowMode,
  onSelectTask,
  onLinkDependency,
  onUnlinkDependency,
  onUpdateLayout
}: ProjectFlowCanvasProps) {
  const [positions, setPositions] = useState<{ [id: string]: { x: number; y: number } }>({});
  const [activeDraggingId, setActiveDraggingId] = useState<string | null>(null);
  const dragInfoRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    initialNodeX: number;
    initialNodeY: number;
    hasMoved: boolean;
  } | null>(null);

  const [linkingSourceId, setLinkingSourceId] = useState<string | null>(null);
  const [linkingMousePos, setLinkingMousePos] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  // Initialize and auto-layout positions if not in project.flowLayout
  useEffect(() => {
    const savedLayout = project?.flowLayout || {};
    const newPositions: { [id: string]: { x: number; y: number } } = { ...savedLayout };

    let currentX = 60;
    let currentY = 80;
    const colWidth = 280;
    const rowHeight = 160;

    items.forEach((item, index) => {
      if (!newPositions[item.id]) {
        const col = index % 3;
        const row = Math.floor(index / 3);
        newPositions[item.id] = {
          x: currentX + col * colWidth,
          y: currentY + row * rowHeight
        };
      }
    });

    setPositions(newPositions);
  }, [items, project]);

  // Pointer-Events Drag & Drop (Guaranteed drop release via PointerCapture)
  const handlePointerDown = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (flowMode !== 'edit') return;
    if (e.button !== 0) return; // left-click only
    if (linkingSourceId) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}

    const initialPos = positions[id] || { x: 60, y: 80 };
    dragInfoRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      initialNodeX: initialPos.x,
      initialNodeY: initialPos.y,
      hasMoved: false
    };
    setActiveDraggingId(id);
  };

  const handlePointerMove = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (flowMode !== 'edit') return;

    // Node dragging
    if (dragInfoRef.current && dragInfoRef.current.id === id) {
      const dx = e.clientX - dragInfoRef.current.startX;
      const dy = e.clientY - dragInfoRef.current.startY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragInfoRef.current.hasMoved = true;
      }

      const newX = Math.max(20, dragInfoRef.current.initialNodeX + dx);
      const newY = Math.max(20, dragInfoRef.current.initialNodeY + dy);

      setPositions(prev => ({
        ...prev,
        [id]: { x: newX, y: newY }
      }));
    }

    // In-flight arrow linking
    if (linkingSourceId && canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      setLinkingMousePos({
        x: e.clientX - canvasRect.left + canvasRef.current.scrollLeft,
        y: e.clientY - canvasRect.top + canvasRef.current.scrollTop
      });
    }
  };

  const handlePointerUp = (id: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (flowMode !== 'edit') return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (dragInfoRef.current && dragInfoRef.current.id === id) {
      if (dragInfoRef.current.hasMoved) {
        setPositions(current => {
          onUpdateLayout(current);
          return current;
        });
      }
      dragInfoRef.current = null;
    }
    setActiveDraggingId(null);
  };

  const handleStartLinking = (id: string, e: React.PointerEvent) => {
    if (flowMode !== 'edit') return;
    e.stopPropagation();
    setLinkingSourceId(id);
  };

  const handleDropLink = (targetId: string, e: React.PointerEvent) => {
    if (flowMode !== 'edit') return;
    e.stopPropagation();
    if (linkingSourceId && linkingSourceId !== targetId) {
      onLinkDependency(targetId, linkingSourceId);
    }
    setLinkingSourceId(null);
    setLinkingMousePos(null);
  };

  const handleCardClick = (id: string) => {
    if (flowMode === 'view') {
      onSelectTask(id);
    }
  };

  const handleDownloadCanvasImage = () => {
    downloadFlowCanvasImage(items, positions, project?.name || 'Project Flow');
    showToast('Flowchart PNG image downloaded!');
  };

  // Generate SVG Bezier Curved Paths
  const renderDependencyLines = () => {
    const lines: React.ReactNode[] = [];
    const CARD_WIDTH = 220;
    const CARD_HEIGHT = 100;

    items.forEach(targetItem => {
      const targetPos = positions[targetItem.id];
      if (!targetPos) return;

      (targetItem.dependsOn || []).forEach(sourceId => {
        const sourcePos = positions[sourceId];
        if (!sourcePos) return;

        const x1 = sourcePos.x + CARD_WIDTH;
        const y1 = sourcePos.y + CARD_HEIGHT / 2;
        const x2 = targetPos.x;
        const y2 = targetPos.y + CARD_HEIGHT / 2;

        const dx = Math.abs(x2 - x1) * 0.5;
        const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        lines.push(
          <g key={`${sourceId}->${targetItem.id}`} className="group/line">
            <path
              d={path}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="2.5"
              strokeDasharray={targetItem.status === 'done' ? 'none' : '4,4'}
              className="dark:stroke-white/20 transition-all group-hover/line:stroke-blue-500 group-hover/line:stroke-[3.5]"
            />
            {/* Click to unlink handle only visible in edit mode */}
            {flowMode === 'edit' && (
              <circle
                cx={(x1 + x2) / 2}
                cy={(y1 + y2) / 2}
                r="8"
                fill="#ef4444"
                className="opacity-0 group-hover/line:opacity-100 cursor-pointer transition-opacity"
                onClick={() => onUnlinkDependency(targetItem.id, sourceId)}
              />
            )}
          </g>
        );
      });
    });

    // In-flight linking line
    if (linkingSourceId && positions[linkingSourceId] && linkingMousePos && flowMode === 'edit') {
      const sourcePos = positions[linkingSourceId];
      const x1 = sourcePos.x + CARD_WIDTH;
      const y1 = sourcePos.y + CARD_HEIGHT / 2;
      const x2 = linkingMousePos.x;
      const y2 = linkingMousePos.y;
      const dx = Math.abs(x2 - x1) * 0.5;
      const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

      lines.push(
        <path
          key="in-flight-link"
          d={path}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="3"
          strokeDasharray="6,6"
          className="animate-pulse"
        />
      );
    }

    return lines;
  };

  const getGapForNode = (id: string) => gaps.find(g => g.targetId === id);

  return (
    <div className="space-y-2">
      {/* Mode Status Pill & Image Export Button */}
      <div className="flex items-center justify-between px-2 text-xs">
        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 font-semibold">
          {flowMode === 'view' ? (
            <>
              <Eye size={14} className="text-blue-500" />
              <span><strong>View Mode:</strong> Click any card to edit task details. Layout is locked.</span>
            </>
          ) : (
            <>
              <Move size={14} className="text-amber-500" />
              <span><strong>Edit Flow Mode:</strong> Click & drag cards to move them. Release anywhere to drop.</span>
            </>
          )}
        </div>

        <button
          onClick={handleDownloadCanvasImage}
          className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          title="Download snapshot of this flowchart"
        >
          <Camera size={13} />
          <span>Download Flowchart (.png)</span>
        </button>
      </div>

      <div
        ref={canvasRef}
        className="w-full h-[650px] relative overflow-auto rounded-3xl bg-[#fafafa] dark:bg-[#121214] border border-black/5 dark:border-white/5 select-none custom-scrollbar"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(150, 150, 150, 0.15) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          touchAction: 'none'
        }}
      >
        {/* SVG Canvas for Curves */}
        <svg className="absolute inset-0 w-[2000px] h-[2000px] pointer-events-auto">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
            </marker>
          </defs>
          {renderDependencyLines()}
        </svg>

        {/* Node Cards */}
        {items.map(item => {
          const pos = positions[item.id] || { x: 50, y: 50 };
          const gap = getGapForNode(item.id);
          const isMilestone = item.entityType === 'milestone';
          const isBeingDragged = activeDraggingId === item.id;

          return (
            <div
              key={item.id}
              onClick={() => handleCardClick(item.id)}
              onPointerDown={(e) => handlePointerDown(item.id, e)}
              onPointerMove={(e) => handlePointerMove(item.id, e)}
              onPointerUp={(e) => handlePointerUp(item.id, e)}
              style={{ 
                left: pos.x, 
                top: pos.y,
                userSelect: 'none',
                touchAction: 'none'
              }}
              className={`absolute w-[220px] p-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border transition-shadow z-10 ${
                flowMode === 'edit' 
                  ? 'cursor-grab active:cursor-grabbing hover:shadow-2xl hover:border-blue-400' 
                  : 'cursor-pointer hover:shadow-xl hover:ring-2 hover:ring-blue-500/30'
              } ${
                isBeingDragged ? 'shadow-2xl ring-2 ring-blue-500 scale-105 z-30 opacity-95' : 'shadow-md'
              } ${
                gap ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-400/20' : 
                isMilestone ? 'border-purple-400 dark:border-purple-600' :
                'border-black/10 dark:border-white/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5 pointer-events-none">
                <div className="flex items-center gap-1.5 min-w-0">
                  {isMilestone ? (
                    <Flag size={14} className="text-purple-500 shrink-0" />
                  ) : item.status === 'done' ? (
                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                  ) : (
                    <Circle size={15} className="text-gray-300 shrink-0" />
                  )}
                  <span className="text-[10px] font-mono font-bold text-gray-400 uppercase truncate">
                    {item.key}
                  </span>
                </div>

                {gap && (
                  <div title={gap.description} className="shrink-0 text-amber-500">
                    <AlertTriangle size={13} />
                  </div>
                )}
              </div>

              <h4 className="font-semibold text-[13px] text-gray-900 dark:text-white line-clamp-2 leading-snug pointer-events-none">
                {item.title}
              </h4>

              {item.dueDate && (
                <div className="flex items-center gap-1 mt-2 text-[10px] text-gray-400 font-semibold pointer-events-none">
                  <Clock size={11} />
                  <span>Due {item.dueDate}</span>
                </div>
              )}

              {/* Output Connector Handle (Only in Edit Flow mode) */}
              {flowMode === 'edit' && (
                <div
                  onPointerDown={(e) => handleStartLinking(item.id, e)}
                  onPointerUp={(e) => handleDropLink(item.id, e)}
                  className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center cursor-crosshair transition-transform shadow-md hover:scale-110"
                  title="Click & drag to link to a dependent task"
                >
                  <Plus size={12} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
