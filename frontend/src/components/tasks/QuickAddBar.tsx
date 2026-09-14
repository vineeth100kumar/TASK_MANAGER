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
    <div className="w-full bg-[#101013] border-2 border-stone-800 rounded-none p-3 shadow-none space-y-2.5 transition-all focus-within:border-amber-600/70">
      <div className="flex justify-between items-center text-[9px] font-ledger uppercase tracking-widest text-stone-500 border-b border-stone-800/80 pb-1.5">
        <span>TELEGRAM DISPATCH ENTRY &bull; 0MS CLIENT NLP</span>
        <span className="text-amber-500">FORMAT: "Title tomorrow 5pm #project !high @context ~30m"</span>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 pt-0.5">
        <div className="w-7 h-7 rounded-none bg-stone-900 border border-stone-700 text-amber-500 flex items-center justify-center shrink-0">
          <Plus className="w-4 h-4" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder='Draft clipping: "Review quarterly taxes tomorrow 5pm #Finance !high @audit ~45m"'
          className="flex-1 bg-transparent text-xs font-ledger text-stone-100 placeholder-stone-600 focus:outline-none rounded-none"
        />

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenAiBrainDump}
            title="Open The Wire for unstructured notes"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-none bg-stone-900 hover:bg-stone-800 text-amber-400 border border-stone-700 text-xs font-ledger uppercase tracking-wider transition-colors"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline">The Wire</span>
          </button>

          <button
            type="submit"
            disabled={!parsed.title}
            className={`flex items-center justify-center px-3 py-1.5 rounded-none transition-colors border text-xs font-ledger uppercase font-bold tracking-wider ${
              parsed.title
                ? 'bg-amber-600 hover:bg-amber-500 text-stone-950 border-amber-500 font-black'
                : 'bg-stone-900 text-stone-600 border-stone-800 cursor-not-allowed'
            }`}
          >
            <ArrowRight className="w-3.5 h-3.5 mr-1" />
            <span>DISPATCH</span>
          </button>
        </div>
      </form>

      {/* Live Interactive Token Preview Pills */}
      {parsed.tokens.length > 0 && (
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-stone-800/80 text-[10px] font-ledger">
          <span className="text-stone-500 font-bold uppercase tracking-wider shrink-0 text-[9px]">DETECTED:</span>
          {parsed.tokens.map((token, idx) => (
            <span
              key={idx}
              className={`px-1.5 py-0.5 rounded-none uppercase whitespace-nowrap border ${
                token.type === 'priority'
                  ? 'bg-rose-950/60 text-rose-300 border-rose-800'
                  : token.type === 'project'
                  ? 'bg-stone-900 text-stone-200 border-stone-700'
                  : token.type === 'date' || token.type === 'time'
                  ? 'bg-amber-950/60 text-amber-300 border-amber-800'
                  : token.type === 'tag'
                  ? 'bg-stone-900 text-amber-400 border-amber-800/60'
                  : 'bg-stone-900 text-stone-300 border-stone-700'
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
