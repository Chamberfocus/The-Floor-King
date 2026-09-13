"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportInstallerIssue } from "@/app/(app)/ops/actions";
import { INSTALLER_ISSUE_CATEGORIES } from "@/lib/ops-followup";

export function InstallerIssueForm({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();

  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium hover:bg-muted">
        <AlertTriangle className="size-4 text-amber-600" />
        Report a problem
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          Shortage, damage, extra work
        </span>
      </summary>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("job_id", jobId);
          start(async () => {
            try {
              await reportInstallerIssue(fd);
              toast.success("Issue sent to the office");
              e.currentTarget.reset();
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "Could not send the issue",
              );
            }
          });
        }}
      >
        <select
          name="category"
          required
          className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          defaultValue="shortage"
        >
          {INSTALLER_ISSUE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <textarea
          name="description"
          required
          rows={3}
          placeholder="What happened? What do you need from the office?"
          className="w-full rounded-md border px-2 py-2 text-sm"
        />
        <Button type="submit" size="sm" disabled={pending} className="min-h-10">
          {pending ? "Sending…" : "Send to office"}
        </Button>
      </form>
    </details>
  );
}
