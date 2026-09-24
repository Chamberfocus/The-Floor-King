"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { snoozeCustomerFollowup } from "@/app/(app)/customers/actions";
import { completeOfficeTask } from "@/app/(app)/ops/actions";
import { ALLOWED_SNOOZE_DAYS } from "@/lib/ops-followup";
import { formatDateTime } from "@/lib/format";
import type { OfficeTaskRow } from "@/lib/data/ops-glue";

export function CustomerNextActionCard({
  customerId,
  nextActionDue,
  stuck,
  tasks,
  canSnooze,
}: {
  customerId: string;
  nextActionDue: string | null;
  stuck: boolean;
  tasks: OfficeTaskRow[];
  canSnooze: boolean;
}) {
  const [pending, start] = useTransition();

  const snooze = (days: number) =>
    start(async () => {
      const fd = new FormData();
      fd.set("customer_id", customerId);
      fd.set("days", String(days));
      try {
        await snoozeCustomerFollowup(fd);
        toast.success(`Follow-up snoozed ${days} day${days === 1 ? "" : "s"}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not snooze");
      }
    });

  const complete = (taskId: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("task_id", taskId);
      try {
        await completeOfficeTask(fd);
        toast.success("Task completed");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not complete");
      }
    });

  return (
    <div
      className={`rounded-lg border bg-card p-5 shadow-sm ${
        stuck ? "border-destructive/40" : ""
      }`}
    >
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Follow-up reminder
      </p>
      <p className="text-sm text-muted-foreground">
        Snooze only moves this reminder. It does not clear a deposit, a material hold, or an install date.
      </p>
      {nextActionDue ? (
        <p className={`mt-1 text-xs ${stuck ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          Due {formatDateTime(nextActionDue)}
          {stuck ? " · overdue" : ""}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No follow-up date set.</p>
      )}
      {canSnooze ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ALLOWED_SNOOZE_DAYS.map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              className="min-h-9"
              onClick={() => snooze(d)}
            >
              Snooze {d}d
            </Button>
          ))}
        </div>
      ) : null}
      {tasks.length ? (
        <ul className="mt-4 space-y-2 border-t pt-3">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{t.title}</div>
                {t.estimate_id ? (
                  <Link
                    href={`/estimates/${t.estimate_id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Open estimate
                  </Link>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                className="min-h-9 shrink-0"
                onClick={() => complete(t.id)}
              >
                Done
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
