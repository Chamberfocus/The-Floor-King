"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, Car, MapPin } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { SearchPicker } from "@/components/ui/search-picker";
import { formatDate } from "@/lib/format";
import {
  suggestEstimateTimes,
  bookEstimateAppointment,
} from "./schedule-actions";
import type { EstimateSlot } from "@/lib/data/scheduling";

export function EstimateScheduler({
  customerId,
  autoOpen,
  reps = [],
}: {
  customerId: string;
  autoOpen?: boolean;
  reps?: { id: string; name: string }[];
}) {
  const [slots, setSlots] = useState<EstimateSlot[] | null>(null);
  const [mode, setMode] = useState<"assigned" | "closest">("assigned");
  const [pending, startTransition] = useTransition();
  const [showManual, setShowManual] = useState(false);
  const auto = useRef(false);

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

  // Auto-open suggestions when the customer lands in the trigger stage.
  useEffect(() => {
    if (autoOpen && !auto.current) {
      auto.current = true;
      find("assigned");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  return (
    <Card className={autoOpen ? "ring-2 ring-primary" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4" /> Schedule estimate
          {autoOpen ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Due now
            </span>
          ) : null}
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
                  <SubmitButton
                    size="sm"
                    variant="outline"
                    pendingText="Booking…"
                    confirm="Appointment booked"
                  >
                    Book
                  </SubmitButton>
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

        {/* Manual scheduling */}
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showManual ? "− Hide manual" : "+ Schedule manually"}
          </button>
          {showManual ? (
            <form
              action={bookEstimateAppointment}
              className="mt-2 grid grid-cols-2 gap-2"
            >
              <input type="hidden" name="customer_id" value={customerId} />
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Date
                </label>
                <Input type="date" name="date" required className="h-9" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Time
                </label>
                <Input type="time" name="time" required className="h-9" />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-muted-foreground">
                  Salesperson
                </label>
                <SearchPicker
                  name="salesperson_id"
                  placeholder="— Choose —"
                  options={reps.map((r) => ({ value: r.id, label: r.name }))}
                />
              </div>
              <div className="col-span-2 flex justify-end">
                <SubmitButton
                  size="sm"
                  pendingText="Booking…"
                  confirm="Appointment booked"
                >
                  Book appointment
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
