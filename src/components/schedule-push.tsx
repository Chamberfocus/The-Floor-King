"use client";

import { useRef, useState, type ReactNode } from "react";
import { CalendarCheck } from "lucide-react";
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
 * Booking confirmation that decides WHO gets notified — the customer and/or the
 * assigned installer/estimator. Two independent toggles, then Book/Cancel. The
 * booking itself always happens; the toggles only control notifications.
 *
 * Form mode only: place inside a `<form action={serverAction}>`. It writes hidden
 * `send_email` (customer) and `notify_assignee` (installer/estimator) as
 * "yes"/"no" for the action to read.
 */
export function SchedulePush({
  customerName,
  customerEmail,
  assigneeRole,
  title,
  description,
  confirmLabel = "Book",
  children,
  variant,
  size,
  className,
  disabled,
}: {
  customerName?: string | null;
  /** null = customer has no email (that toggle is disabled). */
  customerEmail?: string | null;
  /** e.g. "installer" or "estimator" — labels the second toggle. */
  assigneeRole: string;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const custRef = useRef<HTMLInputElement>(null);
  const assigneeRef = useRef<HTMLInputElement>(null);

  const custKnownNoEmail = customerEmail === null;
  const custAddr = typeof customerEmail === "string" ? customerEmail.trim() : "";
  const [emailCustomer, setEmailCustomer] = useState(true);
  const [notifyAssignee, setNotifyAssignee] = useState(true);

  const openDialog = () => {
    const form = triggerRef.current?.closest("form");
    if (form && !form.reportValidity()) return;
    setOpen(true);
  };

  const confirm = () => {
    setOpen(false);
    const form = triggerRef.current?.closest("form");
    if (custRef.current)
      custRef.current.value = emailCustomer && !custKnownNoEmail ? "yes" : "no";
    if (assigneeRef.current) assigneeRef.current.value = notifyAssignee ? "yes" : "no";
    form?.requestSubmit();
  };

  const who = customerName?.split(" ")[0] || "the customer";

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
      <input ref={custRef} type="hidden" name="send_email" defaultValue="yes" />
      <input ref={assigneeRef} type="hidden" name="notify_assignee" defaultValue="yes" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <div className="space-y-2.5 py-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Who should we notify?
            </p>

            <label
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                custKnownNoEmail ? "opacity-60" : "cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={emailCustomer && !custKnownNoEmail}
                disabled={custKnownNoEmail}
                onChange={(e) => setEmailCustomer(e.target.checked)}
              />
              <span>
                <span className="font-medium">Email {who}</span>
                <span className="block text-xs text-muted-foreground">
                  {custKnownNoEmail
                    ? "No email on file — nothing will be sent."
                    : `Their confirmation with the arrival window${custAddr ? ` → ${custAddr}` : ""}.`}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={notifyAssignee}
                onChange={(e) => setNotifyAssignee(e.target.checked)}
              />
              <span>
                <span className="font-medium">Notify the assigned {assigneeRole}</span>
                <span className="block text-xs text-muted-foreground">
                  Sends them the date, arrival window, and address for the job.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirm}>
              <CalendarCheck className="size-4" /> {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
