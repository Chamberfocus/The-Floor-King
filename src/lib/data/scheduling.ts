import { createClient } from "@/lib/supabase/server";
import {
  nextFreeWindow,
  workDaySet,
  installDaysForJob,
  chooseEstimateInsertion,
  estimateDayWindow,
  ymd,
  fromYmd,
  addDaysYmd,
  type DateRange,
  type InsertionStop,
} from "@/lib/scheduling";
import { getDriveTable, storeAddress } from "@/lib/maps";
import { crewFitLabel, installerCanDoJob, jobMaterialType } from "@/lib/job-scope";
import { listInstallCrews } from "@/lib/data/install-crews";
import { getOverrides, getShiftsMap, listTimeOff } from "@/lib/data/team-schedule";
import { INSTALL_ROLES, type EstimateLineItem, type SchedulingSettings } from "@/lib/types";
import { DEFAULT_ARRIVAL_WINDOWS } from "@/lib/format";

const CAP_KEYS = [
  "cap_carpet_yd",
  "cap_lvt_sf",
  "cap_laminate_sf",
  "cap_hardwood_sf",
  "cap_tile_teardown_sf",
  "cap_subfloor_sheets",
  "cap_selflevel_sf",
  "cap_stair_steps",
] as const;

/** Merge global settings with an installer's non-null overrides. */
export function mergeInstaller(
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

export const SCHEDULING_DEFAULTS: SchedulingSettings = {
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
  cap_stair_steps: 12,
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
  return { ...SCHEDULING_DEFAULTS, ...(data ?? {}) } as SchedulingSettings;
}

export interface InstallerProfile {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * THE canonical list of people who can be scheduled to install — the single
 * source of truth for every scheduler surface (suggestions, the manual picker,
 * the capacity settings screen, the install calendar). Uses INSTALL_ROLES so
 * changing who installs is a one-line change and never diverges page to page.
 */
export async function listInstallers(): Promise<InstallerProfile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", INSTALL_ROLES as unknown as string[])
    .order("full_name", { ascending: true });
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string) || (p.email as string),
    email: (p.email as string) ?? "",
    role: p.role as string,
  }));
}

export interface InstallerSuggestion {
  installerId: string;
  name: string;
  days: number;
  start: string;
  end: string;
  /** Why this crew can do the job. The scheduler approves it with the booking. */
  fit: string;
}

/**
 * Earliest window per installer for a job — each installer is sized with THEIR
 * own daily capacities and work days (falling back to the shop defaults).
 */
export interface InstallerOutlook {
  installers: InstallerProfile[];
  overrides: Map<string, Record<string, unknown>>;
  booked: Map<string, DateRange[]>;
  /** Crew trade skills. Missing id means no limit is saved. */
  skills: Map<string, string[]>;
}

/**
 * Installer capacity and the bookings that can still block a future opening.
 * Jobs that already ended before `fromDate` are not loaded.
 */
export async function loadInstallerOutlook(fromDate?: string): Promise<InstallerOutlook> {
  const supabase = await createClient();
  const installers = await listInstallers();
  const from = fromDate ?? ymd(new Date());
  const crews = await listInstallCrews({ activeOnly: true });
  const skills = new Map<string, string[]>();
  const crewIds: string[] = [];
  for (const crew of crews) {
    if (crew.profile_id) {
      skills.set(crew.profile_id, crew.skills ?? []);
    } else {
      const id = `crew:${crew.id}`;
      installers.push({
        id,
        name: crew.name,
        email: crew.email ?? "",
        role: "crew",
      });
      skills.set(id, crew.skills ?? []);
      crewIds.push(crew.id);
    }
  }
  if (!installers.length) {
    return { installers, overrides: new Map(), booked: new Map(), skills };
  }
  const ids = installers.map((i) => i.id).filter((id) => !id.startsWith("crew:"));
  const [{ data: ovRows }, { data: jobs }, crewJobs] = await Promise.all([
    ids.length
      ? supabase.from("installer_settings").select("*").in("installer_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("jobs")
          .select("assigned_to, scheduled_date, scheduled_end")
          .in("assigned_to", ids)
          .not("scheduled_date", "is", null)
          .or(`scheduled_end.gte.${from},scheduled_date.gte.${from}`)
      : Promise.resolve({ data: [] }),
    crewIds.length
      ? supabase
          .from("jobs")
          .select("assigned_crew_id, scheduled_date, scheduled_end")
          .in("assigned_crew_id", crewIds)
          .not("scheduled_date", "is", null)
          .or(`scheduled_end.gte.${from},scheduled_date.gte.${from}`)
      : Promise.resolve({ data: [] }),
  ]);
  const overrides = new Map<string, Record<string, unknown>>();
  for (const r of ovRows ?? [])
    overrides.set(r.installer_id as string, r as Record<string, unknown>);
  const booked = new Map<string, DateRange[]>();
  const pushBooked = (who: string, start: string, end: string) => {
    const arr = booked.get(who) ?? [];
    arr.push({ start, end: end || start });
    booked.set(who, arr);
  };
  for (const j of jobs ?? []) {
    pushBooked(j.assigned_to as string, j.scheduled_date as string, (j.scheduled_end as string) || (j.scheduled_date as string));
  }
  for (const j of crewJobs.data ?? []) {
    if (!j.assigned_crew_id) continue;
    pushBooked(`crew:${j.assigned_crew_id as string}`, j.scheduled_date as string, (j.scheduled_end as string) || (j.scheduled_date as string));
  }
  return { installers, overrides, booked, skills };
}

export function suggestionsFromOutlook(
  outlook: InstallerOutlook,
  lines: EstimateLineItem[],
  global: SchedulingSettings,
  fromDate?: string,
): InstallerSuggestion[] {
  const from = fromDate ?? ymd(new Date());
  const jobType = jobMaterialType(lines);
  const out: InstallerSuggestion[] = [];
  for (const inst of outlook.installers) {
    const skills = outlook.skills.get(inst.id) ?? [];
    if (!installerCanDoJob(skills, jobType)) continue;
    const settings = mergeInstaller(global, outlook.overrides.get(inst.id));
    const days = installDaysForJob(lines, settings).days;
    if (days <= 0) continue;
    const win = nextFreeWindow(
      outlook.booked.get(inst.id) ?? [],
      workDaySet(settings),
      days,
      from,
    );
    if (win)
      out.push({
        installerId: inst.id,
        name: inst.name,
        days,
        start: win.start,
        end: win.end,
        fit: crewFitLabel(skills, jobType),
      });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.days - b.days);
}

export async function getInstallerSuggestions(
  lines: EstimateLineItem[],
  global: SchedulingSettings,
  fromDate?: string,
): Promise<InstallerSuggestion[]> {
  const outlook = await loadInstallerOutlook(fromDate);
  return suggestionsFromOutlook(outlook, lines, global, fromDate);
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
  const crew = await listInstallers();
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
    name: c.name,
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
  let customerAddress = [
    cust.street,
    [cust.city, cust.state].filter(Boolean).join(", "),
    cust.zip,
  ]
    .filter(Boolean)
    .join(" ");
  if (!customerAddress) {
    const { data: sites } = await supabase
      .from("service_addresses")
      .select("street, city, state, zip")
      .eq("customer_id", customerId)
      .limit(1);
    const site = sites?.[0];
    if (site) {
      customerAddress = [site.street, [site.city, site.state].filter(Boolean).join(", "), site.zip]
        .filter(Boolean)
        .join(" ");
    }
  }
  if (!customerAddress) return [];

  const settings = await getSchedulingSettings();
  const workDays = workDaySet(settings);
  const dur = settings.estimate_duration_min;
  const buffer = settings.travel_buffer_min;
  const store = defaultOrigin(settings);

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
    .select("salesperson_id, starts_at, ends_at, address, kind, is_block")
    .in("salesperson_id", repIds)
    .eq("status", "scheduled")
    .gte("starts_at", `${today}T00:00:00Z`)
    .lte("starts_at", `${windowEnd}T23:59:59Z`);

  const [shifts, overrides, timeOff] = await Promise.all([
    getShiftsMap(),
    getOverrides(today, windowEnd),
    listTimeOff(today, windowEnd, ["approved"]),
  ]);

  // Full existing stops per rep/day (start, end, address) — the route we insert into.
  const byRepDay = new Map<string, DayStop[]>();
  for (const a of appts ?? []) {
    const st = a.starts_at as string;
    const date = st.slice(0, 10);
    const startMin = parseHM(st.slice(11, 16));
    const en = (a.ends_at as string) || "";
    const endMin = en ? parseHM(en.slice(11, 16)) : startMin + dur;
    const blocked = a.kind === "block" || a.is_block === true;
    const k = `${a.salesperson_id}|${date}`;
    const arr = byRepDay.get(k) ?? [];
    arr.push({ startMin, endMin, address: blocked ? null : ((a.address as string) || null) });
    byRepDay.set(k, arr);
  }

  // Score every rep×day: the store is the start of the route, the rep's own
  // hours and time off come first, and the slot that adds the least drive wins.
  const pairs: { rep: (typeof reps)[number]; date: string }[] = [];
  for (const rep of reps) for (const date of days) pairs.push({ rep, date });

  const results = await Promise.all(
    pairs.map(async ({ rep, date }): Promise<EstimateSlot | null> => {
      const shiftBook = shifts[rep.id];
      const off = timeOff.some(
        (t) => t.user_id === rep.id && t.start_date <= date && date <= t.end_date,
      );
      const window = estimateDayWindow({
        date,
        shopWorkDays: workDays,
        shopStart: settings.day_start,
        shopEnd: settings.day_end,
        hasShiftSchedule: !!shiftBook && Object.keys(shiftBook).length > 0,
        shift: shiftBook?.[fromYmd(date).getUTCDay()] ?? null,
        override: overrides[rep.id]?.[date] ?? null,
        off,
      });
      if (!window) return null;
      const base = store || rep.home_address || "";
      const baseLabel = store ? "the store" : "home";
      const stops = (byRepDay.get(`${rep.id}|${date}`) ?? []).sort(
        (a, b) => a.startMin - b.startMin,
      );
      const best = await bestInsertion({
        destination: customerAddress,
        base,
        baseLabel,
        stops,
        dayStart: window.start,
        dayEnd: window.end,
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
          best.arriveDrive != null ? `${best.arriveDrive} min from ${baseLabel}` : null,
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
 * Least added drive from the store into one rep's day. One Distance Matrix
 * call. With no Maps key the earliest time that fits the hours is returned.
 */
async function bestInsertion(opts: {
  destination: string;
  base: string;
  baseLabel: string;
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
  const places: { key: string; address: string }[] = [];
  if (opts.base.trim()) places.push({ key: "base", address: opts.base.trim() });
  places.push({ key: "new", address: opts.destination });
  const stops: InsertionStop[] = opts.stops.map((stop, i) => {
    const address = stop.address?.trim() || "";
    if (!address) return { startMin: stop.startMin, endMin: stop.endMin, placeKey: null };
    const key = `s${i}`;
    places.push({ key, address });
    return { startMin: stop.startMin, endMin: stop.endMin, placeKey: key };
  });
  const capped = places.slice(0, 10);
  const table = await getDriveTable(capped.map((p) => p.address));
  const index = new Map(capped.map((p, i) => [p.key, i]));
  const drive = (from: string, to: string) => {
    const i = index.get(from);
    const j = index.get(to);
    if (i == null || j == null) return null;
    return table[i]?.[j] ?? null;
  };
  return chooseEstimateInsertion({
    dayStart: opts.dayStart,
    dayEnd: opts.dayEnd,
    dur: opts.dur,
    buffer: opts.buffer,
    stops,
    drive,
    baseLabel: opts.baseLabel,
  });
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
    origin: defaultOrigin(settings) || (rep?.home_address as string) || "",
    stops,
  };
}
