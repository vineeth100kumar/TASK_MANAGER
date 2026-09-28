import React, { useRef } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { Check, Clock } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';

interface SwipeRowProps {
  children: React.ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  rightLabel?: string;
  leftLabel?: string;
  className?: string;
}

const THRESHOLD = 88;

// On phones, swipe a row right to complete it or left to snooze it.
// On larger screens it renders the row unchanged.
export function SwipeRow({ children, onSwipeRight, onSwipeLeft, rightLabel = 'Done', leftLabel = 'Tomorrow', className = '' }: SwipeRowProps) {
  const isMobile = useIsMobile();
  const x = useMotionValue(0);
  const dragged = useRef(false);
  const rightOpacity = useTransform(x, [0, THRESHOLD], [0, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, 0], [1, 0]);

  if (!isMobile || (!onSwipeRight && !onSwipeLeft)) {
    return <div className={className}>{children}</div>;
  }

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > THRESHOLD && onSwipeRight) onSwipeRight();
    else if (info.offset.x < -THRESHOLD && onSwipeLeft) onSwipeLeft();
    // Let the click that ends a drag pass before re-enabling taps.
    setTimeout(() => { dragged.current = false; }, 0);
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      {onSwipeRight && (
        <motion.div style={{ opacity: rightOpacity }} className="absolute inset-0 flex items-center pl-5 bg-emerald-500 text-white text-[13px] font-semibold gap-2 rounded-2xl" aria-hidden>
          <Check size={18} /> {rightLabel}
        </motion.div>
      )}
      {onSwipeLeft && (
        <motion.div style={{ opacity: leftOpacity }} className="absolute inset-0 flex items-center justify-end pr-5 bg-amber-500 text-white text-[13px] font-semibold gap-2 rounded-2xl" aria-hidden>
          {leftLabel} <Clock size={18} />
        </motion.div>
      )}
      <motion.div
        drag="x"
        style={{ x }}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: onSwipeLeft ? 0.6 : 0.05, right: onSwipeRight ? 0.6 : 0.05 }}
        dragDirectionLock
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={handleDragEnd}
        onClickCapture={(e) => { if (dragged.current) { e.stopPropagation(); e.preventDefault(); } }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
}

// 9 AM tomorrow, the default for a swipe snooze.
export function tomorrowMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}
