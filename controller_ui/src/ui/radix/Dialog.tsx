import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogPortal(props: DialogPrimitive.DialogPortalProps) {
  const container =
    typeof window !== "undefined" ? ((window as any).__ctlDialogPortalContainer as HTMLElement | undefined) : undefined;
  return <DialogPrimitive.Portal container={container} {...props} />;
}

export function DialogOverlay(props: DialogPrimitive.DialogOverlayProps) {
  const style: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483644,
    ...(props.style as React.CSSProperties | undefined),
  };
  return <DialogPrimitive.Overlay className="ctl-dialog-overlay" {...props} style={style} />;
}

export function DialogContent(props: DialogPrimitive.DialogContentProps) {
  const style: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 2147483645,
    ...(props.style as React.CSSProperties | undefined),
  };
  return <DialogPrimitive.Content className="ctl-dialog-content ctl-focus-ring" {...props} style={style} />;
}
