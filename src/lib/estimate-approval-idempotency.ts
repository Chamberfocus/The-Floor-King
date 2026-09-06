/**
 * Approval idempotency contract (mirrors 0178 estimate_approval_* helpers).
 * Keys are claimed with a context hash; claimed keys are never deleted so they
 * can be reused with a different commercial context.
 */

/**
 * One key per commercial generation. Include current snapshot id so a later
 * re-approval after stale/edit is a NEW key (new digest) instead of
 * IDEMPOTENCY_CONFLICT on the original success key.
 * Same snapshot + retry = same key = replay.
 */
export function buildApprovalIdempotencyKey(args: {
  estimateId: string;
  source: string;
  optionId: string | null | undefined;
  snapshotId?: string | null;
  portalCustomerId?: string | null;
}): string {
  const snap = args.snapshotId || "none";
  const option = args.optionId || "_";
  if (args.source === "portal") {
    return `portal_approve:${args.estimateId}:${args.portalCustomerId ?? "_"}:${option}:${snap}`;
  }
  return `est_approve:${args.estimateId}:${args.source}:${option}:${snap}`;
}

export function approvalContextHash(parts: {
  action?: string;
  estimateId: string;
  optionId: string;
  source: string;
  staffActor: string | null;
  portalCustomer: string | null;
  commercialDigest: string;
}): string {
  return [
    parts.action ?? "estimate_approve",
    parts.estimateId,
    parts.optionId,
    parts.source,
    parts.staffActor ?? "",
    parts.portalCustomer ?? "",
    parts.commercialDigest,
  ].join("\u001f");
}

export type IdempotencyRow = {
  key: string;
  action: string;
  contextHash: string;
  status: "pending" | "completed";
  result: Record<string, unknown> | null;
};

export function beginApprovalIdempotency(args: {
  store: Map<string, IdempotencyRow>;
  key: string;
  action: string;
  contextHash: string;
}):
  | { kind: "claim" }
  | { kind: "replay"; result: Record<string, unknown> }
  | { kind: "conflict" } {
  const existing = args.store.get(args.key);
  if (!existing) {
    args.store.set(args.key, {
      key: args.key,
      action: args.action,
      contextHash: args.contextHash,
      status: "pending",
      result: null,
    });
    return { kind: "claim" };
  }
  if (
    existing.action !== args.action ||
    existing.contextHash !== args.contextHash
  ) {
    return { kind: "conflict" };
  }
  if (existing.status === "completed" && existing.result) {
    return { kind: "replay", result: existing.result };
  }
  return { kind: "claim" };
}

export function completeApprovalIdempotency(
  store: Map<string, IdempotencyRow>,
  key: string,
  result: Record<string, unknown>,
): void {
  const row = store.get(key);
  if (!row) return;
  row.status = "completed";
  row.result = result;
}

/** Terminal business outcomes complete the claim; they must never delete it. */
export function onApprovalBusinessOutcome(args: {
  store: Map<string, IdempotencyRow>;
  key: string;
  claimed: boolean;
  result: Record<string, unknown>;
}): void {
  if (!args.claimed) return;
  completeApprovalIdempotency(args.store, args.key, args.result);
}
