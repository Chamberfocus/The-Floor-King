"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarOff, Lock, Plus, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/ui/date-field";
import { SegmentedField } from "@/components/ui/segmented-field";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MyAvailabilityBlock } from "@/lib/data/crew-availability";
import {
  addAvailability,
  deleteAvailability,
  type AvailabilityFormState,
} from "./availability-actions";

const initial: AvailabilityFormState = { error: null };

function fmtRange(b: MyAvailabilityBlock): string {
  const days =
    b.start_date === b.end_date
      ? formatDate(b.start_date)
      : `${formatDate(b.start_date)} – ${formatDate(b.end_date)}`;
  if (b.all_day || !b.start_time) return days;
  return `${days} · ${b.start_time}${b.end_time ? `–${b.end_time}` : ""}`;
}

export function MyAvailability({ blocks }: { blocks: MyAvailabilityBlock[] }) {
  const [open, setOpen] = useState(false);
  const [allDay, setAllDay] = useState(true);
  const [isPrivate, setPrivate] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(addAvailability, initial);

  useEffect(() => {
    if (state.ok) {
      toast.success("Availability posted — the office can see it now.");
      setOpen(false);
      setAllDay(true);
      setPrivate(false);
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarOff className="size-4 text-primary" /> My availability
          </CardTitle>
          {!open ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Add time off
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              <X className="size-4" /> Cancel
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Tell the office when you can’t be scheduled. Mark a block{" "}
          <span className="font-medium">private</span> and they’ll only see
          “Unavailable” — never your own job or customer details.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {open ? (
          <form
            ref={formRef}
            action={formAction}
            className="space-y-3 rounded-xl border bg-muted/30 p-3"
          >
            <SegmentedField
              name="kind"
              defaultValue="off"
              options={[
                { value: "off", label: "Time off" },
                { value: "busy", label: "Busy (my own job)" },
              ]}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="start_date">From *</Label>
                <DateField id="start_date" name="start_date" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end_date">To</Label>
                <DateField id="end_date" name="end_date" />
                <p className="text-[11px] text-muted-foreground">
                  Leave blank for a single day.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="all_day"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="size-4 accent-primary"
              />
              All day
            </label>

            {!allDay ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="start_time">Start time</Label>
                  <Input id="start_time" name="start_time" type="time" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_time">End time</Label>
                  <Input id="end_time" name="end_time" type="time" />
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="note">
                Note {isPrivate ? "(kept private)" : "(optional)"}
              </Label>
              <Input
                id="note"
                name="note"
                placeholder={isPrivate ? "Only you can see this" : "e.g. Doctor appointment"}
              />
            </div>

            <label
              className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5 text-sm",
                isPrivate ? "border-primary/40 bg-primary/5" : "",
              )}
            >
              <input
                type="checkbox"
                name="private"
                checked={isPrivate}
                onChange={(e) => setPrivate(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="flex items-center gap-1 font-medium">
                  <Lock className="size-3.5" /> Keep the reason private
                </span>
                <span className="text-xs text-muted-foreground">
                  The office sees only that you’re unavailable — no note, no job
                  or customer details.
                </span>
              </span>
            </label>

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Posting…" : "Post availability"}
            </Button>
          </form>
        ) : null}

        {blocks.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">
            No blocks posted. Add time off so the office doesn’t schedule you when
            you’re out.
          </p>
        ) : (
          <ul className="divide-y">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {fmtRange(b)}
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        b.kind === "busy"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {b.kind === "busy" ? "Busy" : "Time off"}
                    </span>
                    {b.private ? (
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-primary">
                        <Lock className="size-3" /> Private
                      </span>
                    ) : null}
                  </div>
                  {b.note ? (
                    <p className="truncate text-xs text-muted-foreground">{b.note}</p>
                  ) : null}
                </div>
                <form action={deleteAvailability}>
                  <input type="hidden" name="id" value={b.id} />
                  <ConfirmButton
                    title="Remove this block?"
                    description="The office will no longer see you as unavailable for these dates."
                    confirmLabel="Remove"
                    destructive
                    variant="ghost"
                    size="icon"
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
