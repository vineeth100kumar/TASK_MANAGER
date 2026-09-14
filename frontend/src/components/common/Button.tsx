import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'gradient';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'sm',
  isLoading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-ledger font-bold uppercase tracking-wider transition-colors rounded-none active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none select-none border';

  const sizeClasses = {
    xs: 'px-2 py-1 text-[10px] gap-1',
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-xs gap-2',
    lg: 'px-5 py-2.5 text-sm gap-2.5'
  };

  const variantClasses = {
    primary: 'bg-amber-600 hover:bg-amber-500 text-stone-950 border-amber-500 font-black',
    secondary: 'bg-stone-900 hover:bg-stone-800 text-stone-200 hover:text-white border-stone-700',
    ghost: 'border-transparent text-stone-400 hover:text-stone-200 hover:bg-stone-900',
    danger: 'bg-stone-950 hover:bg-rose-950/80 text-rose-400 border-rose-800',
    outline: 'border-stone-700 text-stone-300 hover:text-white hover:bg-stone-900',
    gradient: 'bg-stone-900 hover:bg-stone-800 text-amber-400 border-amber-600'
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
};
