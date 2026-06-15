import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeSlots, type ExistingAppt, type SlotOption } from "@/lib/booking";
import type {
  AppointmentType,
  ShowroomSettings,
  AppointmentColor,
  AppointmentKind,
} from "@/lib/types";

const SHOWROOM_DEFAULTS: ShowroomSettings = {
  id: "default",
  open_days: "1,2,3,4,5,6",
  day_start: "09:00",
  day_end: "17:00",
  slot_interval_min: 30,
  capacity: 2,
  buffer_min: 0,
  booking_enabled: true,
  booking_notice_hours: 2,
  updated_at: "",
};

export async function getShowroomSettings(): Promise<ShowroomSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("showroom_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  return (data as ShowroomSettings) ?? SHOWROOM_DEFAULTS;
}

/** Public (no auth) read for the booking page — uses the service-role client. */
export async function getPublicBookingConfig(): Promise<{
  settings: ShowroomSettings;
  types: AppointmentType[];
}> {
  const admin = createAdminClient();
  const [{ data: s }, { data: t }] = await Promise.all([
    admin.from("showroom_settings").select("*").eq("id", "default").maybeSingle(),
    admin
      .from("appointment_types")
      .select("*")
      .eq("active", true)
      .order("position", { ascending: true }),
  ]);
  return {
    settings: (s as ShowroomSettings) ?? SHOWROOM_DEFAULTS,
    types: (t ?? []) as AppointmentType[],
  };
}

export async function listAppointmentTypes(
  opts: { activeOnly?: boolean } = {},
): Promise<AppointmentType[]> {
  const supabase = await createClient();
  let q = supabase
    .from("appointment_types")
    .select("*")
    .order("position", { ascending: true });
  if (opts.activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as AppointmentType[];
}

export interface BookingStaff {
  id: string;
  name: string;
  role: string;
}

/** Staff who can be assigned to an appointment. */
export async function listBookingStaff(): Promise<BookingStaff[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", ["admin", "office", "sales_manager", "salesman", "scheduler"])
    .order("full_name", { ascending: true });
  return ((data ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
    role: string;
  }[]).map((p) => ({ id: p.id, name: p.full_name || p.email, role: p.role }));
}

export async function getAppointmentType(
  id: string,
): Promise<AppointmentType | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointment_types")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as AppointmentType) ?? null;
}

// --- Calendar reads ---------------------------------------------------------

export interface CalendarAppointment {
  id: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
  isBlock: boolean;
  title: string | null;
  notes: string | null;
  source: string;
  customerId: string | null;
  customerName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  typeId: string | null;
  typeName: string | null;
  color: AppointmentColor;
  kind: AppointmentKind | string;
}

/** All appointments overlapping [startISO, endISO), enriched for the calendar. */
export async function listAppointmentsRange(
  startISO: string,
  endISO: string,
): Promise<CalendarAppointment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, ends_at, status, is_block, title, notes, source, kind, customer_id, contact_name, contact_phone, salesperson_id, type_id",
    )
    .gte("starts_at", startISO)
    .lt("starts_at", endISO)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true });
  const rows = (data ?? []) as RawAppt[];
  if (!rows.length) return [];

  // Resolve names for customers, reps, and types in batch.
  const custIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))] as string[];
  const repIds = [...new Set(rows.map((r) => r.salesperson_id).filter(Boolean))] as string[];
  const typeIds = [...new Set(rows.map((r) => r.type_id).filter(Boolean))] as string[];

  const [custRes, repRes, typeRes] = await Promise.all([
    custIds.length
      ? supabase.from("customers").select("id, full_name").in("id", custIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    repIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", repIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    typeIds.length
      ? supabase
          .from("appointment_types")
          .select("id, name, color, kind")
          .in("id", typeIds)
      : Promise.resolve({ data: [] as { id: string; name: string; color: string; kind: string }[] }),
  ]);

  const custName = new Map<string, string | null>();
  for (const c of custRes.data ?? []) custName.set(c.id, c.full_name);
  const repName = new Map<string, string>();
  for (const r of repRes.data ?? []) repName.set(r.id, r.full_name || r.email);
  const typeInfo = new Map<string, { name: string; color: string; kind: string }>();
  for (const t of typeRes.data ?? [])
    typeInfo.set(t.id, { name: t.name, color: t.color, kind: t.kind });

  return rows.map((r) => {
    const t = r.type_id ? typeInfo.get(r.type_id) : undefined;
    return {
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      isBlock: r.is_block,
      title: r.title,
      notes: r.notes,
      source: r.source,
      customerId: r.customer_id,
      customerName: r.customer_id ? (custName.get(r.customer_id) ?? null) : null,
      contactName: r.contact_name,
      contactPhone: r.contact_phone,
      salespersonId: r.salesperson_id,
      salespersonName: r.salesperson_id
        ? (repName.get(r.salesperson_id) ?? null)
        : null,
      typeId: r.type_id,
      typeName: t?.name ?? r.title ?? (r.is_block ? "Blocked" : "Appointment"),
      color: (t?.color as AppointmentColor) ?? (r.is_block ? "gray" : "blue"),
      kind: (t?.kind as AppointmentKind) ?? r.kind ?? "other",
    };
  });
}

export interface PendingRequest extends CalendarAppointment {
  preferredText: string;
}

// Shared enrichment used by the pending list.
type RawAppt = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  is_block: boolean;
  title: string | null;
  notes: string | null;
  source: string;
  kind: string | null;
  customer_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  salesperson_id: string | null;
  type_id: string | null;
};

/** Client-submitted requests awaiting staff confirmation. */
export async function listPendingRequests(): Promise<CalendarAppointment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments")
    .select(
      "id, starts_at, ends_at, status, is_block, title, notes, source, kind, customer_id, contact_name, contact_phone, salesperson_id, type_id",
    )
    .eq("status", "pending")
    .order("starts_at", { ascending: true });
  const rows = (data ?? []) as RawAppt[];
  if (!rows.length) return [];
  return enrichMany(rows);
}

async function enrichMany(rows: RawAppt[]): Promise<CalendarAppointment[]> {
  const supabase = await createClient();
  const custIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))] as string[];
  const repIds = [...new Set(rows.map((r) => r.salesperson_id).filter(Boolean))] as string[];
  const typeIds = [...new Set(rows.map((r) => r.type_id).filter(Boolean))] as string[];
  const [custRes, repRes, typeRes] = await Promise.all([
    custIds.length
      ? supabase.from("customers").select("id, full_name").in("id", custIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    repIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", repIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    typeIds.length
      ? supabase.from("appointment_types").select("id, name, color, kind").in("id", typeIds)
      : Promise.resolve({ data: [] as { id: string; name: string; color: string; kind: string }[] }),
  ]);
  const custName = new Map<string, string | null>();
  for (const c of custRes.data ?? []) custName.set(c.id, c.full_name);
  const repName = new Map<string, string>();
  for (const r of repRes.data ?? []) repName.set(r.id, r.full_name || r.email);
  const typeInfo = new Map<string, { name: string; color: string; kind: string }>();
  for (const t of typeRes.data ?? []) typeInfo.set(t.id, { name: t.name, color: t.color, kind: t.kind });

  return rows.map((r) => {
    const t = r.type_id ? typeInfo.get(r.type_id) : undefined;
    return {
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      isBlock: r.is_block,
      title: r.title,
      notes: r.notes,
      source: r.source,
      customerId: r.customer_id,
      customerName: r.customer_id ? (custName.get(r.customer_id) ?? null) : null,
      contactName: r.contact_name,
      contactPhone: r.contact_phone,
      salespersonId: r.salesperson_id,
      salespersonName: r.salesperson_id ? (repName.get(r.salesperson_id) ?? null) : null,
      typeId: r.type_id,
      typeName: t?.name ?? r.title ?? "Appointment",
      color: (t?.color as AppointmentColor) ?? "blue",
      kind: (t?.kind as AppointmentKind) ?? "other",
    };
  });
}

export async function pendingRequestCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

// --- Availability -----------------------------------------------------------

async function existingForDay(
  db: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  ymd: string,
): Promise<ExistingAppt[]> {
  // Pending + scheduled both hold a slot (a pending request is tentatively
  // reserved so we don't double-offer it).
  const { data } = await db
    .from("appointments")
    .select("starts_at, ends_at, salesperson_id")
    .gte("starts_at", `${ymd}T00:00:00+00`)
    .lte("starts_at", `${ymd}T23:59:59+00`)
    .in("status", ["pending", "scheduled"]);
  return ((data ?? []) as {
    starts_at: string;
    ends_at: string | null;
    salesperson_id: string | null;
  }[]).map((r) => ({
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    salespersonId: r.salesperson_id,
  }));
}

/** Open slots for staff booking (respects RLS via the normal client). */
export async function getDaySlots(
  ymd: string,
  durationMin: number,
  opts: { repId?: string | null; nowIso?: string } = {},
): Promise<SlotOption[]> {
  const supabase = await createClient();
  const settings = await getShowroomSettings();
  const existing = await existingForDay(supabase, ymd);
  return computeSlots(settings, durationMin, ymd, existing, {
    repId: opts.repId ?? null,
    nowIso: opts.nowIso,
  });
}

/** Open slots for the PUBLIC booking page (service-role; enforces notice). */
export async function getPublicDaySlots(
  ymd: string,
  durationMin: number,
  nowIso: string,
): Promise<SlotOption[]> {
  const admin = createAdminClient();
  const settings =
    ((
      await admin
        .from("showroom_settings")
        .select("*")
        .eq("id", "default")
        .maybeSingle()
    ).data as ShowroomSettings) ?? SHOWROOM_DEFAULTS;
  const existing = await existingForDay(admin, ymd);
  return computeSlots(settings, durationMin, ymd, existing, { nowIso });
}
