"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { docRef } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  deleteEstimate,
  deleteAllDraftEstimates,
  getEstimateDeleteImpact,
  type EstimateDeleteImpact,
} from "./actions";

/**
 * Delete an estimate — with a warning that spells out EVERYTHING it takes down
 * (work orders, purchase orders, invoices, and all their children). Fetches the
 * real counts when the dialog opens so the warning is honest.
 */
export function DeleteEstimateButton({
  id,
  customerId,
  customerName,
  variant = "icon",
}: {
  id: string;
  customerId?: string;
  customerName?: string;
  variant?: "icon" | "full";
}) {
  // Name the exact estimate in the confirmation so nobody deletes the wrong one.
  const ref = docRef("EST", id);
  const title = `Delete Estimate ${ref}${customerName ? ` for ${customerName}` : ""}?`;
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<EstimateDeleteImpact | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setImpact(null);
    getEstimateDeleteImpact(id)
      .then(setImpact)
      .finally(() => setLoading(false));
  }, [open, id]);

  const bits: string[] = [];
  if (impact) {
    if (impact.jobs) bits.push(`${impact.jobs} work order${impact.jobs === 1 ? "" : "s"}`);
    if (impact.purchaseOrders) bits.push(`${impact.purchaseOrders} purchase order${impact.purchaseOrders === 1 ? "" : "s"}`);
    if (impact.invoices) bits.push(`${impact.invoices} invoice${impact.invoices === 1 ? "" : "s"}`);
    // The ones you can't rebuild from memory, named separately.
    if (impact.payments)
      bits.push(`${impact.payments} recorded payment${impact.payments === 1 ? "" : "s"}`);
    if (impact.moneyRecords)
      bits.push(`${impact.moneyRecords} expense/supplier bill${impact.moneyRecords === 1 ? "" : "s"}`);
    if (impact.documents)
      bits.push(`${impact.documents} job photo/file${impact.documents === 1 ? "" : "s"}`);
    if (impact.stockRecords)
      bits.push(`${impact.stockRecords} stock movement${impact.stockRecords === 1 ? "" : "s"} (material goes back)`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          variant === "full" ? (
            <Button variant="destructive" size="sm" />
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Delete estimate" />
          )
        }
      >
        <Trash2 className={variant === "full" ? "size-3.5" : "size-4 text-destructive"} />
        {variant === "full" ? " Delete estimate" : null}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 shrink-0 text-destructive" /> {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            This <span className="font-semibold">permanently deletes the estimate</span> and{" "}
            <span className="font-semibold">everything attached to it</span>
            {loading ? "…" : bits.length ? (
              <>
                :
                <ul className="mt-2 list-disc space-y-0.5 pl-5">
                  {bits.map((b) => (
                    <li key={b} className="font-medium">{b}</li>
                  ))}
                </ul>
                <span className="mt-2 block text-muted-foreground">
                  …plus all their line items, materials and labor. Any reserved
                  stock is released.
                </span>
              </>
            ) : (
              <span className="text-muted-foreground"> — nothing else is attached.</span>
            )}
          </p>
          {impact?.movesStageBack ? (
            <p className="rounded-md bg-amber-100 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              This is the estimate that won the job — the customer moves back to
              awaiting a response.
            </p>
          ) : null}
          <p className="rounded-md bg-destructive/10 px-3 py-2 font-medium text-destructive">
            This cannot be undone.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <form action={deleteEstimate}>
            <input type="hidden" name="id" value={id} />
            {customerId ? <input type="hidden" name="customer_id" value={customerId} /> : null}
            <Button type="submit" variant="destructive" disabled={loading}>
              <Trash2 className="size-4" /> Delete everything
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Wipe all draft estimates at once — for clearing out test quotes. */
export function ClearDraftsButton() {
  return (
    <form
      action={deleteAllDraftEstimates}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Delete ALL draft estimates? This removes every unsent estimate and can't be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="outline" size="lg" className="text-destructive">
        <Trash2 className="size-4" /> Delete all drafts
      </Button>
    </form>
  );
}
