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
import { createStage, type StageFormState } from "./actions";

const fieldClass =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
      <Input name="name" placeholder="New stage name" className="w-44" required />
      <select name="color" defaultValue="blue" className={fieldClass}>
        {STAGE_COLORS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select name="default_owner" defaultValue="" className={fieldClass}>
        <option value="">— No default owner —</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.title ? ` (${m.title})` : ""}
          </option>
        ))}
      </select>
      <select name="auto_action" defaultValue="none" className={fieldClass}>
        {(Object.keys(STAGE_AUTO_ACTION_LABELS) as StageAutoAction[]).map((a) => (
          <option key={a} value={a}>
            {STAGE_AUTO_ACTION_LABELS[a]}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending}>
        <Plus className="size-4" /> Add stage
      </Button>
    </form>
  );
}
