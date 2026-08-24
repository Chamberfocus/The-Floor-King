import Link from "next/link";
import { Car, MapPin, User, CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, to12 } from "@/lib/format";
import type { AppointmentRow } from "@/lib/data/scheduling";

/**
 * "What's coming up, in route order" — the list that used to be its own nav
 * destination at /schedule, competing with the calendar for the same
 * appointments. It's a genuinely useful way to read the week, so it survives as
 * a VIEW of the calendar rather than a second place to look.
 */
export function CalendarAgenda({
  appointments,
  repNames,
}: {
  appointments: AppointmentRow[];
  repNames: Record<string, string>;
}) {
  if (!appointments.length) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nothing booked yet"
        description="Book an estimate from a customer's file, or add an appointment above."
      />
    );
  }

  // Group by date; rows arrive already time-ordered.
  const byDate = new Map<string, AppointmentRow[]>();
  for (const a of appointments) {
    const arr = byDate.get(a.date) ?? [];
    arr.push(a);
    byDate.set(a.date, arr);
  }

  return (
    <div className="space-y-6">
      {Array.from(byDate.keys()).map((date) => (
        <section key={date}>
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
            {formatDate(date)}
          </h2>
          <Card>
            <CardContent className="divide-y p-0">
              {byDate.get(date)!.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {to12(a.time)}{" "}
                      <Link
                        href={`/customers/${a.customerId}`}
                        className="hover:underline"
                      >
                        {a.customerName}
                      </Link>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      {a.salespersonId && repNames[a.salespersonId] ? (
                        <span className="inline-flex items-center gap-1">
                          <User className="size-3" />
                          {repNames[a.salespersonId]}
                        </span>
                      ) : null}
                      {a.address ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" /> {a.address}
                        </span>
                      ) : null}
                      {a.driveMinutes != null ? (
                        <span className="inline-flex items-center gap-1">
                          <Car className="size-3" /> {a.driveMinutes} min drive
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {a.salespersonId ? (
                    <Link
                      href={`/schedule/route?rep=${a.salespersonId}&date=${a.date}`}
                      className="shrink-0 text-xs text-primary hover:underline"
                    >
                      View route →
                    </Link>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}
