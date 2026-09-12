/**
 * Remaining financial idempotency: direct expense, AP import, AP draft save.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessApIdempotency } from "@/lib/accounting/ap-source";
import {
  AP_IMPORT_IDEMPOTENCY_REQUIRED_MESSAGE,
  DIRECT_EXPENSE_IDEMPOTENCY_REQUIRED_MESSAGE,
  applyApDraftSave,
  resolveApDraftSaveIdempotencyKey,
  resolveApImportIdempotencyKey,
  resolveDirectExpenseIdempotencyKey,
  replayOrInsertApImport,
  replayOrInsertDirectExpense,
  type ApBillRecord,
  type ApDraftBillRecord,
  type DirectExpenseRecord,
} from "@/lib/financial-idempotency";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const TOKEN_A = "op-token-a";
const TOKEN_B = "op-token-b";

const EXPENSE_A = {
  date: "2026-09-09",
  category: "materials",
  amount: 42.5,
  vendor: "Home Depot",
  jobId: null as string | null,
};

describe("direct expense operation token", () => {
  it("prefixes a client token once and keeps retries identical", () => {
    const a = resolveDirectExpenseIdempotencyKey(TOKEN_A);
    const b = resolveDirectExpenseIdempotencyKey(TOKEN_A);
    expect(a).toBe("direct-exp:op-token-a");
    expect(a).toBe(b);
    expect(resolveDirectExpenseIdempotencyKey("direct-exp:op-token-a")).toBe(
      "direct-exp:op-token-a",
    );
  });

  it("refuses an empty token instead of minting a UUID", () => {
    expect(resolveDirectExpenseIdempotencyKey("")).toBeNull();
    expect(resolveDirectExpenseIdempotencyKey("   ")).toBeNull();
    expect(DIRECT_EXPENSE_IDEMPOTENCY_REQUIRED_MESSAGE).toMatch(/token/i);
  });
});

describe("DIRECT EXPENSE", () => {
  it("one request → one expense", () => {
    const store = new Map<string, DirectExpenseRecord>();
    const first = replayOrInsertDirectExpense(store, {
      key: resolveDirectExpenseIdempotencyKey(TOKEN_A),
      ...EXPENSE_A,
    });
    expect(first.ok && !first.duplicate).toBe(true);
    expect(store.size).toBe(1);
  });

  it("duplicate same token → one expense", () => {
    const store = new Map<string, DirectExpenseRecord>();
    const key = resolveDirectExpenseIdempotencyKey(TOKEN_A);
    const req = { key, ...EXPENSE_A };
    const first = replayOrInsertDirectExpense(store, req);
    const second = replayOrInsertDirectExpense(store, req);
    expect(first.ok && !first.duplicate).toBe(true);
    expect(second.ok && second.duplicate).toBe(true);
    if (first.ok && second.ok) {
      expect(second.record.id).toBe(first.record.id);
      expect(second.record.amount).toBe(42.5);
    }
    expect(store.size).toBe(1);
  });

  it("simultaneous same token → one expense", () => {
    const store = new Map<string, DirectExpenseRecord>();
    const key = resolveDirectExpenseIdempotencyKey(TOKEN_A);
    const req = { key, ...EXPENSE_A };
    const results = [req, req].map((r) => replayOrInsertDirectExpense(store, r));
    const created = results.filter((r) => r.ok && !r.duplicate);
    const replayed = results.filter((r) => r.ok && r.duplicate);
    expect(created).toHaveLength(1);
    expect(replayed).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it("new token → second legitimate expense", () => {
    const store = new Map<string, DirectExpenseRecord>();
    const first = replayOrInsertDirectExpense(store, {
      key: resolveDirectExpenseIdempotencyKey(TOKEN_A),
      ...EXPENSE_A,
    });
    const second = replayOrInsertDirectExpense(store, {
      key: resolveDirectExpenseIdempotencyKey(TOKEN_B),
      ...EXPENSE_A,
    });
    expect(first.ok && !first.duplicate).toBe(true);
    expect(second.ok && !second.duplicate).toBe(true);
    if (first.ok && second.ok) {
      expect(second.record.id).not.toBe(first.record.id);
    }
    expect(store.size).toBe(2);
  });

  it("mismatched context is rejected (does not apply changed values)", () => {
    const store = new Map<string, DirectExpenseRecord>();
    const key = resolveDirectExpenseIdempotencyKey(TOKEN_A);
    const first = replayOrInsertDirectExpense(store, { key, ...EXPENSE_A });
    const changed = replayOrInsertDirectExpense(store, {
      key,
      ...EXPENSE_A,
      amount: 99,
    });
    expect(first.ok).toBe(true);
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(store.size).toBe(1);
    if (first.ok) expect(first.record.amount).toBe(42.5);
  });

  it("RPC context hash mismatch is conflict, not a new expense", () => {
    expect(
      assessApIdempotency({
        existingKey: "direct-exp:op-token-a",
        existingContextHash: "hash-a",
        incomingKey: "direct-exp:op-token-a",
        incomingContextHash: "hash-b",
        existingAction: "record_direct_expense",
        incomingAction: "record_direct_expense",
      }),
    ).toBe("conflict");
  });
});

describe("AP BILL IMPORT", () => {
  const BILL_A = {
    supplierId: "sup-1",
    billNumber: "INV-100",
    billDate: "2026-09-01",
    amount: 250,
  };

  it("prefixes a client token once", () => {
    const a = resolveApImportIdempotencyKey(TOKEN_A);
    expect(a).toBe("ap-import:op-token-a");
    expect(resolveApImportIdempotencyKey(a)).toBe(a);
    expect(resolveApImportIdempotencyKey("")).toBeNull();
    expect(AP_IMPORT_IDEMPOTENCY_REQUIRED_MESSAGE).toMatch(/token/i);
  });

  it("one import → one bill", () => {
    const store = new Map<string, ApBillRecord>();
    const first = replayOrInsertApImport(store, {
      key: resolveApImportIdempotencyKey(TOKEN_A),
      ...BILL_A,
    });
    expect(first.ok && !first.duplicate).toBe(true);
    expect(store.size).toBe(1);
  });

  it("duplicate retry → no duplicate", () => {
    const store = new Map<string, ApBillRecord>();
    const key = resolveApImportIdempotencyKey(TOKEN_A);
    const req = { key, ...BILL_A };
    replayOrInsertApImport(store, req);
    const retry = replayOrInsertApImport(store, req);
    expect(retry.ok && retry.duplicate).toBe(true);
    expect(store.size).toBe(1);
  });

  it("simultaneous retry → no duplicate", () => {
    const store = new Map<string, ApBillRecord>();
    const key = resolveApImportIdempotencyKey(TOKEN_A);
    const req = { key, ...BILL_A };
    const results = [req, req].map((r) => replayOrInsertApImport(store, r));
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.duplicate)).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it("new operation → allowed (same vendor/amount is still a new bill)", () => {
    const store = new Map<string, ApBillRecord>();
    replayOrInsertApImport(store, {
      key: resolveApImportIdempotencyKey(TOKEN_A),
      ...BILL_A,
    });
    const next = replayOrInsertApImport(store, {
      key: resolveApImportIdempotencyKey(TOKEN_B),
      ...BILL_A,
      billNumber: "INV-101",
    });
    expect(next.ok && !next.duplicate).toBe(true);
    expect(store.size).toBe(2);
  });

  it("same token with changed vendor/amount is conflict, not a new bill", () => {
    const store = new Map<string, ApBillRecord>();
    const key = resolveApImportIdempotencyKey(TOKEN_A);
    replayOrInsertApImport(store, { key, ...BILL_A });
    const changed = replayOrInsertApImport(store, {
      key,
      ...BILL_A,
      amount: 999,
    });
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(store.size).toBe(1);
  });
});

describe("AP DRAFT SAVE", () => {
  const seed = (): Map<string, ApDraftBillRecord> => {
    const bills = new Map<string, ApDraftBillRecord>();
    bills.set("bill-1", {
      id: "bill-1",
      memo: "",
      billNumber: "INV-1",
      billDate: "2026-09-01",
      dueDate: "2026-10-01",
      terms: "net_30",
    });
    return bills;
  };

  it("repeated save affects the same bill and does not insert a second row", () => {
    const bills = seed();
    const actions = new Map<string, ApDraftBillRecord>();
    const fields = {
      billId: "bill-1",
      billDate: "2026-09-01",
      dueDate: "2026-10-01",
      billNumber: "INV-1",
      terms: "net_30",
      memo: "first",
    };
    const first = applyApDraftSave(bills, actions, fields);
    const retry = applyApDraftSave(bills, actions, fields);
    expect(first.ok && !first.duplicate).toBe(true);
    expect(retry.ok && retry.duplicate).toBe(true);
    expect(bills.size).toBe(1);
    expect(bills.get("bill-1")?.memo).toBe("first");
  });

  it("save retry is safe (lost-response / double click)", () => {
    const bills = seed();
    const actions = new Map<string, ApDraftBillRecord>();
    const fields = {
      billId: "bill-1",
      billDate: "2026-09-01",
      dueDate: "2026-10-01",
      billNumber: "INV-1",
      terms: "net_30",
      memo: "retry-me",
    };
    const results = [fields, fields, fields].map((f) =>
      applyApDraftSave(bills, actions, f),
    );
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.duplicate)).toHaveLength(2);
    expect(bills.size).toBe(1);
  });

  it("a later edit of the same draft updates that bill (new payload is allowed)", () => {
    const bills = seed();
    const actions = new Map<string, ApDraftBillRecord>();
    applyApDraftSave(bills, actions, {
      billId: "bill-1",
      billDate: "2026-09-01",
      dueDate: "2026-10-01",
      billNumber: "INV-1",
      terms: "net_30",
      memo: "first",
    });
    const edited = applyApDraftSave(bills, actions, {
      billId: "bill-1",
      billDate: "2026-09-01",
      dueDate: "2026-10-01",
      billNumber: "INV-1",
      terms: "net_30",
      memo: "updated memo",
    });
    expect(edited.ok && !edited.duplicate).toBe(true);
    expect(bills.size).toBe(1);
    expect(bills.get("bill-1")?.memo).toBe("updated memo");
  });

  it("draft save key is deterministic for the same payload (no random UUID)", () => {
    const a = resolveApDraftSaveIdempotencyKey({
      billId: "bill-1",
      billDate: "2026-09-01",
      dueDate: "2026-10-01",
      billNumber: "INV-1",
      terms: "net_30",
      memo: "x",
    });
    const b = resolveApDraftSaveIdempotencyKey({
      billId: "bill-1",
      billDate: "2026-09-01",
      dueDate: "2026-10-01",
      billNumber: "INV-1",
      terms: "net_30",
      memo: "x",
    });
    const c = resolveApDraftSaveIdempotencyKey({
      billId: "bill-1",
      billDate: "2026-09-01",
      dueDate: "2026-10-01",
      billNumber: "INV-1",
      terms: "net_30",
      memo: "y",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^ap-draft-save:bill-1:/);
    expect(c).not.toBe(a);
  });
});

describe("wiring — no server-minted UUID keys", () => {
  it("createExpense requires the form token and never randomUUID", () => {
    const src = read("src/app/(app)/financials/actions.ts");
    const start = src.indexOf("export async function createExpense");
    const fn = src.slice(start, src.indexOf("export interface BillExtractResult"));
    expect(fn).toContain("resolveDirectExpenseIdempotencyKey");
    expect(fn).toContain("DIRECT_EXPENSE_IDEMPOTENCY_REQUIRED_MESSAGE");
    expect(fn).not.toContain("crypto.randomUUID()");
    expect(fn).not.toContain("Date.now()");
    expect(fn).toContain("record_direct_expense_safe");
  });

  it("expense form mounts a per-operation token and remints after success", () => {
    const src = read("src/app/(app)/financials/expense-form.tsx");
    expect(src).toContain("OperationIdempotencyField");
    expect(src).toContain("setOpEpoch");
    expect(src).toContain("key={opEpoch}");
  });

  it("createBillFromImport requires a stable import token", () => {
    const src = read("src/app/(app)/bills/actions.ts");
    const fn = src.slice(src.indexOf("export async function createBillFromImport"));
    const end = fn.indexOf("export async function createBillFromPO");
    const body = fn.slice(0, end);
    expect(body).toContain("resolveApImportIdempotencyKey");
    expect(body).toContain("AP_IMPORT_IDEMPOTENCY_REQUIRED_MESSAGE");
    expect(body).not.toContain("crypto.randomUUID()");
    expect(body).toContain("create_vendor_bill_safe");
    expect(body).toContain("p_idempotency_key: idem");
  });

  it("bill importer mints one token per import draft, not per save click", () => {
    const src = read("src/app/(app)/bills/bill-importer.tsx");
    expect(src).toContain("setImportToken");
    expect(src).toContain("idempotencyKey: importToken");
    expect(src).toContain("createConfirmLock");
  });

  it("updateBillMeta uses deterministic draft-save identity, not randomUUID", () => {
    const src = read("src/app/(app)/bills/actions.ts");
    const fn = src.slice(src.indexOf("export async function updateBillMeta"));
    expect(fn).toContain("resolveApDraftSaveIdempotencyKey");
    expect(fn).not.toContain("crypto.randomUUID()");
    expect(fn).toContain("save_vendor_bill_draft_safe");
  });

  it("existing AP RPC uniqueness + context lookup remain (no new migration)", () => {
    const sql = read("supabase/migrations/0175_f6_p3b_ap_vendor_integrity.sql");
    expect(sql).toContain("ap_lookup_action");
    expect(sql).toContain("ap_store_action");
    expect(sql).toContain("record_direct_expense_safe");
    expect(sql).toContain("create_vendor_bill_safe");
    expect(sql).toContain("save_vendor_bill_draft_safe");
    expect(sql).toContain("IDEMPOTENCY_CONFLICT");
    expect(sql).toContain("DUPLICATE_VENDOR_INVOICE");
    const sql166 = read("supabase/migrations/0166_f5_ap_expense_bill_payment.sql");
    expect(sql166).toContain("expenses_idempotency_key_uidx");
  });

  it("accounting period/GL actions require the form token instead of a UUID fallback", () => {
    const src = read("src/app/(app)/accounting/actions.ts");
    expect(src).not.toContain("crypto.randomUUID()");
    expect(src).toContain("Missing operation token");
    const field = read("src/app/(app)/accounting/components/idempotency-field.tsx");
    expect(field).not.toContain("Date.now()");
  });
});
