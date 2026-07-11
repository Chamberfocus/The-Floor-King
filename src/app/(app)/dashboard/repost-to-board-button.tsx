"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { repostJobToBoard } from "@/app/(app)/jobs/actions";

/**
 * Repost a scheduled install to the board from the dashboard, choosing who can
 * see it — everyone, or only certain installers. Clears the fallen-through
 * installer and reopens it (keeping the scheduled date as the target).
 */
export function RepostToBoardButton({
  jobId,
  installers,
}: {
  jobId: string;
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
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Megaphone className="size-3.5" /> Repost to board
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Repost to the job board</DialogTitle>
            <DialogDescription>
              The current installer is cleared and the job goes back on the board.
              Choose who can see it.
            </DialogDescription>
          </DialogHeader>
          <form action={repostJobToBoard} className="space-y-4">
            <input type="hidden" name="id" value={jobId} />
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
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton
                disabled={audience === "some" && picked.size === 0}
                pendingText="Reposting…"
                confirm="Reposted to the board"
              >
                <Megaphone className="size-4" /> Repost
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
