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
  STAGE_AUTO_ACTION_LABELS,
  type StageAutoAction,
  type WorkflowStage,
} from "@/lib/types";
import type { HandoffMember } from "@/lib/data/workflow";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SearchPicker } from "@/components/ui/search-picker";
import {
  updateStage,
  deleteStage,
  moveStage,
  type StageFormState,
} from "./actions";

const initialState: StageFormState = { error: null };

export function StageRow({
  stage,
  members,
  isFirst,
  isLast,
  hideMove,
}: {
  stage: WorkflowStage;
  members: HandoffMember[];
  isFirst: boolean;
  isLast: boolean;
  hideMove?: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateStage, initialState);
  useEffect(() => {
    if (state.ok) toast.success("Stage saved");
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card p-2">
      {!hideMove ? (
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
      ) : null}

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
        <Input name="name" defaultValue={stage.name} className="w-36" />
        <Input
          name="next_action"
          defaultValue={stage.next_action ?? ""}
          placeholder="Next action (e.g. Call the customer)"
          className="w-52"
        />
        <div className="flex items-center gap-1" title="Flag as stalled after">
          <Input
            name="sla_value"
            type="number"
            min="0"
            defaultValue={
              stage.sla_hours
                ? stage.sla_hours % 24 === 0
                  ? stage.sla_hours / 24
                  : stage.sla_hours
                : ""
            }
            placeholder="0"
            className="w-16"
          />
          <SegmentedField
            size="sm"
            name="sla_unit"
            defaultValue={
              stage.sla_hours && stage.sla_hours % 24 === 0 ? "days" : "hours"
            }
            options={[
              { value: "hours", label: "hrs" },
              { value: "days", label: "days" },
            ]}
          />
        </div>
        <SearchPicker
          className="w-32"
          name="color"
          defaultValue={stage.color}
          options={STAGE_COLORS.map((c) => ({ value: c, label: c }))}
        />
        <SearchPicker
          className="w-44"
          name="default_owner"
          defaultValue={stage.default_owner ?? ""}
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
          defaultValue={stage.auto_action ?? "none"}
          options={(Object.keys(STAGE_AUTO_ACTION_LABELS) as StageAutoAction[]).map(
            (a) => ({ value: a, label: STAGE_AUTO_ACTION_LABELS[a] }),
          )}
        />
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
