"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addJobLine, updateJobLine, removeJobLine } from "./scope-actions";

export interface ScopeLine {
  id: string;
  description: string | null;
  room: string | null;
  sqft: number | null;
  quantity: number | null;
  unit: string | null;
  note: string | null;
}

/**
 * Edit what the crew is actually doing.
 *
 * Changes the WORK ORDER only — the customer's approved estimate is untouched.
 * That's the point: a measurement comes up a closet short, there's a second
 * layer of subfloor, a room gets dropped. The work order has to say what's
 * really happening, and the signed quote has to stay as signed.
 */
export function EditScope({
  jobId,
  lines,
}: {
  jobId: string;
  lines: ScopeLine[];
}) {
  const [editing, setEditing] = useState<ScopeLine | null>(null);
  const [adding, setAdding] = useState(false);

  const fields = (l?: ScopeLine) => (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground">What is it?</label>
          <Input name="description" defaultValue={l?.description ?? ""} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Room / area</label>
          <Input name="room" defaultValue={l?.room ?? ""} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Sq ft</label>
            <Input
              name="sqft"
              inputMode="decimal"
              defaultValue={l?.sqft != null ? String(l.sqft) : ""}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Qty</label>
            <Input
              name="quantity"
              inputMode="decimal"
              defaultValue={l?.quantity != null ? String(l.quantity) : ""}
            />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground">
            Note for the crew
          </label>
          <Input
            name="note"
            defaultValue={l?.note ?? ""}
            placeholder="e.g. second layer under the vinyl — allow extra time"
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        This changes the work order only. The customer&apos;s approved estimate
        stays exactly as it was signed.
      </p>
    </>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">What we&apos;re doing</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> Add a line
        </Button>
      </div>

      <ul className="divide-y rounded-lg border">
        {lines.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">
            Nothing on this work order yet.
          </li>
        ) : (
          lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">{l.description || "Line"}</div>
                <div className="text-xs text-muted-foreground">
                  {[
                    l.room,
                    l.sqft != null ? `${l.sqft} sq ft` : null,
                    l.quantity != null ? `${l.quantity} ${l.unit ?? ""}`.trim() : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {l.note ? (
                  <div className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    {l.note}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(l)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <form action={removeJobLine}>
                  <input type="hidden" name="job_id" value={jobId} />
                  <input type="hidden" name="line_id" value={l.id} />
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    title="Remove this from the work order?"
                    description="The customer's estimate keeps its copy — this only takes it off what the crew is doing."
                    confirmLabel="Remove it"
                    destructive
                  >
                    <Trash2 className="size-3.5" />
                  </ConfirmButton>
                </form>
              </div>
            </li>
          ))
        )}
      </ul>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit this line</DialogTitle>
            <DialogDescription>What the crew is actually doing here.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <form action={updateJobLine}>
              <input type="hidden" name="job_id" value={jobId} />
              <input type="hidden" name="line_id" value={editing.id} />
              {fields(editing)}
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <SubmitButton size="sm" confirm="Work order updated">
                  Save
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to the work order</DialogTitle>
            <DialogDescription>
              Something the estimate didn&apos;t have — the extra closet, the
              second layer, the room they added on the day.
            </DialogDescription>
          </DialogHeader>
          <form action={addJobLine}>
            <input type="hidden" name="job_id" value={jobId} />
            {fields()}
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <SubmitButton size="sm" confirm="Added to the work order">
                Add it
              </SubmitButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
