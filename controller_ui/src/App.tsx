import React, { useEffect, useRef } from "react";
import { ControllerLayout } from "./legacy/ControllerLayout";
import { installControllerModules } from "./modules/install";
import { initStreamCore } from "./controller/streamCore";
import { initAiCore } from "./controller/aiCore";
import { ToastHost } from "./ui/toast/ToastHost";
import { useToastStore } from "./ui/toast/toastStore";
import { ModalHost } from "./ui/modal/ModalHost";
import { useModalStore } from "./ui/modal/modalStore";

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return String(err);
}

function hideOverlay(overlay: HTMLElement | null) {
  if (!overlay) return;
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
}

export default function App() {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayMessageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let canceled = false;

    const run = (async () => {
      // Install a modern toast bridge early so both streamCore and aiCore can use it.
      if (!window.showToast) {
        window.showToast = (message: string, type?: string) => {
          const variant = type === "success" || type === "warn" || type === "error" ? type : "default";
          useToastStore.getState().push(message, variant as any);
        };
      }

      // Modern modal bridge: replace alert/confirm/prompt with a consistent Radix dialog.
      if (!(window as any).showAlertDialog) {
        (window as any).showAlertDialog = (title: string, message?: string) => {
          if ((window as any).__controllerE2E) {
            window.alert?.(String(message ?? title));
            return Promise.resolve();
          }
          return useModalStore.getState().openAlert({ title, message });
        };
      }
      if (!(window as any).showConfirmDialog) {
        (window as any).showConfirmDialog = (
          title: string,
          message?: string,
          variant?: "default" | "danger",
          confirmText?: string,
          cancelText?: string,
        ) => {
          if ((window as any).__controllerE2E) {
            return Promise.resolve(window.confirm?.(String(message ?? title)) ?? false);
          }
          return useModalStore.getState().openConfirm({
            title,
            message,
            variant: variant || "default",
            confirmText,
            cancelText,
          });
        };
      }
      if (!(window as any).showPromptDialog) {
        (window as any).showPromptDialog = (
          title: string,
          opts?: { message?: string; defaultValue?: string; placeholder?: string; allowEmpty?: boolean },
        ) => {
          if ((window as any).__controllerE2E) {
            const raw = window.prompt?.(opts?.message ?? title, opts?.defaultValue ?? "") ?? null;
            if (raw === null) return Promise.resolve(null);
            if (opts?.allowEmpty) return Promise.resolve(String(raw));
            const value = String(raw);
            if (!value.trim()) return Promise.resolve(null);
            return Promise.resolve(value);
          }
          return useModalStore.getState().openPrompt({
            title,
            message: opts?.message,
            defaultValue: opts?.defaultValue,
            placeholder: opts?.placeholder,
            allowEmpty: opts?.allowEmpty,
          });
        };
      }

      // Core runtime must be installed before AI init (aiCore depends on initModelBtn()).
      initStreamCore();
      // Modules provide the legacy inline-handler globals.
      installControllerModules();
      // AI init defines window.aiSendMessage which our E2E tests use as readiness signal.
      initAiCore();
      hideOverlay(overlayRef.current);
    })();

    run.catch((e) => {
      if (canceled) return;
      console.error("[controller-react] init failed:", e);
      const message = `加载失败：${errorMessage(e)}（请刷新页面重试）`;
      const el = overlayMessageRef.current;
      if (el) el.textContent = message;
    });

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <>
      <div className="legacy-root">
        <ControllerLayout />
      </div>
      <ModalHost />
      <ToastHost />
      <div className="legacy-loading" ref={overlayRef} role="status" aria-live="polite">
        <div className="legacy-loading-card">
          <div className="legacy-loading-title">正在加载控制台…</div>
          <div className="legacy-loading-sub" ref={overlayMessageRef}>
            正在初始化全新 React + TypeScript 控制台…
          </div>
        </div>
      </div>
    </>
  );
}
