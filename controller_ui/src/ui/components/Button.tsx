import React from "react";
import { cn } from "../cn";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ className, variant = "default", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "ctl-btn ctl-focus-ring",
        variant === "primary" && "ctl-btn--primary",
        variant === "danger" && "ctl-btn--danger",
        variant === "ghost" && "ctl-btn--ghost",
        className,
      )}
      {...props}
    />
  );
}

