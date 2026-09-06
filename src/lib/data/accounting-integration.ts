/**
 * F4 server helpers: event status + durable outbox enqueue + canonical processor.
 * Admin retry and future cron both call processAccountingOutboxItem.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAccountingSettings,
  postAccountingEvent,
} from "@/lib/data/accounting";
import type { BuiltJournalEntry, JournalLineInput } from "@/lib/accounting/types";
import {
  planAccountingIntegration,
  assertNoSilentAccountingGap,
} from "@/lib/accounting/integration";
import type { AccountingEventKind } from "@/lib/accounting/event-status";
import { outboxIdempotencyKey } from "@/lib/accounting/outbox-policy";
import {
  decideOutboxProcess,
  type OutboxProcessDecision,
} from "@/lib/accounting/outbox-processor";
import {
  journalIdempotencyKey,
  parseOutboxSnapshot,
  type AccountingOutboxSnapshot,
} from "@/lib/accounting/outbox-rebuild";
import type { OutboxStatus } from "@/lib/accounting/outbox-policy";
import type { AccountingPeriodStatus } from "@/lib/accounting/types";

export async function recordAccountingEventStatus(args: {
  sourceType: string;
  sourceId: string;
  eventKind: string;
  status: string;
  journalEntryId?: string | null;
  outboxId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  flags?: Record<string, unknown>;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("accounting_event_status").upsert(
    {
      source_type: args.sourceType,
      source_id: args.sourceId,
      event_kind: args.eventKind,
      status: args.status,
      journal_entry_id: args.journalEntryId ?? null,
      outbox_id: args.outboxId ?? null,
      error_code: args.errorCode ?? null,
      error_message: args.errorMessage ?? null,
      flags: args.flags ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source_type,source_id,event_kind" },
  );
  if (error) throw new Error(error.message);
}

export async function enqueueAccountingOutbox(args: {
  sourceType: string;
  sourceId: string;
  eventKind: string;
  payload: AccountingOutboxSnapshot | Record<string, unknown>;
  reviewRequired?: boolean;
}): Promise<{ id: string; duplicate: boolean }> {
  const supabase = await createClient();
  const key = outboxIdempotencyKey(
    args.sourceType,
    args.sourceId,
    args.eventKind,
  );
  const { data: existing } = await supabase
    .from("accounting_posting_outbox")
    .select("id")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existing?.id) return { id: existing.id as string, duplicate: true };

  const { data, error } = await supabase
    .from("accounting_posting_outbox")
    .insert({
      source_type: args.sourceType,
      source_id: args.sourceId,
      event_kind: args.eventKind,
      idempotency_key: key,
      payload: args.payload,
      status: args.reviewRequired ? "review_required" : "pending",
      review_required: Boolean(args.reviewRequired),
      next_attempt_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    const { data: again } = await supabase
      .from("accounting_posting_outbox")
      .select("id")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (again?.id) return { id: again.id as string, duplicate: true };
    throw new Error(error.message);
  }
  return { id: data.id as string, duplicate: false };
}

/**
 * Canonical after-op hook. Safe when posting disabled (records skipped/disabled).
 * Does NOT flood outbox while posting is intentionally disabled.
 * Prefer RPC-side enqueue for outbox_guaranteed events (same TX as source).
 */
export async function afterFinancialEventAccounting(args: {
  kind: AccountingEventKind;
  sourceType: string;
  sourceId: string;
  entryDate: string;
  buildJournal?: () => BuiltJournalEntry | Promise<BuiltJournalEntry>;
  /** Durable snapshot required when app-layer enqueues (fallback if RPC did not). */
  snapshot?: AccountingOutboxSnapshot;
  reviewRequired?: boolean;
  unsupported?: boolean;
  userId?: string | null;
}): Promise<{
  status: string;
  journalEntryId?: string;
  outboxId?: string;
  skipped?: boolean;
}> {
  const settings = await getAccountingSettings();
  const flags = {
    posting_enabled: settings.posting_enabled,
    invoice_posting_enabled: settings.invoice_posting_enabled,
    payment_posting_enabled: settings.payment_posting_enabled,
    credit_posting_enabled: settings.credit_posting_enabled,
    ap_posting_enabled: settings.ap_posting_enabled,
    expense_posting_enabled: settings.expense_posting_enabled,
    deposit_posting_enabled: settings.deposit_posting_enabled,
    installer_posting_enabled: settings.installer_posting_enabled,
    inventory_posting_enabled: settings.inventory_posting_enabled,
    cutover_date: settings.cutover_date,
  };

  const plan = planAccountingIntegration({
    kind: args.kind,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    entryDate: args.entryDate,
    flags,
    reviewRequired: args.reviewRequired,
    unsupported: args.unsupported,
  });

  if (
    plan.action === "skip_disabled" ||
    plan.action === "skip_legacy" ||
    plan.action === "skip_unsupported"
  ) {
    await recordAccountingEventStatus({
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      eventKind: args.kind,
      status: plan.status,
      errorCode: plan.code ?? null,
      errorMessage: plan.message ?? null,
    });
    const gap = assertNoSilentAccountingGap({
      postingEnabled: flags.posting_enabled,
      plan,
      journalPosted: false,
      outboxEnqueued: false,
      statusRecorded: true,
    });
    if (!gap.ok) throw new Error(gap.error);
    return { status: plan.status, skipped: true };
  }

  if (plan.action === "not_guaranteed" || plan.action === "review_required") {
    await recordAccountingEventStatus({
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      eventKind: args.kind,
      status: "review_required",
      errorCode: plan.code ?? null,
      errorMessage: plan.message ?? null,
    });
    const gap = assertNoSilentAccountingGap({
      postingEnabled: flags.posting_enabled,
      plan,
      journalPosted: false,
      outboxEnqueued: false,
      statusRecorded: true,
    });
    if (!gap.ok) throw new Error(gap.error);
    return { status: "review_required" };
  }

  if (plan.action === "enqueue_outbox") {
    // Prefer existing RPC-enqueued row (same TX as payment). App enqueue is fallback only.
    const supabase = await createClient();
    const key = outboxIdempotencyKey(args.sourceType, args.sourceId, args.kind);
    const { data: existing } = await supabase
      .from("accounting_posting_outbox")
      .select("id")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing?.id) {
      await recordAccountingEventStatus({
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        eventKind: args.kind,
        status: "pending",
        outboxId: existing.id as string,
      });
      return { status: "pending", outboxId: existing.id as string };
    }
    if (!args.snapshot) {
      await recordAccountingEventStatus({
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        eventKind: args.kind,
        status: "failed",
        errorCode: "payload_invalid",
        errorMessage:
          "Outbox-guaranteed event missing durable rebuild snapshot (RPC enqueue expected).",
      });
      return { status: "failed" };
    }
    const box = await enqueueAccountingOutbox({
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      eventKind: args.kind,
      payload: args.snapshot,
    });
    await recordAccountingEventStatus({
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      eventKind: args.kind,
      status: "pending",
      outboxId: box.id,
    });
    return { status: "pending", outboxId: box.id };
  }

  // post_atomic (manual / opening only)
  if (!args.buildJournal) {
    await recordAccountingEventStatus({
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      eventKind: args.kind,
      status: "failed",
      errorMessage: "Missing journal builder for atomic post.",
    });
    return { status: "failed" };
  }
  const entry = await args.buildJournal();
  const posted = await postAccountingEvent(entry, {
    forceManual: true,
    userId: args.userId,
  });
  if (!posted.ok) {
    await recordAccountingEventStatus({
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      eventKind: args.kind,
      status: "failed",
      errorMessage: posted.error,
    });
    return { status: "failed" };
  }
  await recordAccountingEventStatus({
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    eventKind: args.kind,
    status: "posted",
    journalEntryId: posted.journalEntryId,
  });
  return { status: "posted", journalEntryId: posted.journalEntryId };
}

async function findJournalByIdempotency(
  idempotencyKey: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function periodStatusForDate(
  entryDate: string,
): Promise<AccountingPeriodStatus | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("accounting_periods")
    .select("status")
    .lte("start_date", entryDate)
    .gte("end_date", entryDate)
    .maybeSingle();
  return (data?.status as AccountingPeriodStatus | undefined) ?? null;
}

async function applyOutboxDecision(
  outboxId: string,
  row: {
    source_type: string;
    source_id: string;
    event_kind: string;
    attempt_count: number;
  },
  decision: OutboxProcessDecision,
  userId?: string | null,
  asServiceProcessor = true,
): Promise<{
  ok: boolean;
  status: string;
  journalEntryId?: string;
  error?: string;
}> {
  const supabase = asServiceProcessor
    ? createAdminClient()
    : await createClient();

  if (decision.action === "already_posted") {
    await supabase
      .from("accounting_posting_outbox")
      .update({
        status: "posted",
        journal_entry_id: decision.journalEntryId,
        processed_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);
    await recordAccountingEventStatus({
      sourceType: row.source_type,
      sourceId: row.source_id,
      eventKind: row.event_kind,
      status: "posted",
      journalEntryId: decision.journalEntryId,
      outboxId,
    });
    return {
      ok: true,
      status: "posted",
      journalEntryId: decision.journalEntryId,
    };
  }

  if (decision.action === "post") {
    const posted = await postAccountingEvent(decision.entry, {
      forceManual: false,
      userId,
      asServiceProcessor,
    });
    if (posted.ok) {
      // Duplicate journal from crash recovery still converges.
      await supabase
        .from("accounting_posting_outbox")
        .update({
          status: "posted",
          journal_entry_id: posted.journalEntryId,
          processed_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", outboxId);
      await recordAccountingEventStatus({
        sourceType: row.source_type,
        sourceId: row.source_id,
        eventKind: row.event_kind,
        status: "posted",
        journalEntryId: posted.journalEntryId,
        outboxId,
      });
      return {
        ok: true,
        status: "posted",
        journalEntryId: posted.journalEntryId,
      };
    }
    // Posting failed — schedule retry
    const retryDecision = decideOutboxProcess({
      status: "pending",
      attemptCount: row.attempt_count,
      maxAttempts: 8,
      payload: decision.snapshot,
      existingJournalId: await findJournalByIdempotency(
        decision.entry.idempotencyKey,
      ),
      periodStatus: await periodStatusForDate(decision.entry.entryDate),
      flags: await flagsFromSettings(),
    });
    if (
      retryDecision.action === "already_posted" &&
      retryDecision.journalEntryId
    ) {
      return applyOutboxDecision(
        outboxId,
        row,
        retryDecision,
        userId,
        asServiceProcessor,
      );
    }
    await supabase
      .from("accounting_posting_outbox")
      .update({
        status: "failed",
        last_error: posted.error,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);
    await recordAccountingEventStatus({
      sourceType: row.source_type,
      sourceId: row.source_id,
      eventKind: row.event_kind,
      status: "failed",
      outboxId,
      errorMessage: posted.error,
    });
    return { ok: false, status: "failed", error: posted.error };
  }

  if (decision.action === "skip_legacy" || decision.action === "skip_disabled") {
    await supabase
      .from("accounting_posting_outbox")
      .update({
        status: "skipped",
        last_error: decision.message,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);
    await recordAccountingEventStatus({
      sourceType: row.source_type,
      sourceId: row.source_id,
      eventKind: row.event_kind,
      status:
        decision.action === "skip_legacy" ? "legacy_pre_cutover" : "disabled",
      outboxId,
      errorMessage: decision.message,
    });
    return { ok: true, status: "skipped" };
  }

  if (decision.action === "review_required") {
    await supabase
      .from("accounting_posting_outbox")
      .update({
        status: "review_required",
        review_required: true,
        last_error: decision.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);
    await recordAccountingEventStatus({
      sourceType: row.source_type,
      sourceId: row.source_id,
      eventKind: row.event_kind,
      status: "review_required",
      outboxId,
      errorCode: decision.code,
      errorMessage: decision.message,
    });
    return { ok: false, status: "review_required", error: decision.message };
  }

  if (decision.action === "fail_exhausted") {
    await supabase
      .from("accounting_posting_outbox")
      .update({
        status: "failed",
        last_error: decision.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);
    await recordAccountingEventStatus({
      sourceType: row.source_type,
      sourceId: row.source_id,
      eventKind: row.event_kind,
      status: "failed",
      outboxId,
      errorCode: decision.code,
      errorMessage: decision.message,
    });
    return { ok: false, status: "failed", error: decision.message };
  }

  if (decision.action === "fail_retry") {
    await supabase
      .from("accounting_posting_outbox")
      .update({
        status: "failed",
        last_error: decision.message,
        next_attempt_at: decision.nextAttemptAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);
    await recordAccountingEventStatus({
      sourceType: row.source_type,
      sourceId: row.source_id,
      eventKind: row.event_kind,
      status: "failed",
      outboxId,
      errorCode: decision.code,
      errorMessage: decision.message,
    });
    return { ok: false, status: "failed", error: decision.message };
  }

  return { ok: false, status: "failed", error: "reject_claim" };
}

async function flagsFromSettings() {
  const settings = await getAccountingSettings();
  return {
    posting_enabled: settings.posting_enabled,
    invoice_posting_enabled: settings.invoice_posting_enabled,
    payment_posting_enabled: settings.payment_posting_enabled,
    credit_posting_enabled: settings.credit_posting_enabled,
    ap_posting_enabled: settings.ap_posting_enabled,
    expense_posting_enabled: settings.expense_posting_enabled,
    deposit_posting_enabled: settings.deposit_posting_enabled,
    installer_posting_enabled: settings.installer_posting_enabled,
    inventory_posting_enabled: settings.inventory_posting_enabled,
    cutover_date: settings.cutover_date,
  };
}

/**
 * Canonical outbox processor — used by admin retry AND future cron.
 * Claims safely, rebuilds from durable snapshot, posts via journal RPC,
 * converges crash-after-post without duplicate journals.
 */
export async function processAccountingOutboxItem(
  outboxId: string,
  opts?: { userId?: string | null; asServiceProcessor?: boolean },
): Promise<{
  ok: boolean;
  status: string;
  journalEntryId?: string;
  error?: string;
}> {
  const supabase = opts?.asServiceProcessor
    ? createAdminClient()
    : await createClient();

  // Prefer DB claim RPC when present; fallback to optimistic update pre-0163.
  const { data: claimedRpc, error: claimRpcError } = await supabase.rpc(
    "claim_accounting_outbox_item",
    { p_id: outboxId },
  );

  let row: Record<string, unknown> | null = null;

  if (!claimRpcError && claimedRpc && typeof claimedRpc === "object") {
    const res = claimedRpc as {
      ok?: boolean;
      row?: Record<string, unknown>;
      error?: string;
    };
    if (!res.ok || !res.row) {
      return {
        ok: false,
        status: "failed",
        error: res.error ?? "Claim lost to concurrent worker.",
      };
    }
    row = res.row;
  } else {
    // Fallback claim for pre-migration
    const { data: current } = await supabase
      .from("accounting_posting_outbox")
      .select("*")
      .eq("id", outboxId)
      .maybeSingle();
    if (!current) {
      return { ok: false, status: "failed", error: "Outbox not found." };
    }
    if (
      !["pending", "failed", "error", "processing"].includes(
        String(current.status),
      )
    ) {
      return {
        ok: false,
        status: String(current.status),
        error: `Cannot process status ${current.status}`,
      };
    }
    const nextAttempt = (Number(current.attempt_count) || 0) + 1;
    const { data: updated, error: claimErr } = await supabase
      .from("accounting_posting_outbox")
      .update({
        status: "processing",
        attempt_count: nextAttempt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId)
      .in("status", ["pending", "failed", "error", "processing"])
      .select("*")
      .maybeSingle();
    if (claimErr || !updated) {
      return {
        ok: false,
        status: "failed",
        error: claimErr?.message ?? "Claim lost to concurrent worker.",
      };
    }
    row = updated as Record<string, unknown>;
  }

  const payload = row.payload;
  const parsed = parseOutboxSnapshot(payload);
  const flags = await flagsFromSettings();
  let existingJournalId: string | null = null;
  let originalLines: JournalLineInput[] | undefined;
  let sourceReload:
    | {
        amount?: number;
        invoiceId?: string | null;
        customerId?: string | null;
        jobId?: string | null;
        billId?: string | null;
        status?: string | null;
      }
    | undefined;

  if (parsed.ok) {
    existingJournalId = await findJournalByIdempotency(
      journalIdempotencyKey(parsed.snapshot),
    );
    if (parsed.snapshot.originalJournalEntryId) {
      const { data: lines } = await supabase
        .from("journal_lines")
        .select(
          "account_id, debit, credit, memo, customer_id, vendor_id, job_id, invoice_id, bill_id",
        )
        .eq("journal_entry_id", parsed.snapshot.originalJournalEntryId);
      originalLines = (lines ?? []).map((l) => ({
        accountId: l.account_id as string,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        memo: l.memo as string | null,
        customerId: l.customer_id as string | null,
        vendorId: l.vendor_id as string | null,
        jobId: l.job_id as string | null,
        invoiceId: l.invoice_id as string | null,
        billId: l.bill_id as string | null,
      }));
    }
    // Optional source reload for amounts (never overrides frozen accounts / date)
    if (parsed.snapshot.sourceType === "payment") {
      const { data: pay } = await supabase
        .from("payments")
        .select("amount, invoice_id, status")
        .eq("id", parsed.snapshot.sourceId)
        .maybeSingle();
      if (pay) {
        sourceReload = {
          amount: Number(pay.amount) || 0,
          invoiceId: pay.invoice_id as string,
          status: pay.status as string,
        };
      }
    } else if (parsed.snapshot.eventKind === "credit_application") {
      const { data: app } = await supabase
        .from("credit_applications")
        .select("amount, invoice_id, status")
        .eq("id", parsed.snapshot.sourceId)
        .maybeSingle();
      if (app) {
        sourceReload = {
          amount: Number(app.amount) || 0,
          invoiceId: app.invoice_id as string,
          status: app.status as string,
        };
      }
    } else if (parsed.snapshot.eventKind === "refund") {
      const { data: ref } = await supabase
        .from("refunds")
        .select("amount, status, customer_id")
        .eq("id", parsed.snapshot.sourceId)
        .maybeSingle();
      if (ref) {
        sourceReload = {
          amount: Number(ref.amount) || 0,
          customerId: ref.customer_id as string,
          status: ref.status as string,
        };
      }
    } else if (parsed.snapshot.eventKind === "bill_payment") {
      const { data: bp } = await supabase
        .from("bill_payments")
        .select("amount, bill_id")
        .eq("id", parsed.snapshot.sourceId)
        .maybeSingle();
      if (bp) {
        sourceReload = {
          amount: Number(bp.amount) || 0,
          billId: bp.bill_id as string,
        };
      }
    }
  }

  const economicDate = parsed.ok
    ? parsed.snapshot.economicEventDate
    : new Date().toISOString().slice(0, 10);
  const decision = decideOutboxProcess({
    status: String(row.status) as OutboxStatus,
    attemptCount: Number(row.attempt_count) || 0,
    maxAttempts: Number(row.max_attempts) || 8,
    payload,
    existingJournalId,
    periodStatus: await periodStatusForDate(economicDate),
    flags,
    originalJournalLines: originalLines,
    sourceReload,
  });

  return applyOutboxDecision(
    outboxId,
    {
      source_type: String(row.source_type),
      source_id: String(row.source_id),
      event_kind: String(row.event_kind ?? "post"),
      attempt_count: Number(row.attempt_count) || 0,
    },
    decision,
    opts?.userId,
    opts?.asServiceProcessor ?? true,
  );
}

/** Admin retry — SAME canonical processor as future cron. */
export async function retryAccountingOutbox(outboxId: string, userId: string) {
  return processAccountingOutboxItem(outboxId, { userId });
}
