"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { overrideAdvanceWorkflow } from "../actions";

/**
 * Owner-only escape hatch for a genuinely blocked step. Requires a reason and is
 * fully logged (who / when / which step / why). Shown only to the owner, only
 * when a step is blocked — so strict enforcement never becomes a dead end.
 */
export function OwnerOverride({
  customerId,
  toStageId,
  toUser,
  stepLabel,
  blockedReason,
}: {
  customerId: string;
  toStageId: string;
  toUser: string | null;
  stepLabel: string;
  blockedReason: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-amber-700 hover:text-amber-800 dark:text-amber-300"
        onClick={() => setOpen(true)}
      >
        <ShieldAlert className="size-3.5" /> Owner override
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Owner override</DialogTitle>
            <DialogDescription>
              Advance past this step even though its action isn&apos;t complete. Use this
              only for a real exception — it&apos;s logged (who, when, which step, and why).
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Blocked because: {blockedReason}
          </div>
          <form action={overrideAdvanceWorkflow} className="space-y-3">
            <input type="hidden" name="id" value={customerId} />
            <input type="hidden" name="to_stage" value={toStageId} />
            <input type="hidden" name="to_user" value={toUser ?? ""} />
            <input type="hidden" name="step_label" value={stepLabel} />
            <div>
              <Label htmlFor="ov-reason">Why are you overriding? (required — logged)</Label>
              <textarea
                id="ov-reason"
                name="reason"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Deposit paid by check — recording it later; customer wants to schedule now."
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton
                disabled={!reason.trim()}
                pendingText="Overriding…"
                confirm="Advanced — override logged"
              >
                <ShieldAlert className="size-4" /> Override &amp; advance
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
