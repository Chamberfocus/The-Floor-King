"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { postJobToBoard } from "../actions";

/**
 * Post a job to the board WITH the target: the dates you want it done and how
 * long you expect it to take. Installers see this on the board when they claim.
 * Pre-fills the expected days from the computed install estimate.
 */
export function PostToBoardButton({
  jobId,
  defaultDays,
}: {
  jobId: string;
  defaultDays?: number | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Megaphone className="size-4" /> Post to job board
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post to the job board</DialogTitle>
            <DialogDescription>
              Set the dates you want it done and how long you expect it to take —
              installers see this when they claim the job.
            </DialogDescription>
          </DialogHeader>
          <form action={postJobToBoard} className="space-y-3">
            <input type="hidden" name="id" value={jobId} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wanted_start">Wanted from</Label>
                <DateField id="wanted_start" name="wanted_start" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="wanted_end">
                  Wanted by <span className="text-muted-foreground">(optional)</span>
                </Label>
                <DateField id="wanted_end" name="wanted_end" className="mt-1" />
              </div>
            </div>
            <div>
              <Label htmlFor="expected_days">Expected time (days)</Label>
              <Input
                id="expected_days"
                type="number"
                step="0.5"
                min="0"
                name="expected_days"
                defaultValue={defaultDays ? String(defaultDays) : ""}
                placeholder="e.g. 2"
                className="mt-1 w-32"
              />
              {defaultDays ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Estimated {defaultDays} day{defaultDays === 1 ? "" : "s"} from the job size — adjust if needed.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingText="Posting…" confirm="Posted to the board">
                <Megaphone className="size-4" /> Post to board
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
