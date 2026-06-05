"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  STAGE_COLORS,
  STAGE_COLOR_BADGE,
  type WorkflowStage,
} from "@/lib/types";
import type { HandoffMember } from "@/lib/data/workflow";
import {
  updateStage,
  deleteStage,
  moveStage,
  type StageFormState,
} from "./actions";

const fieldClass =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const initialState: StageFormState = { error: null };

export function StageRow({
  stage,
  members,
  isFirst,
  isLast,
}: {
  stage: WorkflowStage;
  members: HandoffMember[];
  isFirst: boolean;
  isLast: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateStage, initialState);
  useEffect(() => {
    if (state.ok) toast.success("Stage saved");
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <div className="flex items-center gap-2 rounded-md border p-2">
      <div className="flex flex-col">
        <form action={moveStage}>
          <input type="hidden" name="id" value={stage.id} />
          <input type="hidden" name="dir" value="up" />
          <Button
            type="submit"
            variant="ghost"
            size="icon-xs"
            aria-label="Move up"
            disabled={isFirst}
          >
            <ChevronUp className="size-3.5" />
          </Button>
        </form>
        <form action={moveStage}>
          <input type="hidden" name="id" value={stage.id} />
          <input type="hidden" name="dir" value="down" />
          <Button
            type="submit"
            variant="ghost"
            size="icon-xs"
            aria-label="Move down"
            disabled={isLast}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </form>
      </div>

      <span
        className={cn(
          "size-3 shrink-0 rounded-full",
          (STAGE_COLOR_BADGE[stage.color] ?? STAGE_COLOR_BADGE.zinc).split(
            " ",
          )[0],
        )}
      />

      <form
        action={formAction}
        className="flex flex-1 flex-wrap items-center gap-2"
      >
        <input type="hidden" name="id" value={stage.id} />
        <Input name="name" defaultValue={stage.name} className="w-40" />
        <select name="color" defaultValue={stage.color} className={fieldClass}>
          {STAGE_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="default_owner"
          defaultValue={stage.default_owner ?? ""}
          className={fieldClass}
        >
          <option value="">— No default owner —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.title ? ` (${m.title})` : ""}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Save
        </Button>
      </form>

      <form action={deleteStage}>
        <input type="hidden" name="id" value={stage.id} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete stage"
        >
          <Trash2 className="size-4" />
        </Button>
      </form>
    </div>
  );
}
