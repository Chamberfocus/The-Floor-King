"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  STAGE_COLORS,
  STAGE_AUTO_ACTION_LABELS,
  type StageAutoAction,
} from "@/lib/types";
import type { HandoffMember } from "@/lib/data/workflow";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SearchPicker } from "@/components/ui/search-picker";
import { createStage, type StageFormState } from "./actions";

const initialState: StageFormState = { error: null };

export function AddStageForm({ members }: { members: HandoffMember[] }) {
  const [state, formAction, pending] = useActionState(createStage, initialState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      toast.success("Stage added");
      ref.current?.reset();
    }
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form
      ref={ref}
      action={formAction}
      className="flex flex-wrap items-center gap-2"
    >
      <Input name="name" placeholder="New stage name" className="w-36" required />
      <Input
        name="next_action"
        placeholder="Next action"
        className="w-44"
      />
      <div className="flex items-center gap-1">
        <Input
          name="sla_value"
          type="number"
          min="0"
          placeholder="0"
          className="w-16"
        />
        <SegmentedField
          size="sm"
          name="sla_unit"
          defaultValue="days"
          options={[
            { value: "hours", label: "hrs" },
            { value: "days", label: "days" },
          ]}
        />
      </div>
      <SearchPicker
        className="w-32"
        name="color"
        defaultValue="blue"
        options={STAGE_COLORS.map((c) => ({ value: c, label: c }))}
      />
      <SearchPicker
        className="w-44"
        name="default_owner"
        placeholder="— No default owner —"
        allowClear
        options={members.map((m) => ({
          value: m.id,
          label: m.name,
          hint: m.title ?? undefined,
        }))}
      />
      <SearchPicker
        className="w-44"
        name="auto_action"
        defaultValue="none"
        options={(Object.keys(STAGE_AUTO_ACTION_LABELS) as StageAutoAction[]).map(
          (a) => ({ value: a, label: STAGE_AUTO_ACTION_LABELS[a] }),
        )}
      />
      <Button type="submit" disabled={pending}>
        <Plus className="size-4" /> Add stage
      </Button>
    </form>
  );
}
