/**
 * Existing customer duplicate cleanup — detector, merge decisions, SQL markers.
 * No production mutation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LIVE_CUSTOMER_REASSIGN,
  MERGE_SQL_TABLES,
  IMMUTABLE_CUSTOMER_REFS,
} from "@/lib/customer-reference-map";
import {
  authorizeMerge,
  authorizeDuplicateReview,
  canonicalCustomerId,
  classifyCleanupPair,
  depositRestrictionsIntact,
  executeCustomerMerge,
  exclusionKey,
  filterDuplicateGroups,
  findCleanupDuplicateGroups,
  financialsUnchanged,
  hideMergedCustomers,
  maskEmail,
  maskPhone,
  mergeIdempotencyKey,
  normalizeExclusionPair,
  previewMerge,
  resolveChosenProfile,
  snapshotFinancials,
  type InMemoryMergeState,
} from "@/lib/customer-duplicate-cleanup";
import { uniqueCustomersById } from "@/lib/customer-list";
import { productionDuplicateAuditStatus } from "@/lib/data/customer-duplicate-cleanup";

const ROOT = join(import.meta.dirname, "../..");
const sql0185 = readFileSync(
  join(ROOT, "supabase/migrations/0185_customer_duplicate_merge.sql"),
  "utf8",
);

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function cust(
  id: string,
  extra: Partial<InMemoryMergeState["customers"][number]> = {},
): InMemoryMergeState["customers"][number] {
  return {
    id,
    full_name: extra.full_name ?? "John Smith",
    phone: extra.phone ?? "216-555-1111",
    email: extra.email ?? "john@email.com",
    street: extra.street ?? "123 Main St",
    city: extra.city ?? "Cleveland",
    state: extra.state ?? "OH",
    zip: extra.zip ?? "44102",
    created_at: extra.created_at ?? "2024-01-01T00:00:00.000Z",
    ...extra,
  };
}

function baseState(over: Partial<InMemoryMergeState> = {}): InMemoryMergeState {
  return {
    customers: [cust(A, { created_at: "2024-01-01T00:00:00.000Z" }), cust(B, { created_at: "2026-01-01T00:00:00.000Z" })],
    jobs: [
      { id: "j1", customer_id: A, status: "scheduled" },
      { id: "j2", customer_id: A, status: "completed" },
      { id: "j3", customer_id: B, status: "unscheduled" },
    ],
    estimates: [
      { id: "e1", customer_id: A },
      { id: "e2", customer_id: B },
    ],
    invoices: [
      {
        id: "i1",
        customer_id: A,
        status: "sent",
        tax_rate: 0,
        items: [{ quantity: 1, rate: 1000 }],
        amountPaid: 200,
        appliedCredits: 50,
        appliedDeposits: 25,
        appliedWriteOffs: 10,
      },
      {
        id: "i2",
        customer_id: B,
        status: "sent",
        tax_rate: 0,
        items: [{ quantity: 1, rate: 400 }],
        amountPaid: 100,
        appliedCredits: 0,
        appliedDeposits: 0,
        appliedWriteOffs: 0,
        counter_sale: true,
      },
    ],
    deposits: [
      {
        id: "d1",
        customer_id: A,
        job_id: "j1",
        estimate_id: null,
        amount: 25,
        unapplied: 0,
      },
      {
        id: "d2",
        customer_id: B,
        job_id: "j3",
        estimate_id: null,
        amount: 80,
        unapplied: 80,
      },
    ],
    creditMemos: [{ id: "c1", customer_id: A, amount: 50 }],
    refunds: [{ id: "r1", customer_id: B, amount: 20 }],
    writeOffs: [{ id: "w1", invoice_id: "i1", amount: 10 }],
    orders: [{ id: "o1", customer_id: B }],
    appointments: [{ id: "ap1", customer_id: B }],
    documents: [{ id: "doc1", customer_id: B, path: `${B}/measure.pdf` }],
    notes: [{ id: "n1", customer_id: B, body: "Called" }],
    portalProfiles: [],
    estimateDrafts: [],
    exclusions: [],
    mergeHistory: [],
    locks: new Set(),
    accountingPostings: 0,
    accountingEnabled: false,
    ...over,
  };
}

describe("reference map", () => {
  it("lists live reassignment targets used by the RPC", () => {
    for (const table of MERGE_SQL_TABLES) {
      expect(sql0185).toContain(`'${table}'`);
      expect(sql0185).toContain(`customer_merge_reassign('${table}'`);
    }
    expect(LIVE_CUSTOMER_REASSIGN.length).toBeGreaterThan(15);
    expect(IMMUTABLE_CUSTOMER_REFS.map((r) => r.table)).toContain(
      "journal_lines",
    );
    expect(sql0185).not.toContain("update public.journal_lines");
    expect(sql0185).not.toContain("update public.estimate_approval_snapshots");
  });
});

describe("read-only duplicate detector", () => {
  it("HIGH — exact phone + email", () => {
    const cls = classifyCleanupPair(
      cust(A),
      cust(B, { street: "123 Main Street" }),
    );
    expect(cls?.confidence).toBe("high");
    expect(cls?.reasons.some((r) => r === "phone" || r === "phone_name")).toBe(
      true,
    );
    expect(cls?.reasons.some((r) => r === "email" || r === "email_name")).toBe(
      true,
    );
  });

  it("LOW — same name only, never automatic", () => {
    const cls = classifyCleanupPair(
      cust(A, { phone: "216-555-0000", email: "a@x.com", street: "1 A St" }),
      cust(B, { phone: "216-555-9999", email: "b@x.com", street: "2 B St" }),
    );
    expect(cls?.confidence).toBe("low");
    expect(cls?.reasons).toContain("name");
    const groups = findCleanupDuplicateGroups({
      customers: [
        cust(A, { phone: "216-555-0000", email: "a@x.com", street: "1 A St" }),
        cust(B, { phone: "216-555-9999", email: "b@x.com", street: "2 B St" }),
      ],
    });
    const high = filterDuplicateGroups(groups, { confidence: "high" });
    expect(high).toHaveLength(0);
    expect(groups[0]?.confidence).toBe("low");
  });

  it("masks phone and email in reports", () => {
    expect(maskPhone("216-555-1111")).toBe("(•••) •••-1111");
    expect(maskEmail("john@email.com")).toBe("j•••@email.com");
  });
});

describe("TEST 1 — jobs move, not cloned", () => {
  it("merge B → A makes all jobs visible on A", () => {
    const r = executeCustomerMerge({
      state: baseState(),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "Same household",
      idempotencyKey: mergeIdempotencyKey(A, B),
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const jobs = r.state.jobs.filter((j) => j.customer_id === A);
    expect(jobs.map((j) => j.id).sort()).toEqual(["j1", "j2", "j3"]);
    expect(r.state.jobs.filter((j) => j.customer_id === B)).toHaveLength(0);
    expect(new Set(r.state.jobs.map((j) => j.id)).size).toBe(3);
  });
});

describe("TEST 2 — invoice totals unchanged", () => {
  it("combined invoice total is identical after merge", () => {
    const state = baseState();
    const before = snapshotFinancials(state.invoices);
    const r = executeCustomerMerge({
      state,
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "Same person",
      idempotencyKey: "k-inv",
      actorId: "admin-1",
      actorRole: "office",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = snapshotFinancials(r.state.invoices);
    expect(after.invoiceTotal).toBe(before.invoiceTotal);
    expect(after.invoiceTotal).toBe(1400);
  });
});

describe("TEST 3 — payments/credits/deposits/write-offs / open AR", () => {
  it("combined open AR is identical before and after", () => {
    const state = baseState();
    const before = previewMerge({ state, survivorId: A, duplicateId: B });
    const r = executeCustomerMerge({
      state,
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "Same person",
      idempotencyKey: "k-ar",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = snapshotFinancials(r.state.invoices.filter((i) => i.customer_id === A));
    expect(financialsUnchanged(before.combinedFinancials, {
      ...after,
      depositBalances: before.combinedFinancials.depositBalances,
      refunds: before.combinedFinancials.refunds,
    })).toBe(true);
    // Canonical: max(0, total - payments - credits - deposits - write-offs)
    // 1000-200-50-25-10 = 715; 400-100 = 300; combined 1015
    expect(after.openAr).toBe(1015);
  });
});

describe("TEST 4 — cash-and-carry", () => {
  it("counter sale / C&C attaches to survivor without cloning", () => {
    const r = executeCustomerMerge({
      state: baseState({
        jobs: [
          { id: "cc1", customer_id: A, delivery_type: "cash_carry" },
          { id: "cc2", customer_id: B, delivery_type: "cash_carry" },
        ],
      }),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "Walk-in repeat",
      idempotencyKey: "k-cc",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cc = r.state.jobs.filter((j) => j.delivery_type === "cash_carry");
    expect(cc).toHaveLength(2);
    expect(cc.every((j) => j.customer_id === A)).toBe(true);
  });
});

describe("TEST 5 — conflicting profile fields", () => {
  it("requires explicit selection and applies the chosen values", () => {
    const state = baseState({
      customers: [
        cust(A, { phone: "216-555-1111", email: "a@x.com" }),
        cust(B, { phone: "216-555-2222", email: "b@x.com" }),
      ],
    });
    const blocked = executeCustomerMerge({
      state,
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "Same",
      idempotencyKey: "k-fields-block",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("FIELD_CONFLICT");

    const chosen = resolveChosenProfile(state.customers[0]!, state.customers[1]!, {
      phone: "duplicate",
      email: "survivor",
    });
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    const merged = executeCustomerMerge({
      state,
      survivorId: A,
      duplicateId: B,
      chosen: { phone: "duplicate", email: "survivor" },
      reason: "Same",
      idempotencyKey: "k-fields",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const surv = merged.state.customers.find((c) => c.id === A)!;
    expect(surv.phone).toBe("216-555-2222");
    expect(surv.email).toBe("a@x.com");
  });
});

describe("TEST 6 — not a duplicate suppression", () => {
  it("normalized pair is excluded from later groups", () => {
    const pair = normalizeExclusionPair(B, A);
    expect(pair.customer_id_a).toBe(A);
    expect(exclusionKey(B, A)).toBe(exclusionKey(A, B));
    const groups = findCleanupDuplicateGroups({
      customers: [cust(A), cust(B)],
      exclusions: [{ customer_id_a: pair.customer_id_a, customer_id_b: pair.customer_id_b }],
    });
    expect(groups).toHaveLength(0);
  });
});

describe("TEST 7 + 8 — authorization", () => {
  it("denies merge without authorization", () => {
    expect(authorizeMerge("customer").ok).toBe(false);
    expect(authorizeDuplicateReview("crew").ok).toBe(false);
    expect(authorizeDuplicateReview("warehouse").ok).toBe(false);
  });

  it("denies salesman merge; sales_manager may view only", () => {
    expect(authorizeMerge("salesman").ok).toBe(false);
    expect(authorizeDuplicateReview("sales_manager").ok).toBe(true);
    expect(authorizeMerge("sales_manager").ok).toBe(false);
    const r = executeCustomerMerge({
      state: baseState(),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "nope",
      idempotencyKey: "k-sales",
      actorId: "sales-1",
      actorRole: "salesman",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_AUTHORIZED");
  });
});

describe("TEST 9 — concurrent merge", () => {
  it("only one attempt proceeds while rows are locked", () => {
    const state = baseState();
    state.locks.add(A);
    state.locks.add(B);
    const r = executeCustomerMerge({
      state,
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "race",
      idempotencyKey: "k-lock",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MERGE_IN_PROGRESS");
  });
});

describe("TEST 10 — idempotency retry", () => {
  it("second identical key returns the prior success without cloning", () => {
    const key = mergeIdempotencyKey(A, B);
    const first = executeCustomerMerge({
      state: baseState(),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "Same",
      idempotencyKey: key,
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = executeCustomerMerge({
      state: first.state,
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "Same",
      idempotencyKey: key,
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.state.jobs.filter((j) => j.customer_id === A)).toHaveLength(3);
    expect(second.state.mergeHistory).toHaveLength(1);
  });
});

describe("TEST 11 — duplicate already merged", () => {
  it("cannot merge the same duplicate into a third customer", () => {
    const first = executeCustomerMerge({
      state: baseState({
        customers: [cust(A), cust(B), cust(C, { full_name: "Other", phone: "440-555-0000", email: "c@x.com" })],
      }),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "first",
      idempotencyKey: "k-11a",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = executeCustomerMerge({
      state: first.state,
      survivorId: C,
      duplicateId: B,
      chosen: {},
      reason: "second",
      idempotencyKey: "k-11b",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("DUPLICATE_MERGED");
  });
});

describe("TEST 12 — survivor already merged", () => {
  it("blocks using a merged-away record as the survivor", () => {
    const first = executeCustomerMerge({
      state: baseState({
        customers: [cust(A), cust(B), cust(C, { full_name: "Other", phone: "440-555-0000", email: "c@x.com" })],
      }),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "first",
      idempotencyKey: "k-12a",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = executeCustomerMerge({
      state: first.state,
      survivorId: B,
      duplicateId: C,
      chosen: {},
      reason: "second",
      idempotencyKey: "k-12b",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("SURVIVOR_MERGED");
  });
});

describe("TEST 13 — portal identity conflict", () => {
  it("blocks merge when both records have portal users", () => {
    const r = executeCustomerMerge({
      state: baseState({
        portalProfiles: [
          { id: "p1", customer_id: A, role: "customer" },
          { id: "p2", customer_id: B, role: "customer" },
        ],
      }),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "same",
      idempotencyKey: "k-portal",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("PORTAL_CONFLICT");
  });
});

describe("TEST 14 — storage/doc linkage", () => {
  it("moves DB customer_id and leaves the storage path unchanged", () => {
    const r = executeCustomerMerge({
      state: baseState(),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "same",
      idempotencyKey: "k-doc",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = r.state.documents.find((d) => d.id === "doc1")!;
    expect(doc.customer_id).toBe(A);
    expect(doc.path).toBe(`${B}/measure.pdf`);
  });
});

describe("TEST 15 — list hides merged-away", () => {
  it("active list is one row per canonical id", () => {
    const first = executeCustomerMerge({
      state: baseState(),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "same",
      idempotencyKey: "k-list",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const visible = hideMergedCustomers(first.state.customers);
    expect(visible.map((c) => c.id)).toEqual([A]);
    expect(uniqueCustomersById(visible)).toHaveLength(1);
  });
});

describe("TEST 16 — old customer URL", () => {
  it("canonical id follows merged_into to the survivor", () => {
    const first = executeCustomerMerge({
      state: baseState(),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "same",
      idempotencyKey: "k-url",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dup = first.state.customers.find((c) => c.id === B)!;
    expect(canonicalCustomerId(dup)).toBe(A);
    const page = readFileSync(
      join(ROOT, "src/app/(app)/customers/[id]/page.tsx"),
      "utf8",
    );
    expect(page).toContain("merged_into_customer_id");
    expect(page).toContain("Customer merged into");
  });
});

describe("TEST 17 — deposit job restrictions", () => {
  it("reassigns identity without broadening job/estimate tags or auto-applying", () => {
    const before = baseState();
    const r = executeCustomerMerge({
      state: before,
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "same",
      idempotencyKey: "k-dep",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(depositRestrictionsIntact(before.deposits, r.state.deposits)).toBe(true);
    const moved = r.state.deposits.find((d) => d.id === "d2")!;
    expect(moved.customer_id).toBe(A);
    expect(moved.job_id).toBe("j3");
    expect(moved.unapplied).toBe(80);
  });
});

describe("TEST 18 — no accounting posting", () => {
  it("merge does not create accounting entries or enable posting", () => {
    const r = executeCustomerMerge({
      state: baseState(),
      survivorId: A,
      duplicateId: B,
      chosen: {},
      reason: "same",
      idempotencyKey: "k-acct",
      actorId: "admin-1",
      actorRole: "admin",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.accountingPostings).toBe(0);
    expect(r.state.accountingEnabled).toBe(false);
    expect(sql0185).toContain("Do NOT set posting_enabled");
    expect(sql0185).not.toMatch(/posting_enabled\s*=\s*true/);
  });
});

describe("migration + UI wiring", () => {
  it("0185 is additive, transactional, locked, and not applied by the app", () => {
    expect(sql0185).toContain("merge_customer_records");
    expect(sql0185).toContain("pg_advisory_xact_lock");
    expect(sql0185).toContain("idempotency_key");
    expect(sql0185).toContain("customer_duplicate_exclusions");
    expect(sql0185).toContain("merged_into_customer_id");
    expect(sql0185).toContain("PORTAL_CONFLICT");
    expect(sql0185).toContain("security definer");
    expect(sql0185).toContain("set search_path = public");
    expect(sql0185).not.toMatch(/delete from public\.customers/i);
    expect(sql0185).toContain("Do NOT apply this file to production without owner review");
  });

  it("admin duplicate review page is role-gated", () => {
    const page = readFileSync(
      join(ROOT, "src/app/(app)/customers/duplicates/page.tsx"),
      "utf8",
    );
    const actions = readFileSync(
      join(ROOT, "src/app/(app)/customers/duplicates/actions.ts"),
      "utf8",
    );
    const nav = readFileSync(join(ROOT, "src/lib/nav.ts"), "utf8");
    expect(page).toContain('requireRole(["admin", "office", "sales_manager"])');
    expect(actions).toContain("assertRole([...MERGE_ROLES])");
    expect(actions).toContain('["admin", "office"]');
    expect(nav).toContain("/customers/duplicates");
    expect(nav).not.toMatch(/Duplicate Review[\s\S]{0,80}salesman/);
  });

  it("list hides merged-away rows by default", () => {
    const src = readFileSync(join(ROOT, "src/lib/data/customers.ts"), "utf8");
    expect(src).toContain('q.is("merged_into_customer_id", null)');
  });
});

describe("production read-only audit", () => {
  it("does not invent credentials", () => {
    expect(["blocked", "ready"]).toContain(productionDuplicateAuditStatus());
  });
});
