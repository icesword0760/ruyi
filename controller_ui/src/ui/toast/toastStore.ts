import { create } from "zustand";

export type ToastVariant = "default" | "success" | "warn" | "error";

export type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
  createdAt: number;
};

type ToastState = {
  toasts: ToastItem[];
  push: (message: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, variant = "default") => {
    const toast: ToastItem = {
      id: uid(),
      message: String(message ?? ""),
      variant,
      createdAt: Date.now(),
    };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-6) }));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

