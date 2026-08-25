"use client";

import { useState } from "react";
import type { EstimateQuestion, CustomerArea } from "@/lib/types";
import { Questionnaire } from "./questionnaire";
import type { EstimateDraft } from "./smart-actions";

/**
 * Guided estimate front-door. Holds the job-site selector (for multi-property
 * accounts) and renders the data-driven questionnaire, which computes the line
 * items and hands off to the CURRENT builder (createSmartEstimate → openEdit).
 */
export function GuidedEstimate(props: {
  customerId: string;
  customerName: string;
  targetMargin: number;
  serviceAddresses: { id: string; label: string }[];
  questions: EstimateQuestion[];
  savedAreas: CustomerArea[];
  draft?: EstimateDraft | null;
  /** Chosen in the New estimate dialog, so it isn't asked twice. */
  initialServiceAddressId?: string | null;
}) {
  const [serviceAddressId, setServiceAddressId] = useState(
    props.initialServiceAddressId ?? "",
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

      <Questionnaire
        customerId={props.customerId}
        customerName={props.customerName}
        targetMargin={props.targetMargin}
        serviceAddressId={serviceAddressId}
        questions={props.questions}
        savedAreas={props.savedAreas}
        draft={props.draft}
      />
    </div>
  );
}
