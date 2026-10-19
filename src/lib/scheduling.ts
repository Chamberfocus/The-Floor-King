import { lineAreaSqft, lineQty, lineSkipsAreaCartonMath, num } from "@/lib/estimate-calc";
import { to12 } from "@/lib/format";
import type { EstimateLineItem, SchedulingSettings } from "@/lib/types";

/**
 * Hard-surface furniture moving is outside the flooring daily rate.
 * Carpet yardage already includes takeup and furniture, so a carpet install
 * does not add these days again.
 */
export const FURNITURE_EXTRA_DAYS = { light: 0.25, medium: 0.5, heavy: 1 } as const;

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
  /** Shop capacity this amount was divided by. 0 when the line is a fixed extra day. */
  rate: number;
}

export interface InstallEstimate {
  days: number;
  breakdown: DayLine[];
}

/**
 * Estimate install days from a job's scope using the shop's daily capacities.
 * Flooring uses yardage or square feet per day. Floor prep, subfloor sheets,
 * tear-out, stairs, and hard-surface furniture moving add their own days.
 * The person scheduling approves that total with the crew who can do the trade.
 */
export function installDaysForJob(
  lines: EstimateLineItem[],
  s: SchedulingSettings,
): InstallEstimate {
  const breakdown: DayLine[] = [];
  let fraction = 0;
  const add = (label: string, amount: number, unit: string, days: number, rate: number) => {
    if (days <= 0) return;
    fraction += days;
    breakdown.push({ label, amount, unit, days, rate });
  };
  // Days for `amount` at a per-day capacity `cap`. Guards a missing/zero/negative
  // capacity so a mis-set setting can't produce Infinity/NaN days (which would
  // silently drop the installer from suggestions). No cap → this line adds no
  // days rather than blowing up.
  const daysAt = (amount: number, cap: number | string | null | undefined) => {
    const rate = num(cap);
    return rate > 0 ? amount / rate : 0;
  };
  const rateOf = (cap: number | string | null | undefined) => {
    const rate = num(cap);
    return rate > 0 ? rate : 0;
  };
  const prepOwnsSelfLevel = lines.some((l) => {
    const text = `${l.description ?? ""}`.toLowerCase();
    return /floor prep/.test(text) && /(self.?level|leveling|self level)/.test(text);
  });
  const carpetInstall = lines.some(
    (l) =>
      l.category === "carpet" &&
      (lineSkipsAreaCartonMath(l) ? 0 : lineAreaSqft(l)) > 0,
  );

  for (const l of lines) {
    // Exclusive carpet-tile scheduling leftover planted taped sq ft is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
    // Hard-surface scheduling leftover planted taped sq ft stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
    const sf = lineSkipsAreaCartonMath(l) ? 0 : lineAreaSqft(l);
    const sy = sf / 9;
    const text = `${l.description ?? ""} ${l.room ?? ""}`.toLowerCase();

    if (/(tear|remov)/.test(text) && /(tile|ceramic)/.test(text)) {
      add("Ceramic tear-out", sf, "sq ft", daysAt(sf, s.cap_tile_teardown_sf), rateOf(s.cap_tile_teardown_sf));
      continue;
    }
    if (/subfloor/.test(text)) {
      // How many sheets is the order. Leftover taped sq ft is not 4x8 sheets.
      const sheets = lineQty(l);
      add("Subfloor", sheets, "sheets", daysAt(sheets, s.cap_subfloor_sheets), rateOf(s.cap_subfloor_sheets));
      continue;
    }
    if (/floor prep/.test(text) && !/(self.?level|leveling|self level)/.test(text)) {
      add("Floor prep", sf, "sq ft", daysAt(sf, s.cap_selflevel_sf), rateOf(s.cap_selflevel_sf));
      continue;
    }
    if (/(self.?level|leveling|self level)/.test(text)) {
      // The pour is one visit. Bag lines do not add a second day when floor-prep labor already covers it.
      if (prepOwnsSelfLevel && !/floor prep/.test(text)) continue;
      add("Self-leveling", sf, "sq ft", daysAt(sf, s.cap_selflevel_sf), rateOf(s.cap_selflevel_sf));
      continue;
    }
    if (/carpet steps|stair install/.test(text)) {
      const steps = lineQty(l);
      add("Stairs", steps, "steps", daysAt(steps, s.cap_stair_steps), rateOf(s.cap_stair_steps));
      continue;
    }
    if (/(tear-out|tear out|removal)/.test(text)) {
      // Carpet yardage per day already includes takeup. Other tear-out is extra days.
      if (carpetInstall && /carpet/.test(text)) continue;
      add("Tear-out", sf, "sq ft", daysAt(sf, s.cap_tile_teardown_sf), rateOf(s.cap_tile_teardown_sf));
      continue;
    }
    if (/furniture/.test(text)) {
      if (carpetInstall) continue;
      const days = /heavy/.test(text)
        ? FURNITURE_EXTRA_DAYS.heavy
        : /medium/.test(text)
          ? FURNITURE_EXTRA_DAYS.medium
          : /light/.test(text)
            ? FURNITURE_EXTRA_DAYS.light
            : 0;
      add(/heavy/.test(text) ? "Furniture (heavy)" : /medium/.test(text) ? "Furniture (medium)" : "Furniture (light)", 1, "move", days, 0);
      continue;
    }

    switch (l.category) {
      case "carpet":
        add("Carpet", sy, "sq yd", daysAt(sy, s.cap_carpet_yd), rateOf(s.cap_carpet_yd));
        break;
      case "lvp":
        add("LVP / LVT", sf, "sq ft", daysAt(sf, s.cap_lvt_sf), rateOf(s.cap_lvt_sf));
        break;
      case "vinyl":
        // Floor King settings only have one luxury/sheet daily capacity.
        // Do not invent a second rate — label sheet vinyl as itself.
        add("Sheet vinyl", sf, "sq ft", daysAt(sf, s.cap_lvt_sf), rateOf(s.cap_lvt_sf));
        break;
      case "laminate":
        add("Laminate", sf, "sq ft", daysAt(sf, s.cap_laminate_sf), rateOf(s.cap_laminate_sf));
        break;
      case "hardwood":
        add("Hardwood", sf, "sq ft", daysAt(sf, s.cap_hardwood_sf), rateOf(s.cap_hardwood_sf));
        break;
      case "tile":
        // Tile setting is slow; use the tile (teardown) capacity as the rate.
        add("Tile", sf, "sq ft", daysAt(sf, s.cap_tile_teardown_sf), rateOf(s.cap_tile_teardown_sf));
        break;
      // Companion materials & labor lines are NOT flooring to install — they
      // don't add install days (pad/underlayment/trim/thinset/grout).
      case "underlayment":
      case "trim":
      case "labor":
      case "other":
        break;
      default:
        // Only a line with NO category and a real area is treated as flooring
        // (legacy lines from the old builder); companions always set a category.
        if (!l.category && sf > 0)
          add("Flooring", sf, "sq ft", daysAt(sf, s.cap_lvt_sf), rateOf(s.cap_lvt_sf));
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

function clockMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minutesToHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface EstimateDayWindowInput {
  date: string;
  shopWorkDays: Set<number>;
  shopStart: string;
  shopEnd: string;
  /** True when this person has any weekday shift saved. An empty schedule uses shop hours. */
  hasShiftSchedule: boolean;
  shift: { start: string; end: string } | null;
  override: { off: boolean; start?: string; end?: string } | null;
  /** Approved time off covers this date. */
  off: boolean;
}

/**
 * Hours a salesperson can take an estimate on one date.
 * Shop work days are the default. A saved shift replaces those hours.
 * Approved time off and an explicit day off remove the date.
 */
export function estimateDayWindow(args: EstimateDayWindowInput): { start: number; end: number } | null {
  if (args.off || args.override?.off) return null;
  if (args.override?.start && args.override.end) {
    const start = clockMinutes(args.override.start);
    const end = clockMinutes(args.override.end);
    return end > start ? { start, end } : null;
  }
  if (args.hasShiftSchedule) {
    if (!args.shift) return null;
    const start = clockMinutes(args.shift.start);
    const end = clockMinutes(args.shift.end);
    return end > start ? { start, end } : null;
  }
  if (!args.shopWorkDays.has(fromYmd(args.date).getUTCDay())) return null;
  const start = clockMinutes(args.shopStart);
  const end = clockMinutes(args.shopEnd);
  return end > start ? { start, end } : null;
}

export interface InsertionStop {
  startMin: number;
  endMin: number;
  /** Set when this stop is a real address. A time block has no address. */
  placeKey: string | null;
}

export interface InsertionChoice {
  startMin: number;
  arriveDrive: number | null;
  detour: number | null;
  miles: number | null;
  reason: string | null;
}

/**
 * Least added drive for one estimate on one day, measured from the store
 * (or whatever base the caller names). Added minutes are the extra route,
 * not the one-way distance standing alone.
 */
export function chooseEstimateInsertion(opts: {
  dayStart: number;
  dayEnd: number;
  dur: number;
  buffer: number;
  stops: InsertionStop[];
  drive: (from: string, to: string) => { minutes: number; miles: number } | null;
  baseLabel?: string;
}): InsertionChoice | null {
  const { dayStart, dayEnd, dur, buffer, stops, drive } = opts;
  const baseLabel = opts.baseLabel ?? "the store";
  const gap = (from: string, to: string) => {
    const leg = drive(from, to);
    return leg ? Math.max(buffer, leg.minutes) : buffer;
  };
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const clock = (min: number) => to12(minutesToHM(min));
  const added = (from: string, to: string) => {
    const out = drive(from, "new");
    const back = drive("new", to);
    if (!out || !back) return null;
    const direct = from === to ? { minutes: 0, miles: 0 } : drive(from, to);
    if (!direct) return { minutes: out.minutes + back.minutes, miles: round1(out.miles + back.miles) };
    return {
      minutes: out.minutes + back.minutes - direct.minutes,
      miles: round1(out.miles + back.miles - direct.miles),
    };
  };
  const placeAt = (index: number, step: -1 | 1): string => {
    for (let i = index; i >= 0 && i < stops.length; i += step) {
      const key = stops[i]?.placeKey;
      if (key) return key;
    }
    return "base";
  };

  type C = InsertionChoice;
  const cands: C[] = [];
  const push = (startMin: number, from: string, to: string, reason: string) => {
    const det = added(from, to);
    const arrive = drive(from, "new");
    cands.push({
      startMin,
      arriveDrive: arrive?.minutes ?? null,
      detour: det?.minutes ?? null,
      miles: det?.miles ?? null,
      reason,
    });
  };

  if (stops.length === 0) {
    if (dayStart + dur <= dayEnd) {
      push(dayStart, "base", "base", `Round trip from ${baseLabel}`);
    }
  } else {
    const first = stops[0];
    const firstPlace = placeAt(0, 1);
    if (dayStart + dur + gap("new", firstPlace) <= first.startMin && dayStart + dur <= dayEnd) {
      push(dayStart, "base", firstPlace, `Before your ${clock(first.startMin)} stop`);
    }
    for (let i = 0; i < stops.length - 1; i++) {
      const prev = stops[i];
      const next = stops[i + 1];
      const from = placeAt(i, -1);
      const to = placeAt(i + 1, 1);
      const arrive = prev.endMin + gap(from, "new");
      const leave = arrive + dur + gap("new", to);
      if (arrive + dur <= dayEnd && leave <= next.startMin) {
        push(arrive, from, to, `Between your ${clock(prev.startMin)} & ${clock(next.startMin)} stops`);
      }
    }
    const last = stops[stops.length - 1];
    const lastPlace = placeAt(stops.length - 1, -1);
    const arriveLast = last.endMin + gap(lastPlace, "new");
    if (arriveLast + dur <= dayEnd) {
      push(arriveLast, lastPlace, "base", `After your ${clock(last.startMin)} stop, back to ${baseLabel}`);
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
