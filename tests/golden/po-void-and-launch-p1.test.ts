/**
 * P0 PO void receipt reversal + P1 inventory/docs/idempotency.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  planPoVoid,
  poVoidIdempotencyKey,
  poReceiptReverseIdempotencyKey,
  PO_VOID_HAS_OPEN_BILL,
} from "@/lib/po-void";
import { planPoReceiveDelta } from "@/lib/po-stock";
import { authorizeServiceRoleDocumentSign } from "@/lib/job-warehouse";
import {
  CARD_PAYMENT_IDEMPOTENCY_REQUIRED_MESSAGE,
  REFUND_IDEMPOTENCY_REQUIRED_MESSAGE,
  APPLY_CREDIT_IDEMPOTENCY_REQUIRED_MESSAGE,
  resolveCardPaymentIdempotencyKey,
  resolveRefundIdempotencyKey,
  resolveApplyCreditIdempotencyKey,
  resolveWriteOffIdempotencyKey,
} from "@/lib/financial-idempotency";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const sql0183 = read("supabase/migrations/0183_po_void_receipt_reversal.sql");
const sql0184 = read("supabase/migrations/0184_inventory_ops_anon_and_documents.sql");

describe("PO void reversal planner", () => {
  it("1. never received → void with nothing to reverse", () => {
    const p = planPoVoid({ status: "ordered", openBillCount: 0, movements: [] });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.reverseIds).toEqual([]);
      expect(p.reverseQty).toBe(0);
    }
  });

  it("2. partial receipt (status ordered) still reverses ledger qty", () => {
    const p = planPoVoid({
      status: "ordered",
      openBillCount: 0,
      movements: [{ id: "m1", qty: 4, alreadyReversed: false }],
    });
    expect(p.ok && p.reverseIds).toEqual(["m1"]);
    if (p.ok) expect(p.reverseQty).toBe(4);
  });

  it("3. full receive movements reverse in aggregate", () => {
    const p = planPoVoid({
      status: "received",
      openBillCount: 0,
      movements: [
        { id: "a", qty: 3, alreadyReversed: false },
        { id: "b", qty: 7, alreadyReversed: false },
      ],
    });
    expect(p.ok && p.reverseQty).toBe(10);
  });

  it("5. multiple receipts reverse each unreversed id once", () => {
    const p = planPoVoid({
      status: "ordered",
      openBillCount: 0,
      movements: [
        { id: "a", qty: 2, alreadyReversed: false },
        { id: "b", qty: 1, alreadyReversed: true },
        { id: "c", qty: 5, alreadyReversed: false },
      ],
    });
    expect(p.ok && p.reverseIds).toEqual(["a", "c"]);
  });

  it("6. already reversed movements are skipped (retry)", () => {
    const p = planPoVoid({
      status: "void",
      openBillCount: 0,
      movements: [{ id: "m1", qty: 4, alreadyReversed: true }],
    });
    expect(p.ok && p.alreadyVoid).toBe(true);
    if (p.ok) expect(p.reverseIds).toEqual([]);
  });

  it("7. open vendor bill blocks void", () => {
    const p = planPoVoid({
      status: "ordered",
      openBillCount: 1,
      movements: [{ id: "m1", qty: 2, alreadyReversed: false }],
    });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.code).toBe("PO_VOID_HAS_OPEN_BILL");
      expect(p.error).toBe(PO_VOID_HAS_OPEN_BILL);
    }
  });

  it("void keys are stable (no Date.now)", () => {
    expect(poVoidIdempotencyKey("po-1")).toBe("po-void:po-1");
    expect(poReceiptReverseIdempotencyKey("po-1", "mov-1")).toBe(
      "po-recv-rev:po-1:mov-1",
    );
    expect(poVoidIdempotencyKey("po-1")).not.toMatch(/Date\.now/);
  });
});

describe("PO receive still fail-closed on over-receive", () => {
  it("cannot receive more than ordered", () => {
    const r = planPoReceiveDelta({
      orderedQty: 10,
      targetReceivedQty: 11,
      alreadyOnLedger: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("second partial posts only the delta", () => {
    const r = planPoReceiveDelta({
      orderedQty: 10,
      targetReceivedQty: 7,
      alreadyOnLedger: 4,
    });
    expect(r).toEqual({ ok: true, delta: 3 });
  });
});

describe("0183 SQL", () => {
  it("void RPC reverses receipts regardless of PO status", () => {
    expect(sql0183).toContain("void_purchase_order_safe");
    expect(sql0183).toContain("reverse_po_receipts_safe");
    expect(sql0183).toContain("reverse_inventory_movement_safe");
    expect(sql0183).toContain("kind = 'receive'");
  });

  it("app reverseReceivedPOs is not status=received only", () => {
    const stock = read("src/lib/po-stock.ts");
    expect(stock).toContain("reverse_po_receipts_safe");
    expect(stock).not.toMatch(
      /if \(\(po\.status as PoStatus\) === "received"\)/,
    );
    const actions = read("src/app/(app)/purchase-orders/actions.ts");
    expect(actions).toContain("void_purchase_order_safe");
    expect(actions).toContain("assertRole");
  });
});

describe("0184 products_inventory_ops fail-closed", () => {
  it("requires non-null uid and explicit internal roles", () => {
    const view = sql0184.slice(
      sql0184.indexOf("create or replace view public.products_inventory_ops"),
      sql0184.indexOf("comment on view public.products_inventory_ops"),
    );
    expect(view).toContain("auth.uid() is not null");
    expect(view).toContain("'warehouse'");
    expect(view).not.toContain("is distinct from 'customer'");
    expect(sql0184).toContain(
      "revoke all on public.products_inventory_ops from public, anon",
    );
  });

  it("documents storage is path-scoped (salesman cannot blanket-read)", () => {
    expect(sql0184).toContain("drop policy if exists documents_storage_rw");
    expect(sql0184).toContain("can_read_documents_object");
    expect(sql0184).toContain("mine_customer");
    expect(sql0184).toContain("mine_job");
    expect(sql0184).toContain("documents_storage_select");
    const salesmanFn = sql0184.slice(
      sql0184.indexOf("create or replace function public.can_access_documents_object"),
      sql0184.indexOf("create or replace function public.can_read_documents_object"),
    );
    expect(salesmanFn).not.toMatch(/first_folder\(object_name\) = 'notes'/);
    expect(sql0184).toContain("owner = auth.uid()");
  });

  it("anon and customer are excluded from inventory ops allowlist", () => {
    const view = sql0184.slice(
      sql0184.indexOf("create or replace view public.products_inventory_ops"),
      sql0184.indexOf("comment on view public.products_inventory_ops"),
    );
    expect(view).not.toContain("'customer'");
    expect(view).not.toContain("'anon'");
  });
});

describe("0183 consumed stock and concurrency", () => {
  it("reversal fail-closes on negative/unsafe stock and uses row locks", () => {
    expect(sql0183).toContain("INV_NEGATIVE_STOCK");
    expect(sql0183).toContain("INV_REVERSAL_UNSAFE");
    expect(sql0183).toContain("for update");
    expect(sql0183).toContain("inv_begin_action");
    expect(sql0183).toContain("already_void");
    expect(sql0183).toContain("ALREADY_REVERSED");
  });

  it("warehouse_ready_at is cleared when receipts reverse on a job PO", () => {
    expect(sql0183).toContain("warehouse_ready_at = null");
  });
});

describe("service-role document signing requires caller auth", () => {
  it("crew cannot sign for an unclaimed board-visible job", () => {
    expect(
      authorizeServiceRoleDocumentSign({
        role: "crew",
        userId: "crew-1",
        jobVisible: true,
        jobAssignedTo: "someone-else",
        jobAssignedCrewId: null,
        memberCrewIds: [],
      }),
    ).toBe(false);
  });

  it("crew assigned can sign; customer cannot", () => {
    expect(
      authorizeServiceRoleDocumentSign({
        role: "crew",
        userId: "crew-1",
        jobVisible: true,
        jobAssignedTo: "crew-1",
        jobAssignedCrewId: null,
        memberCrewIds: [],
      }),
    ).toBe(true);
    expect(
      authorizeServiceRoleDocumentSign({
        role: "customer",
        userId: "cust-1",
        jobVisible: true,
        jobAssignedTo: "crew-1",
        jobAssignedCrewId: null,
        memberCrewIds: [],
      }),
    ).toBe(false);
  });

  it("getJobPhotos / getMeasurementDocuments call the gate", () => {
    const docs = read("src/lib/data/documents.ts");
    expect(docs).toContain("authorizeServiceRoleDocumentSign");
    expect(docs).toContain("assertCanSignJobDocuments");
    expect(docs).toContain("jobId?: string | null");
  });
});

describe("idempotency tokens — no same-day collision fallback", () => {
  it("refund / apply-credit / card require a form token", () => {
    expect(resolveRefundIdempotencyKey("")).toBeNull();
    expect(resolveApplyCreditIdempotencyKey("")).toBeNull();
    expect(resolveCardPaymentIdempotencyKey("")).toBeNull();
    expect(resolveRefundIdempotencyKey("tok-a")).toBe("refund-op:tok-a");
    expect(resolveApplyCreditIdempotencyKey("tok-a")).toBe("apply-credit:tok-a");
    expect(resolveCardPaymentIdempotencyKey("tok-a")).toBe("card-op:tok-a");
    expect(resolveWriteOffIdempotencyKey("")).toBeNull();
    expect(resolveWriteOffIdempotencyKey("tok-w")).toBe("write-off:tok-w");
    expect(REFUND_IDEMPOTENCY_REQUIRED_MESSAGE).toMatch(/token/i);
    expect(APPLY_CREDIT_IDEMPOTENCY_REQUIRED_MESSAGE).toMatch(/token/i);
    expect(CARD_PAYMENT_IDEMPOTENCY_REQUIRED_MESSAGE).toMatch(/token/i);
  });

  it("same token retries; a new token is a new operation", () => {
    const a = resolveCardPaymentIdempotencyKey("op-1");
    const retry = resolveCardPaymentIdempotencyKey("op-1");
    const b = resolveCardPaymentIdempotencyKey("op-2");
    expect(a).toBe(retry);
    expect(b).not.toBe(a);
  });

  it("server fallbacks no longer embed today() for card/refund/apply", () => {
    const credits = read("src/app/(app)/credits/actions.ts");
    const invoices = read("src/app/(app)/invoices/actions.ts");
    expect(credits).toContain("resolveRefundIdempotencyKey");
    expect(credits).toContain("resolveApplyCreditIdempotencyKey");
    expect(credits).not.toMatch(/refund:\$\{memoId\}:\$\{amount\}:\$\{today\(\)\}/);
    expect(invoices).toContain("resolveCardPaymentIdempotencyKey");
    expect(invoices).toContain("resolveInvoicePaymentIdempotencyKey");
    expect(invoices).not.toContain("card-deposit:${customerId}");
    expect(invoices).not.toMatch(/manual:\$\{invoiceId\}:\$\{payAmount\}:\$\{/);
  });
});
