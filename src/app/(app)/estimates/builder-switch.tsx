"use client";

import { useState } from "react";
import { Wand2, ListChecks, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotesToEstimate } from "@/app/(app)/customers/[id]/notes-to-estimate";
import { GuidedWizard } from "./guided-wizard";
import { SmartBuilder } from "./smart-builder";

type Mode = "notes" | "wizard" | "manual";

/**
 * Three ways to build an estimate — pick whichever fits the job:
 *  - From notes  : type the job or snap a photo; AI builds it.
 *  - Step-by-step: a guided wizard that covers every base.
 *  - Manual      : the full builder with every option (the original).
 * All three save the identical estimate and flow on to invoice / PO / job.
 * Each stays mounted, so switching never loses what you entered.
 */
export function BuilderSwitch(props: {
  customerId: string;
  customerName: string;
  targetMargin: number;
  addonDefaults?: React.ComponentProps<typeof SmartBuilder>["addonDefaults"];
  roomDefaults?: React.ComponentProps<typeof SmartBuilder>["roomDefaults"];
}) {
  const [mode, setMode] = useState<Mode>("notes");

  const Tab = ({
    value, icon: Icon, label, hint,
  }: {
    value: Mode; icon: typeof Wand2; label: string; hint: string;
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
      <div className="grid gap-2 sm:grid-cols-3">
        <Tab value="notes" icon={Wand2} label="From notes" hint="Type it or photo your notes — AI builds it" />
        <Tab value="wizard" icon={ListChecks} label="Step-by-step" hint="Guided — covers every base" />
        <Tab value="manual" icon={SlidersHorizontal} label="Manual" hint="Full control, every option" />
      </div>

      <div className={mode === "notes" ? "" : "hidden"}>
        <NotesToEstimate customerId={props.customerId} />
      </div>
      <div className={mode === "wizard" ? "" : "hidden"}>
        <GuidedWizard
          customerId={props.customerId}
          customerName={props.customerName}
          targetMargin={props.targetMargin}
        />
      </div>
      <div className={mode === "manual" ? "" : "hidden"}>
        <SmartBuilder
          customerId={props.customerId}
          customerName={props.customerName}
          targetMargin={props.targetMargin}
          addonDefaults={props.addonDefaults}
          roomDefaults={props.roomDefaults}
        />
      </div>
    </div>
  );
}
