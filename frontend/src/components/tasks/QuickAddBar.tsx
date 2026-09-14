import React, { useState, useRef } from 'react';
import { Sparkles, Plus, Calendar, Folder, Tag, Clock, ArrowRight } from 'lucide-react';
import { Project, WorkItem } from '../../types';
import { parseQuickAdd } from '../../utils/quickAddParser';
import { haptics } from '../../utils/haptics';

interface QuickAddBarProps {
  projects: Project[];
  onQuickAdd: (item: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => void;
  onOpenAiBrainDump: () => void;
}

export const QuickAddBar: React.FC<QuickAddBarProps> = ({
  projects,
  onQuickAdd,
  onOpenAiBrainDump
}) => {
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = parseQuickAdd(input, projects);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.title) return;

    haptics.light();
    onQuickAdd({
      title: parsed.title,
      entity_type: parsed.entity_type,
      priority: parsed.priority,
      due_date: parsed.due_date,
      start_at: parsed.due_time ? `${parsed.due_date || new Date().toISOString().slice(0, 10)}T${parsed.due_time}:00` : undefined,
      project_id: parsed.project_id,
      context_tags: parsed.context_tags,
      estimated_minutes: parsed.estimated_minutes || 30
    });

    setInput('');
  };

  return (
    <div className="w-full bg-zinc-900/80 border border-zinc-800 rounded-2xl p-3 shadow-lg backdrop-blur-md space-y-2.5 transition-all focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/20">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
          <Plus className="w-4 h-4" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder='Quick Add: "Buy groceries tomorrow 5pm #Personal !high @errand ~30m"'
          className="flex-1 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
        />

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenAiBrainDump}
            title="Open AI Brain Dump for unstructured paragraphs"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 text-xs font-medium transition-all"
          >
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span className="hidden sm:inline">AI Brain Dump</span>
          </button>

          <button
            type="submit"
            disabled={!parsed.title}
            className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all ${
              parsed.title
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md active:scale-95'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>

      {/* Live Interactive Token Preview Pills */}
      {parsed.tokens.length > 0 && (
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-zinc-800/60 text-[11px]">
          <span className="text-zinc-500 font-medium text-[10px] uppercase tracking-wider shrink-0">Detected:</span>
          {parsed.tokens.map((token, idx) => (
            <span
              key={idx}
              className={`px-2 py-0.5 rounded-md font-medium whitespace-nowrap border shadow-sm ${
                token.type === 'priority'
                  ? 'bg-red-500/10 text-red-400 border-red-500/30'
                  : token.type === 'project'
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                  : token.type === 'date' || token.type === 'time'
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : token.type === 'tag'
                  ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                  : 'bg-zinc-800 text-zinc-300 border-zinc-700'
              }`}
            >
              {token.display}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
