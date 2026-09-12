"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScoredCustomerMatch } from "@/lib/customer-resolve";

export function CustomerMatchPanel({
  matches,
  onUseExisting,
  onCreateAnyway,
  pending,
}: {
  matches: ScoredCustomerMatch[];
  onUseExisting: (id: string) => void;
  onCreateAnyway: () => void;
  pending?: boolean;
}) {
  const strong = matches.some((m) => m.tier === "strong");
  return (
    <div className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
        <AlertTriangle className="size-4" />
        Possible existing customer found
      </div>
      <ul className="space-y-1.5">
        {matches.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between gap-3 rounded-md border bg-background px-2.5 py-2 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{m.full_name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[m.phone, m.email, m.street || m.city]
                  .filter(Boolean)
                  .join(" · ") || "No contact details"}
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                {m.jobCount
                  ? `${m.jobCount} job${m.jobCount === 1 ? "" : "s"}`
                  : "No jobs yet"}
                {m.tier === "strong" ? " · strong match" : ""}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onUseExisting(m.id)}
            >
              Use existing
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={onCreateAnyway}
      >
        {strong ? "Create new customer anyway" : "Create new anyway"}
      </Button>
    </div>
  );
}
