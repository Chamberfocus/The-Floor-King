/**
 * F4 outbox retry policy (pure).
 */
import { ACCOUNTING_FAILURE } from "@/lib/accounting/event-status";

export type OutboxStatus =
  | "pending"
  | "processing"
  | "posted"
  | "failed"
  | "error"
  | "skipped"
  | "cancelled"
  | "review_required";

export function outboxIdempotencyKey(
  sourceType: string,
  sourceId: string,
  eventKind: string,
): string {
  return `outbox:${sourceType}:${sourceId}:${eventKind}`;
}

export function assessOutboxRetry(args: {
  attemptCount: number;
  maxAttempts: number;
  status: OutboxStatus;
}):
  | { ok: true; nextStatus: "pending" }
  | { ok: false; exhausted: boolean; code: string; message: string } {
  if (args.status === "posted" || args.status === "cancelled") {
    return {
      ok: false,
      exhausted: false,
      code: "outbox_terminal",
      message: `Outbox is ${args.status}; no retry.`,
    };
  }
  if (args.attemptCount >= args.maxAttempts) {
    return {
      ok: false,
      exhausted: true,
      code: ACCOUNTING_FAILURE.OUTBOX_RETRY_EXHAUSTED,
      message: `Outbox retries exhausted (${args.attemptCount}/${args.maxAttempts}).`,
    };
  }
  return { ok: true, nextStatus: "pending" };
}

/** Exponential backoff minutes: 1, 5, 15, 60, 240... capped at 24h. */
export function nextOutboxAttemptAt(
  attemptCount: number,
  now: Date = new Date(),
): Date {
  const minutes = Math.min(
    24 * 60,
    Math.max(1, Math.round(Math.pow(4, Math.min(attemptCount, 6)))),
  );
  return new Date(now.getTime() + minutes * 60_000);
}

export function simulateOutboxLifecycle(
  existingKeys: Set<string>,
  key: string,
): { enqueued: boolean; duplicate: boolean } {
  if (existingKeys.has(key)) return { enqueued: false, duplicate: true };
  existingKeys.add(key);
  return { enqueued: true, duplicate: false };
}
