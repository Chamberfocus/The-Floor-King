"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrgSettings } from "@/lib/types";
import { savePricingSettings, type PricingState } from "./actions";

const initial: PricingState = { error: null };

export function PricingForm({ org }: { org: OrgSettings }) {
  const [state, action, pending] = useActionState(
    savePricingSettings,
    initial,
  );
  useEffect(() => {
    if (state.ok) toast.success("Saved");
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fuel surcharge & quote terms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fuel_surcharge_pct">Global fuel surcharge %</Label>
              <Input
                id="fuel_surcharge_pct"
                name="fuel_surcharge_pct"
                type="number"
                step="0.1"
                min="0"
                defaultValue={org.fuel_surcharge_pct ?? 0}
              />
              <p className="text-xs text-muted-foreground">
                Added to every material cost. Bump this when fuel spikes — all
                new quotes update instantly.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote_valid_days">Quotes valid for (days)</Label>
              <Input
                id="quote_valid_days"
                name="quote_valid_days"
                type="number"
                min="0"
                defaultValue={org.quote_valid_days ?? 30}
              />
              <p className="text-xs text-muted-foreground">
                After this, the estimate shows as expired and should be
                re-priced.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="freight_disclaimer">Freight / fuel disclaimer</Label>
            <textarea
              id="freight_disclaimer"
              name="freight_disclaimer"
              rows={3}
              defaultValue={org.freight_disclaimer ?? ""}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Pricing reflects freight and fuel surcharges in effect on the quote date…"
            />
            <p className="text-xs text-muted-foreground">
              Shown to customers on every estimate.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
