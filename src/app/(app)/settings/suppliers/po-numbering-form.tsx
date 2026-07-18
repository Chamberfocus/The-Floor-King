"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPoNextNumber, type PricingState } from "./actions";

const initial: PricingState = { error: null };

export function PoNumberingForm({
  nextNumber,
  maxIssued,
}: {
  nextNumber: number;
  maxIssued: number;
}) {
  const [state, formAction, pending] = useActionState(setPoNextNumber, initial);
  useEffect(() => {
    if (state.ok) toast.success("PO numbering updated");
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Purchase order numbering</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The next purchase order you issue will be{" "}
          <span className="font-semibold text-foreground">PO-{nextNumber}</span>. Set the
          starting number to continue from your existing books. Numbers are permanent and
          sequential — you can only move the start <strong>forward</strong>, never onto a
          number that&apos;s already been used
          {maxIssued > 0 ? ` (highest so far: PO-${maxIssued})` : ""}.
        </p>
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Next number</span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">PO-</span>
              <Input
                name="next_number"
                type="number"
                min={maxIssued + 1}
                step="1"
                defaultValue={nextNumber}
                className="w-32"
              />
            </div>
          </label>
          <Button type="submit" variant="outline" disabled={pending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
