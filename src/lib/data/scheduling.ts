import { createClient } from "@/lib/supabase/server";
import {
  nextFreeWindow,
  workDaySet,
  installDaysForJob,
  ymd,
  fromYmd,
  addDaysYmd,
  type DateRange,
} from "@/lib/scheduling";
import { getDriveMatrix, storeAddress } from "@/lib/maps";
import type { EstimateLineItem, SchedulingSettings } from "@/lib/types";
import { DEFAULT_ARRIVAL_WINDOWS, to12 } from "@/lib/format";

const CAP_KEYS = [
  "cap_carpet_yd",
  "cap_lvt_sf",
  "cap_laminate_sf",
  "cap_hardwood_sf",
  "cap_tile_teardown_sf",
  "cap_subfloor_sheets",
  "cap_selflevel_sf",
] as const;

/** Merge global settings with an installer's non-null overrides. */
function mergeInstaller(
  global: SchedulingSettings,
  ov: Record<string, unknown> | undefined,
): SchedulingSettings {
  if (!ov) return global;
  const merged = { ...global };
  if (ov.work_days) merged.work_days = ov.work_days as string;
  for (const k of CAP_KEYS) {
    if (ov[k] != null) (merged as Record<string, unknown>)[k] = ov[k];
  }
  return merged;
}

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
  default_origin: null,
  arrival_windows: DEFAULT_ARRIVAL_WINDOWS,
  updated_at: "",
};

/** The shop / default starting address (settings value, else the env shop). */
export function defaultOrigin(settings: SchedulingSettings): string {
  return settings.default_origin?.trim() || storeAddress();
}

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
  days: number;
  start: string;
  end: string;
}

/**
 * Earliest window per installer for a job — each installer is sized with THEIR
 * own daily capacities and work days (falling back to the shop defaults).
 */
export async function getInstallerSuggestions(
  lines: EstimateLineItem[],
  global: SchedulingSettings,
  fromDate?: string,
): Promise<InstallerSuggestion[]> {
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

  const { data: ovRows } = await supabase
    .from("installer_settings")
    .select("*")
    .in("installer_id", ids);
  const overrides = new Map<string, Record<string, unknown>>();
  for (const r of ovRows ?? [])
    overrides.set(r.installer_id as string, r as Record<string, unknown>);

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
  const out: InstallerSuggestion[] = [];
  for (const inst of installers) {
    const settings = mergeInstaller(global, overrides.get(inst.id));
    const days = installDaysForJob(lines, settings).days;
    if (days <= 0) continue;
    const win = nextFreeWindow(
      booked.get(inst.id) ?? [],
      workDaySet(settings),
      days,
      from,
    );
    if (win)
      out.push({
        installerId: inst.id,
        name: inst.full_name || inst.email,
        days,
        start: win.start,
        end: win.end,
      });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.days - b.days);
}

export interface InstallerSettingsRow {
  installer_id: string;
  work_days: string | null;
  cap_carpet_yd: number | null;
  cap_lvt_sf: number | null;
  cap_laminate_sf: number | null;
  cap_hardwood_sf: number | null;
  cap_tile_teardown_sf: number | null;
  cap_subfloor_sheets: number | null;
  cap_selflevel_sf: number | null;
}

/** All crew members with their capacity overrides (for the settings screen). */
export async function listInstallerSettings(): Promise<
  {
    id: string;
    name: string;
    settings: InstallerSettingsRow | null;
  }[]
> {
  const supabase = await createClient();
  const { data: insts } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "crew")
    .order("full_name", { ascending: true });
  const crew = (insts ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
  }[];
  if (!crew.length) return [];
  const { data: ov } = await supabase
    .from("installer_settings")
    .select("*")
    .in(
      "installer_id",
      crew.map((c) => c.id),
    );
  const map = new Map<string, InstallerSettingsRow>();
  for (const r of ov ?? []) map.set(r.installer_id as string, r as InstallerSettingsRow);
  return crew.map((c) => ({
    id: c.id,
    name: c.full_name || c.email,
    settings: map.get(c.id) ?? null,
  }));
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
  driveMinutes: number | null; // drive from the prior stop (arrival leg)
  driveText: string | null;
  addedDriveMinutes: number | null; // detour this appointment adds to the route
  addedMiles: number | null; // extra miles added (fuel proxy)
  reason: string | null; // why it's placed here, e.g. "Between your 10 AM & 1 PM stops"
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

  // Full existing stops per rep/day (start, end, address) — the route we insert into.
  const byRepDay = new Map<string, DayStop[]>();
  for (const a of appts ?? []) {
    const st = a.starts_at as string;
    const date = st.slice(0, 10);
    const startMin = parseHM(st.slice(11, 16));
    const en = (a.ends_at as string) || "";
    const endMin = en ? parseHM(en.slice(11, 16)) : startMin + dur;
    const k = `${a.salesperson_id}|${date}`;
    const arr = byRepDay.get(k) ?? [];
    arr.push({ startMin, endMin, address: (a.address as string) || null });
    byRepDay.set(k, arr);
  }

  // Score every rep×day in parallel: find the lowest-detour place to slot the new
  // estimate that day (before the first stop, between two stops, or end-of-day
  // back home) — one Distance Matrix call each.
  const pairs: { rep: (typeof reps)[number]; date: string }[] = [];
  for (const rep of reps) for (const date of days) pairs.push({ rep, date });

  const results = await Promise.all(
    pairs.map(async ({ rep, date }): Promise<EstimateSlot | null> => {
      const home = rep.home_address || defaultOrigin(settings);
      const stops = (byRepDay.get(`${rep.id}|${date}`) ?? []).sort(
        (a, b) => a.startMin - b.startMin,
      );
      const best = await bestInsertion({
        destination: customerAddress,
        home,
        stops,
        dayStart,
        dayEnd,
        dur,
        buffer,
      });
      if (!best) return null;
      return {
        salespersonId: rep.id,
        name: rep.full_name || rep.email,
        date,
        time: toHM(best.startMin),
        endTime: toHM(best.startMin + dur),
        address: customerAddress,
        driveMinutes: best.arriveDrive,
        driveText:
          best.arriveDrive != null ? `${best.arriveDrive} min drive` : null,
        addedDriveMinutes: best.detour,
        addedMiles: best.miles,
        reason: best.reason,
      };
    }),
  );
  const slots = results.filter((s): s is EstimateSlot => s !== null);

  slots.sort((a, b) => {
    if (mode === "closest") {
      const da = a.addedDriveMinutes ?? 9999;
      const db = b.addedDriveMinutes ?? 9999;
      if (da !== db) return da - db;
      return `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
    }
    const cmp = `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
    if (cmp !== 0) return cmp;
    return (a.addedDriveMinutes ?? 9999) - (b.addedDriveMinutes ?? 9999);
  });
  return slots.slice(0, 6);
}

interface DayStop {
  startMin: number;
  endMin: number;
  address: string | null;
}

/**
 * Find the most fuel/route-efficient place to slot a `dur`-minute estimate into
 * ONE rep's day. Considers inserting before the first stop, between any two
 * stops, or after the last stop (returning home); an empty day is a fresh round
 * trip. Ranks by the drive detour ADDED to the route (least added minutes wins);
 * with no Maps key it falls back to the earliest time. Returns the winning
 * placement, or null if nothing fits the work hours. One Distance Matrix call.
 */
async function bestInsertion(opts: {
  destination: string;
  home: string;
  stops: DayStop[];
  dayStart: number;
  dayEnd: number;
  dur: number;
  buffer: number;
}): Promise<{
  startMin: number;
  arriveDrive: number | null;
  detour: number | null;
  miles: number | null;
  reason: string | null;
} | null> {
  const { destination, home, stops, dayStart, dayEnd, dur, buffer } = opts;

  // One call: drive from the new stop to home + each existing stop's address.
  const anchors = [home, ...stops.map((s) => s.address || home)];
  const matrix = await getDriveMatrix(destination, anchors);
  const dHome = matrix[0];
  const dStop = (i: number) => matrix[i + 1];
  // Realistic travel gap between two stops = the real drive (never below the buffer).
  const gap = (m: { minutes: number } | null) =>
    m ? Math.max(buffer, m.minutes) : buffer;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const clock = (min: number) => to12(toHM(min));

  type C = {
    startMin: number;
    arriveDrive: number | null;
    detour: number | null;
    miles: number | null;
    reason: string | null;
  };
  const cands: C[] = [];

  if (stops.length === 0) {
    if (dayStart + dur <= dayEnd) {
      cands.push({
        startMin: dayStart,
        arriveDrive: dHome?.minutes ?? null,
        detour: dHome ? dHome.minutes * 2 : null,
        miles: dHome ? round1(dHome.miles * 2) : null,
        reason: "Only stop that day",
      });
    }
  } else {
    // Before the first stop.
    const first = stops[0];
    if (dayStart + dur + gap(dStop(0)) <= first.startMin && dayStart + dur <= dayEnd) {
      const a = dHome;
      const b = dStop(0);
      cands.push({
        startMin: dayStart,
        arriveDrive: a?.minutes ?? null,
        detour: a && b ? a.minutes + b.minutes : null,
        miles: a && b ? round1(a.miles + b.miles) : null,
        reason: `Before your ${clock(first.startMin)} stop`,
      });
    }
    // Between two stops.
    for (let i = 0; i < stops.length - 1; i++) {
      const prev = stops[i];
      const next = stops[i + 1];
      const arrive = prev.endMin + gap(dStop(i));
      const leave = arrive + dur + gap(dStop(i + 1));
      if (arrive + dur <= dayEnd && leave <= next.startMin) {
        const a = dStop(i);
        const b = dStop(i + 1);
        cands.push({
          startMin: arrive,
          arriveDrive: a?.minutes ?? null,
          detour: a && b ? a.minutes + b.minutes : null,
          miles: a && b ? round1(a.miles + b.miles) : null,
          reason: `Between your ${clock(prev.startMin)} & ${clock(next.startMin)} stops`,
        });
      }
    }
    // After the last stop (then back home).
    const last = stops[stops.length - 1];
    const arriveLast = last.endMin + gap(dStop(stops.length - 1));
    if (arriveLast + dur <= dayEnd) {
      const a = dStop(stops.length - 1);
      const b = dHome;
      cands.push({
        startMin: arriveLast,
        arriveDrive: a?.minutes ?? null,
        detour: a && b ? a.minutes + b.minutes : null,
        miles: a && b ? round1(a.miles + b.miles) : null,
        reason: `After your ${clock(last.startMin)} stop`,
      });
    }
  }

  if (!cands.length) return null;
  cands.sort((x, y) => {
    const dx = x.detour ?? Infinity;
    const dy = y.detour ?? Infinity;
    if (dx !== dy) return dx - dy;
    return x.startMin - y.startMin;
  });
  return cands[0];
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

export interface CustomerAppointment {
  id: string;
  startsAt: string; // ISO
  address: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
}

/**
 * The customer's soonest still-scheduled estimate appointment, so the guided
 * flow can show "booked for …" instead of nagging to schedule. Prefers an
 * upcoming one; falls back to the most recent if all are in the past.
 */
export async function getCustomerEstimateAppointment(
  customerId: string,
): Promise<CustomerAppointment | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, address, salesperson_id, status, kind, is_block")
    .eq("customer_id", customerId)
    .eq("status", "scheduled")
    .order("starts_at", { ascending: true });
  const rows = (data ?? []).filter(
    (a) => a.kind !== "block" && !a.is_block,
  );
  if (!rows.length) return null;
  const nowIso = new Date().toISOString();
  const upcoming = rows.find((a) => (a.starts_at as string) >= nowIso);
  const pick = upcoming ?? rows[rows.length - 1];

  let salespersonName: string | null = null;
  if (pick.salesperson_id) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", pick.salesperson_id)
      .maybeSingle();
    salespersonName = (p?.full_name as string) ?? null;
  }
  return {
    id: pick.id as string,
    startsAt: pick.starts_at as string,
    address: (pick.address as string) ?? null,
    salespersonId: (pick.salesperson_id as string) ?? null,
    salespersonName,
  };
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

export interface RouteStop {
  id: string;
  time: string;
  seq: number;
  customerId: string;
  customerName: string;
  address: string | null;
  driveMinutes: number | null;
}
export interface DayRoute {
  repName: string;
  origin: string;
  stops: RouteStop[];
}

/** One rep's appointments for a day, in route order (seq, then time). */
export async function getDayRoute(
  repId: string,
  date: string,
): Promise<DayRoute> {
  const supabase = await createClient();
  const settings = await getSchedulingSettings();
  const { data: rep } = await supabase
    .from("profiles")
    .select("full_name, email, home_address")
    .eq("id", repId)
    .maybeSingle();
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, seq, address, drive_minutes, customer:customers(id, full_name)")
    .eq("salesperson_id", repId)
    .eq("status", "scheduled")
    .gte("starts_at", `${date}T00:00:00Z`)
    .lte("starts_at", `${date}T23:59:59Z`)
    .order("seq", { ascending: true })
    .order("starts_at", { ascending: true });
  const stops: RouteStop[] = (data ?? []).map((a) => {
    const c = a.customer as unknown as { id: string; full_name: string } | null;
    return {
      id: a.id as string,
      time: (a.starts_at as string).slice(11, 16),
      seq: (a.seq as number) ?? 0,
      customerId: c?.id ?? "",
      customerName: c?.full_name ?? "Customer",
      address: (a.address as string) ?? null,
      driveMinutes: (a.drive_minutes as number) ?? null,
    };
  });
  return {
    repName: (rep?.full_name as string) || (rep?.email as string) || "Rep",
    origin: (rep?.home_address as string) || defaultOrigin(settings),
    stops,
  };
}
