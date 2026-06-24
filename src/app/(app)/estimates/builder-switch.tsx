"use client";

import { useState } from "react";
import { Zap, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuickBuilder } from "./quick-builder";
import { SmartBuilder } from "./smart-builder";

type Mode = "quick" | "full";

/**
 * Lets you build an estimate in Quick mode (fast, the essentials) or the Full
 * builder (every option). Both stay mounted, so switching never loses what you
 * entered — and the full builder is untouched from how it's always worked.
 */
export function BuilderSwitch(props: {
  customerId: string;
  customerName: string;
  targetMargin: number;
  addonDefaults?: React.ComponentProps<typeof SmartBuilder>["addonDefaults"];
  roomDefaults?: React.ComponentProps<typeof SmartBuilder>["roomDefaults"];
}) {
  const [mode, setMode] = useState<Mode>("quick");

  const Tab = ({ value, icon: Icon, label, hint }: { value: Mode; icon: typeof Zap; label: string; hint: string }) => (
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
      <div className="flex gap-2">
        <Tab value="quick" icon={Zap} label="Quick" hint="Fast pricing — just the essentials" />
        <Tab value="full" icon={SlidersHorizontal} label="Full builder" hint="Every option: companions, add-ons, per-room margin" />
      </div>

      <div className={mode === "quick" ? "" : "hidden"}>
        <QuickBuilder
          customerId={props.customerId}
          customerName={props.customerName}
          targetMargin={props.targetMargin}
        />
      </div>
      <div className={mode === "full" ? "" : "hidden"}>
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
