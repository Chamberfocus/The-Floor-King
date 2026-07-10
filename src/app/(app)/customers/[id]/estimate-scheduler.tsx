"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { DateField } from "@/components/ui/date-field";
import { toast } from "sonner";
import { CalendarClock, Car, MapPin, Route } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate, to12, parseArrivalWindows } from "@/lib/format";
import type { ArrivalWindow } from "@/lib/format";
import {
  suggestEstimateTimes,
  bookEstimateAppointment,
  getArrivalWindows,
} from "./schedule-actions";
import type { EstimateSlot } from "@/lib/data/scheduling";

const fieldCls =
  "h-11 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EstimateScheduler({
  customerId,
  autoOpen,
  reps = [],
  defaultRep = null,
  redirectTo,
}: {
  customerId: string;
  autoOpen?: boolean;
  reps?: { id: string; name: string }[];
  /** The client's assigned salesperson — pre-selected so the estimate is
   *  credited to them by default (still overridable). */
  defaultRep?: string | null;
  /** Where to land after booking (list rows pass their URL to stay put). */
  redirectTo?: string;
}) {
  const [slots, setSlots] = useState<EstimateSlot[] | null>(null);
  const [mode, setMode] = useState<"assigned" | "closest">("assigned");
  const [pending, startTransition] = useTransition();
  const [showManual, setShowManual] = useState(false);
  const [win, setWin] = useState(0);
  const [rep, setRep] = useState(defaultRep ?? "");
  const [windows, setWindows] = useState<ArrivalWindow[]>(() =>
    parseArrivalWindows(null),
  );
  const auto = useRef(false);

  // Load the shop's customizable arrival windows.
  useEffect(() => {
    getArrivalWindows()
      .then((w) => {
        if (w.length) setWindows(w);
      })
      .catch(() => {});
  }, []);

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
                    {formatDate(s.date)} · {to12(s.time)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" /> {s.name}
                    </span>
                    {s.reason ? (
                      <span className="inline-flex items-center gap-1">
                        <Route className="size-3" /> {s.reason}
                      </span>
                    ) : null}
                    {s.addedDriveMinutes != null ? (
                      <span className="inline-flex items-center gap-1">
                        <Car className="size-3" /> adds ~{s.addedDriveMinutes} min
                        {s.addedMiles != null ? ` · ${s.addedMiles} mi` : ""} to the route
                      </span>
                    ) : s.driveText ? (
                      <span className="inline-flex items-center gap-1">
                        <Car className="size-3" /> {s.driveText} from prior stop
                      </span>
                    ) : null}
                  </div>
                </div>
                <form action={bookEstimateAppointment}>
                  <input type="hidden" name="customer_id" value={customerId} />
                  {redirectTo ? (
                    <input type="hidden" name="redirect_to" value={redirectTo} />
                  ) : null}
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
                ? "least added drive & fuel across reps"
                : "soonest, then least added drive"}
              . Each estimate is slotted into the most route-efficient gap in the
              rep&apos;s day — before, between, or after their existing stops.
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
            <form action={bookEstimateAppointment} className="mt-3 space-y-3">
              <input type="hidden" name="customer_id" value={customerId} />
              {redirectTo ? (
                <input type="hidden" name="redirect_to" value={redirectTo} />
              ) : null}
              <input type="hidden" name="time" value={windows[win]?.start ?? ""} />
              <input type="hidden" name="end_time" value={windows[win]?.end ?? ""} />

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Date
                </label>
                <DateField name="date" required className={fieldCls} />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Arrival window
                </label>
                <select
                  value={win}
                  onChange={(e) => setWin(Number(e.target.value))}
                  className={fieldCls}
                >
                  {windows.map((w, i) => (
                    <option key={i} value={i}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Salesperson
                </label>
                <select
                  name="salesperson_id"
                  value={rep}
                  onChange={(e) => setRep(e.target.value)}
                  className={fieldCls}
                >
                  <option value="">— Choose —</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {reps.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-600">
                    No team members yet — add them in Settings → Team.
                  </p>
                ) : null}
              </div>

              <SubmitButton
                className="w-full"
                pendingText="Booking…"
                confirm="Appointment booked"
              >
                Book appointment
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
