"use client";

import { useState, useTransition } from "react";
import { Check, Package, Truck } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { approveOrder } from "./actions";
import { CustomerMatchPanel } from "@/components/customer-match-panel";
import type { ScoredCustomerMatch } from "@/lib/customer-resolve";
import type { OrderStockStatus } from "@/lib/types";

export function ApproveOrder({
  orderId,
  who,
  stockStatus,
}: {
  orderId: string;
  who: string;
  stockStatus: OrderStockStatus;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"from_stock" | "on_order">(
    stockStatus === "in_stock" ? "from_stock" : "on_order",
  );
  const [date, setDate] = useState("");
  const [matches, setMatches] = useState<ScoredCustomerMatch[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [pending, start] = useTransition();

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

  const run = (opts?: { useExistingId?: string; forceCreate?: boolean }) =>
    start(async () => {
      const fd = new FormData();
      fd.set("order_id", orderId);
      fd.set("ready_kind", kind);
      if (date) fd.set("ready_date", date);
      if (opts?.useExistingId) fd.set("use_existing_id", opts.useExistingId);
      if (opts?.forceCreate) fd.set("force_create", "1");
      if (overrideReason) fd.set("duplicate_override_reason", overrideReason);
      const res = await approveOrder(fd);
      if (res.matches?.length) {
        setMatches(res.matches);
        return;
      }
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Order approved");
      setOpen(false);
      router.refresh();
    });

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

          <div className="space-y-3">
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
            </div>

            {matches.length ? (
              <div className="space-y-2">
                {matches.some((m) => m.tier === "strong") ? (
                  <input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Reason for creating a new customer (required for strong matches)"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  />
                ) : null}
                <CustomerMatchPanel
                  matches={matches}
                  pending={pending}
                  onUseExisting={(id) => run({ useExistingId: id })}
                  onCreateAnyway={() => run({ forceCreate: true })}
                />
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={pending} onClick={() => run()}>
                {pending ? "Approving…" : "Approve & tell them"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
