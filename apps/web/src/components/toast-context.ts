import { createContext } from 'react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
}

export interface ToastApi {
  success: (title: string, opts?: { description?: string; duration?: number }) => string;
  error: (title: string, opts?: { description?: string; duration?: number }) => string;
  warning: (title: string, opts?: { description?: string; duration?: number }) => string;
  info: (title: string, opts?: { description?: string; duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const ToastContext = createContext<ToastApi | null>(null);
