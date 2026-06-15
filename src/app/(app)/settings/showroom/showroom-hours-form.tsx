"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveShowroomSettings, type ShowroomState } from "./actions";
import type { ShowroomSettings } from "@/lib/types";

const initial: ShowroomState = { error: null };
const DAYS = [
  { d: 0, label: "Sun" },
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
];

export function ShowroomHoursForm({ settings }: { settings: ShowroomSettings }) {
  const [state, action, pending] = useActionState(saveShowroomSettings, initial);
  const openDays = settings.open_days.split(",").map((s) => parseInt(s, 10));

  useEffect(() => {
    if (state.ok) toast.success("Showroom hours saved.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Open days</label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <label
              key={d.d}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="checkbox"
                name={`day_${d.d}`}
                defaultChecked={openDays.includes(d.d)}
                className="size-4"
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Opens</label>
          <Input type="time" name="day_start" defaultValue={settings.day_start} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Closes</label>
          <Input type="time" name="day_end" defaultValue={settings.day_end} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Slot every (min)</label>
          <Input
            name="slot_interval_min"
            inputMode="numeric"
            defaultValue={String(settings.slot_interval_min)}
          />
          <p className="text-xs text-muted-foreground">
            How granular booking times are (e.g. 30 = on the hour & half hour).
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Concurrent capacity</label>
          <Input
            name="capacity"
            inputMode="numeric"
            defaultValue={String(settings.capacity)}
          />
          <p className="text-xs text-muted-foreground">
            How many appointments the showroom can run at the same time.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Buffer after each (min)</label>
          <Input
            name="buffer_min"
            inputMode="numeric"
            defaultValue={String(settings.buffer_min)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Min booking notice (hours)</label>
          <Input
            name="booking_notice_hours"
            inputMode="numeric"
            defaultValue={String(settings.booking_notice_hours)}
          />
          <p className="text-xs text-muted-foreground">
            Clients can&apos;t request a slot sooner than this.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="booking_enabled"
          defaultChecked={settings.booking_enabled}
          className="size-4"
        />
        Allow clients to request appointments online (public booking page)
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save showroom hours"}
      </Button>
    </form>
  );
}
