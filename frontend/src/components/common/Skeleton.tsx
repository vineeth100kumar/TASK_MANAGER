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
  const baseClasses = 'animate-pulse bg-sunken rounded-control';

  const variantClasses = {
    card: 'h-32 w-full',
    row: 'h-12 w-full',
    text: 'h-4 w-3/4',
    circle: 'w-8 h-8'
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
