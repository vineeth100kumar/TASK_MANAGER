import { useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { Project } from '../../services/types';
import { allProjectTypes, normaliseTypeInput, projectTypeInfo } from '../../services/projectTypes';
import { Popover } from './Popover';

/** A small coloured label naming a project's type. */
export function ProjectTypeChip({ type, size = 'md', className = '' }: { type: string | undefined; size?: 'sm' | 'md'; className?: string }) {
  const info = projectTypeInfo(type);
  const Icon = info.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ${info.chip} ${size === 'sm' ? 'text-[10.5px] px-1.5 py-0.5' : 'text-[12px] px-2 py-0.5'} ${className}`}>
      <Icon size={size === 'sm' ? 11 : 13} strokeWidth={2.2} />
      {info.label}
    </span>
  );
}

/** Tiles for each type, plus a tile that lets the user name their own. */
export function ProjectTypePicker({ value, onChange, projects }: { value: string; onChange: (type: string) => void; projects: Project[] }) {
  const types = allProjectTypes(projects);
  const current = projectTypeInfo(value).id;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  // A custom type typed here but not yet saved on any project still shows as a tile.
  const list = types.some(t => t.id === current) ? types : [...types.slice(0, -1), projectTypeInfo(current), types[types.length - 1]];

  const commit = () => {
    const t = normaliseTypeInput(draft);
    if (t) onChange(t);
    setAdding(false); setDraft('');
  };

  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Project type">
      {list.map(t => {
        const Icon = t.icon;
        const on = t.id === current;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(t.id)}
            className={`flex items-center gap-2.5 p-2.5 rounded-xl text-left border transition-all ${on
              ? 'border-blue-500/60 bg-blue-500/[0.06] ring-2 ring-blue-500/20 dark:bg-blue-400/10'
              : 'border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/[0.03]'}`}>
            <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${t.chip}`}><Icon size={16} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-gray-900 dark:text-white truncate">{t.label}</span>
              <span className="block text-[11px] text-gray-500 truncate">{t.hint}</span>
            </span>
            {on && <Check size={14} className="shrink-0 text-blue-600 dark:text-blue-400" />}
          </button>
        );
      })}
      {adding ? (
        <div className="col-span-2 flex gap-2">
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. Research, Fitness" maxLength={24}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); } }}
            className="field flex-1" aria-label="New type name" />
          <button type="button" onClick={commit} disabled={!draft.trim()} className="px-3 rounded-xl text-[13px] font-semibold bg-gray-900 text-white dark:bg-white dark:text-black disabled:opacity-40">Add</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="col-span-2 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12.5px] font-semibold text-gray-500 border border-dashed border-gray-300 dark:border-white/15 hover:text-gray-900 dark:hover:text-white hover:border-gray-400 transition-colors">
          <Plus size={14} /> Your own type
        </button>
      )}
    </div>
  );
}

/** The chip as a button that opens the picker, for changing a project's type in place. */
export function ProjectTypeMenu({ project, projects, onChange }: { project: Project; projects: Project[]; onChange: (type: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open}
        title="Change project type" className="inline-flex items-center gap-0.5 rounded-full hover:opacity-80 transition-opacity">
        <ProjectTypeChip type={project.type} />
        <ChevronDown size={13} className="text-gray-400" />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={384} label="Project type" className="p-3">
        <div className="hidden md:block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-2 px-0.5">Project type</div>
        <ProjectTypePicker value={project.type || ''} projects={projects} onChange={t => { onChange(t); setOpen(false); }} />
      </Popover>
    </>
  );
}
