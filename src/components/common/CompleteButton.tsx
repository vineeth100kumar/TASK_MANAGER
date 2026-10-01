import React from 'react';
import { Check } from 'lucide-react';

interface CompleteButtonProps {
  checked?: boolean;
  onComplete: (e: React.MouseEvent) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'check-sm', md: 'check-md', lg: 'check-lg' };

// The round tick. It fills with a small pop and a ripple the moment it's pressed.
export function CompleteButton({ checked = false, onComplete, size = 'md', className = '' }: CompleteButtonProps) {
  return (
    <button
      type="button"
      className={`check-ring ${SIZES[size]} ${className}`}
      data-checked={checked || undefined}
      aria-label={checked ? 'Completed' : 'Complete'}
      aria-pressed={checked}
      onClick={(e) => { e.stopPropagation(); if (!checked) onComplete(e); }}
    >
      <Check size={size === 'lg' ? 13 : size === 'sm' ? 11 : 12} strokeWidth={3} />
    </button>
  );
}
