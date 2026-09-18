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
    <div className="w-full bg-surface border border-hairline rounded-surface p-3 space-y-2.5 transition-colors focus-within:border-accent-500/60">

      <div className="flex justify-between items-center gap-4 text-caption text-ink-3 pb-0.5">
        <span>Dates, projects and priorities are picked up as you type</span>
        <span className="hidden md:inline font-mono">tomorrow 5pm #project !high @context ~30m</span>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 pt-0.5">
        <span className="text-accent-500 shrink-0 pl-0.5">
          <Plus className="w-[18px] h-[18px]" />
        </span>

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder='e.g. Review quarterly taxes tomorrow 5pm #Finance !high @audit ~45m'
          className="flex-1 bg-transparent text-body text-ink placeholder:text-ink-3 focus:outline-none"
        />

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenAiBrainDump}
            title="Open quick capture for unstructured notes"
            className="flex items-center gap-1.5 h-9 px-2.5 rounded-control text-ink-2 hover:text-ink hover:bg-sunken text-meta transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Capture</span>
          </button>

          <button
            type="submit"
            disabled={!parsed.title}
            className={`flex items-center justify-center gap-1 h-9 px-3.5 rounded-control text-meta font-medium transition-all duration-150 ease-settle ${
              parsed.title
                ? 'bg-accent-500 hover:bg-accent-600 text-white active:scale-[0.98]'
                : 'bg-sunken text-ink-3 cursor-not-allowed'
            }`}
          >
            <span>Add</span>
          </button>
        </div>
      </form>

      {/* Live Interactive Token Preview Pills */}
      {parsed.tokens.length > 0 && (
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-stone-200 dark:border-stone-800/80 text-caption">
          <span className="text-ink-3 shrink-0 text-caption">Detected</span>
          {parsed.tokens.map((token, idx) => (
            <span
              key={idx}
              className={`px-1.5 py-0.5 rounded-control whitespace-nowrap border ${
                token.type === 'priority'
                  ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                  : token.type === 'project'
                  ? 'bg-stone-100 text-stone-800 border-stone-300 dark:bg-stone-900 dark:text-stone-200 dark:border-stone-700'
                  : token.type === 'date' || token.type === 'time'
                  ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                  : token.type === 'tag'
                  ? 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-stone-900 dark:text-amber-400 dark:border-amber-800/60'
                  : 'bg-stone-100 text-stone-800 border-stone-300 dark:bg-stone-900 dark:text-stone-300 dark:border-stone-700'
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
