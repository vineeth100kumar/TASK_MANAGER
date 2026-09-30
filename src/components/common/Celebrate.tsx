import React from 'react';

const DOT_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#f43f5e', '#8b5cf6', '#14b8a6'];

// A badge that springs in with a quick ring of dots. Plays once on mount; the
// global reduced-motion rule turns it into a plain badge.
export function Celebrate({ children, className = '', dots = 12, distance = 34 }: { children: React.ReactNode; className?: string; dots?: number; distance?: number }) {
  return (
    <div className={`celebrate ${className}`} aria-hidden>
      {Array.from({ length: dots }, (_, i) => (
        <i key={i} style={{
          '--a': `${(360 / dots) * i + (i % 2 ? 8 : 0)}deg`,
          '--d': `${distance + (i % 3) * 8}px`,
          background: DOT_COLORS[i % DOT_COLORS.length],
        } as React.CSSProperties} />
      ))}
      {children}
    </div>
  );
}
