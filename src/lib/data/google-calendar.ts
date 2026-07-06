import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/notify";
import {
  googleConfigured,
  refreshAccessToken,
  createEvent,
  updateEvent,
  deleteEvent,
  listCalendars,
  createCalendar,
  type EventInput,
  type GCalListItem,
} from "@/lib/google-calendar";

/**
 * All token storage/refresh happens server-side with the service-role client so
 * one staff member booking for another rep can push to THAT rep's calendar
 * (cross-user), which RLS would otherwise block. Everything is best-effort and
 * fully inert unless the OAuth app is configured.
 */

interface Conn {
  user_id: string;
  google_email: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expiry: string | null;
  calendar_id: string;
}

function adminOrNull() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/** Connection status for the signed-in user (own row, plain session client). */
export async function getMyGoogleStatus(): Promise<{
  connected: boolean;
  email: string | null;
}> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { connected: false, email: null };
    const { data } = await supabase
      .from("google_calendar_connections")
      .select("google_email")
      .eq("user_id", user.id)
      .maybeSingle();
    return { connected: !!data, email: (data?.google_email as string) ?? null };
  } catch {
    return { connected: false, email: null };
  }
}

export async function saveGoogleConnection(
  userId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in: number },
  email: string | null,
): Promise<void> {
  const db = adminOrNull();
  if (!db) return;
  const expiry = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();
  const patch: Record<string, unknown> = {
    user_id: userId,
    google_email: email,
    access_token: tokens.access_token,
    token_expiry: expiry,
    calendar_id: "primary",
    updated_at: new Date().toISOString(),
  };
  // Google only returns a refresh_token on first consent — keep the old one
  // if this connect didn't include a fresh one.
  if (tokens.refresh_token) patch.refresh_token = tokens.refresh_token;
  await db.from("google_calendar_connections").upsert(patch);
}

export async function disconnectGoogle(userId: string): Promise<void> {
  const db = adminOrNull();
  if (!db) return;
  await db.from("google_calendar_connections").delete().eq("user_id", userId);
}

// --- Shared team calendar ---------------------------------------------------

export interface TeamCalendar {
  ownerId: string;
  calendarId: string;
  calendarName: string | null;
}

/** The one shared calendar every appointment syncs into, or null if unset. */
export async function getTeamCalendar(): Promise<TeamCalendar | null> {
  const db = adminOrNull();
  if (!db) return null;
  const { data } = await db
    .from("team_calendar")
    .select("owner_id, calendar_id, calendar_name")
    .eq("id", true)
    .maybeSingle();
  if (!data?.owner_id || !data?.calendar_id) return null;
  return {
    ownerId: data.owner_id as string,
    calendarId: data.calendar_id as string,
    calendarName: (data.calendar_name as string) ?? null,
  };
}

export async function setTeamCalendar(
  ownerId: string,
  calendarId: string,
  name: string | null,
): Promise<void> {
  const db = adminOrNull();
  if (!db) return;
  await db.from("team_calendar").upsert({
    id: true,
    owner_id: ownerId,
    calendar_id: calendarId,
    calendar_name: name,
    updated_at: new Date().toISOString(),
  });
}

export async function clearTeamCalendar(): Promise<void> {
  const db = adminOrNull();
  if (!db) return;
  await db
    .from("team_calendar")
    .update({ owner_id: null, calendar_id: null, calendar_name: null })
    .eq("id", true);
}

/** The signed-in user's Google calendars (for the team-calendar picker). */
export async function listMyCalendars(): Promise<GCalListItem[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const conn = await tokenFor(user.id);
    if (!conn) return [];
    return await listCalendars(conn.token);
  } catch {
    return [];
  }
}

/** Create a fresh calendar owned by the signed-in user and set it as the team
 *  calendar. Returns its id, or null on any failure. */
export async function createTeamCalendarForMe(
  name: string,
): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const conn = await tokenFor(user.id);
    if (!conn) return null;
    const cal = await createCalendar(conn.token, name);
    await setTeamCalendar(user.id, cal.id, cal.summary);
    return cal.id;
  } catch {
    return null;
  }
}

/** Point the team calendar at an EXISTING calendar the signed-in user picked. */
export async function selectTeamCalendarForMe(
  calendarId: string,
  name: string | null,
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    await setTeamCalendar(user.id, calendarId, name);
    return true;
  } catch {
    return false;
  }
}

/** A valid access token for a user's calendar, refreshing if it's near expiry. */
async function tokenFor(
  userId: string,
): Promise<{ token: string; calId: string } | null> {
  const db = adminOrNull();
  if (!db) return null;
  const { data } = await db
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const conn = data as Conn | null;
  if (!conn) return null;
  const calId = conn.calendar_id || "primary";
  const exp = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
  if (Date.now() < exp - 30_000) return { token: conn.access_token, calId };
  if (!conn.refresh_token) return { token: conn.access_token, calId };
  try {
    const t = await refreshAccessToken(conn.refresh_token);
    const expiry = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
    await db
      .from("google_calendar_connections")
      .update({
        access_token: t.access_token,
        token_expiry: expiry,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return { token: t.access_token, calId };
  } catch {
    return null;
  }
}

function summaryFor(a: {
  is_block: boolean;
  title: string | null;
  kind: string | null;
  customerName: string | null;
  contact_name: string | null;
}): string {
  if (a.is_block) return a.title || "Blocked";
  const who = a.customerName || a.contact_name || "Appointment";
  const label =
    a.kind === "estimate"
      ? "Estimate"
      : a.kind === "in_home"
        ? "In-home"
        : a.kind === "measure"
          ? "Measure"
          : "Appointment";
  return `${label}: ${who}`;
}

/** Look up a person's display name (for labelling shared-calendar events). */
async function profileName(
  db: NonNullable<ReturnType<typeof adminOrNull>>,
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();
  return (data?.full_name as string) ?? null;
}

/**
 * Reflect a CRM appointment into Google Calendar — create, update, move, or
 * remove. When a shared TEAM calendar is configured every appointment lands
 * there (labelled with the rep) so the whole crew sees one schedule; otherwise
 * it falls back to the assigned rep's own primary calendar. Never throws: a
 * Google hiccup must never break booking. No-op unless configured.
 */
export async function syncAppointmentToGoogle(
  appointmentId: string,
): Promise<void> {
  if (!googleConfigured() || !appointmentId) return;
  const db = adminOrNull();
  if (!db) return;
  try {
    const { data: a } = await db
      .from("appointments")
      .select(
        "id, starts_at, ends_at, salesperson_id, status, is_block, kind, address, notes, title, customer_id, contact_name, google_event_id, google_calendar_user, google_calendar_id, customer:customers(full_name)",
      )
      .eq("id", appointmentId)
      .maybeSingle();
    if (!a) return;

    const rep = (a.salesperson_id as string | null) ?? null;
    const existingUser = (a.google_calendar_user as string | null) ?? null;
    const existingCal = (a.google_calendar_id as string | null) ?? "primary";
    const eventId = (a.google_event_id as string | null) ?? null;
    const gone = a.status === "cancelled";

    // Where should this appointment's event live?
    //  - shared team calendar (if set): the owner's token, the team calendar.
    //  - else the assigned rep's own primary calendar.
    const team = await getTeamCalendar();
    let desiredOwner: string | null = null;
    let desiredCal = "primary";
    if (!gone) {
      if (team) {
        desiredOwner = team.ownerId;
        desiredCal = team.calendarId;
      } else if (rep) {
        desiredOwner = rep;
        desiredCal = "primary";
      }
    }

    // Remove the old event when it's going away or moving to a different
    // owner/calendar (cancelled, unassigned, rep changed, or switched to/from
    // the shared calendar).
    const moved =
      !desiredOwner ||
      desiredOwner !== existingUser ||
      desiredCal !== existingCal;
    if (eventId && existingUser && moved) {
      const old = await tokenFor(existingUser);
      if (old) {
        try {
          await deleteEvent(old.token, existingCal, eventId);
        } catch {
          /* already gone / no access — ignore */
        }
      }
      await db
        .from("appointments")
        .update({
          google_event_id: null,
          google_calendar_user: null,
          google_calendar_id: null,
        })
        .eq("id", appointmentId);
    }

    if (!desiredOwner) return; // cancelled, or nowhere to sync

    const conn = await tokenFor(desiredOwner);
    if (!conn) return; // owner hasn't connected — best effort

    const cust = a.customer as unknown as { full_name: string | null } | null;
    // On the shared calendar, tag each event with the rep so you know whose job
    // it is at a glance (their own calendar needs no such label).
    const repName = team ? await profileName(db, rep) : null;
    const base = summaryFor({
      is_block: !!a.is_block,
      title: (a.title as string) ?? null,
      kind: (a.kind as string) ?? null,
      customerName: cust?.full_name ?? null,
      contact_name: (a.contact_name as string) ?? null,
    });
    const input: EventInput = {
      summary: repName ? `${base} — ${repName}` : base,
      location: (a.address as string) ?? null,
      description: [
        (a.notes as string) ?? null,
        a.customer_id ? `${siteUrl()}/customers/${a.customer_id}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      startIso: a.starts_at as string,
      endIso: (a.ends_at as string) ?? null,
    };

    // If the event still lives where it should, update in place; otherwise the
    // old one was just removed above, so create a fresh one and record it.
    const inPlace = !moved && eventId;
    if (inPlace) {
      await updateEvent(conn.token, desiredCal, eventId!, input);
    } else {
      const newId = await createEvent(conn.token, desiredCal, input);
      await db
        .from("appointments")
        .update({
          google_event_id: newId,
          google_calendar_user: desiredOwner,
          google_calendar_id: desiredCal,
        })
        .eq("id", appointmentId);
    }
  } catch {
    /* best-effort; swallow so the CRM action never fails over Google */
  }
}

/** Remove an appointment's Google event BEFORE the row is deleted. */
export async function removeAppointmentFromGoogle(
  appointmentId: string,
): Promise<void> {
  if (!googleConfigured() || !appointmentId) return;
  const db = adminOrNull();
  if (!db) return;
  try {
    const { data: a } = await db
      .from("appointments")
      .select("google_event_id, google_calendar_user, google_calendar_id")
      .eq("id", appointmentId)
      .maybeSingle();
    const eventId = (a?.google_event_id as string) ?? null;
    const user = (a?.google_calendar_user as string) ?? null;
    const calId = (a?.google_calendar_id as string) ?? "primary";
    if (!eventId || !user) return;
    const conn = await tokenFor(user);
    if (conn) {
      try {
        await deleteEvent(conn.token, calId, eventId);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* best-effort */
  }
}
