import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Car, MapPin, User } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listUpcomingAppointments } from "@/lib/data/scheduling";
import { getProfileNames } from "@/lib/data/customers";
import { formatDate, to12 } from "@/lib/format";

export const metadata: Metadata = { title: "Estimate Schedule" };

export default async function SchedulePage() {
  const profile = await requireProfile();
  const allowed = ["admin", "office", "sales_manager", "scheduler", "salesman"];
  if (!allowed.includes(profile.role)) redirect("/");

  const appts = await listUpcomingAppointments();
  const repNames = await getProfileNames(
    appts.map((a) => a.salespersonId ?? "").filter(Boolean),
  );

  // Group by date (rows already time-ordered).
  const byDate = new Map<string, typeof appts>();
  for (const a of appts) {
    const arr = byDate.get(a.date) ?? [];
    arr.push(a);
    byDate.set(a.date, arr);
  }
  const dates = Array.from(byDate.keys());

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Estimate Schedule"
        description="Upcoming estimate appointments, in route order for each day."
      />
      {appts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No estimates scheduled yet. Book one from a customer&apos;s file.
        </div>
      ) : (
        <div className="space-y-6">
          {dates.map((date) => (
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
                              <Car className="size-3" /> {a.driveMinutes} min
                              drive
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
      )}
    </div>
  );
}
