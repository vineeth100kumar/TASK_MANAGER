import React from 'react';
import { clsx } from 'clsx';

interface LedgerRowProps {
  label: string;
  value: string | number;
  sublabel?: string;
  diff?: string;
  isPositive?: boolean;
  className?: string;
}

export const LedgerRow: React.FC<LedgerRowProps> = ({
  label,
  value,
  sublabel,
  diff,
  isPositive,
  className,
}) => {
  return (
    <div
      className={clsx(
        'flex items-baseline justify-between py-1 border-b border-ink-rule/30 last:border-b-0 font-ledger text-[11px]',
        className
      )}
    >
      <div className="flex flex-col">
        <span className="text-ink-primary font-medium">{label}</span>
        {sublabel && (
          <span className="text-[9px] text-ink-faint font-sans tracking-wide">
            {sublabel}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 text-right">
        <span className="text-ink-primary font-semibold tabular-nums">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {diff && (
          <span
            className={clsx(
              'text-[9px] font-bold tabular-nums',
              isPositive ? 'text-ink-success' : 'text-ink-danger'
            )}
          >
            {diff}
          </span>
        )}
      </div>
    </div>
  );
};
