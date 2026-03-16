import { create } from "zustand";

type ModalKind = "alert" | "confirm" | "prompt";

export type ModalVariant = "default" | "danger";

export type ModalRequest = {
  id: string;
  kind: ModalKind;
  variant: ModalVariant;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  placeholder?: string;
  defaultValue?: string;
  allowEmpty?: boolean;
};

type ModalState = {
  active: ModalRequest | null;
  queue: ModalRequest[];
  openAlert: (opts: Omit<ModalRequest, "id" | "kind" | "variant"> & { variant?: ModalVariant }) => Promise<void>;
  openConfirm: (opts: Omit<ModalRequest, "id" | "kind" | "variant"> & { variant?: ModalVariant }) => Promise<boolean>;
  openPrompt: (opts: Omit<ModalRequest, "id" | "kind" | "variant"> & { variant?: ModalVariant }) => Promise<string | null>;
  resolve: (id: string, value: unknown) => void;
  dismissActive: () => void;
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const pendingResolvers = new Map<string, (value: unknown) => void>();

function pushRequest(set: any, req: ModalRequest) {
  set((s: ModalState) => {
    if (!s.active) return { active: req, queue: s.queue };
    return { active: s.active, queue: [...s.queue, req] };
  });
}

function resolveAndAdvance(set: any, id: string, value: unknown) {
  const resolve = pendingResolvers.get(id);
  if (resolve) {
    pendingResolvers.delete(id);
    resolve(value);
  }

  set((s: ModalState) => {
    if (!s.active || s.active.id !== id) return s;
    const [next, ...rest] = s.queue;
    return { active: next || null, queue: rest };
  });
}

export const useModalStore = create<ModalState>((set, get) => ({
  active: null,
  queue: [],

  openAlert: async (opts) => {
    const id = uid();
    const req: ModalRequest = {
      id,
      kind: "alert",
      variant: opts.variant ?? "default",
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText ?? "知道了",
    };
    const promise = new Promise<void>((resolve) => pendingResolvers.set(id, resolve));
    pushRequest(set, req);
    return promise;
  },

  openConfirm: async (opts) => {
    const id = uid();
    const req: ModalRequest = {
      id,
      kind: "confirm",
      variant: opts.variant ?? "default",
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText ?? "确认",
      cancelText: opts.cancelText ?? "取消",
    };
    const promise = new Promise<boolean>((resolve) => pendingResolvers.set(id, resolve));
    pushRequest(set, req);
    return promise;
  },

  openPrompt: async (opts) => {
    const id = uid();
    const req: ModalRequest = {
      id,
      kind: "prompt",
      variant: opts.variant ?? "default",
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText ?? "确认",
      cancelText: opts.cancelText ?? "取消",
      placeholder: opts.placeholder ?? "",
      defaultValue: opts.defaultValue ?? "",
      allowEmpty: opts.allowEmpty ?? false,
    };
    const promise = new Promise<string | null>((resolve) => pendingResolvers.set(id, resolve));
    pushRequest(set, req);
    return promise;
  },

  resolve: (id, value) => resolveAndAdvance(set, id, value),

  dismissActive: () => {
    const active = get().active;
    if (!active) return;
    // Dismiss behaves like "cancel" for confirm/prompt, or "ok" for alert.
    if (active.kind === "confirm") get().resolve(active.id, false);
    else if (active.kind === "prompt") get().resolve(active.id, null);
    else get().resolve(active.id, undefined);
  },
}));

