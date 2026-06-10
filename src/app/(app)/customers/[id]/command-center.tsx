"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CircleDot, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney, formatDate } from "@/lib/format";
import { STAGE_COLOR_BADGE, type WorkflowStage } from "@/lib/types";
import type { HandoffMember } from "@/lib/data/workflow";
import { advanceWorkflow } from "../actions";

interface HandoffRow {
  id: string;
  to_stage_name: string | null;
  to_name: string | null;
  created_at: string;
}

const fieldClass =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CommandCenter({
  customerId,
  stages,
  members,
  currentStageId,
  currentOwnerId,
  ownerName,
  nextActionDue,
  money,
  handoffs = [],
}: {
  customerId: string;
  stages: WorkflowStage[];
  members: HandoffMember[];
  currentStageId: string | null;
  currentOwnerId: string | null;
  ownerName: string | null;
  nextActionDue: string | null;
  money: { invoiced: number; paid: number; balance: number };
  handoffs?: HandoffRow[];
}) {
  const ordered = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );
  const current = ordered.find((s) => s.id === currentStageId) ?? null;
  const idx = current ? ordered.findIndex((s) => s.id === current.id) : -1;
  const nextStage = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;

  const [mode, setMode] = useState<null | "advance" | "move">(null);
  const [toStage, setToStage] = useState<string>(nextStage?.id ?? "");
  // Default to keeping the same person — only changes if you choose to.
  const [toUser, setToUser] = useState<string>(currentOwnerId ?? "");

  const onPickStage = (id: string) => setToStage(id);

  const openAdvance = () => {
    setMode("advance");
    setToStage(nextStage?.id ?? "");
    setToUser(currentOwnerId ?? "");
  };
  const openMove = () => {
    setMode("move");
    setToStage(current?.id ?? ordered[0]?.id ?? "");
    setToUser(currentOwnerId ?? "");
  };

  // The stage's suggested owner (for a quick "hand off" shortcut).
  const targetStage = ordered.find((s) => s.id === toStage) ?? null;
  const suggestedOwner = targetStage?.default_owner ?? null;
  const suggestedName = suggestedOwner
    ? (members.find((m) => m.id === suggestedOwner)?.name ?? null)
    : null;

  const due = nextActionDue ? new Date(nextActionDue) : null;
  const overdue = due ? due.getTime() < Date.now() : false;
  const dueLabel = due
    ? due.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 shadow-sm",
        overdue ? "border-destructive/40 bg-destructive/5" : "bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Stage + next action */}
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <CircleDot className="size-4 text-primary" />
            {current ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  STAGE_COLOR_BADGE[current.color] ?? STAGE_COLOR_BADGE.zinc,
                )}
              >
                {current.name}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Not started</span>
            )}
          </div>
          <div className="text-lg font-semibold">
            {current?.next_action ?? "Set this lead's stage to begin"}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              Owner:{" "}
              <span className="font-medium text-foreground">
                {ownerName ?? "Unassigned"}
              </span>
            </span>
            {dueLabel ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  overdue && "font-medium text-destructive",
                )}
              >
                {overdue ? (
                  <AlertTriangle className="size-3.5" />
                ) : (
                  <Clock className="size-3.5" />
                )}
                {overdue ? `Overdue — due ${dueLabel}` : `Due ${dueLabel}`}
              </span>
            ) : null}
          </div>
        </div>

        {/* Money */}
        <div className="flex gap-4 text-right text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Invoiced</div>
            <div className="font-medium tabular-nums">
              {formatMoney(money.invoiced)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Paid</div>
            <div className="font-medium tabular-nums text-primary">
              {formatMoney(money.paid)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Balance</div>
            <div
              className={cn(
                "font-medium tabular-nums",
                money.balance > 0 ? "text-destructive" : "",
              )}
            >
              {formatMoney(money.balance)}
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {mode === null ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {nextStage ? (
            <Button type="button" onClick={openAdvance}>
              Confirm &amp; advance <ArrowRight className="size-4" />
              <span className="opacity-80">to {nextStage.name}</span>
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={openMove}>
            Move to…
          </Button>
        </div>
      ) : (
        <form action={advanceWorkflow} className="mt-4 space-y-3 rounded-lg border bg-background p-3">
          <input type="hidden" name="id" value={customerId} />
          <input type="hidden" name="to_stage" value={toStage} />
          <input type="hidden" name="to_user" value={toUser} />
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {mode === "advance" ? "Advance to" : "Move to"}
              </label>
              <select
                value={toStage}
                onChange={(e) => onPickStage(e.target.value)}
                className={cn(fieldClass, "w-52")}
              >
                {ordered.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Assign to {toUser === currentOwnerId && currentOwnerId ? "(keeping same person)" : ""}
              </label>
              <select
                value={toUser}
                onChange={(e) => setToUser(e.target.value)}
                className={cn(fieldClass, "w-48")}
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.title ? ` (${m.title})` : ""}
                  </option>
                ))}
              </select>
              {suggestedOwner && suggestedOwner !== toUser ? (
                <button
                  type="button"
                  onClick={() => setToUser(suggestedOwner)}
                  className="mt-1 block text-xs font-medium text-primary hover:underline"
                >
                  Hand off to {suggestedName ?? "stage owner"}
                </button>
              ) : null}
            </div>
          </div>
          <input
            name="note"
            placeholder="Note (optional)"
            className={cn(fieldClass, "w-full")}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button type="submit">Confirm</Button>
          </div>
        </form>
      )}

      {handoffs.length ? (
        <div className="mt-4 border-t pt-3">
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Recent handoffs
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {handoffs.slice(0, 5).map((h) => (
              <li key={h.id}>
                → {h.to_stage_name ?? "stage"} · {h.to_name ?? "unassigned"} ·{" "}
                {formatDate(h.created_at)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
