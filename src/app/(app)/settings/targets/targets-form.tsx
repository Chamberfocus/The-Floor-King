"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTargets, type TargetsState } from "./actions";
import type { BusinessSettings } from "@/lib/types";

const initial: TargetsState = { error: null };

export function TargetsForm({ settings }: { settings: BusinessSettings }) {
  const [state, action, pending] = useActionState(saveTargets, initial);

  useEffect(() => {
    if (state.ok) toast.success("Profit targets saved.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="max-w-md space-y-5">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Target gross margin (%)</label>
        <Input
          name="target_gross_margin_pct"
          inputMode="decimal"
          defaultValue={String(settings.target_gross_margin_pct)}
        />
        <p className="text-xs text-muted-foreground">
          The margin you aim for on a job. Business Pulse flags jobs that come in
          below this.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Monthly revenue goal ($)</label>
        <Input
          name="monthly_revenue_goal"
          inputMode="decimal"
          defaultValue={String(settings.monthly_revenue_goal)}
        />
        <p className="text-xs text-muted-foreground">
          What you want to collect each month. Leave 0 to hide the goal tracker.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
        <div className="text-sm font-semibold">
          Added to every customer bill{" "}
          <span className="font-normal text-muted-foreground">
            — buried in the line prices. Not a cost, and not taken out of the margin.
          </span>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Fuel charge to customer ($)</label>
          <Input
            name="job_fuel_charge"
            inputMode="decimal"
            defaultValue={String(settings.job_fuel_charge)}
          />
          <p className="text-xs text-muted-foreground">
            Gas added to the customer bill and buried in the line prices. It is
            not a separate line and it does not lower the margin.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Salesperson gas per job ($)</label>
          <Input
            name="job_fuel_fee"
            inputMode="decimal"
            defaultValue={String(settings.job_fuel_fee)}
          />
          <p className="text-xs text-muted-foreground">
            Of the gas on the bill, this much goes to the salesperson. It is not
            taken off the job cost and it does not lower the margin.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Car allowance per job ($)</label>
          <Input
            name="job_car_allowance"
            inputMode="decimal"
            defaultValue={String(settings.job_car_allowance)}
          />
          <p className="text-xs text-muted-foreground">
            Added to the customer bill with the gas. Not deducted from the margin.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Commission (% of the sale)</label>
          <Input
            name="job_commission_pct"
            inputMode="decimal"
            defaultValue={String(settings.job_commission_pct)}
          />
          <p className="text-xs text-muted-foreground">
            Percent of the flooring sale, added to the bill. Not deducted from the margin.
          </p>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save targets"}
      </Button>
    </form>
  );
}
