// Pure time/slot helpers for the showroom booking calendar.
// Convention (matches the existing scheduler): appointment times are stored as
// wall-clock pinned to +00 — e.g. "2026-06-20T09:30:00+00" means 9:30 AM local.
// We never timezone-convert; we format in UTC to recover the same wall-clock.

import type { ShowroomSettings } from "@/lib/types";

export function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function hmFromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Day of week (0=Sun..6=Sat) for a YYYY-MM-DD string, computed in UTC. */
export function dowOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

export function isOpenDay(settings: ShowroomSettings, ymd: string): boolean {
  const open = settings.open_days
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return open.includes(dowOf(ymd));
}

/** Build the UTC ISO timestamp for a date + wall-clock minute offset. */
export function isoAt(ymd: string, minutes: number): string {
  return `${ymd}T${hmFromMinutes(minutes)}:00Z`;
}

/**
 * "Now" as the business's local wall-clock, pinned to +00 to match how
 * appointment times are stored. Keeps booking-notice math correct regardless
 * of the server's timezone.
 */
export function localNowIso(tz = "America/New_York"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:00Z`;
}

export function todayLocalYmd(tz = "America/New_York"): string {
  return localNowIso(tz).slice(0, 10);
}

/** Minutes-from-midnight of a stored +00 timestamp, on its own day. */
export function minutesOfIso(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export interface ExistingAppt {
  startsAt: string;
  endsAt: string | null;
  salespersonId: string | null;
  durationMin?: number; // fallback when endsAt is null
}

export interface SlotOption {
  hm: string; // "09:30"
  startIso: string;
  endIso: string;
  remaining: number; // showroom capacity left (capacity model)
  repFree: boolean; // is the chosen rep free (rep model)
  available: boolean; // bookable given the requested mode
}

export interface SlotQuery {
  repId?: string | null; // when set, check this rep's availability
  nowIso?: string; // for enforcing min booking notice
  noticeHours?: number;
}

/**
 * Open start times for a given day and appointment duration. Each slot reports
 * remaining showroom capacity and (if a rep is requested) whether that rep is
 * free. A slot is "available" by the requested mode: rep-free when a rep is
 * chosen, otherwise capacity-remaining.
 */
export function computeSlots(
  settings: ShowroomSettings,
  durationMin: number,
  ymd: string,
  existing: ExistingAppt[],
  query: SlotQuery = {},
): SlotOption[] {
  if (!isOpenDay(settings, ymd)) return [];

  const open = parseHm(settings.day_start);
  const close = parseHm(settings.day_end);
  const step = Math.max(5, settings.slot_interval_min);
  const buffer = Math.max(0, settings.buffer_min);
  const dur = Math.max(5, durationMin);

  // Earliest allowed start (booking notice), as minutes on this day.
  let minStart = open;
  if (query.nowIso) {
    const now = new Date(query.nowIso);
    const nowYmd = now.toISOString().slice(0, 10);
    const noticeMin = (query.noticeHours ?? settings.booking_notice_hours) * 60;
    if (nowYmd === ymd) {
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      minStart = Math.max(open, nowMinutes + noticeMin);
    } else if (ymd < nowYmd) {
      return []; // past day
    }
  }

  // Normalize existing appts to [start,end) minute ranges on this day.
  const ranges = existing.map((e) => {
    const s = minutesOfIso(e.startsAt);
    const end = e.endsAt
      ? minutesOfIso(e.endsAt)
      : s + (e.durationMin ?? dur);
    return { s, e: end + buffer, rep: e.salespersonId };
  });

  const overlaps = (s: number, end: number, rs: number, re: number) =>
    s < re && rs < end;

  const slots: SlotOption[] = [];
  for (let start = minStart; start + dur <= close; start += step) {
    const end = start + dur;
    let concurrent = 0;
    let repBusy = false;
    for (const r of ranges) {
      if (overlaps(start, end, r.s, r.e)) {
        concurrent += 1;
        if (query.repId && r.rep === query.repId) repBusy = true;
      }
    }
    const remaining = Math.max(0, settings.capacity - concurrent);
    const repFree = !repBusy;
    const available = query.repId ? repFree && remaining > 0 : remaining > 0;
    slots.push({
      hm: hmFromMinutes(start),
      startIso: isoAt(ymd, start),
      endIso: isoAt(ymd, end),
      remaining,
      repFree,
      available,
    });
  }
  return slots;
}
