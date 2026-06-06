import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronUp, ChevronDown, Navigation, Car } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getDayRoute } from "@/lib/data/scheduling";
import { storeAddress } from "@/lib/maps";
import { formatDate } from "@/lib/format";
import { moveAppointment } from "../actions";

export const metadata: Metadata = { title: "Day route" };

export default async function DayRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string; date?: string }>;
}) {
  const profile = await requireProfile();
  const allowed = ["admin", "office", "sales_manager", "scheduler", "salesman"];
  if (!allowed.includes(profile.role)) redirect("/");

  const { rep, date } = await searchParams;
  if (!rep || !date) redirect("/schedule");

  const route = await getDayRoute(rep, date);
  const withAddr = route.stops.filter((s) => s.address);
  const origin = route.origin || storeAddress();

  // Build Google Maps directions URLs (in route order).
  const enc = encodeURIComponent;
  let navUrl: string | null = null;
  let embedUrl: string | null = null;
  if (withAddr.length) {
    const dest = withAddr[withAddr.length - 1].address as string;
    const mids = withAddr.slice(0, -1).map((s) => s.address as string);
    navUrl =
      `https://www.google.com/maps/dir/?api=1&travelmode=driving` +
      (origin ? `&origin=${enc(origin)}` : "") +
      `&destination=${enc(dest)}` +
      (mids.length ? `&waypoints=${mids.map(enc).join("|")}` : "");
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (key) {
      embedUrl =
        `https://www.google.com/maps/embed/v1/directions?key=${key}&mode=driving` +
        (origin ? `&origin=${enc(origin)}` : "") +
        `&destination=${enc(dest)}` +
        (mids.length ? `&waypoints=${mids.map(enc).join("|")}` : "");
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/schedule"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to schedule
      </Link>
      <PageHeader
        title={`${route.repName} — ${formatDate(date)}`}
        description="Stops in route order. Reorder to optimize, then open the whole route in Google Maps."
      >
        {navUrl ? (
          <a
            href={navUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: "lg" })}
          >
            <Navigation className="size-4" /> Open route in Google Maps
          </a>
        ) : null}
      </PageHeader>

      {route.stops.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No estimates scheduled for this rep on this day.
        </div>
      ) : (
        <div className="space-y-4">
          {embedUrl ? (
            <div className="overflow-hidden rounded-lg border">
              <iframe
                title="Day route map"
                src={embedUrl}
                className="h-72 w-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          ) : (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Add a <code>NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> (Maps Embed API) to
              show the route on a map here. The Google Maps button above already
              works for turn-by-turn navigation.
            </p>
          )}

          <Card>
            <CardContent className="divide-y p-0">
              {origin ? (
                <div className="px-4 py-2 text-xs text-muted-foreground">
                  Start: {origin}
                </div>
              ) : null}
              {route.stops.map((s, i) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-3 text-sm"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {s.time}{" "}
                      <Link
                        href={`/customers/${s.customerId}`}
                        className="hover:underline"
                      >
                        {s.customerName}
                      </Link>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      {s.address ? <span>{s.address}</span> : null}
                      {s.driveMinutes != null ? (
                        <span className="inline-flex items-center gap-1">
                          <Car className="size-3" /> {s.driveMinutes} min
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <form action={moveAppointment}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="dir" value="up" />
                      <input type="hidden" name="rep" value={rep} />
                      <input type="hidden" name="date" value={date} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Move up"
                        disabled={i === 0}
                      >
                        <ChevronUp className="size-3.5" />
                      </Button>
                    </form>
                    <form action={moveAppointment}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="dir" value="down" />
                      <input type="hidden" name="rep" value={rep} />
                      <input type="hidden" name="date" value={date} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Move down"
                        disabled={i === route.stops.length - 1}
                      >
                        <ChevronDown className="size-3.5" />
                      </Button>
                    </form>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
