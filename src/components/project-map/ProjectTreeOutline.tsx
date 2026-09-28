import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, AlertTriangle, ArrowRight, Link, Flag, X } from 'lucide-react';
import { WorkItem } from '../../services/types';
import { ProjectGap } from '../../utils/projectGapAnalyzer';

interface ProjectTreeOutlineProps {
  items: WorkItem[];
  gaps: ProjectGap[];
  onSelectTask: (id: string) => void;
  onLinkDependency: (fromId: string, toId: string) => void;
  onUnlinkDependency: (fromId: string, toId: string) => void;
  onDismissGap: (gapId: string) => void;
}

export function ProjectTreeOutline({
  items,
  gaps,
  onSelectTask,
  onLinkDependency,
  onUnlinkDependency,
  onDismissGap
}: ProjectTreeOutlineProps) {
  const [linkingTargetItem, setLinkingTargetItem] = useState<WorkItem | null>(null);
  const itemMap = new Map(items.map(i => [i.id, i]));

  return (
    <div className="space-y-4 font-sans">
      {/* List of Tasks & Dependencies */}
      <div className="space-y-3">
        {items.map(item => {
          const isMilestone = item.entityType === 'milestone';
          const prerequisites = (item.dependsOn || []).map(id => itemMap.get(id)).filter(Boolean) as WorkItem[];
          const itemGaps = gaps.filter(g => g.targetId === item.id);

          return (
            <div
              key={item.id}
              className={`p-4 rounded-2xl bg-white dark:bg-[#1c1c1e] border shadow-sm space-y-3 transition-all ${
                itemGaps.length > 0 
                  ? 'border-amber-300 dark:border-amber-500/50 ring-1 ring-amber-300/30' 
                  : isMilestone 
                  ? 'border-purple-300 dark:border-purple-600/50' 
                  : 'border-black/5 dark:border-white/5'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="mt-0.5 shrink-0">
                    {isMilestone ? (
                      <Flag size={16} className="text-purple-500" />
                    ) : item.status === 'done' ? (
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    ) : (
                      <Circle size={18} className="text-gray-300" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelectTask(item.id)}>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase">
                      <span className="font-mono">{item.key}</span>
                      {item.dueDate && <span>· Due {item.dueDate}</span>}
                    </div>

                    <h4 className="font-bold text-sm text-gray-900 dark:text-white mt-0.5 leading-snug hover:text-blue-500 transition-colors">
                      {item.title}
                    </h4>
                  </div>
                </div>

                {/* 1-Tap Link Button */}
                <button
                  onClick={() => setLinkingTargetItem(item)}
                  className="px-2.5 py-1.5 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 text-xs font-bold flex items-center gap-1 shrink-0"
                  title="Link prerequisite"
                >
                  <Link size={12} />
                  <span>Link</span>
                </button>
              </div>

              {/* Prerequisites Chain */}
              {prerequisites.length > 0 && (
                <div className="pt-2 border-t border-gray-100 dark:border-white/5 space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Depends on:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {prerequisites.map(prereq => (
                      <div
                        key={prereq.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[11px] font-semibold text-blue-700 dark:text-blue-300"
                      >
                        <span className="font-mono">{prereq.key}</span>
                        <span className="truncate max-w-[120px]">{prereq.title}</span>
                        <button
                          onClick={() => onUnlinkDependency(item.id, prereq.id)}
                          className="text-blue-400 hover:text-red-500"
                          title="Remove link"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Inline Gap Alerts */}
              {itemGaps.map(gap => (
                <div
                  key={gap.id}
                  className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-xs flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                    <span className="text-amber-900 dark:text-amber-300 font-medium truncate">{gap.description}</span>
                  </div>
                  <button
                    onClick={() => onDismissGap(gap.id)}
                    className="text-gray-400 hover:text-gray-600 text-[10px] font-bold uppercase shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* 1-Tap Link Selector Drawer */}
      <AnimatePresence>
        {linkingTargetItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLinkingTargetItem(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-[#1c1c1e] w-full max-w-md rounded-[32px] shadow-2xl p-6 relative z-10 border border-gray-100 dark:border-white/10 space-y-4 max-h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Link Prerequisite</div>
                  <h3 className="font-extrabold text-sm text-gray-900 dark:text-white truncate mt-0.5">
                    What must finish before "{linkingTargetItem.title}"?
                  </h3>
                </div>
                <button onClick={() => setLinkingTargetItem(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                {items
                  .filter(i => i.id !== linkingTargetItem.id && !(linkingTargetItem.dependsOn || []).includes(i.id))
                  .map(candidate => (
                    <button
                      key={candidate.id}
                      onClick={() => {
                        onLinkDependency(linkingTargetItem.id, candidate.id);
                        setLinkingTargetItem(null);
                      }}
                      className="w-full p-3 rounded-xl bg-gray-50 dark:bg-white/5 hover:bg-blue-50 dark:hover:bg-blue-950/30 border border-black/5 dark:border-white/5 text-left flex items-center justify-between gap-2 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-[10px] font-bold text-gray-400 block">{candidate.key}</span>
                        <span className="font-bold text-xs text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate block">
                          {candidate.title}
                        </span>
                      </div>
                      <ArrowRight size={14} className="text-gray-300 group-hover:text-blue-500 shrink-0" />
                    </button>
                  ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
