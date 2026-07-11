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
 * Post a job to the board with a target window, expected duration, AND who can
 * see it — everyone, or only certain installers. Pre-fills the expected days
 * from the computed install estimate.
 */
export function PostToBoardButton({
  jobId,
  defaultDays,
  installers,
}: {
  jobId: string;
  defaultDays?: number | null;
  installers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<"everyone" | "some">("everyone");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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
              Set the dates you want it done, how long you expect it to take, and who
              can see it.
            </DialogDescription>
          </DialogHeader>
          <form action={postJobToBoard} className="space-y-4">
            <input type="hidden" name="id" value={jobId} />

            {/* Who can see it */}
            <div>
              <Label>Who can see it?</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(
                  [
                    ["everyone", "Everyone"],
                    ["some", "Only certain installers"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAudience(v)}
                    className={`rounded-md border px-2 py-2 text-sm ${
                      audience === v
                        ? "border-primary bg-primary/10 font-medium"
                        : "hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {audience === "some" ? (
                installers.length ? (
                  <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
                    {installers.map((i) => (
                      <label
                        key={i.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          name="installer_ids"
                          value={i.id}
                          checked={picked.has(i.id)}
                          onChange={() => toggle(i.id)}
                          className="size-4 rounded border-input"
                        />
                        {i.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-amber-600">
                    No installers on the team yet — add crew in Settings → Team.
                  </p>
                )
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Any installer can see it and claim it.
                </p>
              )}
            </div>

            {/* When + how long */}
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
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton
                disabled={audience === "some" && picked.size === 0}
                pendingText="Posting…"
                confirm="Posted to the board"
              >
                <Megaphone className="size-4" /> Post to board
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
