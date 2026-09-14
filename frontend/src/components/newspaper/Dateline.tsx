import React from 'react';
import { clsx } from 'clsx';

interface DatelineProps {
  children: React.ReactNode;
  className?: string;
}

export const Dateline: React.FC<DatelineProps> = ({ children, className }) => {
  return (
    <span className={clsx('dateline inline-block select-none', className)}>
      {children}
    </span>
  );
};
