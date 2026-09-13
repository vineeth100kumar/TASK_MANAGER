import React from 'react';

export interface SkeletonProps {
  variant?: 'card' | 'row' | 'text' | 'circle';
  className?: string;
  count?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'text',
  className = '',
  count = 1
}) => {
  const baseClasses = 'animate-pulse bg-zinc-800/70 rounded-xl';

  const variantClasses = {
    card: 'h-32 w-full',
    row: 'h-14 w-full',
    text: 'h-4 w-3/4 rounded-md',
    circle: 'w-10 h-10 rounded-full'
  };

  const elements = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      aria-hidden="true"
    />
  ));

  return count === 1 ? elements[0] : <div className="space-y-2.5 w-full">{elements}</div>;
};
