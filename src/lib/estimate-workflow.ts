/**
 * Presentation helpers for the flooring estimate workspace.
 * Grouping and labels only — no pricing, tax, margin, or approval math.
 */

export type RoomLine = { room: string };

export function listAreas(rooms: string[], pending: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...rooms, ...pending]) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function groupIndexedByRoom<T extends { line: RoomLine }>(
  rows: T[],
): { name: string; rows: T[] }[] {
  const order: string[] = [];
  const groups = new Map<string, { name: string; rows: T[] }>();
  for (const row of rows) {
    const name = row.line.room.trim();
    const key = name.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    const group = { name, rows: [row] };
    groups.set(key, group);
    order.push(key);
  }
  return order.map((key) => groups.get(key)!);
}

/** Next unused "copy" name. Does not copy prices — callers clone existing lines. */
export function duplicateAreaName(name: string, existing: string[]): string {
  const base = `${name.trim()} copy`;
  const taken = new Set(existing.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

export function renameAreaLabel(from: string, to: string): string | null {
  const next = to.trim();
  const prev = from.trim();
  if (!next || !prev) return null;
  if (next.toLowerCase() === prev.toLowerCase()) return prev;
  return next;
}

export function roomMatches(room: string, area: string): boolean {
  const name = area.trim();
  if (!name) return !room.trim();
  return room.trim().toLowerCase() === name.toLowerCase();
}

/** Quantity caption. Uses the line's own unit string — no conversion. */
export function quantityCaption(unit: string | null | undefined): string {
  const label = (unit ?? "").trim();
  return label ? `Quantity (${label})` : "Quantity";
}

export function employeeSaveError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "This estimate did not save. Try again.";
  if (/sqlstate|postgres|duplicate key|violates|pgrst|syntax error|relation /i.test(msg)) {
    return "This estimate did not save. Check the lines and try again.";
  }
  return msg;
}

export type SaveFlight = { current: boolean };

/** Synchronous guard so a second Save/Send click cannot start another write. */
export function claimSaveFlight(lock: SaveFlight): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseSaveFlight(lock: SaveFlight): void {
  lock.current = false;
}

export function approvedJobHandoff(hasJob: boolean): {
  label: "Open job" | "Create job";
  mode: "open" | "create";
} {
  return hasJob
    ? { label: "Open job", mode: "open" }
    : { label: "Create job", mode: "create" };
}

/** Shown when a failed email redirected before status was changed to sent. */
export const EMAIL_FAILED_NOT_SENT =
  "The email did not send, so this estimate was not marked sent.";

export const STALE_APPROVAL_CHARGES =
  "Send it for approval again before creating new charges.";
