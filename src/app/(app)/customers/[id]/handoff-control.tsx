"use client";

import { useState } from "react";
import { Search, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, type UserRole, type WorkflowStage } from "@/lib/types";
import type { HandoffMember } from "@/lib/data/workflow";
import { handoffCustomer } from "./workflow-actions";

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function HandoffControl({
  customerId,
  currentStageId,
  currentOwnerId,
  stages,
  members,
}: {
  customerId: string;
  currentStageId: string | null;
  currentOwnerId: string | null;
  stages: WorkflowStage[];
  members: HandoffMember[];
}) {
  const currentIdx = stages.findIndex((s) => s.id === currentStageId);
  const nextStage =
    stages[currentIdx + 1]?.id ?? currentStageId ?? stages[0]?.id ?? "";

  const [stageId, setStageId] = useState(nextStage);
  const [ownerId, setOwnerId] = useState<string>(
    stages.find((s) => s.id === nextStage)?.default_owner ??
      currentOwnerId ??
      "",
  );
  const [query, setQuery] = useState("");

  const onStageChange = (value: string) => {
    setStageId(value);
    const def = stages.find((s) => s.id === value)?.default_owner;
    if (def) setOwnerId(def);
  };

  const q = query.trim().toLowerCase();
  const filtered = members.filter((m) => {
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      (m.title ?? "").toLowerCase().includes(q) ||
      ROLE_LABELS[m.role as UserRole]?.toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q)
    );
  });
  const selected = members.find((m) => m.id === ownerId);

  return (
    <form action={handoffCustomer} className="space-y-3">
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="to_user" value={ownerId} />

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Move to stage
        </label>
        <select
          name="to_stage_id"
          value={stageId}
          onChange={(e) => onStageChange(e.target.value)}
          className={fieldClass}
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Hand off to (search name, job title, or role)
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Mike, Estimator, Installer…"
            className={cn(fieldClass, "pl-8")}
          />
        </div>
        <div className="max-h-44 overflow-y-auto rounded-md border">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No matches.</p>
          ) : (
            filtered.map((m) => {
              const active = m.id === ownerId;
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => setOwnerId(m.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                    active && "bg-muted",
                  )}
                >
                  <span>
                    <span className="font-medium">{m.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {m.title ? `${m.title} · ` : ""}
                      {ROLE_LABELS[m.role as UserRole] ?? m.role}
                    </span>
                  </span>
                  {active ? <Check className="size-4 text-green-600" /> : null}
                </button>
              );
            })
          )}
        </div>
      </div>

      {selected ? (
        <p className="text-sm">
          Handing off to{" "}
          <span className="font-semibold">{selected.name}</span>
          {selected.title ? ` (${selected.title})` : ""}.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick who takes it next.
        </p>
      )}

      <textarea
        name="note"
        rows={2}
        placeholder="Handoff note (optional) — anything the next person should know."
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <Button type="submit" className="w-full" disabled={!stageId}>
        <ArrowRight className="size-4" /> Hand off
      </Button>
    </form>
  );
}
