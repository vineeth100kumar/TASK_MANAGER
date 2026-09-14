import React from 'react';
import { clsx } from 'clsx';

interface HedProps {
  level?: 1 | 2 | 3 | 4;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  italic?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const Hed: React.FC<HedProps> = ({
  level = 2,
  size = 'md',
  italic = false,
  children,
  className,
}) => {
  const sizeClasses = {
    sm: 'text-sm font-semibold tracking-tight',
    md: 'text-base font-bold tracking-tight',
    lg: 'text-xl font-bold tracking-tight',
    xl: 'text-2xl sm:text-3xl font-black tracking-tight',
  }[size];

  const Tag = `h${level}` as keyof JSX.IntrinsicElements;

  return (
    <Tag
      className={clsx(
        'hed leading-tight',
        sizeClasses,
        italic && 'italic',
        className
      )}
    >
      {children}
    </Tag>
  );
};
