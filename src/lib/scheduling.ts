import { lineAreaSqft, lineQty, num } from "@/lib/estimate-calc";
import type { EstimateLineItem, SchedulingSettings } from "@/lib/types";

// --- date helpers (UTC-noon to dodge DST), all "YYYY-MM-DD" strings ----------
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
export function addDaysYmd(s: string, n: number): string {
  const d = fromYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function dow(s: string): number {
  return fromYmd(s).getUTCDay();
}
export function workDaySet(settings: SchedulingSettings): Set<number> {
  return new Set(
    settings.work_days
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n)),
  );
}

export interface DayLine {
  label: string;
  amount: number;
  unit: string;
  days: number;
}

export interface InstallEstimate {
  days: number;
  breakdown: DayLine[];
}

/**
 * Estimate install days from a job's scope using the shop's daily capacities.
 * Flooring lines use their material category; extras (ceramic tear-out,
 * subfloor, self-leveling) are detected from the line text.
 */
export function installDaysForJob(
  lines: EstimateLineItem[],
  s: SchedulingSettings,
): InstallEstimate {
  const breakdown: DayLine[] = [];
  let fraction = 0;
  const add = (label: string, amount: number, unit: string, days: number) => {
    if (days <= 0) return;
    fraction += days;
    breakdown.push({ label, amount, unit, days });
  };

  for (const l of lines) {
    const sf = lineAreaSqft(l);
    const sy = sf / 9;
    const text = `${l.description ?? ""} ${l.room ?? ""}`.toLowerCase();

    if (/(tear|remov)/.test(text) && /(tile|ceramic)/.test(text)) {
      add("Ceramic tear-out", sf, "sq ft", sf / num(s.cap_tile_teardown_sf));
      continue;
    }
    if (/subfloor/.test(text)) {
      const sheets = lineQty(l) || sf / 32; // 4x8 sheet = 32 sq ft fallback
      add("Subfloor", sheets, "sheets", sheets / num(s.cap_subfloor_sheets));
      continue;
    }
    if (/(self.?level|leveling|self level)/.test(text)) {
      add("Self-leveling", sf, "sq ft", sf / num(s.cap_selflevel_sf));
      continue;
    }

    switch (l.category) {
      case "carpet":
        add("Carpet", sy, "sq yd", sy / num(s.cap_carpet_yd));
        break;
      case "lvp":
      case "vinyl":
        add("Luxury / sheet vinyl", sf, "sq ft", sf / num(s.cap_lvt_sf));
        break;
      case "laminate":
        add("Laminate", sf, "sq ft", sf / num(s.cap_laminate_sf));
        break;
      case "hardwood":
        add("Hardwood", sf, "sq ft", sf / num(s.cap_hardwood_sf));
        break;
      default:
        // Unknown flooring with an area: fall back to the LVT rate.
        if (sf > 0) add("Flooring", sf, "sq ft", sf / num(s.cap_lvt_sf));
    }
  }

  return { days: Math.max(breakdown.length ? 1 : 0, Math.ceil(fraction)), breakdown };
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Earliest run of `daysNeeded` free working days (≥ `from`) that doesn't collide
 * with any booked range. Non-working days are skipped without breaking the run;
 * a booked working day resets it (an installer can't double-book a day).
 */
export function nextFreeWindow(
  booked: DateRange[],
  workDays: Set<number>,
  daysNeeded: number,
  from: string,
): DateRange | null {
  if (daysNeeded <= 0) return null;
  const isBooked = (day: string) =>
    booked.some((r) => r.start <= day && day <= r.end);
  let cursor = from;
  let win: string[] = [];
  for (let i = 0; i < 400; i++) {
    if (workDays.has(dow(cursor))) {
      if (isBooked(cursor)) {
        win = [];
      } else {
        win.push(cursor);
        if (win.length === daysNeeded) return { start: win[0], end: cursor };
      }
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return null;
}
