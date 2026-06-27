"use client";

import { useState } from "react";
import { Clock, AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchPicker } from "@/components/ui/search-picker";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type { WorkflowStage } from "@/lib/types";
import type { HandoffMember } from "@/lib/data/workflow";
import { advanceWorkflow } from "../actions";

/**
 * The "admin" bits of the old command center — owner, money, due, and a manual
 * move/reassign — folded under the guided flow so there's ONE stage control.
 * (Forward progress lives in the guided "Do this next" panel.)
 */
export function StageManage({
  customerId,
  stages,
  members,
  currentStageId,
  currentOwnerId,
  ownerName,
  nextActionDue,
  money,
}: {
  customerId: string;
  stages: WorkflowStage[];
  members: HandoffMember[];
  currentStageId: string | null;
  currentOwnerId: string | null;
  ownerName: string | null;
  nextActionDue: string | null;
  money: { invoiced: number; paid: number; balance: number };
}) {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const [open, setOpen] = useState(false);
  const [toStage, setToStage] = useState(currentStageId ?? ordered[0]?.id ?? "");
  const [toUser, setToUser] = useState(currentOwnerId ?? "");
  const [reason, setReason] = useState("");

  // Moving to a Lost/Dead/Cancelled-type stage = a lost deal → ask why.
  const targetName = ordered.find((s) => s.id === toStage)?.name ?? "";
  const isLost = /lost|declin|dead|cancel/i.test(targetName);
  const LOST_REASONS = [
    "Price too high",
    "Went with competitor",
    "Changed their mind",
    "Couldn't reach them",
    "Bad timing",
  ];

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
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          Owner:{" "}
          <span className="font-medium text-foreground">
            {ownerName ?? "Unassigned"}
          </span>
        </span>
        {dueLabel ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {overdue ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <Clock className="size-3.5" />
            )}
            {overdue ? `Overdue — ${dueLabel}` : `Due ${dueLabel}`}
          </span>
        ) : null}
        {money.invoiced > 0 || money.balance > 0 ? (
          <span className="text-xs text-muted-foreground">
            Invoiced{" "}
            <span className="font-medium text-foreground">
              {formatMoney(money.invoiced)}
            </span>{" "}
            · Paid{" "}
            <span className="font-medium text-primary">
              {formatMoney(money.paid)}
            </span>
            {money.balance > 0 ? (
              <>
                {" "}
                · Balance{" "}
                <span className="font-medium text-destructive">
                  {formatMoney(money.balance)}
                </span>
              </>
            ) : null}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3.5" /> Move / reassign
        </button>
      </div>

      {open ? (
        <form
          action={advanceWorkflow}
          className="mt-2 flex flex-wrap items-end gap-2 border-t pt-2"
        >
          <input type="hidden" name="id" value={customerId} />
          <input type="hidden" name="to_stage" value={toStage} />
          <input type="hidden" name="to_user" value={toUser} />
          <input type="hidden" name="note" value={isLost ? reason : ""} />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Stage</label>
            <SearchPicker
              className="w-52"
              value={toStage}
              onChange={setToStage}
              options={ordered.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Assign to
            </label>
            <SearchPicker
              className="w-48"
              value={toUser}
              onChange={setToUser}
              placeholder="— Unassigned —"
              allowClear
              options={members.map((m) => ({
                value: m.id,
                label: m.name,
                hint: m.title ?? undefined,
              }))}
            />
          </div>
          {isLost ? (
            <div className="w-full space-y-1.5">
              <label className="block text-xs font-medium text-destructive">
                Why was this lost? (shows in the Win/Loss report)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {LOST_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs",
                      reason === r ? "border-primary bg-primary/5" : "hover:bg-muted",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (or pick one above)"
                className="h-8"
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
