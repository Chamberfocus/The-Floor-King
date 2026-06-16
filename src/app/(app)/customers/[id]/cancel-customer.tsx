"use client";

import { useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
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
import { cancelCustomer, reopenCustomer } from "../actions";

const REASONS = [
  "Price too high",
  "Went with competitor",
  "Changed their mind",
  "Couldn't reach them",
  "Not ready / bad timing",
  "Other",
];

export function CancelCustomer({
  customerId,
  name,
  cancelled,
}: {
  customerId: string;
  name: string;
  cancelled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);

  if (cancelled) {
    return (
      <form action={reopenCustomer}>
        <input type="hidden" name="id" value={customerId} />
        <SubmitButton variant="outline" size="sm" pendingText="Reopening…" confirm="Customer reopened">
          <RotateCcw className="size-4" /> Reopen customer
        </SubmitButton>
      </form>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Ban className="size-4" /> Cancel
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {name}?</DialogTitle>
            <DialogDescription>
              This takes the job out of your active pipeline and stops the
              reminders. The record and all its history stay — you can reopen it
              anytime.
            </DialogDescription>
          </DialogHeader>
          <form action={cancelCustomer} className="space-y-3">
            <input type="hidden" name="id" value={customerId} />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason</label>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={
                      reason === r
                        ? "rounded-md border border-primary bg-primary/5 px-2.5 py-1 text-sm"
                        : "rounded-md border px-2.5 py-1 text-sm hover:bg-muted"
                    }
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input
                name="reason"
                defaultValue={reason}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep customer
              </Button>
              <SubmitButton
                variant="default"
                pendingText="Cancelling…"
                confirm="Customer cancelled"
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Cancel customer
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
