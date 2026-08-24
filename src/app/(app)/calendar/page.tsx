import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import {
  listAppointmentsRange,
  listAppointmentTypes,
  listBookingStaff,
  listPendingRequests,
  getShowroomSettings,
} from "@/lib/data/booking";
import { listUpcomingAppointments } from "@/lib/data/scheduling";
import { getProfileNames } from "@/lib/data/customers";
import { CalendarClient } from "./calendar-client";
import { CalendarAgenda } from "./agenda";

export const metadata: Metadata = { title: "Booking Calendar" };

const STAFF_ROLES = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(s: string, n: number): string {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function startOfWeek(s: string): string {
  const d = new Date(`${s}T12:00:00Z`);
  return addDays(s, -d.getUTCDay()); // back to Sunday
}
/** The full month grid for `anchor`: whole weeks (Sun→Sat) covering the month,
 *  including the trailing/leading days needed to fill the first & last rows. */
function monthGridDays(anchor: string): string[] {
  const d = new Date(`${anchor}T12:00:00Z`);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1, 12));
  const gridStart = addDays(ymd(first), -first.getUTCDay());
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  const cells = Math.ceil((first.getUTCDay() + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDays(gridStart, i));
}

// Lets Next's redirect()/notFound() keep working when we wrap everything in
// a try/catch (they signal via a throw with a NEXT_ digest).
function isControlFlow(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "digest" in e &&
    typeof (e as { digest?: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_")
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; rep?: string }>;
}) {
  try {
    const profile = await requireProfile();
    if (!STAFF_ROLES.includes(profile.role)) redirect("/");

    const sp = await searchParams;
    const view =
      sp.view === "day"
        ? "day"
        : sp.view === "month"
          ? "month"
          : sp.view === "agenda"
            ? "agenda"
            : "week";
    const today = ymd(new Date());
    const anchor = sp.date || today;
    const repFilter = sp.rep || "";

    const days =
      view === "day" || view === "agenda"
        ? [anchor]
        : view === "month"
          ? monthGridDays(anchor)
          : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));

    const rangeStart = `${days[0]}T00:00:00+00`;
    const rangeEnd = `${addDays(days[days.length - 1], 1)}T00:00:00+00`;

    // The Agenda view runs from today forward rather than over the visible
    // range, so it fetches its own rows (and the rep names it prints).
    const upcoming =
      view === "agenda" ? await listUpcomingAppointments() : [];
    const agendaRepNames =
      view === "agenda"
        ? await getProfileNames(
            upcoming.map((a) => a.salespersonId ?? "").filter(Boolean),
          )
        : {};

    const [appointments, types, staff, pending, settings] = await Promise.all([
      listAppointmentsRange(rangeStart, rangeEnd),
      listAppointmentTypes({ activeOnly: true }),
      listBookingStaff(),
      listPendingRequests(),
      getShowroomSettings(),
    ]);

    return (
      <div>
        <PageHeader
          title="Booking Calendar"
          description="Showroom appointments and in-home estimates. Book, reschedule, and confirm customer requests."
        />
        <CalendarClient
          view={view}
          anchor={anchor}
          today={today}
          days={days}
          repFilter={repFilter}
          appointments={appointments}
          types={types}
          staff={staff}
          pending={pending}
          settings={{
            dayStart: settings.day_start,
            dayEnd: settings.day_end,
            interval: settings.slot_interval_min,
            capacity: settings.capacity,
            openDays: settings.open_days,
          }}
          agenda={
            view === "agenda" ? (
              <CalendarAgenda appointments={upcoming} repNames={agendaRepNames} />
            ) : null
          }
        />
      </div>
    );
  } catch (e) {
    if (isControlFlow(e)) throw e; // let redirect()/notFound() through
    const msg = e instanceof Error ? `${e.message}` : String(e);
    const stack = e instanceof Error && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : "";
    return (
      <div>
        <PageHeader title="Booking Calendar" />
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            The calendar couldn&apos;t load.
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
            {msg}
          </p>
          {stack ? (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground/80">
              {stack}
            </pre>
          ) : null}
        </div>
      </div>
    );
  }
}
