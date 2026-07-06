/**
 * Google Calendar OAuth + Calendar REST helpers (plain fetch — no SDK). Pure
 * HTTP; no database. Everything no-ops unless the OAuth app is configured via
 * GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET, so the whole feature is
 * inert until those env vars exist.
 */
import { siteUrl } from "@/lib/notify";

/** The shop's timezone — appointment wall-clock times are interpreted here. */
export const SHOP_TZ = process.env.SHOP_TIMEZONE || "America/New_York";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const SCOPES = [
  // Full calendar scope: manage events AND list/create calendars, so an admin
  // can create or pick the shared team calendar. (Broader than calendar.events,
  // so reconnecting is required to upgrade an older connection.)
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
].join(" ");

export function googleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

/** The redirect URI you must register in the Google Cloud OAuth client. */
export function googleRedirectUri(): string {
  return `${siteUrl()}/api/google/callback`;
}

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline", // ask for a refresh token
    include_granted_scopes: "true",
    prompt: "consent", // force a refresh token every connect
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token refresh ${r.status}: ${await r.text()}`);
  return r.json();
}

/** Best-effort email from the OAuth id_token (display only — not verified). */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return (json.email as string) ?? null;
  } catch {
    return null;
  }
}

// --- Calendars -------------------------------------------------------------

export interface GCalListItem {
  id: string;
  summary: string;
  primary: boolean;
}

/** The user's calendars they can write to (for picking the shared team one). */
export async function listCalendars(token: string): Promise<GCalListItem[]> {
  const r = await fetch(
    `${CAL_BASE}/users/me/calendarList?minAccessRole=writer&maxResults=250`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`list calendars ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.items ?? []).map(
    (c: { id: string; summary: string; primary?: boolean }) => ({
      id: c.id,
      summary: c.summary,
      primary: !!c.primary,
    }),
  );
}

/** Create a brand-new (secondary) calendar; returns its id + name. */
export async function createCalendar(
  token: string,
  summary: string,
): Promise<{ id: string; summary: string }> {
  const r = await fetch(`${CAL_BASE}/calendars`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ summary, timeZone: SHOP_TZ }),
  });
  if (!r.ok) throw new Error(`create calendar ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { id: j.id as string, summary: (j.summary as string) ?? summary };
}

// --- Events ----------------------------------------------------------------

export interface EventInput {
  summary: string;
  location?: string | null;
  description?: string | null;
  startIso: string; // stored wall-clock pinned to +00
  endIso: string | null;
}

/** Our appointment times are wall-clock pinned to +00 (e.g. 14:00:00+00 = 2 PM
 *  local). Strip the zone to a naked local datetime and pair it with SHOP_TZ so
 *  Google places it at the correct local time. */
function localDateTime(iso: string): string {
  return iso.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "").slice(0, 19);
}

function eventBody(e: EventInput) {
  const start = localDateTime(e.startIso);
  const end = e.endIso ? localDateTime(e.endIso) : start;
  return {
    summary: e.summary,
    location: e.location || undefined,
    description: e.description || undefined,
    start: { dateTime: start, timeZone: SHOP_TZ },
    end: { dateTime: end, timeZone: SHOP_TZ },
  };
}

export async function createEvent(
  token: string,
  calendarId: string,
  e: EventInput,
): Promise<string> {
  const r = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody(e)),
    },
  );
  if (!r.ok) throw new Error(`create event ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.id as string;
}

export async function updateEvent(
  token: string,
  calendarId: string,
  eventId: string,
  e: EventInput,
): Promise<void> {
  const r = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody(e)),
    },
  );
  // 404/410 = the event was removed on Google's side; let the caller recreate.
  if (!r.ok && r.status !== 404 && r.status !== 410)
    throw new Error(`update event ${r.status}: ${await r.text()}`);
}

export async function deleteEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const r = await fetch(
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok && r.status !== 404 && r.status !== 410)
    throw new Error(`delete event ${r.status}: ${await r.text()}`);
}
