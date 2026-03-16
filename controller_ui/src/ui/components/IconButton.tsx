import React from "react";
import { cn } from "../cn";
import type { ButtonVariant } from "./Button";

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon: React.ReactNode;
  label: string;
};

export function IconButton({ className, variant = "default", size = "md", icon, label, type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={props.title ?? label}
      className={cn(
        "ctl-btn ctl-focus-ring",
        size === "sm" && "ctl-icon-btn--sm",
        variant === "primary" && "ctl-btn--primary",
        variant === "danger" && "ctl-btn--danger",
        variant === "ghost" && "ctl-btn--ghost",
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}

