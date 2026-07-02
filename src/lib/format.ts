export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "HH:MM" (24-hour) → friendly 12-hour, e.g. "14:00" → "2 PM", "09:30" → "9:30 AM".
 * Use this everywhere a stored HH:MM time is shown to a person — never show
 * military time in the UI.
 */
export function to12(hm: string | null | undefined): string {
  if (!hm) return "";
  const [rawH, rawM] = hm.split(":").map((x) => parseInt(x, 10));
  const h = Number.isFinite(rawH) ? rawH : 0;
  const m = Number.isFinite(rawM) ? rawM : 0;
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/**
 * Appointment/booking times are stored as wall-clock pinned to +00 (e.g.
 * "2026-06-20T14:00:00Z" means 2:00 PM local). Read them back in UTC so we
 * recover the exact wall-clock — NOT the viewer's timezone — and show 12-hour.
 * (Do not use this for real timestamps like created_at; use formatDateTime.)
 */
export function formatWallTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return to12(
    `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
  );
}

/** Wall-clock date + 12-hour time, e.g. "Sat, Jun 20 · 2:00 PM". */
export function formatWallDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const datePart = new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${datePart} · ${formatWallTime(iso)}`;
}

/** Default arrival windows if none are configured (matches migration 0065). */
export const DEFAULT_ARRIVAL_WINDOWS =
  "08:00-10:00,10:00-12:00,12:00-14:00,14:00-16:00,16:00-18:00";

export interface ArrivalWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  label: string; // friendly 12-hour, e.g. "8–10 AM"
}

/**
 * Parse the stored "HH:MM-HH:MM,HH:MM-HH:MM" arrival-window string into rows
 * with a friendly 12-hour label. Falls back to the defaults if empty/invalid.
 */
export function parseArrivalWindows(
  raw: string | null | undefined,
): ArrivalWindow[] {
  const src = raw && raw.trim() ? raw : DEFAULT_ARRIVAL_WINDOWS;
  const valid = (t: string) => /^\d{1,2}:\d{2}$/.test(t);
  const out = src
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [start, end] = pair.split("-").map((x) => x.trim());
      return { start, end, label: `${to12(start)}–${to12(end)}` };
    })
    .filter((w) => valid(w.start) && valid(w.end));
  return out.length
    ? out
    : DEFAULT_ARRIVAL_WINDOWS.split(",").map((pair) => {
        const [start, end] = pair.split("-");
        return { start, end, label: `${to12(start)}–${to12(end)}` };
      });
}

export function formatMoney(value: number | string | null | undefined): string {
  const n =
    typeof value === "number" ? value : parseFloat(String(value ?? "0")) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}
