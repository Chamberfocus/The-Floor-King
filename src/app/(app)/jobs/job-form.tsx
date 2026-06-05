"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { JOB_STATUS_LABELS, JOB_STATUS_ORDER, type Job } from "@/lib/types";
import type { AssignableUser } from "@/lib/data/jobs";
import { updateJob, type JobFormState } from "./actions";

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const initialState: JobFormState = { error: null };

export function JobForm({
  job,
  users,
}: {
  job: Job;
  users: AssignableUser[];
}) {
  const [state, formAction, pending] = useActionState(updateJob, initialState);

  useEffect(() => {
    if (state.ok) toast.success("Job saved");
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={job.id} />

      <div className="space-y-2">
        <Label htmlFor="title">Job title</Label>
        <Input id="title" name="title" defaultValue={job.title ?? ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={job.status}
            className={fieldClass}
          >
            {JOB_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="assigned_to">Assigned crew</Label>
          <select
            id="assigned_to"
            name="assigned_to"
            defaultValue={job.assigned_to ?? ""}
            className={fieldClass}
          >
            <option value="">— Unassigned —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduled_date">Start date</Label>
          <Input
            id="scheduled_date"
            name="scheduled_date"
            type="date"
            defaultValue={job.scheduled_date ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduled_end">End date</Label>
          <Input
            id="scheduled_end"
            name="scheduled_end"
            type="date"
            defaultValue={job.scheduled_end ?? ""}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="site_street">Job site address</Label>
        <Input
          id="site_street"
          name="site_street"
          defaultValue={job.site_street ?? ""}
          placeholder="Street"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Input
            name="site_city"
            defaultValue={job.site_city ?? ""}
            placeholder="City"
          />
          <Input
            name="site_state"
            defaultValue={job.site_state ?? ""}
            placeholder="State"
            maxLength={2}
          />
          <Input
            name="site_zip"
            defaultValue={job.site_zip ?? ""}
            placeholder="ZIP"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Job notes (visible to crew)</Label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={job.notes ?? ""}
          rows={3}
          placeholder="Access, gate codes, special instructions…"
          className={cn(fieldClass, "h-auto py-2")}
        />
      </div>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save job"}
        </Button>
      </div>
    </form>
  );
}
