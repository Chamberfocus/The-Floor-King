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
import { CalendarBoard } from "./calendar-board";

export const metadata: Metadata = { title: "Calendar" };

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
  const d = new Date(`${s}T12:00:00+00`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function startOfWeek(s: string): string {
  const d = new Date(`${s}T12:00:00+00`);
  return addDays(s, -d.getUTCDay()); // back to Sunday
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; rep?: string }>;
}) {
  const profile = await requireProfile();
  if (!STAFF_ROLES.includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const view = sp.view === "day" ? "day" : "week";
  const today = ymd(new Date());
  const anchor = sp.date || today;
  const repFilter = sp.rep || "";

  const days =
    view === "day"
      ? [anchor]
      : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));

  const rangeStart = `${days[0]}T00:00:00+00`;
  const rangeEnd = `${addDays(days[days.length - 1], 1)}T00:00:00+00`;

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
        title="Booking calendar"
        description="Showroom appointments and in-home estimates. Book, reschedule, and confirm client requests."
      />
      <CalendarBoard
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
      />
    </div>
  );
}
