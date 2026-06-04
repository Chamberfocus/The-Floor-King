"use client";

import { useRef } from "react";
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  type LeadStage,
} from "@/lib/types";
import { changeStage } from "../actions";

export function StageSelect({ id, stage }: { id: string; stage: LeadStage }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={changeStage}>
      <input type="hidden" name="id" value={id} />
      <select
        name="stage"
        defaultValue={stage}
        onChange={() => formRef.current?.requestSubmit()}
        aria-label="Pipeline stage"
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {LEAD_STAGE_ORDER.map((s) => (
          <option key={s} value={s}>
            {LEAD_STAGE_LABELS[s]}
          </option>
        ))}
      </select>
    </form>
  );
}
