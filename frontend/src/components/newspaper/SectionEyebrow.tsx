import React from 'react';
import { clsx } from 'clsx';

interface SectionEyebrowProps {
  children: React.ReactNode;
  className?: string;
  badge?: string;
}

export const SectionEyebrow: React.FC<SectionEyebrowProps> = ({ children, className, badge }) => {
  return (
    <div className={clsx('flex items-center justify-between gap-2 mb-1.5', className)}>
      <span className="font-sans text-[9px] font-bold tracking-[0.18em] uppercase text-ink-faint select-none">
        {children}
      </span>
      {badge && (
        <span className="font-sans text-[8px] font-bold tracking-wider uppercase border border-ink-faint text-ink-muted px-1.5 py-0.5 rounded-[1px]">
          {badge}
        </span>
      )}
    </div>
  );
};
