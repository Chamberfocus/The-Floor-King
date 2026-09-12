"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
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
import { createConfirmLock } from "@/lib/confirm-lock";

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
 *
 * Double-mash: a sync lock flips before the action runs. The dialog stays open
 * in a pending state until the attempt settles (callback) or the form pending
 * flag clears (server action). Failure releases the lock so retry is possible.
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
  /** Run this on confirm. Omit to submit the enclosing `<form>` instead.
   *  Return a promise so the lock waits until the attempt finishes. */
  onConfirm?: () => void | Promise<void>;
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
  const [pending, setPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hiddenSubmitRef = useRef<HTMLButtonElement>(null);
  const lockRef = useRef(createConfirmLock());
  const mountedRef = useRef(true);
  const sawFormPendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const release = () => {
    lockRef.current.settle();
    if (mountedRef.current) setPending(false);
  };

  const open_ = () => {
    if (disabled || lockRef.current.isPending()) return;
    // In form mode, enforce native validation (required fields, etc.) BEFORE
    // asking to confirm — so a required reason can't be skipped by the dialog.
    if (!onConfirm) {
      const form = triggerRef.current?.closest("form");
      if (form && !form.reportValidity()) return;
    }
    setOpen(true);
  };

  const confirm = () => {
    if (disabled || !lockRef.current.tryBegin()) return;
    setPending(true);
    void runConfirm();
  };

  const runConfirm = async () => {
    try {
      if (onConfirm) {
        await onConfirm();
        if (!mountedRef.current) return;
        release();
        setOpen(false);
        return;
      }
      if (formAction) hiddenSubmitRef.current?.click();
      else triggerRef.current?.closest("form")?.requestSubmit();
      // Form mode: FormPendingBridge releases when useFormStatus clears.
    } catch {
      if (!mountedRef.current) return;
      release();
    }
  };

  const busy = pending || disabled;

  return (
    <>
      <FormPendingBridge
        active={!onConfirm}
        onFormPending={(formPending) => {
          if (formPending) {
            sawFormPendingRef.current = true;
            setPending(true);
            return;
          }
          if (sawFormPendingRef.current && lockRef.current.isPending()) {
            sawFormPendingRef.current = false;
            release();
            if (mountedRef.current) setOpen(false);
          }
        }}
      />
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={busy}
        aria-busy={pending || undefined}
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

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (lockRef.current.isPending()) return;
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (lockRef.current.isPending()) return;
                setOpen(false);
              }}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              className={destructive ? "text-white" : undefined}
              disabled={pending}
              aria-busy={pending || undefined}
              data-confirm-pending={pending ? "true" : undefined}
              onClick={confirm}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Working…
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FormPendingBridge({
  active,
  onFormPending,
}: {
  active: boolean;
  onFormPending: (pending: boolean) => void;
}) {
  const { pending } = useFormStatus();
  const onFormPendingRef = useRef(onFormPending);
  onFormPendingRef.current = onFormPending;

  useEffect(() => {
    if (!active) return;
    onFormPendingRef.current(pending);
  }, [active, pending]);

  return null;
}
