"use client";

import { useRef, useState, type ReactNode } from "react";
import { Mail, MailX } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VariantProps } from "class-variance-authority";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
type ButtonSize = VariantProps<typeof buttonVariants>["size"];

/**
 * A trigger that, before a client-facing action runs, asks whether the CLIENT
 * should get an email. Three outcomes: Send email, Skip email (do the action but
 * don't email), or Cancel. The action itself always still happens on Send/Skip —
 * only the email is gated.
 *
 * Two modes:
 *  • Form (default): place inside a `<form action={serverAction}>`. On Send it
 *    submits with the hidden `fieldName` = "yes"; on Skip = "no". Read that in
 *    the action to decide whether to email.
 *  • Callback: pass `onChoose(sendEmail)` to run a handler instead of submitting.
 */
export function SendToClient({
  clientName,
  email,
  title,
  description,
  sendLabel = "Send email",
  skipLabel = "Skip email",
  fieldName = "send_email",
  onChoose,
  disabled,
  children,
  variant,
  size,
  className,
}: {
  clientName?: string | null;
  /** The client's email — when empty, sending is disabled (nothing to send to). */
  email?: string | null;
  title?: string;
  description?: ReactNode;
  sendLabel?: string;
  skipLabel?: string;
  fieldName?: string;
  /** Callback mode: run this instead of submitting a form. */
  onChoose?: (sendEmail: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // null = known to have NO email (send disabled); undefined = unknown (allow
  // send, the server still guards); a string = show the address.
  const addr = typeof email === "string" ? email.trim() : "";
  const knownNoEmail = email === null;
  const canSend = !knownNoEmail;

  const openDialog = () => {
    // In form mode, enforce native validation (required fields) before asking.
    if (!onChoose) {
      const form = triggerRef.current?.closest("form");
      if (form && !form.reportValidity()) return;
    }
    setOpen(true);
  };

  const choose = (sendEmail: boolean) => {
    setOpen(false);
    if (onChoose) {
      onChoose(sendEmail);
      return;
    }
    const form = triggerRef.current?.closest("form");
    if (fieldRef.current) fieldRef.current.value = sendEmail ? "yes" : "no";
    form?.requestSubmit();
  };

  const who = clientName?.split(" ")[0] || "the client";
  const heading = title ?? `Email ${who}?`;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        onClick={openDialog}
      >
        {children}
      </Button>
      {!onChoose ? (
        <input ref={fieldRef} type="hidden" name={fieldName} defaultValue="yes" />
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{heading}</DialogTitle>
            <DialogDescription>
              {canSend ? (
                <>
                  {description ? <>{description} </> : null}
                  {addr ? (
                    <>We&rsquo;ll email <span className="font-medium text-foreground">{addr}</span>.</>
                  ) : null}
                </>
              ) : (
                <>
                  {clientName ? `${clientName} has` : "This client has"} no email on
                  file, so nothing will be emailed. You can still continue.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => choose(false)}>
              <MailX className="size-4" /> {skipLabel}
            </Button>
            {canSend ? (
              <Button type="button" onClick={() => choose(true)}>
                <Mail className="size-4" /> {sendLabel}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
