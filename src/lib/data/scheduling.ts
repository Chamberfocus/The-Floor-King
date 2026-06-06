import { createClient } from "@/lib/supabase/server";
import {
  nextFreeWindow,
  workDaySet,
  ymd,
  fromYmd,
  addDaysYmd,
  type DateRange,
} from "@/lib/scheduling";
import { getDriveTime, storeAddress } from "@/lib/maps";
import type { SchedulingSettings } from "@/lib/types";

const DEFAULTS: SchedulingSettings = {
  id: "default",
  work_days: "1,2,3,4,5,6",
  day_start: "09:00",
  day_end: "17:00",
  estimate_duration_min: 60,
  travel_buffer_min: 30,
  cap_carpet_yd: 100,
  cap_lvt_sf: 250,
  cap_laminate_sf: 250,
  cap_hardwood_sf: 175,
  cap_tile_teardown_sf: 100,
  cap_subfloor_sheets: 10,
  cap_selflevel_sf: 600,
  updated_at: "",
};

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("scheduling_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  return { ...DEFAULTS, ...(data ?? {}) } as SchedulingSettings;
}

export interface InstallerSuggestion {
  installerId: string;
  name: string;
  start: string;
  end: string;
}

/** Earliest available window per installer for a job needing `daysNeeded` days. */
export async function getInstallerSuggestions(
  daysNeeded: number,
  settings: SchedulingSettings,
  fromDate?: string,
): Promise<InstallerSuggestion[]> {
  if (daysNeeded <= 0) return [];
  const supabase = await createClient();
  const { data: insts } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "crew");
  const installers = (insts ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
  }[];
  if (!installers.length) return [];

  const ids = installers.map((i) => i.id);
  const { data: jobs } = await supabase
    .from("jobs")
    .select("assigned_to, scheduled_date, scheduled_end")
    .in("assigned_to", ids)
    .not("scheduled_date", "is", null);
  const booked = new Map<string, DateRange[]>();
  for (const j of jobs ?? []) {
    const who = j.assigned_to as string;
    const start = j.scheduled_date as string;
    const end = (j.scheduled_end as string) || start;
    const arr = booked.get(who) ?? [];
    arr.push({ start, end });
    booked.set(who, arr);
  }

  const from = fromDate ?? ymd(new Date());
  const workDays = workDaySet(settings);
  const out: InstallerSuggestion[] = [];
  for (const inst of installers) {
    const win = nextFreeWindow(
      booked.get(inst.id) ?? [],
      workDays,
      daysNeeded,
      from,
    );
    if (win)
      out.push({
        installerId: inst.id,
        name: inst.full_name || inst.email,
        start: win.start,
        end: win.end,
      });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// --- Estimate appointment suggestions (geo-aware) ----------------------------
function parseHM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function toHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface EstimateSlot {
  salespersonId: string;
  name: string;
  date: string;
  time: string;
  endTime: string;
  address: string;
  driveMinutes: number | null;
  driveText: string | null;
}

/**
 * Suggest estimate slots for a customer. "assigned" routes the designated
 * salesperson's next open days; "closest" scans reps and ranks by drive time
 * from each rep's prior stop that day (gas + time efficient).
 */
export async function getEstimateSuggestions(
  customerId: string,
  mode: "assigned" | "closest",
): Promise<EstimateSlot[]> {
  const supabase = await createClient();
  const { data: cust } = await supabase
    .from("customers")
    .select("street, city, state, zip, assigned_to, workflow_owner_id")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust) return [];
  const customerAddress = [
    cust.street,
    [cust.city, cust.state].filter(Boolean).join(", "),
    cust.zip,
  ]
    .filter(Boolean)
    .join(" ");
  if (!customerAddress) return [];

  const settings = await getSchedulingSettings();
  const workDays = workDaySet(settings);
  const dur = settings.estimate_duration_min;
  const buffer = settings.travel_buffer_min;
  const dayStart = parseHM(settings.day_start);
  const dayEnd = parseHM(settings.day_end);

  const designated =
    (cust.assigned_to as string) || (cust.workflow_owner_id as string) || null;
  let reps: {
    id: string;
    full_name: string | null;
    email: string;
    home_address: string | null;
  }[] = [];
  if (mode === "assigned" && designated) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, home_address")
      .eq("id", designated);
    reps = (data ?? []) as typeof reps;
  }
  if (!reps.length) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, home_address")
      .in("role", ["salesman", "sales_manager", "office", "admin"]);
    reps = (data ?? []) as typeof reps;
  }
  if (!reps.length) return [];
  if (mode === "closest") reps = reps.slice(0, 5);

  const today = ymd(new Date());
  const numDays = mode === "assigned" ? 7 : 3;
  const days: string[] = [];
  let cur = today;
  for (let i = 0; i < 30 && days.length < numDays; i++) {
    if (workDays.has(fromYmd(cur).getUTCDay())) days.push(cur);
    cur = addDaysYmd(cur, 1);
  }

  const repIds = reps.map((r) => r.id);
  const windowEnd = days[days.length - 1] ?? today;
  const { data: appts } = await supabase
    .from("appointments")
    .select("salesperson_id, starts_at, ends_at, address")
    .in("salesperson_id", repIds)
    .eq("status", "scheduled")
    .gte("starts_at", `${today}T00:00:00Z`)
    .lte("starts_at", `${windowEnd}T23:59:59Z`);
  const byRepDay = new Map<string, { endMin: number; address: string | null }[]>();
  for (const a of appts ?? []) {
    const st = a.starts_at as string;
    const date = st.slice(0, 10);
    const startMin = parseHM(st.slice(11, 16));
    const en = (a.ends_at as string) || "";
    const endMin = en ? parseHM(en.slice(11, 16)) : startMin + dur;
    const k = `${a.salesperson_id}|${date}`;
    const arr = byRepDay.get(k) ?? [];
    arr.push({ endMin, address: (a.address as string) || null });
    byRepDay.set(k, arr);
  }

  const slots: EstimateSlot[] = [];
  for (const rep of reps) {
    for (const date of days) {
      const dayAppts = (byRepDay.get(`${rep.id}|${date}`) ?? []).sort(
        (a, b) => a.endMin - b.endMin,
      );
      let startMin = dayStart;
      // First stop of the day starts from the rep's home base (or the shop).
      let priorAddr = rep.home_address || storeAddress();
      if (dayAppts.length) {
        const last = dayAppts[dayAppts.length - 1];
        startMin = last.endMin + buffer;
        priorAddr = last.address || storeAddress();
      }
      if (startMin + dur > dayEnd) continue;
      const drive = await getDriveTime(customerAddress, priorAddr || undefined);
      slots.push({
        salespersonId: rep.id,
        name: rep.full_name || rep.email,
        date,
        time: toHM(startMin),
        endTime: toHM(startMin + dur),
        address: customerAddress,
        driveMinutes: drive?.minutes ?? null,
        driveText: drive?.text ?? null,
      });
    }
  }

  slots.sort((a, b) => {
    if (mode === "closest") {
      const da = a.driveMinutes ?? 9999;
      const db = b.driveMinutes ?? 9999;
      if (da !== db) return da - db;
      return `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
    }
    const cmp = `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
    if (cmp !== 0) return cmp;
    return (a.driveMinutes ?? 9999) - (b.driveMinutes ?? 9999);
  });
  return slots.slice(0, 6);
}

export interface AppointmentRow {
  id: string;
  date: string;
  time: string;
  customerId: string;
  customerName: string;
  salespersonId: string | null;
  address: string | null;
  driveMinutes: number | null;
}

/** Upcoming estimate appointments (today forward), time-ordered. */
export async function listUpcomingAppointments(): Promise<AppointmentRow[]> {
  const supabase = await createClient();
  const today = ymd(new Date());
  const { data } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, salesperson_id, address, drive_minutes, customer:customers(id, full_name)",
    )
    .eq("status", "scheduled")
    .gte("starts_at", `${today}T00:00:00Z`)
    .order("starts_at", { ascending: true });
  return (data ?? []).map((a) => {
    const c = a.customer as unknown as { id: string; full_name: string } | null;
    const st = a.starts_at as string;
    return {
      id: a.id as string,
      date: st.slice(0, 10),
      time: st.slice(11, 16),
      customerId: c?.id ?? "",
      customerName: c?.full_name ?? "Customer",
      salespersonId: (a.salesperson_id as string) ?? null,
      address: (a.address as string) ?? null,
      driveMinutes: (a.drive_minutes as number) ?? null,
    };
  });
}
