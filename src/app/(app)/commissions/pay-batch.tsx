"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markCommissionPaid } from "@/app/(app)/jobs/[id]/true-up/actions";

export function PayBatch({
  salespersonId,
  ledgerIds,
  periodStart,
  periodEnd,
}: {
  salespersonId: string;
  ledgerIds: string[];
  periodStart: string;
  periodEnd: string;
}) {
  const [pending, start] = useTransition();
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  if (!ledgerIds.length) return null;
  return (
    <div className="grid gap-2 rounded-xl border p-4 print:hidden">
      <h2 className="font-semibold">Mark this statement paid</h2>
      <p className="text-sm text-muted-foreground">
        Marks every payable commission on this statement as paid. Paying the same commissions again is refused. This does not create an accounting entry.
      </p>
      <Input className="h-11" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      <Input className="h-11" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check or reference" />
      <Button
        type="button"
        className="h-11"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const result = await markCommissionPaid({
              salespersonId,
              ledgerIds,
              paidOn,
              reference,
              periodStart,
              periodEnd,
              idempotencyKey: `pay:${salespersonId}:${ledgerIds.slice().sort().join(",")}:${reference}`,
            });
            if (!result.ok) toast.error(result.error);
            else toast.success("Commission marked paid.");
          });
        }}
      >
        Mark paid
      </Button>
    </div>
  );
}
