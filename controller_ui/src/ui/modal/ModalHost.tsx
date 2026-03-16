import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogOverlay, DialogPortal } from "../radix/Dialog";
import { useModalStore } from "./modalStore";

import "./ModalHost.css";

export function ModalHost() {
  const active = useModalStore((s) => s.active);
  const dismissActive = useModalStore((s) => s.dismissActive);
  const resolve = useModalStore((s) => s.resolve);

  const [promptValue, setPromptValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!active) return;
    if (active.kind !== "prompt") return;
    setPromptValue(active.defaultValue ?? "");
  }, [active?.id]);

  const titleId = useMemo(() => (active ? `ctl-modal-title-${active.id}` : undefined), [active?.id]);
  const descId = useMemo(() => (active ? `ctl-modal-desc-${active.id}` : undefined), [active?.id]);

  if (!active) {
    return null;
  }

  const confirmLabel = active.confirmText ?? (active.kind === "alert" ? "知道了" : "确认");
  const cancelLabel = active.cancelText ?? "取消";

  function onConfirm() {
    if (active.kind === "alert") {
      resolve(active.id, undefined);
      return;
    }
    if (active.kind === "confirm") {
      resolve(active.id, true);
      return;
    }
    const value = String(promptValue ?? "").trim();
    if (!active.allowEmpty && !value) return;
    resolve(active.id, value);
  }

  function onCancel() {
    if (active.kind === "alert") {
      resolve(active.id, undefined);
      return;
    }
    if (active.kind === "confirm") {
      resolve(active.id, false);
      return;
    }
    resolve(active.id, null);
  }

  const confirmDisabled =
    active.kind === "prompt" ? (!active.allowEmpty && String(promptValue ?? "").trim().length === 0) : false;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismissActive();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          aria-labelledby={titleId}
          aria-describedby={active.message ? descId : undefined}
          data-variant={active.variant}
          onOpenAutoFocus={(event) => {
            if (active.kind !== "prompt") return;
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="ctl-modal">
            <div className="ctl-modal__title" id={titleId}>
              {active.title}
            </div>
            {active.message ? (
              <div className="ctl-modal__msg" id={descId}>
                {active.message}
              </div>
            ) : null}

            {active.kind === "prompt" ? (
              <div className="ctl-modal__field">
                <input
                  ref={inputRef}
                  className="ctl-input ctl-modal__input ctl-focus-ring"
                  placeholder={active.placeholder || ""}
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onConfirm();
                  }}
                />
                {!active.allowEmpty && String(promptValue ?? "").trim().length === 0 ? (
                  <div className="ctl-modal__hint">请输入内容</div>
                ) : null}
              </div>
            ) : null}

            <div className="ctl-modal__footer">
              {active.kind === "alert" ? null : (
                <button className="ctl-btn ctl-btn--ghost ctl-focus-ring" onClick={onCancel}>
                  {cancelLabel}
                </button>
              )}
              <button
                className={[
                  "ctl-btn ctl-focus-ring",
                  active.variant === "danger" ? "ctl-btn--danger" : "ctl-btn--primary",
                ].join(" ")}
                onClick={onConfirm}
                disabled={confirmDisabled}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
