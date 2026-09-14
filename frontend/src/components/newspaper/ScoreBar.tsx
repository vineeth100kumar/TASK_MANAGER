import React from 'react';
import { clsx } from 'clsx';

interface ScoreBarProps {
  value: number; // 0 to 100
  className?: string;
  height?: string;
  showTicks?: boolean;
}

export const ScoreBar: React.FC<ScoreBarProps> = ({
  value,
  className,
  height = 'h-1.5',
  showTicks = false,
}) => {
  const clamped = Math.min(Math.max(value, 0), 100);

  return (
    <div className={clsx('w-full relative', className)}>
      <div className={clsx('w-full bg-ink-rule/30 border border-ink-rule overflow-hidden', height)}>
        <div
          className="h-full bg-ink-primary transition-all duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showTicks && (
        <div className="flex justify-between text-[8px] font-ledger text-ink-faint mt-0.5">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      )}
    </div>
  );
};
