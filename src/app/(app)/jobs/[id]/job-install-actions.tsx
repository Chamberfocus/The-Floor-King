"use client";

import { useState } from "react";
import { Check, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { setJobStatusFeedback } from "../actions";
import {
  canCompleteInstallation,
  canStartInstallation,
} from "@/lib/install-closeout";
import type { JobStatus } from "@/lib/types";

export function JobInstallActions({
  jobId,
  status,
  title,
}: {
  jobId: string;
  status: JobStatus | null | undefined;
  title: string;
}) {
  const [pending, setPending] = useState<"start" | "complete" | null>(null);
  const showStart = canStartInstallation(status);
  const showComplete = canCompleteInstallation(status);
  if (!showStart && !showComplete) return null;

  async function run(next: "in_progress" | "completed") {
    if (pending) return;
    setPending(next === "in_progress" ? "start" : "complete");
    const fd = new FormData();
    fd.set("id", jobId);
    fd.set("status", next);
    try {
      const result = await setJobStatusFeedback(fd);
      if (result.error) toast.error(result.error);
    } catch {
      toast.error(
        next === "completed"
          ? "This installation could not be marked complete. Refresh and try again."
          : "This installation could not be started. Refresh and try again.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      {showStart ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          disabled={pending != null}
          onClick={() => void run("in_progress")}
        >
          <Play className="size-4" />
          {pending === "start" ? "Starting…" : "Start installation"}
        </Button>
      ) : null}
      {showComplete ? (
        <ConfirmButton
          size="lg"
          className="min-h-11 w-full sm:w-auto"
          disabled={pending != null}
          title={`Mark "${title || "this job"}" as complete?`}
          description="This marks the physical installation complete. It does not collect payment, close a service callback, or replace a customer sign-off."
          confirmLabel="Mark complete"
          onConfirm={() => run("completed")}
        >
          <Check className="size-4" />
          {pending === "complete" ? "Saving…" : "Mark installation complete"}
        </ConfirmButton>
      ) : null}
    </div>
  );
}
