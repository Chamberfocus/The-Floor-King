"use client";

import { useState } from "react";
import { ListChecks, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { GuidedWizard } from "./guided-wizard";
import { QuickEstimate } from "./quick-estimate";

type Mode = "wizard" | "quick";

/**
 * Two ways to build an estimate:
 *  - Wizard : the guided, step-by-step builder that covers every base.
 *  - Quick  : one screen for a fast quote.
 * Both save the identical estimate and flow on to invoice / PO / job.
 * Each stays mounted, so switching never loses what you entered.
 */
export function BuilderSwitch(props: {
  customerId: string;
  customerName: string;
  targetMargin: number;
  freightPct: number;
}) {
  const [mode, setMode] = useState<Mode>("wizard");

  const Tab = ({
    value, icon: Icon, label, hint,
  }: {
    value: Mode; icon: typeof Zap; label: string; hint: string;
  }) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={cn(
        "flex flex-1 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
        mode === value ? "border-primary bg-primary/5" : "hover:bg-muted",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4" /> {label}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Tab value="wizard" icon={ListChecks} label="Estimate builder" hint="Step-by-step — covers every base" />
        <Tab value="quick" icon={Zap} label="Quick estimate" hint="One screen — fast quote" />
      </div>

      <div className={mode === "wizard" ? "" : "hidden"}>
        <GuidedWizard
          customerId={props.customerId}
          customerName={props.customerName}
          targetMargin={props.targetMargin}
          freightPct={props.freightPct}
        />
      </div>
      <div className={mode === "quick" ? "" : "hidden"}>
        <QuickEstimate
          customerId={props.customerId}
          customerName={props.customerName}
          targetMargin={props.targetMargin}
          freightPct={props.freightPct}
        />
      </div>
    </div>
  );
}
