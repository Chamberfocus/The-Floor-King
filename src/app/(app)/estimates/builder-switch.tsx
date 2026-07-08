"use client";

import { useState } from "react";
import { ClipboardList, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EstimateQuestion, CustomerArea } from "@/lib/types";
import { Questionnaire } from "./questionnaire";
import { AiEstimate } from "./ai-estimate";

type Mode = "questionnaire" | "ai";

/**
 * One estimate builder, two input paths — both produce the identical estimate
 * (same line items → invoice / PO / work order):
 *  - Questionnaire : a guided, data-driven Q&A (managed in Settings).
 *  - AI            : describe the whole job in plain English.
 * Each stays mounted, so switching never loses what you entered.
 */
export function BuilderSwitch(props: {
  customerId: string;
  customerName: string;
  targetMargin: number;
  serviceAddresses: { id: string; label: string }[];
  questions: EstimateQuestion[];
  savedAreas: CustomerArea[];
}) {
  const [mode, setMode] = useState<Mode>("questionnaire");
  const [serviceAddressId, setServiceAddressId] = useState("");

  const Tab = ({ value, icon: Icon, label, hint }: { value: Mode; icon: typeof Sparkles; label: string; hint: string }) => (
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
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <Tab value="questionnaire" icon={ClipboardList} label="Guided questionnaire" hint="Answer a few questions" />
        <Tab value="ai" icon={Sparkles} label="Describe the job (AI)" hint="Plain English → itemized draft" />
      </div>

      <div className={mode === "questionnaire" ? "" : "hidden"}>
        <Questionnaire
          customerId={props.customerId}
          customerName={props.customerName}
          targetMargin={props.targetMargin}
          serviceAddressId={serviceAddressId}
          questions={props.questions}
          savedAreas={props.savedAreas}
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
