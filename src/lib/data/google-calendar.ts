import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/notify";
import {
  googleConfigured,
  refreshAccessToken,
  createEvent,
  updateEvent,
  deleteEvent,
  type EventInput,
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

/**
 * Reflect a CRM appointment into the assigned rep's Google Calendar — create,
 * update, move (rep changed), or remove (cancelled/unassigned). Never throws:
 * a Google hiccup must never break booking. No-op unless configured.
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
        "id, starts_at, ends_at, salesperson_id, status, is_block, kind, address, notes, title, customer_id, contact_name, google_event_id, google_calendar_user, customer:customers(full_name)",
      )
      .eq("id", appointmentId)
      .maybeSingle();
    if (!a) return;

    const target = (a.salesperson_id as string | null) ?? null;
    const existingUser = (a.google_calendar_user as string | null) ?? null;
    const eventId = (a.google_event_id as string | null) ?? null;
    const gone = a.status === "cancelled";

    // Remove the old event when cancelled/unassigned, or when the rep changed.
    if (eventId && existingUser && (gone || !target || target !== existingUser)) {
      const old = await tokenFor(existingUser);
      if (old) {
        try {
          await deleteEvent(old.token, old.calId, eventId);
        } catch {
          /* already gone / no access — ignore */
        }
      }
      await db
        .from("appointments")
        .update({ google_event_id: null, google_calendar_user: null })
        .eq("id", appointmentId);
    }

    if (gone || !target) return; // nothing to (re)create

    const conn = await tokenFor(target);
    if (!conn) return; // rep hasn't connected their calendar — best effort

    const cust = a.customer as unknown as { full_name: string | null } | null;
    const input: EventInput = {
      summary: summaryFor({
        is_block: !!a.is_block,
        title: (a.title as string) ?? null,
        kind: (a.kind as string) ?? null,
        customerName: cust?.full_name ?? null,
        contact_name: (a.contact_name as string) ?? null,
      }),
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

    // If the event still lives in the same rep's calendar, update it in place;
    // otherwise create a fresh one and record the mapping.
    const sameCalendar = existingUser === target && eventId;
    if (sameCalendar) {
      await updateEvent(conn.token, conn.calId, eventId!, input);
    } else {
      const newId = await createEvent(conn.token, conn.calId, input);
      await db
        .from("appointments")
        .update({ google_event_id: newId, google_calendar_user: target })
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
      .select("google_event_id, google_calendar_user")
      .eq("id", appointmentId)
      .maybeSingle();
    const eventId = (a?.google_event_id as string) ?? null;
    const user = (a?.google_calendar_user as string) ?? null;
    if (!eventId || !user) return;
    const conn = await tokenFor(user);
    if (conn) {
      try {
        await deleteEvent(conn.token, conn.calId, eventId);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* best-effort */
  }
}
