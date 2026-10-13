import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '../../hooks/useIsMobile';

// The floating panel behind the app's own pickers (Select, DatePicker,
// TimePicker). On a desk it hangs off its trigger and flips above when there's
// no room below; on a phone it rises as a bottom sheet. It sits in a portal so
// a modal's overflow can't clip it, and marks itself with data-popover-layer so
// menus that close on an outside press can tell it isn't outside.
export function Popover({ anchorRef, open, onClose, children, align = 'start', width, label, className = '' }: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  /** Pixel width, or 'anchor' to match the trigger (never narrower than 12rem). */
  width?: number | 'anchor';
  label?: string;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number; above: boolean } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Place the panel next to its trigger, and keep it there while the page scrolls.
  useLayoutEffect(() => {
    if (!open || isMobile) { setPos(null); return; }
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const r = anchor.getBoundingClientRect();
      const w = width === 'anchor' ? Math.max(r.width, 192) : (width ?? panel.offsetWidth);
      const h = panel.offsetHeight;
      const gap = 6, edge = 8;
      const roomBelow = window.innerHeight - r.bottom - gap - edge;
      const above = h > roomBelow && r.top - gap - edge > roomBelow;
      let top = above ? r.top - gap - h : r.bottom + gap;
      top = Math.max(edge, Math.min(top, window.innerHeight - h - edge));
      let left = align === 'end' ? r.right - w : r.left;
      left = Math.max(edge, Math.min(left, window.innerWidth - w - edge));
      setPos({ top, left, width: typeof width === 'undefined' ? undefined : w, above });
    };
    place();
    // Contents can change height (a month with six weeks), so measure again.
    const ro = new ResizeObserver(place);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, isMobile, anchorRef, align, width]);

  // A press anywhere else closes it; so does Esc, without also closing the
  // dialog the picker sits in.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeRef.current();
      anchorRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchorRef]);

  if (!open) return null;

  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-[1000] flex flex-col justify-end" data-popover-layer>
        <div className="absolute inset-0 scrim" aria-hidden />
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label}
          className={`popover-sheet relative surface-float rounded-t-[1.75rem] pb-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto custom-scrollbar ${className}`}>
          <div className="sticky top-0 z-10 flex justify-center pt-2.5 pb-1" aria-hidden>
            <span className="w-9 h-1 rounded-full bg-black/15 dark:bg-white/20" />
          </div>
          {label && <p className="px-5 pb-1 pt-1 text-[13px] font-semibold text-gray-500 dark:text-gray-400">{label}</p>}
          {children}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div ref={panelRef} role="dialog" aria-label={label} data-popover-layer data-above={pos?.above || undefined}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width, opacity: pos ? undefined : 0 }}
      className={`popover-panel z-[1000] surface-float rounded-2xl ${className}`}>
      {children}
    </div>,
    document.body,
  );
}
