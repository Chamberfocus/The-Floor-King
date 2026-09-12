/**
 * Per-operation financial idempotency tokens.
 *
 * A retry of ONE intended operation (double-submit, lost response) must reuse
 * the same key. A genuinely new operation (new form mount) gets a new key.
 * Never mint Date.now() / random values inside a retryable server action.
 */

export const GOODWILL_IDEMPOTENCY_REQUIRED_MESSAGE =
  "Missing goodwill operation token. Refresh the page and try again.";

export const REFUND_IDEMPOTENCY_REQUIRED_MESSAGE =
  "Missing refund operation token. Refresh the page and try again.";

export const APPLY_CREDIT_IDEMPOTENCY_REQUIRED_MESSAGE =
  "Missing credit-application token. Refresh the page and try again.";

export const INVOICE_PAYMENT_IDEMPOTENCY_REQUIRED_MESSAGE =
  "Missing payment operation token. Refresh the page and try again.";

export const CARD_PAYMENT_IDEMPOTENCY_REQUIRED_MESSAGE =
  "Missing card-payment token. Refresh the page and try again.";

export const WRITE_OFF_IDEMPOTENCY_REQUIRED_MESSAGE =
  "Missing write-off operation token. Refresh the page and try again.";

export const DIRECT_EXPENSE_IDEMPOTENCY_REQUIRED_MESSAGE =
  "Missing expense operation token. Refresh the page and try again.";

export const AP_IMPORT_IDEMPOTENCY_REQUIRED_MESSAGE =
  "Missing bill import operation token. Refresh the page and try again.";

export function resolveGoodwillIdempotencyKey(
  raw: string | null | undefined,
): string | null {
  const token = (raw ?? "").trim();
  if (!token) return null;
  return token.startsWith("goodwill:") ? token : `goodwill:${token}`;
}

export function goodwillApplyIdempotencyKey(
  creditMemoId: string,
  invoiceId: string,
): string {
  return `apply-goodwill:${creditMemoId}:${invoiceId}`;
}

export type GoodwillMemoRecord = {
  id: string;
  customerId: string;
  amount: number;
  reason: string;
};

export type GoodwillIssueResult =
  | { ok: true; memo: GoodwillMemoRecord; duplicate: boolean }
  | { ok: false; code: "IDEMPOTENCY_CROSS_ENTITY" | "MISSING_KEY" };

/**
 * Mirrors issue_credit_memo_safe: unique key lookup, same-customer replay,
 * cross-customer reject. Unique-violation races replay the existing row.
 */
export function replayOrInsertGoodwillMemo(
  store: Map<string, GoodwillMemoRecord>,
  args: {
    key: string | null;
    customerId: string;
    amount: number;
    reason: string;
  },
): GoodwillIssueResult {
  if (!args.key) return { ok: false, code: "MISSING_KEY" };
  const existing = store.get(args.key);
  if (existing) {
    if (existing.customerId !== args.customerId) {
      return { ok: false, code: "IDEMPOTENCY_CROSS_ENTITY" };
    }
    return { ok: true, memo: existing, duplicate: true };
  }
  const memo: GoodwillMemoRecord = {
    id: `memo-${store.size + 1}`,
    customerId: args.customerId,
    amount: args.amount,
    reason: args.reason,
  };
  store.set(args.key, memo);
  return { ok: true, memo, duplicate: false };
}

export type GoodwillApplicationRecord = {
  memoId: string;
  invoiceId: string;
  amount: number;
};

export type GoodwillApplyResult =
  | { ok: true; application: GoodwillApplicationRecord; duplicate: boolean }
  | { ok: false; code: "IDEMPOTENCY_CROSS_ENTITY" };

/** Mirrors apply_credit_to_invoice_safe key lookup + same-entity replay. */
export function replayOrInsertGoodwillApplication(
  store: Map<string, GoodwillApplicationRecord>,
  args: { memoId: string; invoiceId: string; amount: number },
): GoodwillApplyResult {
  const key = goodwillApplyIdempotencyKey(args.memoId, args.invoiceId);
  const existing = store.get(key);
  if (existing) {
    if (
      existing.memoId !== args.memoId ||
      existing.invoiceId !== args.invoiceId
    ) {
      return { ok: false, code: "IDEMPOTENCY_CROSS_ENTITY" };
    }
    return { ok: true, application: existing, duplicate: true };
  }
  const application: GoodwillApplicationRecord = {
    memoId: args.memoId,
    invoiceId: args.invoiceId,
    amount: args.amount,
  };
  store.set(key, application);
  return { ok: true, application, duplicate: false };
}

/** One intended goodwill event: issue + apply, safe under duplicate retries. */
export function runGoodwillIssueAndApply(
  memos: Map<string, GoodwillMemoRecord>,
  apps: Map<string, GoodwillApplicationRecord>,
  args: {
    key: string | null;
    customerId: string;
    invoiceId: string;
    amount: number;
    reason: string;
  },
): {
  ok: boolean;
  duplicateIssue: boolean;
  duplicateApply: boolean;
  memoId?: string;
  code?: string;
} {
  const issued = replayOrInsertGoodwillMemo(memos, args);
  if (!issued.ok) return { ok: false, duplicateIssue: false, duplicateApply: false, code: issued.code };
  const applied = replayOrInsertGoodwillApplication(apps, {
    memoId: issued.memo.id,
    invoiceId: args.invoiceId,
    amount: issued.memo.amount,
  });
  if (!applied.ok) {
    return {
      ok: false,
      duplicateIssue: issued.duplicate,
      duplicateApply: false,
      memoId: issued.memo.id,
      code: applied.code,
    };
  }
  return {
    ok: true,
    duplicateIssue: issued.duplicate,
    duplicateApply: applied.duplicate,
    memoId: issued.memo.id,
  };
}

function prefixToken(
  raw: string | null | undefined,
  prefix: string,
): string | null {
  const token = (raw ?? "").trim();
  if (!token) return null;
  return token.startsWith(`${prefix}:`) ? token : `${prefix}:${token}`;
}

export function resolveDirectExpenseIdempotencyKey(
  raw: string | null | undefined,
): string | null {
  return prefixToken(raw, "direct-exp");
}

export function resolveApImportIdempotencyKey(
  raw: string | null | undefined,
): string | null {
  return prefixToken(raw, "ap-import");
}

export function resolveRefundIdempotencyKey(
  raw: string | null | undefined,
): string | null {
  return prefixToken(raw, "refund-op");
}

export function resolveApplyCreditIdempotencyKey(
  raw: string | null | undefined,
): string | null {
  return prefixToken(raw, "apply-credit");
}

export function resolveCardPaymentIdempotencyKey(
  raw: string | null | undefined,
): string | null {
  return prefixToken(raw, "card-op");
}

export function resolveWriteOffIdempotencyKey(
  raw: string | null | undefined,
): string | null {
  return prefixToken(raw, "write-off");
}

export function resolveInvoicePaymentIdempotencyKey(
  raw: string | null | undefined,
): string | null {
  return prefixToken(raw, "pay-op");
}

/** UPDATE identity: same bill + same save payload. Not a random UUID. */
export function resolveApDraftSaveIdempotencyKey(args: {
  billId: string;
  billDate: string;
  dueDate: string;
  billNumber: string;
  terms: string;
  memo: string;
}): string | null {
  const billId = args.billId.trim();
  if (!billId) return null;
  const payload = [
    args.billDate,
    args.dueDate,
    args.billNumber,
    args.terms,
    args.memo,
  ].join("\u001f");
  return `ap-draft-save:${billId}:${payload}`;
}

export type KeyedInsertResult<T> =
  | { ok: true; record: T; duplicate: boolean }
  | { ok: false; code: "MISSING_KEY" | "IDEMPOTENCY_CONFLICT" };

/**
 * Mirrors ap_lookup_action: same key + same context replays; same key +
 * different context is rejected (does not apply the changed values).
 */
export function replayOrInsertKeyed<T extends { context: string }>(
  store: Map<string, T>,
  args: { key: string | null; context: string; create: () => T },
): KeyedInsertResult<T> {
  if (!args.key) return { ok: false, code: "MISSING_KEY" };
  const existing = store.get(args.key);
  if (existing) {
    if (existing.context !== args.context) {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    return { ok: true, record: existing, duplicate: true };
  }
  const record = args.create();
  store.set(args.key, record);
  return { ok: true, record, duplicate: false };
}

export type DirectExpenseRecord = {
  id: string;
  amount: number;
  vendor: string;
  category: string;
  date: string;
  jobId: string | null;
  context: string;
};

export function directExpenseContext(args: {
  date: string;
  category: string;
  amount: number;
  vendor: string;
  jobId: string | null;
}): string {
  return JSON.stringify({
    date: args.date,
    category: args.category,
    amount: args.amount,
    vendor: args.vendor,
    jobId: args.jobId,
  });
}

export function replayOrInsertDirectExpense(
  store: Map<string, DirectExpenseRecord>,
  args: {
    key: string | null;
    date: string;
    category: string;
    amount: number;
    vendor: string;
    jobId: string | null;
  },
): KeyedInsertResult<DirectExpenseRecord> {
  const context = directExpenseContext(args);
  return replayOrInsertKeyed(store, {
    key: args.key,
    context,
    create: () => ({
      id: `exp-${store.size + 1}`,
      amount: args.amount,
      vendor: args.vendor,
      category: args.category,
      date: args.date,
      jobId: args.jobId,
      context,
    }),
  });
}

export type ApBillRecord = {
  id: string;
  supplierId: string;
  billNumber: string;
  amount: number;
  context: string;
};

export function apImportContext(args: {
  supplierId: string;
  billNumber: string;
  billDate: string;
  amount: number;
}): string {
  return JSON.stringify({
    supplierId: args.supplierId,
    billNumber: args.billNumber,
    billDate: args.billDate,
    amount: args.amount,
  });
}

export function replayOrInsertApImport(
  store: Map<string, ApBillRecord>,
  args: {
    key: string | null;
    supplierId: string;
    billNumber: string;
    billDate: string;
    amount: number;
  },
): KeyedInsertResult<ApBillRecord> {
  const context = apImportContext(args);
  return replayOrInsertKeyed(store, {
    key: args.key,
    context,
    create: () => ({
      id: `bill-${store.size + 1}`,
      supplierId: args.supplierId,
      billNumber: args.billNumber,
      amount: args.amount,
      context,
    }),
  });
}

export type ApDraftBillRecord = {
  id: string;
  memo: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  terms: string;
};

export function applyApDraftSave(
  bills: Map<string, ApDraftBillRecord>,
  actions: Map<string, ApDraftBillRecord>,
  args: {
    billId: string;
    billDate: string;
    dueDate: string;
    billNumber: string;
    terms: string;
    memo: string;
  },
):
  | { ok: true; bill: ApDraftBillRecord; duplicate: boolean }
  | { ok: false; code: "MISSING_KEY" | "NOT_FOUND" } {
  const key = resolveApDraftSaveIdempotencyKey(args);
  if (!key) return { ok: false, code: "MISSING_KEY" };
  const existingAction = actions.get(key);
  if (existingAction) {
    return { ok: true, bill: existingAction, duplicate: true };
  }
  const current = bills.get(args.billId);
  if (!current) return { ok: false, code: "NOT_FOUND" };
  const updated: ApDraftBillRecord = {
    id: args.billId,
    memo: args.memo,
    billNumber: args.billNumber,
    billDate: args.billDate,
    dueDate: args.dueDate,
    terms: args.terms,
  };
  bills.set(args.billId, updated);
  actions.set(key, updated);
  return { ok: true, bill: updated, duplicate: false };
}
