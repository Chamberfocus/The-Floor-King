"use client";

import { useState, useTransition } from "react";
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  type LeadStage,
} from "@/lib/types";
import { SegmentedField } from "@/components/ui/segmented-field";
import { changeStage } from "../actions";

export function StageSelect({ id, stage }: { id: string; stage: LeadStage }) {
  const [current, setCurrent] = useState<LeadStage>(stage);
  const [, start] = useTransition();

  const change = (s: string) => {
    setCurrent(s as LeadStage);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("stage", s);
    start(() => {
      changeStage(fd);
    });
  };

  return (
    <SegmentedField
      size="sm"
      value={current}
      onChange={change}
      options={LEAD_STAGE_ORDER.map((s) => ({
        value: s,
        label: LEAD_STAGE_LABELS[s],
      }))}
    />
  );
}
