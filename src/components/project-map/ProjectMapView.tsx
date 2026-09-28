import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Network, ListTree, Sparkles, AlertTriangle, CheckCircle2, 
  Plus, ChevronRight, X, Info, Workflow, LayoutGrid, RotateCcw, Flag,
  Eye, Edit3, Move 
} from 'lucide-react';
import { WorkItem, Project } from '../../services/types';
import { api } from '../../services/api';
import { analyzeProjectGaps, ProjectGap } from '../../utils/projectGapAnalyzer';
import { ProjectFlowCanvas } from './ProjectFlowCanvas';
import { ProjectTreeOutline } from './ProjectTreeOutline';
import { useToast } from '../../context/ToastContext';

interface ProjectMapViewProps {
  items: WorkItem[];
  project?: Project | null;
  onSelectTask: (id: string) => void;
  onRefreshData?: () => void;
}

export function ProjectMapView({ items, project, onSelectTask, onRefreshData }: ProjectMapViewProps) {
  const [viewMode, setViewMode] = useState<'canvas' | 'outline'>('canvas');
  const [flowMode, setFlowMode] = useState<'view' | 'edit'>('view');
  const [dismissedGapIds, setDismissedGapIds] = useState<Set<string>>(new Set());
  const [quickStepTitle, setQuickStepTitle] = useState<string>('');
  const [quickStepType, setQuickStepType] = useState<'task' | 'milestone'>('task');
  const [isAddingStep, setIsAddingStep] = useState<boolean>(false);
  const { showToast } = useToast();

  // Auto-switch to outline on mobile screens
  useEffect(() => {
    if (window.innerWidth < 768) {
      setViewMode('outline');
    }
  }, []);

  // Filter tasks belonging to this project (or all items if in All workspace)
  const projectTasks = useMemo(() => {
    if (!project) return items.filter(i => !i.deletedAt);
    return items.filter(i => !i.deletedAt && (i.projectId === project.id || i.areaId === project.id));
  }, [items, project]);

  // Run Gap Analyzer Heuristics
  const gaps = useMemo(() => {
    return analyzeProjectGaps(projectTasks, dismissedGapIds);
  }, [projectTasks, dismissedGapIds]);

  const handleLinkDependency = async (targetId: string, prerequisiteId: string) => {
    const targetItem = projectTasks.find(i => i.id === targetId);
    if (!targetItem) return;

    const existingDepends = targetItem.dependsOn || [];
    if (existingDepends.includes(prerequisiteId)) return;

    try {
      const updated = [...existingDepends, prerequisiteId];
      await api.workItems.updateDetails(targetId, { dependsOn: updated });
      showToast('Dependency link established');
      if (onRefreshData) onRefreshData();
    } catch (e: any) {
      showToast('Failed to link: ' + e.message, 'error');
    }
  };

  const handleUnlinkDependency = async (targetId: string, prerequisiteId: string) => {
    const targetItem = projectTasks.find(i => i.id === targetId);
    if (!targetItem) return;

    try {
      const updated = (targetItem.dependsOn || []).filter(id => id !== prerequisiteId);
      await api.workItems.updateDetails(targetId, { dependsOn: updated });
      showToast('Dependency link removed');
      if (onRefreshData) onRefreshData();
    } catch (e: any) {
      showToast('Failed to unlink: ' + e.message, 'error');
    }
  };

  const handleUpdateLayout = async (layout: { [nodeId: string]: { x: number; y: number } }) => {
    if (!project) return;
    try {
      await api.projects.update(project.id, { flowLayout: layout });
    } catch (e) {
      console.warn('Failed to save layout:', e);
    }
  };

  const handleDismissGap = (gapId: string) => {
    setDismissedGapIds(prev => new Set([...prev, gapId]));
  };

  // 1-Click Auto-Sequence Flow
  const handleAutoSequenceFlow = async () => {
    if (projectTasks.length < 2) {
      showToast('Need at least 2 tasks to generate a sequential flow', 'error');
      return;
    }

    try {
      const sorted = [...projectTasks].sort((a, b) => {
        if (a.entityType === 'milestone' && b.entityType !== 'milestone') return 1;
        if (b.entityType === 'milestone' && a.entityType !== 'milestone') return -1;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      const newLayout: { [nodeId: string]: { x: number; y: number } } = {};
      let startX = 60;
      let startY = 100;

      for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i];
        newLayout[curr.id] = {
          x: startX + i * 290,
          y: startY + (i % 2 === 0 ? 0 : 40)
        };

        if (i > 0) {
          const prev = sorted[i - 1];
          const existing = curr.dependsOn || [];
          if (!existing.includes(prev.id)) {
            await api.workItems.updateDetails(curr.id, {
              dependsOn: [...existing, prev.id]
            });
          }
        }
      }

      if (project) {
        await api.projects.update(project.id, { flowLayout: newLayout });
      }

      showToast(`Auto-sequenced ${sorted.length} tasks into an end-to-end flow!`);
      if (onRefreshData) onRefreshData();
    } catch (e: any) {
      showToast('Auto-sequence error: ' + e.message, 'error');
    }
  };

  // Auto-Layout / Tidy Nodes without modifying links
  const handleTidyLayout = async () => {
    if (projectTasks.length === 0) return;

    const newLayout: { [nodeId: string]: { x: number; y: number } } = {};
    const colWidth = 290;
    const rowHeight = 160;

    projectTasks.forEach((item, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      newLayout[item.id] = {
        x: 60 + col * colWidth,
        y: 80 + row * rowHeight
      };
    });

    if (project) {
      await api.projects.update(project.id, { flowLayout: newLayout });
    }
    showToast('Tidied flow graph layout');
    if (onRefreshData) onRefreshData();
  };

  // Add a Step or Milestone directly to the flow
  const handleQuickAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickStepTitle.trim() || isAddingStep) return;

    setIsAddingStep(true);
    try {
      const lastTask = projectTasks[projectTasks.length - 1];
      const dependsOn = lastTask ? [lastTask.id] : [];

      const created = await api.workItems.create({
        title: quickStepTitle.trim(),
        projectId: project?.id,
        entityType: quickStepType,
        type: quickStepType,
        dependsOn: dependsOn
      });

      // Position to the right of last task
      if (project) {
        const currentLayout = project.flowLayout || {};
        const lastPos = lastTask ? currentLayout[lastTask.id] || { x: 60, y: 80 } : { x: 60, y: 80 };
        const nextLayout = {
          ...currentLayout,
          [created.id]: {
            x: lastPos.x + 290,
            y: lastPos.y
          }
        };
        await api.projects.update(project.id, { flowLayout: nextLayout });
      }

      showToast(`Added "${created.title}" to flow`);
      setQuickStepTitle('');
      if (onRefreshData) onRefreshData();
    } catch (e: any) {
      showToast('Failed to add step: ' + e.message, 'error');
    } finally {
      setIsAddingStep(false);
    }
  };

  // Clear all dependency connections in this project
  const handleClearAllLinks = async () => {
    if (!window.confirm('Reset all dependency links in this flow?')) return;
    try {
      for (const item of projectTasks) {
        if (item.dependsOn && item.dependsOn.length > 0) {
          await api.workItems.updateDetails(item.id, { dependsOn: [] });
        }
      }
      showToast('Cleared all dependency links');
      if (onRefreshData) onRefreshData();
    } catch (e: any) {
      showToast('Clear failed: ' + e.message, 'error');
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 font-sans">
      {/* Header Banner */}
      <div className="p-6 md:p-8 rounded-[32px] bg-[#f5f5f7] dark:bg-[#1c1c1e] border border-black/5 dark:border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
            <Network size={18} />
            <span>Project Map & Flow Builder</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white">
            {project ? `${project.name} Flow` : 'All Work Dependencies'}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Visual dependency graph and gap detection. Toggle between <strong>View & Edit Task</strong> and <strong>Edit Flow</strong> modes.
          </p>
        </div>

        {/* View Mode & Canvas Mode Switchers */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode vs Edit Flow Mode Toggle */}
          {viewMode === 'canvas' && (
            <div className="flex items-center bg-gray-200/60 dark:bg-white/10 p-1 rounded-2xl">
              <button
                onClick={() => setFlowMode('view')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  flowMode === 'view' 
                    ? 'bg-white dark:bg-[#2c2c2e] text-blue-600 dark:text-blue-400 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Eye size={14} /> View & Edit Tasks
              </button>
              <button
                onClick={() => setFlowMode('edit')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  flowMode === 'edit' 
                    ? 'bg-amber-500 text-white shadow-sm' 
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Move size={14} /> Edit Flow & Drag
              </button>
            </div>
          )}

          {/* Canvas vs Tree Outline Switcher */}
          <div className="flex items-center bg-gray-200/60 dark:bg-white/10 p-1 rounded-2xl">
            <button
              onClick={() => setViewMode('canvas')}
              className={`hidden md:flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'canvas' ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
              }`}
            >
              <Network size={14} /> Canvas
            </button>
            <button
              onClick={() => setViewMode('outline')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'outline' ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
              }`}
            >
              <ListTree size={14} /> Outline
            </button>
          </div>
        </div>
      </div>

      {/* Quick Flow Creation & Action Bar */}
      <div className="p-4 rounded-[28px] bg-white dark:bg-[#1c1c1e] border border-black/5 dark:border-white/5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-sm">
        {/* Quick Add Step Input */}
        <form onSubmit={handleQuickAddStep} className="flex items-center gap-2 flex-1">
          <div className="relative flex-1">
            <input
              type="text"
              value={quickStepTitle}
              onChange={e => setQuickStepTitle(e.target.value)}
              placeholder="Add next step or milestone to flow..."
              className="w-full pl-4 pr-24 py-2.5 rounded-xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/10 text-xs outline-none dark:text-white font-medium"
            />
            <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setQuickStepType(t => t === 'task' ? 'milestone' : 'task')}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors ${
                  quickStepType === 'milestone' 
                    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' 
                    : 'bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-gray-300'
                }`}
              >
                {quickStepType === 'milestone' ? '🚩 Milestone' : 'Task'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={!quickStepTitle.trim() || isAddingStep}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform"
          >
            <Plus size={14} /> Add to Flow
          </button>
        </form>

        {/* 1-Click Flow Actions */}
        <div className="flex items-center gap-2 shrink-0 border-t lg:border-t-0 pt-2 lg:pt-0 border-gray-100 dark:border-white/5">
          <button
            onClick={handleAutoSequenceFlow}
            className="flex-1 lg:flex-none px-3.5 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 border border-blue-200/60 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95"
            title="Auto-connect all tasks into sequential order"
          >
            <Workflow size={14} />
            <span>Auto-Sequence Flow</span>
          </button>

          <button
            onClick={handleTidyLayout}
            className="px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 text-gray-700 dark:text-gray-300 text-xs font-bold flex items-center gap-1.5 transition-colors"
            title="Clean up and organize node layout"
          >
            <LayoutGrid size={14} />
            <span className="hidden sm:inline">Tidy Layout</span>
          </button>

          <button
            onClick={handleClearAllLinks}
            className="px-3 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-red-50 hover:text-red-600 text-gray-500 text-xs font-bold flex items-center gap-1.5 transition-colors"
            title="Clear all dependency connections"
          >
            <RotateCcw size={13} />
            <span className="hidden sm:inline">Reset Links</span>
          </button>
        </div>
      </div>

      {/* Advisory Gap Finder Ribbon */}
      {gaps.length > 0 && (
        <div className="p-5 rounded-[28px] bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              <Sparkles size={15} />
              <span>Project Gap Suggestions ({gaps.length})</span>
            </div>
            <span className="text-[11px] text-gray-400 font-semibold">Sage suggests · Never blocking</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {gaps.map(gap => (
              <div key={gap.id} className="p-3.5 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-amber-200/50 dark:border-amber-900/30 flex items-start justify-between gap-3 shadow-sm">
                <div className="min-w-0 flex-1 space-y-0.5 cursor-pointer" onClick={() => onSelectTask(gap.targetId)}>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
                    <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                    <span className="truncate">{gap.title}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{gap.description}</p>
                </div>

                <button
                  onClick={() => handleDismissGap(gap.id)}
                  className="text-gray-400 hover:text-gray-600 p-1 text-xs font-bold"
                  title="Dismiss suggestion"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Canvas or Outline View */}
      {projectTasks.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-[#1c1c1e] rounded-[32px] border border-black/5 dark:border-white/5 space-y-2">
          <Network size={32} className="text-gray-300 mx-auto" />
          <h3 className="text-base font-bold text-gray-900 dark:text-white">No tasks in this project map</h3>
          <p className="text-xs text-gray-400">Use the input above or press N to add tasks and build your flow.</p>
        </div>
      ) : viewMode === 'canvas' ? (
        <ProjectFlowCanvas
          items={projectTasks}
          project={project}
          gaps={gaps}
          flowMode={flowMode}
          onSelectTask={onSelectTask}
          onLinkDependency={handleLinkDependency}
          onUnlinkDependency={handleUnlinkDependency}
          onUpdateLayout={handleUpdateLayout}
        />
      ) : (
        <ProjectTreeOutline
          items={projectTasks}
          gaps={gaps}
          onSelectTask={onSelectTask}
          onLinkDependency={handleLinkDependency}
          onUnlinkDependency={handleUnlinkDependency}
          onDismissGap={handleDismissGap}
        />
      )}
    </div>
  );
}
