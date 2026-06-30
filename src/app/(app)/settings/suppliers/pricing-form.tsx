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
          <CardTitle className="text-base">Freight &amp; fees markup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <Label htmlFor="freight_markup_pct" className="text-sm font-semibold">
              Freight &amp; fees markup %
            </Label>
            <div className="mt-1.5 flex max-w-xs items-center gap-2">
              <Input
                id="freight_markup_pct"
                name="freight_markup_pct"
                type="number"
                step="0.1"
                min="0"
                defaultValue={org.freight_markup_pct ?? 0}
                className="text-lg font-semibold"
              />
              <span className="text-lg font-semibold text-muted-foreground">%</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Catalog prices are the <strong>bare material cost</strong>. This one
              number covers freight, fuel surcharges, drop fees and handling on
              average — set it to whatever your real landed cost runs above the
              price list. It&apos;s added to every material cost automatically, so
              your margins and job profit reflect the <strong>true</strong> cost.
              Example: 10% turns a $1.80/sf price into a $1.98/sf cost. Labor is
              never marked up.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="quote_valid_days">Quotes valid for (days)</Label>
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
