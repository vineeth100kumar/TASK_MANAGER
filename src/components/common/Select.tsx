import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from './Popover';

interface Opt { value: string; label: string; disabled?: boolean; group?: string }

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as any).children);
  return '';
}

// Reads <option> and <optgroup> children, so a native <select> becomes a
// <Select> without rewriting its options.
function readOptions(children: ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    const props = child.props as any;
    if (child.type === Fragment) readOptions(props.children, group, out);
    else if (child.type === 'optgroup') readOptions(props.children, props.label, out);
    else if (child.type === 'option') {
      const label = textOf(props.children);
      out.push({ value: String(props.value ?? label), label, disabled: props.disabled, group });
    }
  });
  return out;
}

// A dropdown in the app's own style: the trigger takes whatever classes the
// old <select> had, and the list opens in a Popover (a bottom sheet on phones).
export function Select({ value, onChange, children, className = '', placeholder, disabled, title, id, align = 'start', icon, 'aria-label': ariaLabel }: {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  id?: string;
  align?: 'start' | 'end';
  icon?: ReactNode;
  'aria-label'?: string;
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const current = String(value ?? '');
  const selected = options.find(o => o.value === current);
  // Like a native select, an unknown value shows the first choice.
  const shown = selected ?? (placeholder ? undefined : options[0]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const typed = useRef({ text: '', at: 0 });

  const openList = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex(o => o.value === current)));
    setOpen(true);
  };
  const choose = (o: Opt) => {
    if (o.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (o.value !== current) onChange(o.value);
  };

  // Keep the highlighted choice in view and focused for screen readers.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  useEffect(() => {
    if (open) requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }));
  }, [open]);

  const move = (from: number, step: number) => {
    let i = from;
    for (let n = 0; n < options.length; n++) {
      i = (i + step + options.length) % options.length;
      if (!options[i].disabled) return i;
    }
    return from;
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => move(a, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => move(a, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(move(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setActive(move(options.length, -1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) choose(options[active]); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Type the first letters of a choice to jump to it.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const hit = options.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
      e.stopPropagation();
    }
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button ref={triggerRef} type="button" id={id} title={title} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(); } }}
        className={`select-trigger ${className}`} data-open={open || undefined}>
        {icon}
        <span className={`flex-1 min-w-0 truncate ${shown ? '' : 'select-placeholder'}`}>{shown ? shown.label : placeholder}</span>
        <ChevronDown size={14} strokeWidth={2.25} className={`select-chevron shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} align={align} width="anchor" label={ariaLabel}>
        <div ref={listRef} id={listId} role="listbox" tabIndex={-1} aria-label={ariaLabel} onKeyDown={onListKey}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="p-1.5 md:max-h-72 overflow-y-auto custom-scrollbar outline-none">
          {options.map((o, i) => {
            const header = o.group !== lastGroup && o.group ? o.group : null;
            lastGroup = o.group;
            const isSel = o.value === current;
            return (
              <Fragment key={`${o.group ?? ''}:${o.value}:${i}`}>
                {header && <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400 dark:text-gray-500" role="presentation">{header}</div>}
                <div id={`${listId}-${i}`} role="option" aria-selected={isSel} aria-disabled={o.disabled || undefined} data-index={i}
                  onPointerMove={() => !o.disabled && active !== i && setActive(i)}
                  onClick={() => choose(o)}
                  className={`select-option ${i === active ? 'is-active' : ''} ${isSel ? 'is-selected' : ''} ${o.disabled ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}>
                  <span className="flex-1 min-w-0 truncate">{o.label || ' '}</span>
                  {isSel && <Check size={15} strokeWidth={2.5} className="shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />}
                </div>
              </Fragment>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
