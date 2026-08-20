"use client";

import { useState } from "react";
import { ShieldAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChecklistStep } from "@/lib/job-checklist";
import { overrideStep, clearStepOverride } from "@/app/(app)/customers/[id]/step-actions";

const REASONS = [
  "Deposit waived",
  "Approved on the phone",
  "Material already in stock",
  "Handled in the old system",
  "Paid cash on site",
  "Not needed on this job",
];

/**
 * The escape hatch for a step no record will ever prove.
 *
 * The checklist earns its trust by reading real records, so this deliberately
 * does NOT fake one — no invented payment, no back-dated estimate. It writes an
 * override that sits alongside, says who decided and why, and can be undone. A
 * step carried by an override says so on the row; the moment the real record
 * turns up, the row goes back to reporting the record.
 */
export function StepOverride({
  step,
  customerId,
  jobId,
}: {
  step: ChecklistStep;
  customerId: string;
  jobId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const hidden = (
    <>
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="step_key" value={step.key} />
      {jobId ? <input type="hidden" name="job_id" value={jobId} /> : null}
    </>
  );

  // Carried by an override: say so, and offer the way back.
  if (step.override) {
    return (
      <form action={clearStepOverride} className="inline">
        {hidden}
        <SubmitButton
          size="sm"
          variant="ghost"
          confirm="Override removed"
          pendingText="Removing…"
          className="h-6 px-2 text-[11px] text-amber-700 hover:text-amber-800 dark:text-amber-300"
        >
          <Undo2 className="size-3" /> Undo override
        </SubmitButton>
      </form>
    );
  }

  // Already proven by a record — there is nothing to overrule.
  if (step.state === "done") return null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => {
          setReason("");
          setOpen(true);
        }}
      >
        <ShieldAlert className="size-3" /> Mark done
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark &ldquo;{step.title}&rdquo; done</DialogTitle>
            <DialogDescription>
              Nothing in the records proves this step yet, so this marks it done
              on your say-so. It doesn&apos;t create an estimate, a payment or a
              purchase order — it just stops the list asking. Logged with your
              name, and you can undo it.
            </DialogDescription>
          </DialogHeader>
          <form action={overrideStep} className="space-y-3">
            {hidden}
            <input type="hidden" name="reason" value={reason} />
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Why? (optional, but it&apos;s what makes this readable later)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={
                      reason === r
                        ? "rounded-md border border-primary bg-primary/5 px-2.5 py-1 text-xs"
                        : "rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                    }
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Or type your own"
                className="h-8"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <SubmitButton size="sm" pendingText="Marking…" confirm="Step marked done">
                Mark done
              </SubmitButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
