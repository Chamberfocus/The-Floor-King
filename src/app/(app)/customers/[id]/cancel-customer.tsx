"use client";

import { useState } from "react";
import { Ban, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CancelReason } from "@/lib/types";
import { cancelCustomer, reopenCustomer } from "../actions";

export function CancelCustomer({
  customerId,
  name,
  cancelled,
  reasons,
  hasOpenPO = false,
}: {
  customerId: string;
  name: string;
  cancelled: boolean;
  /** Manageable reason list (Settings → Cancellation reasons). */
  reasons: CancelReason[];
  /** A committed (non-void) PO exists → warn it may need cancelling too. */
  hasOpenPO?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Selected reason id + the text that gets stored (prefilled from the pick,
  // still editable for "Other" / notes).
  const [reasonId, setReasonId] = useState<string>(reasons[0]?.id ?? "");
  const [reasonText, setReasonText] = useState<string>(reasons[0]?.label ?? "");

  if (cancelled) {
    return (
      <form action={reopenCustomer}>
        <input type="hidden" name="id" value={customerId} />
        <SubmitButton variant="outline" pendingText="Reactivating…" confirm="Job reactivated">
          <RotateCcw className="size-4" /> Reactivate job
        </SubmitButton>
      </form>
    );
  }

  const pick = (r: CancelReason) => {
    setReasonId(r.id);
    setReasonText(r.label);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Ban className="size-4" /> Cancel job
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {name}?</DialogTitle>
            <DialogDescription>
              This takes the job out of your active pipeline (it&apos;s marked lost,
              not closed/won) and stops the reminders. The record and all its
              history stay — you can reactivate it anytime.
            </DialogDescription>
          </DialogHeader>

          {hasOpenPO ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                This job has an <strong>open purchase order</strong>. Cancelling
                the job doesn&apos;t cancel the PO — check the Materials tab and
                void the PO if the order should stop too.
              </span>
            </div>
          ) : null}

          <form action={cancelCustomer} className="space-y-3">
            <input type="hidden" name="id" value={customerId} />
            <input type="hidden" name="reason_id" value={reasonId} />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason</label>
              {reasons.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {reasons.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pick(r)}
                      className={
                        reasonId === r.id
                          ? "rounded-md border border-primary bg-primary/5 px-2.5 py-1 text-sm"
                          : "rounded-md border px-2.5 py-1 text-sm hover:bg-muted"
                      }
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <Input
                name="reason"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Reason (or add a note)"
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep job
              </Button>
              <SubmitButton
                variant="default"
                pendingText="Cancelling…"
                confirm="Job cancelled"
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Cancel job
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
