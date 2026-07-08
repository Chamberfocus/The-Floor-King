"use client";

import { useState } from "react";
import { ListChecks, Zap, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { GuidedWizard } from "./guided-wizard";
import { QuickEstimate } from "./quick-estimate";
import { AiEstimate } from "./ai-estimate";

type Mode = "wizard" | "quick" | "ai";

/**
 * Three ways to build an estimate:
 *  - Wizard : the guided, step-by-step builder that covers every base.
 *  - Quick  : one screen for a fast quote.
 *  - AI     : describe the job in plain English → itemized draft to review.
 * All save the identical estimate and flow on to invoice / PO / job.
 * Each stays mounted, so switching never loses what you entered.
 */
export function BuilderSwitch(props: {
  customerId: string;
  customerName: string;
  targetMargin: number;
  freightPct: number;
  serviceAddresses: { id: string; label: string }[];
}) {
  const [mode, setMode] = useState<Mode>("wizard");
  const [serviceAddressId, setServiceAddressId] = useState("");

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
      {props.serviceAddresses.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Job site (this account has multiple properties)
          </label>
          <select
            value={serviceAddressId}
            onChange={(e) => setServiceAddressId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Primary address</option>
            {props.serviceAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <Tab value="wizard" icon={ListChecks} label="Estimate builder" hint="Step-by-step — covers every base" />
        <Tab value="quick" icon={Zap} label="Quick estimate" hint="One screen — fast quote" />
        <Tab value="ai" icon={Sparkles} label="Describe the job (AI)" hint="Plain English → itemized draft" />
      </div>

      <div className={mode === "wizard" ? "" : "hidden"}>
        <GuidedWizard
          customerId={props.customerId}
          customerName={props.customerName}
          targetMargin={props.targetMargin}
          freightPct={props.freightPct}
          serviceAddressId={serviceAddressId}
        />
      </div>
      <div className={mode === "quick" ? "" : "hidden"}>
        <QuickEstimate
          customerId={props.customerId}
          customerName={props.customerName}
          targetMargin={props.targetMargin}
          freightPct={props.freightPct}
          serviceAddressId={serviceAddressId}
        />
      </div>
      <div className={mode === "ai" ? "" : "hidden"}>
        <AiEstimate
          customerId={props.customerId}
          customerName={props.customerName}
          serviceAddressId={serviceAddressId}
        />
      </div>
    </div>
  );
}
