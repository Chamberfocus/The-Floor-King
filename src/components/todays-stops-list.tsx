"use client";

import Link from "next/link";
import { CalendarClock, Hammer, MapPin } from "lucide-react";
import { OnTheWayButton } from "@/app/(app)/customers/[id]/on-the-way-button";
import type { MyStop } from "@/lib/data/my-stops";

/** Today's estimates + installs for the signed-in rep, each with a one-tap
 *  "on our way" button (reuses the existing notify action + ETA). */
export function TodaysStopsList({ stops }: { stops: MyStop[] }) {
  if (!stops.length) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Nothing on your schedule today.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {stops.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {s.kind === "estimate" ? (
              <CalendarClock className="size-5" />
            ) : (
              <Hammer className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{s.timeLabel}</span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.kind}
              </span>
            </div>
            <Link
              href={`/customers/${s.customerId}`}
              className="font-medium hover:underline"
            >
              {s.customerName}
            </Link>
            {s.address ? (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{s.address}</span>
              </div>
            ) : null}
          </div>
          <OnTheWayButton customerId={s.customerId} />
        </li>
      ))}
    </ul>
  );
}
