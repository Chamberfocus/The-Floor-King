/** Visible install-calendar window. Week changes refetch this range only. */
export const SCHEDULER_CALENDAR_MAX_DAYS = 92;

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function calendarWindow(
  cal: string | undefined,
  spanRaw: string | undefined,
  now = new Date(),
): { start: string; end: string; span: number } {
  const parsedSpan = Number.parseInt(spanRaw ?? "", 10);
  const span = Number.isFinite(parsedSpan)
    ? Math.min(SCHEDULER_CALENDAR_MAX_DAYS, Math.max(1, parsedSpan))
    : 7;
  const startDate = (cal && parseYmd(cal)) || startOfWeek(now);
  const endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  endDate.setDate(endDate.getDate() + span - 1);
  return { start: ymdLocal(startDate), end: ymdLocal(endDate), span };
}

/**
 * A booked install overlaps the days on screen.
 * scheduled_date <= end, and the job reaches the start (its end date, or the
 * start date itself when there is no later end).
 */
export function installOverlapsWindow(
  scheduledDate: string,
  scheduledEnd: string | null,
  start: string,
  end: string,
): boolean {
  if (scheduledDate > end) return false;
  if (scheduledDate >= start) return true;
  return !!scheduledEnd && scheduledEnd >= start;
}
