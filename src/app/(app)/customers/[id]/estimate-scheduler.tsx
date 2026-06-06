"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, Car, MapPin } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import {
  suggestEstimateTimes,
  bookEstimateAppointment,
} from "./schedule-actions";
import type { EstimateSlot } from "@/lib/data/scheduling";

export function EstimateScheduler({ customerId }: { customerId: string }) {
  const [slots, setSlots] = useState<EstimateSlot[] | null>(null);
  const [mode, setMode] = useState<"assigned" | "closest">("assigned");
  const [pending, startTransition] = useTransition();

  const find = (m: "assigned" | "closest") =>
    startTransition(async () => {
      setMode(m);
      const res = await suggestEstimateTimes(customerId, m);
      if (res.error) {
        toast.error(res.error);
        setSlots([]);
        return;
      }
      setSlots(res.slots ?? []);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4" /> Schedule estimate
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "assigned" ? "default" : "outline"}
            disabled={pending}
            onClick={() => find("assigned")}
          >
            {pending && mode === "assigned" ? "Finding…" : "Smart times (their rep)"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "closest" ? "default" : "outline"}
            disabled={pending}
            onClick={() => find("closest")}
          >
            {pending && mode === "closest" ? "Finding…" : "Closest available rep"}
          </Button>
        </div>

        {slots && slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No times found. Check the customer&apos;s address and your work hours
            in Settings → Scheduling.
          </p>
        ) : null}

        {slots && slots.length > 0 ? (
          <div className="space-y-2">
            {slots.map((s, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {formatDate(s.date)} · {s.time}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" /> {s.name}
                    </span>
                    {s.driveText ? (
                      <span className="inline-flex items-center gap-1">
                        <Car className="size-3" /> {s.driveText} from prior stop
                      </span>
                    ) : null}
                  </div>
                </div>
                <form action={bookEstimateAppointment}>
                  <input type="hidden" name="customer_id" value={customerId} />
                  <input type="hidden" name="salesperson_id" value={s.salespersonId} />
                  <input type="hidden" name="date" value={s.date} />
                  <input type="hidden" name="time" value={s.time} />
                  <input type="hidden" name="end_time" value={s.endTime} />
                  <input type="hidden" name="address" value={s.address} />
                  <input
                    type="hidden"
                    name="drive_minutes"
                    value={s.driveMinutes ?? ""}
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Book
                  </Button>
                </form>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Ranked by{" "}
              {mode === "closest"
                ? "least drive time across reps"
                : "soonest, then least drive time"}
              . Times are slotted after each day&apos;s last appointment.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
