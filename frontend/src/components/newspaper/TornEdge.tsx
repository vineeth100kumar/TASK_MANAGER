import React from 'react';
import { clsx } from 'clsx';

interface TornEdgeProps {
  position: 'top' | 'bottom';
  className?: string;
}

export const TornEdge: React.FC<TornEdgeProps> = ({ position, className }) => {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        position === 'top' ? 'torn-top' : 'torn-bottom',
        className
      )}
    />
  );
};
