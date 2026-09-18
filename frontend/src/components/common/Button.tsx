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
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-control ' +
    'transition-all duration-150 ease-settle active:scale-[0.98] ' +
    'disabled:opacity-40 disabled:pointer-events-none select-none';

  const sizeClasses = {
    xs: 'px-2.5 py-1 text-caption gap-1',
    sm: 'px-3 py-1.5 text-meta gap-1.5',
    md: 'px-4 h-10 text-meta gap-2',
    lg: 'px-5 h-11 text-body gap-2',
  };

  /*
   * Only `primary` gets the accent fill. Everything else is a quiet surface or
   * bare text, so the one action that matters on a screen is obvious.
   */
  const variantClasses = {
    primary: 'bg-accent-500 hover:bg-accent-600 text-white',
    secondary: 'bg-sunken hover:bg-hairline text-ink',
    ghost: 'text-ink-2 hover:text-ink hover:bg-sunken',
    danger: 'bg-danger-600 hover:bg-danger-700 text-white',
    outline: 'border border-hairline text-ink hover:bg-sunken',
    gradient: 'bg-sunken hover:bg-hairline text-accent-500',
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="w-3.5 h-3.5 border-2 border-current/25 border-t-current rounded-full animate-spin shrink-0" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
};
