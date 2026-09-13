import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { ToastContainer } from '../components/common/Toast';

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'action';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  showToast: (toast: Omit<ToastItem, 'id'>) => string;
  error: (message: string, title?: string) => string;
  success: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
  warning: (message: string, title?: string) => string;
  action: (message: string, actionLabel: string, onAction: () => void, duration?: number) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<{ [id: string]: any }>({});

  const dismissToast = useCallback((id: string) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((item: Omit<ToastItem, 'id'>): string => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const duration = item.duration ?? (item.type === 'error' ? 6000 : 4500);

    const newToast: ToastItem = { ...item, id, duration };

    // Max 3 toasts at once, prepend new toast
    setToasts(prev => [newToast, ...prev.slice(0, 2)]);

    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => {
        dismissToast(id);
      }, duration);
    }

    return id;
  }, [dismissToast]);

  const error = useCallback((message: string, title?: string) => {
    return showToast({ type: 'error', message, title });
  }, [showToast]);

  const success = useCallback((message: string, title?: string) => {
    return showToast({ type: 'success', message, title });
  }, [showToast]);

  const info = useCallback((message: string, title?: string) => {
    return showToast({ type: 'info', message, title });
  }, [showToast]);

  const warning = useCallback((message: string, title?: string) => {
    return showToast({ type: 'warning', message, title });
  }, [showToast]);

  const action = useCallback((message: string, actionLabel: string, onAction: () => void, duration = 6000) => {
    return showToast({
      type: 'action',
      message,
      duration,
      action: {
        label: actionLabel,
        onClick: onAction
      }
    });
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, error, success, info, warning, action, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
