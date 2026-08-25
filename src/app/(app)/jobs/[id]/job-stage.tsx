"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchPicker } from "@/components/ui/search-picker";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setJobStage } from "@/app/(app)/jobs/stage-actions";

/**
 * Move THIS job along, independently of everything else on the account.
 *
 * The account-level picker on the customer file moved all of an account's work
 * at once, because there was only ever one stage to move. A contractor with a
 * finished kitchen and an unmeasured basement needs to put them in two different
 * places, which is the whole point of the stage living on the job.
 */
export function JobStage({
  jobId,
  jobTitle,
  stages,
  currentStageId,
  siblingCount,
}: {
  jobId: string;
  jobTitle: string | null;
  stages: { id: string; name: string }[];
  currentStageId: string | null;
  /** Other live jobs on the same account — worth saying they won't move. */
  siblingCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [toStage, setToStage] = useState(currentStageId ?? stages[0]?.id ?? "");
  const [note, setNote] = useState("");

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setToStage(currentStageId ?? stages[0]?.id ?? "");
          setNote("");
          setOpen(true);
        }}
      >
        <ArrowLeftRight className="size-3.5" /> Change stage
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move this job</DialogTitle>
            <DialogDescription>
              {siblingCount > 0
                ? `Only ${jobTitle || "this job"} moves. The other ${
                    siblingCount === 1 ? "job" : `${siblingCount} jobs`
                  } on this account stay where they are.`
                : "Where this job stands in the flow."}
            </DialogDescription>
          </DialogHeader>
          <form action={setJobStage} className="space-y-3">
            <input type="hidden" name="job_id" value={jobId} />
            <input type="hidden" name="to_stage" value={toStage} />
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Stage</label>
              <SearchPicker
                className="w-full"
                value={toStage}
                onChange={setToStage}
                options={stages.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Why? (optional — shows in the customer&apos;s history)
              </label>
              <Input
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. waiting on the basement to dry out"
                className="h-8"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="sm" pendingText="Moving…" confirm="Job moved">
                Save
              </SubmitButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
