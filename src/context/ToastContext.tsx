import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onAction: () => void;
  durationMs?: number;
}

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, action?: ToastAction) => void;
  dismissToast: (id: number) => void;
  toasts: Toast[];
}

export const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    return { 
      showToast: () => {}, 
      dismissToast: () => {}, 
      toasts: [] 
    };
  }
  return context;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'success', action?: ToastAction) => {
    const id = Date.now();
    const toast: Toast = { id, message, type, action };
    setToasts(prev => [...prev, toast]);

    const duration = action?.durationMs || (action ? 8000 : 4000);
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast, toasts }}>
      {children}
    </ToastContext.Provider>
  );
};
