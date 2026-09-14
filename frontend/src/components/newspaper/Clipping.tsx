import React from 'react';
import { clsx } from 'clsx';

export interface ClippingProps {
  variant?: 'base' | 'aged' | 'cream' | 'white';
  rotate?: number;           // degrees, e.g. -1.2
  className?: string;
  children: React.ReactNode;
  padding?: string;
}

export const Clipping: React.FC<ClippingProps> = ({
  variant = 'base',
  rotate = 0,
  className,
  children,
  padding = 'p-3',
}) => {
  const variantClass = {
    base: 'clipping',
    aged: 'clipping clipping-aged',
    cream: 'clipping clipping-cream',
    white: 'clipping clipping-white',
  }[variant];

  // Dampen rotation on mobile screens
  const effectiveRotate =
    typeof window !== 'undefined' && window.innerWidth < 768
      ? rotate * 0.4
      : rotate;

  return (
    <div
      className={clsx(variantClass, padding, className)}
      style={{
        transform: effectiveRotate !== 0 ? `rotate(${effectiveRotate}deg)` : undefined,
      }}
    >
      {children}
    </div>
  );
};
