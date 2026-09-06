/**
 * F4 canonical outbox processor decision layer (pure).
 * Admin retry and future cron MUST share this logic.
 * DB claim/post are performed by the server adapter.
 */
import type { AccountingPeriodStatus } from "@/lib/accounting/types";
import type { BuiltJournalEntry } from "@/lib/accounting/types";
import { assessPeriodPosting } from "@/lib/accounting/journal";
import { ACCOUNTING_FAILURE } from "@/lib/accounting/event-status";
import {
  assessOutboxRetry,
  nextOutboxAttemptAt,
  type OutboxStatus,
} from "@/lib/accounting/outbox-policy";
import {
  journalIdempotencyKey,
  parseOutboxSnapshot,
  rebuildAccountingEventFromSnapshot,
  type AccountingOutboxSnapshot,
} from "@/lib/accounting/outbox-rebuild";
import { assessAccountingGate, type EventFlagSettings } from "@/lib/accounting/event-status";

export type OutboxProcessDecision =
  | {
      action: "already_posted";
      journalEntryId: string;
      /** Crash recovery: journal exists, outbox still pending/processing. */
      convergeOutbox: true;
    }
  | {
      action: "post";
      entry: BuiltJournalEntry;
      snapshot: AccountingOutboxSnapshot;
    }
  | {
      action: "review_required";
      code: string;
      message: string;
      terminal: boolean;
    }
  | {
      action: "fail_retry";
      code: string;
      message: string;
      nextAttemptAt: Date;
      attemptCount: number;
    }
  | {
      action: "fail_exhausted";
      code: string;
      message: string;
    }
  | {
      action: "skip_legacy";
      message: string;
    }
  | {
      action: "skip_disabled";
      message: string;
    }
  | {
      action: "reject_claim";
      message: string;
    };

/**
 * Simulate DB-safe claim: only one worker wins for a given item.
 * UI disabling is NOT concurrency control — this models UPDATE…WHERE status.
 */
export function simulateOutboxClaim(args: {
  itemId: string;
  status: OutboxStatus;
  /** Worker ids attempting claim in parallel. */
  workers: string[];
  /** Items already claimed by other workers this tick. */
  claimedBy?: Map<string, string>;
}): { winner: string | null; losers: string[] } {
  const claimed = args.claimedBy ?? new Map<string, string>();
  if (claimed.has(args.itemId)) {
    return { winner: null, losers: [...args.workers] };
  }
  if (
    args.status !== "pending" &&
    args.status !== "failed" &&
    args.status !== "error"
  ) {
    return { winner: null, losers: [...args.workers] };
  }
  const [winner, ...rest] = args.workers;
  if (!winner) return { winner: null, losers: [] };
  claimed.set(args.itemId, winner);
  return { winner, losers: rest };
}

/**
 * After a successful claim, decide what to do — including crash recovery
 * when the journal already exists under the idempotency key.
 */
export function decideOutboxProcess(args: {
  status: OutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  payload: unknown;
  /** Journal already posted for this source idempotency key. */
  existingJournalId: string | null;
  periodStatus: AccountingPeriodStatus | null;
  flags: EventFlagSettings;
  /** Live mapping at process time — must NOT override frozen snapshot accounts. */
  liveCashAccountIdForMethod?: string | null;
  originalJournalLines?: import("@/lib/accounting/types").JournalLineInput[];
  sourceReload?: {
    amount?: number;
    invoiceId?: string | null;
    customerId?: string | null;
    jobId?: string | null;
    billId?: string | null;
    status?: string | null;
  };
  now?: Date;
}): OutboxProcessDecision {
  if (args.status === "posted" || args.status === "cancelled") {
    return {
      action: "reject_claim",
      message: `Outbox is ${args.status}.`,
    };
  }
  if (args.status === "review_required") {
    return {
      action: "review_required",
      code: "review_required",
      message: "Outbox item requires manual review before posting.",
      terminal: false,
    };
  }

  const parsed = parseOutboxSnapshot(args.payload);
  if (!parsed.ok) {
    return failOrExhaust(args, "payload_invalid", parsed.error);
  }
  const snap = parsed.snapshot;

  // Cutover uses ECONOMIC event date, not retry/processing date.
  const gate = assessAccountingGate({
    kind: snap.eventKind,
    flags: args.flags,
    entryDate: snap.economicEventDate,
  });
  if (!gate.ok) {
    if (gate.status === "legacy_pre_cutover") {
      return { action: "skip_legacy", message: gate.message };
    }
    if (gate.status === "disabled") {
      return { action: "skip_disabled", message: gate.message };
    }
    return {
      action: "review_required",
      code: gate.code,
      message: gate.message,
      terminal: true,
    };
  }

  const idem = journalIdempotencyKey(snap);
  if (args.existingJournalId) {
    return {
      action: "already_posted",
      journalEntryId: args.existingJournalId,
      convergeOutbox: true,
    };
  }
  void idem;

  // Period must still be open for the economic event date — do not shift date.
  const periodGate = assessPeriodPosting({
    periodStatus: args.periodStatus,
    entryKind: snap.eventKind.includes("void") ? "reversal" : "post",
  });
  if (!periodGate.ok) {
    return {
      action: "review_required",
      code:
        args.periodStatus === "locked"
          ? ACCOUNTING_FAILURE.LOCKED_PERIOD
          : ACCOUNTING_FAILURE.CLOSED_PERIOD,
      message: `${periodGate.error} Economic date ${snap.economicEventDate} was not changed.`,
      terminal: true,
    };
  }

  // Mapping-change safety: frozen cash account in snapshot wins.
  if (
    snap.cashAccountId &&
    args.liveCashAccountIdForMethod &&
    snap.cashAccountId !== args.liveCashAccountIdForMethod
  ) {
    // Proceed with snapshot account — do not rewrite to live mapping.
  }

  const rebuilt = rebuildAccountingEventFromSnapshot({
    snapshot: snap,
    sourceReload: args.sourceReload,
    originalJournalLines: args.originalJournalLines,
  });
  if (!rebuilt.ok) {
    if (rebuilt.code === "tax_review_required") {
      return {
        action: "review_required",
        code: ACCOUNTING_FAILURE.TAX_REVIEW_REQUIRED,
        message: rebuilt.error,
        terminal: true,
      };
    }
    return failOrExhaust(args, rebuilt.code, rebuilt.error);
  }

  return { action: "post", entry: rebuilt.entry, snapshot: snap };
}

function failOrExhaust(
  args: {
    attemptCount: number;
    maxAttempts: number;
    status: OutboxStatus;
    now?: Date;
  },
  code: string,
  message: string,
): OutboxProcessDecision {
  const nextAttempt = args.attemptCount; // already incremented on claim
  const gate = assessOutboxRetry({
    attemptCount: nextAttempt,
    maxAttempts: args.maxAttempts,
    status: args.status === "processing" ? "pending" : args.status,
  });
  if (!gate.ok && gate.exhausted) {
    return {
      action: "fail_exhausted",
      code: ACCOUNTING_FAILURE.OUTBOX_RETRY_EXHAUSTED,
      message: `${message} (${gate.message})`,
    };
  }
  return {
    action: "fail_retry",
    code,
    message,
    nextAttemptAt: nextOutboxAttemptAt(nextAttempt, args.now ?? new Date()),
    attemptCount: nextAttempt,
  };
}

/**
 * Crash after journal post, before outbox update:
 * retry sees pending + existing journal → converge to posted, no duplicate.
 */
export function convergeAfterCrashPost(args: {
  outboxStatus: OutboxStatus;
  existingJournalId: string | null;
}):
  | { ok: true; outboxStatus: "posted"; journalEntryId: string; duplicateJournal: false }
  | { ok: false; reason: string } {
  if (!args.existingJournalId) {
    return { ok: false, reason: "No journal to converge." };
  }
  if (args.outboxStatus === "posted") {
    return {
      ok: true,
      outboxStatus: "posted",
      journalEntryId: args.existingJournalId,
      duplicateJournal: false,
    };
  }
  return {
    ok: true,
    outboxStatus: "posted",
    journalEntryId: args.existingJournalId,
    duplicateJournal: false,
  };
}
