"use client";

import { useState } from "react";
import { Check, Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { approveOrder } from "./actions";
import type { OrderStockStatus } from "@/lib/types";

/**
 * Approving an order is a promise, so it asks what the promise is.
 *
 * The warehouse has already answered the stock question by this point — that's
 * what `stockStatus` carries — so the choice is pre-made from their answer and
 * you only touch it when you disagree. What the customer gets depends on it:
 * "we have it, ready on the 3rd" or "we're ordering it in, ready on the 14th",
 * instead of the one vague sentence both used to get.
 */
export function ApproveOrder({
  orderId,
  who,
  stockStatus,
}: {
  orderId: string;
  who: string;
  stockStatus: OrderStockStatus;
}) {
  const [open, setOpen] = useState(false);
  // The warehouse said it's here → we're cutting stock. Anything else means
  // some of it has to come in.
  const [kind, setKind] = useState<"from_stock" | "on_order">(
    stockStatus === "in_stock" ? "from_stock" : "on_order",
  );
  const [date, setDate] = useState("");

  const option = (
    value: "from_stock" | "on_order",
    icon: React.ReactNode,
    title: string,
    blurb: string,
  ) => (
    <button
      type="button"
      onClick={() => setKind(value)}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left",
        kind === value ? "border-primary bg-primary/5" : "hover:bg-muted",
      )}
    >
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{blurb}</span>
      </span>
    </button>
  );

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Check className="size-3.5" /> Approve
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve {who}&apos;s order</DialogTitle>
            <DialogDescription>
              Sends it to the warehouse to cut and stage, and tells the customer
              when to come for it.
            </DialogDescription>
          </DialogHeader>

          <form action={approveOrder} className="space-y-3">
            <input type="hidden" name="order_id" value={orderId} />
            <input type="hidden" name="ready_kind" value={kind} />

            <div className="space-y-2">
              {option(
                "from_stock",
                <Package className="size-4" />,
                "We have it — cutting from stock",
                "Material's on the shelf; this is just cutting turnaround.",
              )}
              {option(
                "on_order",
                <Truck className="size-4" />,
                "We have to order the material",
                "Supplier lead time, then cutting. Give them the realistic date.",
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Ready for pickup on
              </label>
              <DateField
                name="ready_date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {date
                  ? kind === "on_order"
                    ? "They'll be told we're ordering it in and it's ready that day."
                    : "They'll be told it's in stock and ready that day."
                  : "Leave it empty and they just get “approved, we'll let you know” — which is what everyone used to get."}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="sm" pendingText="Approving…" confirm="Order approved">
                Approve &amp; tell them
              </SubmitButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
