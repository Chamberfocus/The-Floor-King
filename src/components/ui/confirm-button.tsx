"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
type ButtonSize = VariantProps<typeof buttonVariants>["size"];

/**
 * A trigger button that gates a consequential action behind an "are you sure?"
 * dialog. The dialog NAMES the action + item (title/description), Cancel is the
 * safe default, and the action only runs on explicit confirm.
 *
 * Two modes:
 *  • Form submit (default): place inside a `<form action={serverAction}>`; on
 *    confirm it submits that form (hidden inputs, server action, all preserved).
 *  • Callback: pass `onConfirm` to run a handler instead (for onClick actions).
 */
export function ConfirmButton({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  formAction,
  disabled,
  children,
  variant,
  size,
  className,
  "aria-label": ariaLabel,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
  /** Run this on confirm. Omit to submit the enclosing `<form>` instead. */
  onConfirm?: () => void;
  /** Submit the enclosing form to THIS action (a `formAction` override) instead
   *  of the form's own action — for a delete button that shares a form. */
  formAction?: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hiddenSubmitRef = useRef<HTMLButtonElement>(null);

  const open_ = () => {
    // In form mode, enforce native validation (required fields, etc.) BEFORE
    // asking to confirm — so a required reason can't be skipped by the dialog.
    if (!onConfirm) {
      const form = triggerRef.current?.closest("form");
      if (form && !form.reportValidity()) return;
    }
    setOpen(true);
  };

  const confirm = () => {
    setOpen(false);
    if (onConfirm) onConfirm();
    else if (formAction) hiddenSubmitRef.current?.click();
    else triggerRef.current?.closest("form")?.requestSubmit();
  };

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={open_}
      >
        {children}
      </Button>
      {formAction ? (
        <button
          ref={hiddenSubmitRef}
          type="submit"
          formAction={formAction}
          className="hidden"
          tabIndex={-1}
          aria-hidden
        />
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              className={destructive ? "text-white" : undefined}
              onClick={confirm}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
