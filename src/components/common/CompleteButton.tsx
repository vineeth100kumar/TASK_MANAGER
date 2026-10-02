import React from 'react';
import { Check } from 'lucide-react';

interface CompleteButtonProps {
  checked?: boolean;
  // While the completion is saving the ring spins; when it lands the tick draws in.
  saving?: boolean;
  onComplete: (e: React.MouseEvent) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'check-sm', md: 'check-md', lg: 'check-lg' };

// The round tick. Pressed, it spins while saving, then fills with a pop and a ripple.
export function CompleteButton({ checked = false, saving = false, onComplete, size = 'md', className = '' }: CompleteButtonProps) {
  return (
    <button
      type="button"
      className={`check-ring ${SIZES[size]} ${className}`}
      data-saving={saving || undefined}
      data-checked={(checked && !saving) || undefined}
      aria-label={saving ? 'Completing' : checked ? 'Completed' : 'Complete'}
      aria-pressed={checked}
      aria-busy={saving || undefined}
      onClick={(e) => { e.stopPropagation(); if (!checked && !saving) onComplete(e); }}
    >
      <Check size={size === 'lg' ? 13 : size === 'sm' ? 11 : 12} strokeWidth={3} />
    </button>
  );
}
