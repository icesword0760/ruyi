import React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useToastStore } from "./toastStore";

import "./ToastHost.css";

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <ToastPrimitive.Provider swipeDirection="down" duration={2400}>
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          className="ctl-toast"
          data-variant={t.variant}
          defaultOpen
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
        >
          <div className="ctl-toast__dot" />
          <div className="ctl-toast__msg">{t.message}</div>
          <ToastPrimitive.Close className="ctl-toast__close" aria-label="关闭提示">
            <X className="ctl-icon ctl-icon--sm" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="ctl-toast-viewport" />
    </ToastPrimitive.Provider>
  );
}
