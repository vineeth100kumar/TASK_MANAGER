import React from 'react';
import { clsx } from 'clsx';

interface ClipRuleProps {
  variant?: 'solid' | 'thin' | 'double';
  className?: string;
}

export const ClipRule: React.FC<ClipRuleProps> = ({ variant = 'solid', className }) => {
  const variantClass = {
    solid: 'clip-rule',
    thin: 'clip-rule-thin',
    double: 'clip-rule-double',
  }[variant];

  return <div className={clsx(variantClass, className)} />;
};
