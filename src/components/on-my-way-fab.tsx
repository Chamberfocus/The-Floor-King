"use client";

import { useEffect, useState, useTransition } from "react";
import { Truck } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TodaysStopsList } from "@/components/todays-stops-list";
import { fetchMyStopsToday } from "@/app/(app)/on-my-way-actions";
import type { MyStop } from "@/lib/data/my-stops";

/**
 * Floating "On my way" button — visible on every screen for anyone with stops
 * today (sales & crew both). Tap it → a sheet lists today's estimates/installs,
 * each with a one-tap "on our way" (texts/emails the customer + ETA). So a rep
 * never has to open a customer's page to say they're rolling.
 */
export function OnMyWayFab() {
  const [stops, setStops] = useState<MyStop[] | null>(null);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    start(async () => {
      try {
        setStops(await fetchMyStopsToday());
      } catch {
        setStops([]);
      }
    });
    // Load once when the shell mounts.
  }, []);

  if (!stops || stops.length === 0) return null;

  const next = stops.find((s) => s.upcoming) ?? stops[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Tell a customer you're on the way"
        className="fixed bottom-24 left-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5 md:bottom-6 print:hidden"
      >
        <Truck className="size-5" />
        On my way
        <span className="ml-0.5 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs">
          {stops.length}
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto p-5">
          <SheetTitle className="text-lg">Your stops today</SheetTitle>
          <p className="mb-3 text-sm text-muted-foreground">
            Next up: <span className="font-medium text-foreground">{next.customerName}</span>{" "}
            at {next.timeLabel}. Tap “On our way” to text &amp; email the customer
            with your ETA.
          </p>
          <TodaysStopsList stops={stops} />
        </SheetContent>
      </Sheet>
    </>
  );
}
