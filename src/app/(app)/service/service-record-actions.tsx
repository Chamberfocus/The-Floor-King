"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import {
  assignServiceCallback,
  resolveServiceCallback,
  scheduleServiceVisit,
  setServiceCallbackStatus,
} from "@/app/(app)/ops/actions";
import { canMoveServiceTo } from "@/lib/service-callback";

export function ServiceRecordActions({
  callbackId,
  status,
  assignedTo,
  followUpAt,
  assignees,
  canCancel,
}: {
  callbackId: string;
  status: string;
  assignedTo: string | null;
  followUpAt: string | null;
  assignees: { id: string; name: string }[];
  canCancel: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const visitDefault = followUpAt ? followUpAt.slice(0, 10) : "";
  const closed = status === "resolved" || status === "cancelled";

  async function run(
    key: string,
    action: (fd: FormData) => Promise<{ error: string | null }>,
    fields: Record<string, string>,
    fallback: string,
  ) {
    if (pending) return;
    setPending(key);
    const fd = new FormData();
    fd.set("callback_id", callbackId);
    for (const [name, value] of Object.entries(fields)) fd.set(name, value);
    try {
      const result = await action(fd);
      if (result.error) toast.error(result.error);
    } catch {
      toast.error(fallback);
    } finally {
      setPending(null);
    }
  }

  if (closed) return null;

  return (
    <div className="space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const day = String(new FormData(event.currentTarget).get("visit_date") ?? "");
          void run(
            "schedule",
            scheduleServiceVisit,
            { visit_date: day },
            "This visit could not be scheduled. Refresh and try again.",
          );
        }}
      >
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Visit date
          </span>
          <input
            type="date"
            name="visit_date"
            required
            defaultValue={visitDefault}
            className="h-11 w-full rounded-md border px-2 text-sm"
          />
        </label>
        <Button type="submit" className="min-h-11" disabled={pending != null}>
          {pending === "schedule" ? "Saving…" : "Schedule visit"}
        </Button>
      </form>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const assigned = String(new FormData(event.currentTarget).get("assigned_to") ?? "");
          void run(
            "assign",
            assignServiceCallback,
            { assigned_to: assigned },
            "This service issue could not be assigned. Refresh and try again.",
          );
        }}
      >
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assigned to
          </span>
          <select
            name="assigned_to"
            defaultValue={assignedTo ?? ""}
            className="h-11 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Unassigned</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" className="min-h-11" disabled={pending != null}>
          {pending === "assign" ? "Saving…" : "Save assignment"}
        </Button>
      </form>

      <div className="flex flex-col gap-2 sm:flex-row">
        {canMoveServiceTo(status, "in_progress") ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending != null}
            onClick={() =>
              void run(
                "start",
                setServiceCallbackStatus,
                { status: "in_progress" },
                "This service issue could not be updated. Refresh and try again.",
              )
            }
          >
            {pending === "start" ? "Saving…" : "Start service"}
          </Button>
        ) : null}
        {canMoveServiceTo(status, "waiting") ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending != null}
            onClick={() =>
              void run(
                "wait",
                setServiceCallbackStatus,
                { status: "waiting" },
                "This service issue could not be updated. Refresh and try again.",
              )
            }
          >
            {pending === "wait" ? "Saving…" : "Mark waiting"}
          </Button>
        ) : null}
      </div>

      <ResolveForm callbackId={callbackId} pending={pending} setPending={setPending} />

      {canCancel ? (
        <p className="text-xs text-muted-foreground">
          Cancelling this issue does not change the installation or the customer balance.
        </p>
      ) : null}
    </div>
  );
}

function ResolveForm({
  callbackId,
  pending,
  setPending,
}: {
  callbackId: string;
  pending: string | null;
  setPending: (value: string | null) => void;
}) {
  const [notes, setNotes] = useState("");
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Resolution
        </span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          placeholder="What was done"
          className="w-full rounded-md border px-2 py-2 text-sm"
        />
      </label>
      <ConfirmButton
        className="min-h-11"
        disabled={pending != null}
        title="Mark this service issue resolved?"
        description="This marks the service issue resolved. It does not change the installation completion date, customer balance, payments, credits, or refunds."
        confirmLabel="Mark resolved"
        onConfirm={async () => {
          if (pending) return;
          setPending("resolve");
          const fd = new FormData();
          fd.set("callback_id", callbackId);
          fd.set("resolution_notes", notes);
          try {
            const result = await resolveServiceCallback(fd);
            if (result.error) toast.error(result.error);
          } catch {
            toast.error("This service issue could not be marked resolved. Refresh and try again.");
          } finally {
            setPending(null);
          }
        }}
      >
        {pending === "resolve" ? "Saving…" : "Mark resolved"}
      </ConfirmButton>
    </div>
  );
}
