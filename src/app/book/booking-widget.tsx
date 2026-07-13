"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { PhoneInput } from "@/components/ui/phone-input";
import { cn } from "@/lib/utils";
import {
  APPOINTMENT_COLOR_CLASSES,
  type AppointmentType,
} from "@/lib/types";
import { publicDaySlots, submitBookingRequest, type PublicSlot } from "./actions";

export function BookingWidget({
  types,
  today,
}: {
  types: AppointmentType[];
  today: string;
}) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [slot, setSlot] = useState<PublicSlot | null>(null);
  const [loading, startLoad] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!typeId || !date) return;
    setSlot(null);
    startLoad(async () => {
      setSlots(await publicDaySlots(typeId, date));
    });
  }, [typeId, date]);

  const submit = () =>
    startSubmit(async () => {
      setError(null);
      if (!slot) {
        setError("Please pick a time.");
        return;
      }
      const res = await submitBookingRequest({
        typeId,
        startIso: slot.startIso,
        endIso: slot.endIso,
        name,
        phone,
        email,
        notes,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone(true);
    });

  if (done) {
    return (
      <div className="rounded-lg border bg-emerald-50 p-10 text-center">
        <CheckCircle2 className="mx-auto mb-3 size-10 text-emerald-600" />
        <h2 className="text-lg font-semibold">Request received!</h2>
        <p className="mt-1 text-muted-foreground">
          Thanks, {name.split(" ")[0] || "there"}. We&apos;ll confirm your
          appointment shortly by {phone ? "text or " : ""}email.
        </p>
      </div>
    );
  }

  const selectedType = types.find((t) => t.id === typeId);

  return (
    <div className="space-y-6">
      {/* Type */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">1. What do you need?</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {types.map((t) => {
            const c = APPOINTMENT_COLOR_CLASSES[t.color];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeId(t.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  typeId === t.id
                    ? "border-primary ring-1 ring-primary"
                    : "hover:bg-muted/50",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("size-2.5 rounded-full", c.dot)} />
                  <span className="font-medium">{t.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  about {t.duration_min} minutes
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Date */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">2. Pick a day</h2>
        <DateField
          value={date}
          min={today}
          onChange={(e) => setDate(e.target.value)}
          className="max-w-xs"
        />
      </section>

      {/* Slots */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">3. Pick a time</h2>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Finding open times…
          </p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open times that day — try another date.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((s) => (
              <button
                key={s.startIso}
                type="button"
                onClick={() => setSlot(s)}
                className={cn(
                  "rounded-md border py-2 text-sm transition-colors",
                  slot?.startIso === s.startIso
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Contact */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">4. Your details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <PhoneInput
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="sm:col-span-2"
          />
          <Input
            placeholder="Anything we should know? (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="sm:col-span-2"
          />
        </div>
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button
        onClick={submit}
        disabled={submitting || !slot || !name}
        size="lg"
        className="w-full"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Sending…
          </>
        ) : (
          `Request ${selectedType?.name ?? "appointment"}${
            slot ? ` — ${date} ${slot.label}` : ""
          }`
        )}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        This sends a request. We&apos;ll confirm your exact time shortly.
      </p>
      <p className="text-center text-[11px] leading-snug text-muted-foreground">
        By providing your phone number and requesting an appointment, you agree to
        receive text messages from Cleveland Floor King about your estimate,
        appointment, and installation. Msg &amp; data rates may apply. Msg frequency
        varies. Consent is not a condition of purchase. Reply STOP to opt out, HELP
        for help.
      </p>
    </div>
  );
}
