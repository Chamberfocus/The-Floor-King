/**
 * Goodwill credit idempotency — stable per-operation token, RPC replay contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";
import {
  GOODWILL_IDEMPOTENCY_REQUIRED_MESSAGE,
  goodwillApplyIdempotencyKey,
  resolveGoodwillIdempotencyKey,
  replayOrInsertGoodwillMemo,
  runGoodwillIssueAndApply,
  type GoodwillApplicationRecord,
  type GoodwillMemoRecord,
} from "@/lib/financial-idempotency";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const TOKEN_A = "op-token-a";
const TOKEN_B = "op-token-b";

describe("goodwill operation token", () => {
  it("prefixes a client token once and keeps retries identical", () => {
    const a = resolveGoodwillIdempotencyKey(TOKEN_A);
    const b = resolveGoodwillIdempotencyKey(TOKEN_A);
    expect(a).toBe("goodwill:op-token-a");
    expect(a).toBe(b);
    expect(resolveGoodwillIdempotencyKey("goodwill:op-token-a")).toBe(
      "goodwill:op-token-a",
    );
  });

  it("refuses an empty token instead of minting Date.now()", () => {
    expect(resolveGoodwillIdempotencyKey("")).toBeNull();
    expect(resolveGoodwillIdempotencyKey("   ")).toBeNull();
    expect(GOODWILL_IDEMPOTENCY_REQUIRED_MESSAGE).toMatch(/token/i);
  });
});

describe("CASE A — duplicate retry of one $50 goodwill", () => {
  it("same operation token submitted twice creates one memo", () => {
    const store = new Map<string, GoodwillMemoRecord>();
    const key = resolveGoodwillIdempotencyKey(TOKEN_A);
    const req = {
      key,
      customerId: "cust-1",
      amount: 50,
      reason: "Goodwill",
    };
    const first = replayOrInsertGoodwillMemo(store, req);
    const second = replayOrInsertGoodwillMemo(store, req);
    expect(first.ok && !first.duplicate).toBe(true);
    expect(second.ok && second.duplicate).toBe(true);
    if (first.ok && second.ok) {
      expect(second.memo.id).toBe(first.memo.id);
      expect(second.memo.amount).toBe(50);
    }
    expect(store.size).toBe(1);
  });

  it("simultaneous duplicate requests (unique-violation race) still one memo", () => {
    const store = new Map<string, GoodwillMemoRecord>();
    const key = resolveGoodwillIdempotencyKey(TOKEN_A)!;
    const req = {
      key,
      customerId: "cust-1",
      amount: 50,
      reason: "Goodwill",
    };
    const results = [req, req].map((r) => replayOrInsertGoodwillMemo(store, r));
    const created = results.filter((r) => r.ok && !r.duplicate);
    const replayed = results.filter((r) => r.ok && r.duplicate);
    expect(created).toHaveLength(1);
    expect(replayed).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it("lost-response retry reuses the memo and does not apply twice", () => {
    const memos = new Map<string, GoodwillMemoRecord>();
    const apps = new Map<string, GoodwillApplicationRecord>();
    const args = {
      key: resolveGoodwillIdempotencyKey(TOKEN_A),
      customerId: "cust-1",
      invoiceId: "inv-1",
      amount: 50,
      reason: "Goodwill",
    };
    const first = runGoodwillIssueAndApply(memos, apps, args);
    const retry = runGoodwillIssueAndApply(memos, apps, args);
    expect(first.ok && !first.duplicateIssue && !first.duplicateApply).toBe(true);
    expect(retry.ok && retry.duplicateIssue && retry.duplicateApply).toBe(true);
    expect(retry.memoId).toBe(first.memoId);
    expect(memos.size).toBe(1);
    expect(apps.size).toBe(1);
    expect(goodwillApplyIdempotencyKey(first.memoId!, "inv-1")).toBe(
      `apply-goodwill:${first.memoId}:inv-1`,
    );
  });

  it("effective invoice balance drops by $50 once, not twice", () => {
    const memos = new Map<string, GoodwillMemoRecord>();
    const apps = new Map<string, GoodwillApplicationRecord>();
    const args = {
      key: resolveGoodwillIdempotencyKey(TOKEN_A),
      customerId: "cust-1",
      invoiceId: "inv-1",
      amount: 50,
      reason: "Goodwill",
    };
    runGoodwillIssueAndApply(memos, apps, args);
    runGoodwillIssueAndApply(memos, apps, args);
    const applied = [...apps.values()].reduce((s, a) => s + a.amount, 0);
    expect(applied).toBe(50);
    const due = effectiveInvoiceBalance({
      items: [{ quantity: 1, rate: 100 }],
      taxRate: 0,
      amountPaid: 0,
      appliedCredits: applied,
    }).amountDue;
    expect(due).toBe(50);
  });
});

describe("CASE B — legitimate later goodwill", () => {
  it("a new operation token issues a second $50 credit", () => {
    const memos = new Map<string, GoodwillMemoRecord>();
    const apps = new Map<string, GoodwillApplicationRecord>();
    const first = runGoodwillIssueAndApply(memos, apps, {
      key: resolveGoodwillIdempotencyKey(TOKEN_A),
      customerId: "cust-1",
      invoiceId: "inv-1",
      amount: 50,
      reason: "First courtesy",
    });
    const second = runGoodwillIssueAndApply(memos, apps, {
      key: resolveGoodwillIdempotencyKey(TOKEN_B),
      customerId: "cust-1",
      invoiceId: "inv-1",
      amount: 50,
      reason: "Second courtesy",
    });
    expect(first.ok && second.ok).toBe(true);
    expect(second.memoId).not.toBe(first.memoId);
    expect(memos.size).toBe(2);
    expect(apps.size).toBe(2);
    const applied = [...apps.values()].reduce((s, a) => s + a.amount, 0);
    expect(applied).toBe(100);
    expect(
      effectiveInvoiceBalance({
        items: [{ quantity: 1, rate: 200 }],
        taxRate: 0,
        amountPaid: 0,
        appliedCredits: applied,
      }).amountDue,
    ).toBe(100);
  });
});

describe("token context mismatch", () => {
  it("same token against a different customer is rejected", () => {
    const store = new Map<string, GoodwillMemoRecord>();
    const key = resolveGoodwillIdempotencyKey(TOKEN_A);
    replayOrInsertGoodwillMemo(store, {
      key,
      customerId: "cust-1",
      amount: 50,
      reason: "Goodwill",
    });
    const cross = replayOrInsertGoodwillMemo(store, {
      key,
      customerId: "cust-2",
      amount: 50,
      reason: "Goodwill",
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.code).toBe("IDEMPOTENCY_CROSS_ENTITY");
    expect(store.size).toBe(1);
  });

  it("same token with a changed amount replays the original credit (does not insert)", () => {
    const store = new Map<string, GoodwillMemoRecord>();
    const key = resolveGoodwillIdempotencyKey(TOKEN_A);
    const first = replayOrInsertGoodwillMemo(store, {
      key,
      customerId: "cust-1",
      amount: 50,
      reason: "Goodwill",
    });
    const changed = replayOrInsertGoodwillMemo(store, {
      key,
      customerId: "cust-1",
      amount: 80,
      reason: "Different amount",
    });
    expect(changed.ok && changed.duplicate).toBe(true);
    if (first.ok && changed.ok) {
      expect(changed.memo.amount).toBe(50);
      expect(changed.memo.id).toBe(first.memo.id);
    }
    expect(store.size).toBe(1);
  });
});

describe("wiring + write-off unchanged", () => {
  it("invoice goodwill form sends a per-mount operation token", () => {
    const page = read("src/app/(app)/invoices/[id]/page.tsx");
    const form = page.slice(
      page.indexOf("Issue goodwill credit"),
      page.indexOf("Write off remaining"),
    );
    expect(form).toContain("PaymentIdempotencyField");
    expect(page).toContain("action={issueGoodwillCredit}");
  });

  it("issueGoodwillCredit requires the token and never uses Date.now()", () => {
    const src = read("src/app/(app)/credits/actions.ts");
    expect(src).toContain("resolveGoodwillIdempotencyKey");
    expect(src).toContain("GOODWILL_IDEMPOTENCY_REQUIRED_MESSAGE");
    expect(src).toContain("goodwillApplyIdempotencyKey");
    expect(src).not.toMatch(/goodwill:[\s\S]*Date\.now\(\)/);
    expect(src).toContain('p_kind: "manual"');
    expect(src).toContain("CREDIT_MUTATE_ROLES");
  });

  it("RPC unique index + replay still exist; no new migration", () => {
    const sql = read("supabase/migrations/0159_f1_credits_refunds.sql");
    expect(sql).toContain("credit_memos_idempotency_key_uidx");
    expect(sql).toContain("credit_applications_idempotency_key_uidx");
    const rpc = read("supabase/migrations/0171_f6_p2a_audit_retrofit.sql");
    expect(rpc).toContain("issue_credit_memo_safe");
    expect(rpc).toContain("IDEMPOTENCY_CROSS_ENTITY");
    expect(rpc).toContain("'duplicate', true");
  });

  it("write-off requires a form token (no invoice+amount collision key)", () => {
    const src = read("src/app/(app)/credits/actions.ts");
    const wo = src.slice(src.indexOf("export async function writeOffInvoiceBalance"));
    expect(wo).toContain("resolveWriteOffIdempotencyKey");
    expect(wo).toContain("WRITE_OFF_IDEMPOTENCY_REQUIRED_MESSAGE");
    expect(wo).not.toContain("Date.now()");
    expect(wo).not.toContain("`wo:${invoiceId}:${amount}:${user?.id ?? \"\"}`");
    expect(wo).toContain("write_off_invoice_safe");
    const page = read("src/app/(app)/invoices/[id]/page.tsx");
    const form = page.slice(page.indexOf("writeOffInvoiceBalance"));
    expect(form).toContain("PaymentIdempotencyField");
  });
});
