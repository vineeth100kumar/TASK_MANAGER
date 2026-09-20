import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Sparkles, Plus } from 'lucide-react';
import { Project, WorkItem } from '../../types';
import { parseQuickAdd } from '../../utils/quickAddParser';
import { haptics } from '../../utils/haptics';

export const CONTEXT_TAGS = ['@errands', '@computer', '@phone', '@home', '@deep-work'];

export interface QuickAddBarHandle {
  focus: () => void;
}

interface QuickAddBarProps {
  projects: Project[];
  onQuickAdd: (item: Omit<Partial<WorkItem>, 'subtasks'> & { subtasks?: string[] }) => void;
  onOpenAiBrainDump: () => void;
}

interface Suggestion {
  /* What replaces the fragment being typed. */
  insert: string;
  label: string;
  hint?: string;
}

/*
 * The fragment under the caret, when it is the start of a #project or @context
 * token. Only the word currently being typed is offered a completion, so a
 * finished token further back in the line is left alone.
 */
function fragmentAtEnd(input: string): { sigil: '#' | '@'; query: string } | null {
  const match = input.match(/(^|\s)([#@])([a-zA-Z0-9_-]*)$/);
  if (!match) return null;
  return { sigil: match[2] as '#' | '@', query: match[3].toLowerCase() };
}

export const QuickAddBar = forwardRef<QuickAddBarHandle, QuickAddBarProps>(({
  projects,
  onQuickAdd,
  onOpenAiBrainDump,
}, ref) => {
  const [input, setInput] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [isSuggestionsDismissed, setIsSuggestionsDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const parsed = parseQuickAdd(input, projects);

  const fragment = fragmentAtEnd(input);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!fragment || isSuggestionsDismissed) return [];

    if (fragment.sigil === '#') {
      return projects
        .filter((p) => p.name.toLowerCase().replace(/[\s_-]/g, '').includes(fragment.query))
        .slice(0, 5)
        .map((p) => ({
          insert: `#${p.name.replace(/\s+/g, '')}`,
          label: p.name,
          hint: 'Project',
        }));
    }

    return CONTEXT_TAGS.filter((t) => t.slice(1).startsWith(fragment.query))
      .slice(0, 5)
      .map((t) => ({ insert: t, label: t, hint: 'Context' }));
  }, [fragment, projects, isSuggestionsDismissed]);

  const applySuggestion = (suggestion: Suggestion) => {
    setInput((prev) => `${prev.replace(/([#@])[a-zA-Z0-9_-]*$/, suggestion.insert)} `);
    setActiveSuggestion(0);
    inputRef.current?.focus();
  };

  const handleChange = (value: string) => {
    setInput(value);
    setActiveSuggestion(0);
    setIsSuggestionsDismissed(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestions[activeSuggestion])) {
        e.preventDefault();
        applySuggestion(suggestions[activeSuggestion]);
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setIsSuggestionsDismissed(true);
      } else if (input) {
        setInput('');
      } else {
        inputRef.current?.blur();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.title) return;

    haptics.light();
    onQuickAdd({
      title: parsed.title,
      entity_type: parsed.entity_type,
      priority: parsed.priority,
      due_date: parsed.due_date,
      start_at: parsed.due_time
        ? `${parsed.due_date || new Date().toISOString().slice(0, 10)}T${parsed.due_time}:00`
        : undefined,
      project_id: parsed.project_id,
      context_tags: parsed.context_tags,
      estimated_minutes: parsed.estimated_minutes || 30,
    });

    setInput('');
    setActiveSuggestion(0);
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

        <div className="relative flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Quick add a task"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            placeholder="e.g. Review quarterly taxes tomorrow 5pm #Finance !high @audit ~45m"
            className="w-full bg-transparent text-body text-ink placeholder:text-ink-3 focus:outline-none"
          />

          {/* Completion for the token being typed, so the syntax is learnable */}
          {suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute left-0 top-full mt-2 z-30 w-64 max-w-full bg-surface border border-hairline rounded-control shadow-lg overflow-hidden py-1"
            >
              {suggestions.map((suggestion, idx) => (
                <li key={suggestion.insert}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={idx === activeSuggestion}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySuggestion(suggestion);
                    }}
                    onMouseEnter={() => setActiveSuggestion(idx)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-meta transition-colors ${
                      idx === activeSuggestion ? 'bg-accent-500/10 text-ink' : 'text-ink-2'
                    }`}
                  >
                    <span className="truncate">{suggestion.label}</span>
                    {suggestion.hint && <span className="text-caption text-ink-3 shrink-0">{suggestion.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-hairline text-caption">
          <span className="text-ink-3 shrink-0 text-caption">Detected</span>
          {parsed.tokens.map((token, idx) => (
            <span
              key={idx}
              className="px-1.5 py-0.5 rounded-control whitespace-nowrap bg-sunken text-ink-2"
            >
              {token.display}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

QuickAddBar.displayName = 'QuickAddBar';
