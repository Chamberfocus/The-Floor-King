/** Shared rules for how a customer responds to an estimate. */

export const DECLINE_REASON_REQUIRED_MESSAGE =
  "A reason is required to decline this estimate.";

export const DECLINE_REASON_MAX = 2000;

/** Blank and whitespace-only reasons are not a reason. */
export function declineReason(raw: string | null | undefined): string | null {
  const note = (raw ?? "").trim();
  if (!note) return null;
  return note.slice(0, DECLINE_REASON_MAX);
}

/** Honest page-load count. Zero means they have not opened the estimate. */
export function estimateViewLabel(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n <= 0) return "Not opened";
  if (n === 1) return "Opened once";
  return `Opened ${n} times`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
