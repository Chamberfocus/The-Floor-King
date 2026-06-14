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

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save targets"}
      </Button>
    </form>
  );
}
