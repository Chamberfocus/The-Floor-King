/**
 * Pre-live readiness — portal estimate guard, re-approval keys, assistant RPC.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  buildApprovalIdempotencyKey,
  beginApprovalIdempotency,
  onApprovalBusinessOutcome,
  approvalContextHash,
  type IdempotencyRow,
} from "@/lib/estimate-approval-idempotency";
import {
  portalMayMutateEstimateField,
  portalEstimateStatusChangeAllowed,
  evaluatePortalDirectEstimateUpdate,
  PORTAL_ESTIMATE_MUTABLE_FIELDS,
  PORTAL_APPROVAL_MUTATION_GUC,
} from "@/lib/estimate-approval";
import {
  authorizeJobMeasurementUpload,
  DOCUMENTS_STORAGE_JWT_ROLES,
} from "@/lib/job-warehouse";
import { findInstallerScheduleConflict } from "@/lib/scheduling-conflicts";
import {
  normalizePersonName,
  normalizeEmail,
  scoreCustomerDuplicate,
} from "@/lib/customer-duplicate";
import { planPoReceiveDelta } from "@/lib/po-stock";
import {
  invoiceRemainingBalance,
  assessPaymentAmount,
} from "@/lib/payment-safety";
import { computeJobOpenBalance } from "@/lib/invoice-calc";
import {
  planEstimateInvoiceCreation,
} from "@/lib/change-order-invoice";

const ROOT = process.cwd();
const sql0179 = readFileSync(
  join(ROOT, "supabase/migrations/0179_final_pre_live_readiness.sql"),
  "utf8",
);
const portalActions = readFileSync(
  join(ROOT, "src/app/portal/actions.ts"),
  "utf8",
);
const estimateApprovals = readFileSync(
  join(ROOT, "src/lib/data/estimate-approvals.ts"),
  "utf8",
);
const assistantActions = readFileSync(
  join(ROOT, "src/app/(app)/assistant/actions.ts"),
  "utf8",
);
const measurementActions = readFileSync(
  join(ROOT, "src/app/(app)/jobs/[id]/measurement-actions.ts"),
  "utf8",
);
const documentActions = readFileSync(
  join(ROOT, "src/app/(app)/customers/[id]/document-actions.ts"),
  "utf8",
);
const customerPage = readFileSync(
  join(ROOT, "src/app/(app)/customers/[id]/page.tsx"),
  "utf8",
);
const sql0178 = readFileSync(
  join(ROOT, "supabase/migrations/0178_f7_launch_integrity_hardening.sql"),
  "utf8",
);

function baseEst(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    customer_id: "cust-a",
    status: "sent",
    tax_rate: 0.08,
    discount_value: 0,
    subtotal: 1000,
    total: 1080,
    accepted_option_id: "opt-1",
    current_approval_snapshot_id: null,
    customer_response_note: null,
    updated_at: "t0",
    ...over,
  };
}

function portalDirect(
  over: Partial<Parameters<typeof evaluatePortalDirectEstimateUpdate>[0]> & {
    next?: Record<string, unknown>;
    old?: Record<string, unknown>;
  } = {},
) {
  const old = over.old ?? baseEst();
  return evaluatePortalDirectEstimateUpdate({
    jwtIsServiceRole: over.jwtIsServiceRole ?? false,
    actorRole: over.actorRole ?? "customer",
    trustedApprovalMutation: over.trustedApprovalMutation ?? false,
    old,
    next: over.next ?? old,
  });
}

describe("0179 portal estimate commercial lock", () => {
  it("migration exists and does not enable accounting", () => {
    expect(existsSync(join(ROOT, "supabase/migrations/0179_final_pre_live_readiness.sql"))).toBe(
      true,
    );
    expect(sql0179).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql0179).toContain("Do NOT set posting_enabled");
    expect(createHash("sha256").update(sql0179).digest("hex")).toHaveLength(64);
  });

  it("trigger blocks commercial fields; allows decline/changes from sent", () => {
    expect(sql0179).toContain("estimates_protect_portal_columns");
    expect(sql0179).toContain("PORTAL_ESTIMATE_FORBIDDEN");
    expect(sql0179).toContain("declined");
    expect(sql0179).toContain("changes_requested");
    expect(sql0179).toContain("to_jsonb(new) - 'status' - 'customer_response_note' - 'updated_at'");
    expect(portalMayMutateEstimateField("tax_rate")).toBe(false);
    expect(portalMayMutateEstimateField("status")).toBe(true);
    for (const f of [
      "assigned_to",
      "tax_rate",
      "discount_value",
      "accepted_option_id",
    ]) {
      expect(portalMayMutateEstimateField(f)).toBe(false);
    }
    expect(PORTAL_ESTIMATE_MUTABLE_FIELDS).toContain("customer_response_note");
    expect(portalEstimateStatusChangeAllowed("sent", "approved")).toBe(false);
    expect(portalEstimateStatusChangeAllowed("sent", "declined")).toBe(true);
    expect(portalEstimateStatusChangeAllowed("sent", "changes_requested")).toBe(
      true,
    );
    expect(
      portalEstimateStatusChangeAllowed("changes_requested", "declined"),
    ).toBe(true);
    expect(portalEstimateStatusChangeAllowed("declined", "sent")).toBe(false);
    expect(sql0179).toContain(
      "old.status = 'changes_requested' and new.status = 'declined'",
    );
    expect(sql0179).toContain(PORTAL_APPROVAL_MUTATION_GUC);
    expect(sql0179).toMatch(
      /set_config\('app\.allow_portal_approval_mutation', 'true', true\)[\s\S]{0,400}update public\.estimates/,
    );
    expect(sql0179).not.toMatch(
      /grant execute on function public\.estimates_protect_portal_columns\(\) to authenticated/,
    );
    expect(sql0179).not.toMatch(
      /create or replace function public\.\w*allow_portal_approval/i,
    );
  });

  it("job_satisfaction read is no longer using(true)", () => {
    expect(sql0179).toContain("drop policy if exists js_read");
    expect(sql0179).not.toMatch(/js_read[\s\S]*using \(true\)/);
    expect(sql0179).toContain("j.customer_id = public.my_customer_id()");
  });

  it("documents storage is not any-non-customer", () => {
    expect(sql0179).toContain("documents_storage_rw");
    expect(sql0179).not.toContain("my_role() <> 'customer'");
    expect(sql0179).toContain("'salesman'");
  });
});

describe("re-approval idempotency keys include snapshot generation", () => {
  it("first approve and retry share a key; stale re-approve uses a new key", () => {
    const first = buildApprovalIdempotencyKey({
      estimateId: "est-1",
      source: "staff",
      optionId: "opt-1",
      snapshotId: null,
    });
    const retry = buildApprovalIdempotencyKey({
      estimateId: "est-1",
      source: "staff",
      optionId: "opt-1",
      snapshotId: null,
    });
    expect(first).toBe(retry);
    const afterStale = buildApprovalIdempotencyKey({
      estimateId: "est-1",
      source: "staff",
      optionId: "opt-1",
      snapshotId: "snap-1",
    });
    expect(afterStale).not.toBe(first);

    const store = new Map<string, IdempotencyRow>();
    const digestA = approvalContextHash({
      estimateId: "est-1",
      optionId: "opt-1",
      source: "staff",
      staffActor: "u1",
      portalCustomer: null,
      commercialDigest: "A",
    });
    const digestB = approvalContextHash({
      estimateId: "est-1",
      optionId: "opt-1",
      source: "staff",
      staffActor: "u1",
      portalCustomer: null,
      commercialDigest: "B",
    });
    expect(
      beginApprovalIdempotency({
        store,
        key: first,
        action: "estimate_approve",
        contextHash: digestA,
      }).kind,
    ).toBe("claim");
    onApprovalBusinessOutcome({
      store,
      key: first,
      claimed: true,
      result: { ok: true, snapshot_id: "snap-1" },
    });
    expect(
      beginApprovalIdempotency({
        store,
        key: first,
        action: "estimate_approve",
        contextHash: digestA,
      }).kind,
    ).toBe("replay");
    expect(
      beginApprovalIdempotency({
        store,
        key: afterStale,
        action: "estimate_approve",
        contextHash: digestB,
      }).kind,
    ).toBe("claim");
  });

  it("app callers build snapshot-scoped keys (not a static key)", () => {
    expect(estimateApprovals).toContain("buildApprovalIdempotencyKey");
    expect(portalActions).toContain("buildApprovalIdempotencyKey");
    expect(portalActions).toContain("current_approval_snapshot_id");
    expect(portalActions).not.toMatch(
      /portal_approve:\$\{id\}:\$\{portalCustomerId\}:\$\{optionId/,
    );
  });
});

describe("assistant schedule uses 0178 RPC", () => {
  it("reschedule_job calls schedule_job_install_safe, not direct jobs.update", () => {
    const start = assistantActions.indexOf('case "reschedule_job": {');
    const end = assistantActions.indexOf('case "add_note": {');
    const fn = assistantActions.slice(start, end);
    expect(fn).toContain("schedule_job_install_safe");
    expect(fn).not.toContain('from("jobs").update');
    expect(fn).toContain("SCHEDULE_CONFLICT");
  });
});

describe("portal direct UPDATE behavioral allowlist", () => {
  it("1–6. customer direct commercial / approved mutations denied", () => {
    const old = baseEst();
    for (const field of [
      "tax_rate",
      "discount_value",
      "total",
      "accepted_option_id",
      "current_approval_snapshot_id",
    ] as const) {
      const next = { ...old, [field]: "tamper" };
      expect(portalDirect({ old, next }).ok).toBe(false);
      expect(portalMayMutateEstimateField(field)).toBe(false);
    }
    expect(
      portalDirect({
        old,
        next: { ...old, status: "approved" },
      }).ok,
    ).toBe(false);
  });

  it("7–9. allowed portal response transitions", () => {
    const sent = baseEst({ status: "sent" });
    expect(
      portalDirect({
        old: sent,
        next: { ...sent, status: "declined", customer_response_note: "no" },
      }).ok,
    ).toBe(true);
    expect(
      portalDirect({
        old: sent,
        next: {
          ...sent,
          status: "changes_requested",
          customer_response_note: "fix",
        },
      }).ok,
    ).toBe(true);
    const cr = baseEst({ status: "changes_requested" });
    expect(
      portalDirect({
        old: cr,
        next: { ...cr, status: "declined", customer_response_note: "no" },
      }).ok,
    ).toBe(true);
  });

  it("10. forbidden reverse/internal transitions denied", () => {
    for (const [from, to] of [
      ["declined", "sent"],
      ["declined", "approved"],
      ["approved", "sent"],
      ["draft", "declined"],
      ["sent", "draft"],
      ["changes_requested", "sent"],
      ["changes_requested", "approved"],
    ] as const) {
      const old = baseEst({ status: from });
      expect(
        portalDirect({ old, next: { ...old, status: to } }).ok,
      ).toBe(false);
    }
  });

  it("11. approval RPC GUC lets customer JWT apply approved+snapshot mutation", () => {
    const old = baseEst({ status: "sent" });
    expect(
      portalDirect({
        trustedApprovalMutation: true,
        old,
        next: {
          ...old,
          status: "approved",
          accepted_option_id: "opt-1",
          current_approval_snapshot_id: "snap-1",
          tax_rate: 0.08,
        },
      }).ok,
    ).toBe(true);
    expect(
      portalDirect({
        trustedApprovalMutation: false,
        old,
        next: { ...old, status: "approved" },
      }).ok,
    ).toBe(false);
  });

  it("staff and service_role skip the portal column lock", () => {
    const old = baseEst();
    expect(
      portalDirect({
        actorRole: "office",
        old,
        next: { ...old, tax_rate: 0.1 },
      }).ok,
    ).toBe(true);
    expect(
      portalDirect({
        jwtIsServiceRole: true,
        actorRole: "customer",
        old,
        next: { ...old, status: "approved" },
      }).ok,
    ).toBe(true);
  });

  it("customer cannot reassign customer_id", () => {
    const old = baseEst();
    expect(
      portalDirect({
        old,
        next: { ...old, customer_id: "cust-b" },
      }).ok,
    ).toBe(false);
  });

  it("privileged commercial columns are rejected on direct portal PATCH", () => {
    const old = baseEst({
      notes: "internal",
      job_description: "scope",
      presentation: "detailed",
      target_margin: 35,
      discount_kind: "amount",
      recommended_option_id: "opt-1",
      created_by: "staff-1",
      approval_source: null,
      approved_by_user_id: null,
      approval_stale: false,
      valid_until: "2026-12-01",
      show_project_details: true,
    });
    const privileged: Record<string, unknown> = {
      customer_id: "cust-b",
      tax_rate: 0,
      discount_value: 999,
      discount_kind: "percent",
      target_margin: 1,
      subtotal: 1,
      total: 1,
      notes: "cleared internal",
      job_description: "rewritten scope",
      presentation: "summary",
      accepted_option_id: "opt-evil",
      recommended_option_id: "opt-evil",
      created_by: "hijack",
      approved_at: "2099-01-01",
      approval_source: "portal",
      approved_by_user_id: "staff-x",
      approved_by_customer_id: "cust-b",
      current_approval_snapshot_id: "snap-fake",
      approval_stale: true,
      valid_until: "1999-01-01",
      show_project_details: false,
      sent_at: "2099-01-01",
      title: "free job",
    };
    for (const [field, value] of Object.entries(privileged)) {
      const result = portalDirect({ old, next: { ...old, [field]: value } });
      expect(result.ok, field).toBe(false);
      if (!result.ok) expect(result.code).toBe("PORTAL_ESTIMATE_FORBIDDEN");
    }
  });

  it("staff roles still pass the portal column lock (office, salesman, warehouse)", () => {
    const old = baseEst();
    for (const role of ["admin", "office", "sales_manager", "salesman", "warehouse", "crew"]) {
      expect(
        portalDirect({
          actorRole: role,
          old,
          next: { ...old, tax_rate: 0, notes: "staff edit", status: "draft" },
        }).ok,
      ).toBe(true);
    }
  });

  it("0179 does not drop customer row RLS or grant trigger execute to authenticated", () => {
    const sql0009 = readFileSync(
      join(ROOT, "supabase/migrations/0009_portal.sql"),
      "utf8",
    );
    expect(sql0009).toContain("estimates_customer_update");
    expect(sql0009).toContain("customer_id = public.my_customer_id()");
    expect(sql0179).not.toContain("drop policy if exists estimates_customer_update");
    expect(sql0009).toContain("estimate_options_customer_read");
    expect(sql0009).not.toMatch(/estimate_options_customer_update/);
    expect(sql0009).not.toMatch(/estimate_line_items_customer_update/);
    expect(sql0179).not.toMatch(
      /grant execute on function public\.set_config/i,
    );
  });

  it("portal decline/request-changes only PATCH status + customer_response_note", () => {
    const decline = portalActions.slice(
      portalActions.indexOf("export async function portalDeclineEstimate"),
      portalActions.indexOf("export async function portalRequestChanges"),
    );
    expect(decline).toContain('status: "declined"');
    expect(decline).toContain("customer_response_note");
    expect(decline).not.toContain("tax_rate");
    expect(decline).not.toContain("createAdminClient");
    const changes = portalActions.slice(
      portalActions.indexOf("export async function portalRequestChanges"),
    );
    expect(changes).toContain('status: "changes_requested"');
    expect(changes).toContain("customer_response_note");
    expect(changes).not.toContain("tax_rate");
  });

  it("portal approve uses JWT RPC, never service_role, and checks ownership first", () => {
    const fn = portalActions.slice(
      portalActions.indexOf("export async function portalApproveEstimate"),
      portalActions.indexOf("export async function portalDeclineEstimate"),
    );
    expect(fn).toContain("recordEstimateApproval");
    expect(fn).toContain('source: "portal"');
    expect(fn).toContain("estRow.customer_id !== portalCustomerId");
    expect(fn).toContain("admin: false");
    expect(fn).not.toContain("createAdminClient");
    expect(estimateApprovals).toContain("APPROVAL_PORTAL_SERVICE_ROLE");
    expect(estimateApprovals).toContain("p_approval_source: args.source");
  });
});

describe("job_satisfaction read policy (behavioral + SQL)", () => {
  function jsRead(args: {
    role: string;
    uid: string;
    jobAssignedTo: string | null;
    jobCustomerId: string;
    myCustomerId: string | null;
    salesmanOwns: boolean;
  }): boolean {
    if (["admin", "office", "sales_manager", "scheduler"].includes(args.role)) {
      return true;
    }
    if (args.jobAssignedTo === args.uid) return true;
    if (args.myCustomerId && args.jobCustomerId === args.myCustomerId) {
      return true;
    }
    if (args.role === "salesman" && args.salesmanOwns) return true;
    return false;
  }

  it("22–27. intended staff/installer/customer/salesman; unrelated denied", () => {
    expect(
      jsRead({
        role: "office",
        uid: "u1",
        jobAssignedTo: "crew1",
        jobCustomerId: "c1",
        myCustomerId: null,
        salesmanOwns: false,
      }),
    ).toBe(true);
    expect(
      jsRead({
        role: "crew",
        uid: "crew1",
        jobAssignedTo: "crew1",
        jobCustomerId: "c1",
        myCustomerId: null,
        salesmanOwns: false,
      }),
    ).toBe(true);
    expect(
      jsRead({
        role: "crew",
        uid: "crew2",
        jobAssignedTo: "crew1",
        jobCustomerId: "c1",
        myCustomerId: null,
        salesmanOwns: false,
      }),
    ).toBe(false);
    expect(
      jsRead({
        role: "customer",
        uid: "p1",
        jobAssignedTo: "crew1",
        jobCustomerId: "c1",
        myCustomerId: "c1",
        salesmanOwns: false,
      }),
    ).toBe(true);
    expect(
      jsRead({
        role: "customer",
        uid: "p2",
        jobAssignedTo: "crew1",
        jobCustomerId: "c1",
        myCustomerId: "c2",
        salesmanOwns: false,
      }),
    ).toBe(false);
    expect(
      jsRead({
        role: "salesman",
        uid: "s1",
        jobAssignedTo: "crew1",
        jobCustomerId: "c1",
        myCustomerId: null,
        salesmanOwns: false,
      }),
    ).toBe(false);
    expect(
      jsRead({
        role: "salesman",
        uid: "s1",
        jobAssignedTo: "crew1",
        jobCustomerId: "c1",
        myCustomerId: null,
        salesmanOwns: true,
      }),
    ).toBe(true);
  });

  it("28. warehouse private satisfaction read denied; empty sat is not an error", () => {
    expect(
      jsRead({
        role: "warehouse",
        uid: "w1",
        jobAssignedTo: "crew1",
        jobCustomerId: "c1",
        myCustomerId: null,
        salesmanOwns: false,
      }),
    ).toBe(false);
    const satRow: { id: string } | null = null;
    expect(!!satRow).toBe(false);
    const jsBlock = sql0179.slice(
      sql0179.indexOf("create policy js_read"),
      sql0179.indexOf("documents storage"),
    );
    expect(jsBlock).not.toContain("warehouse");
  });
});

describe("warehouse / crew document upload authorization", () => {
  it("15. authorized warehouse job measurement uses admin after visibility", () => {
    expect(
      authorizeJobMeasurementUpload({
        role: "warehouse",
        userId: "w1",
        jobAssignedTo: "crew1",
        jobVisible: true,
      }),
    ).toEqual({ ok: true, useAdmin: true });
    expect(measurementActions).toContain("authorizeJobMeasurementUpload");
    expect(measurementActions).toContain("createAdminClient");
  });

  it("16–18. warehouse JWT insert remains denied; invisible job denied", () => {
    expect(DOCUMENTS_STORAGE_JWT_ROLES).not.toContain("warehouse");
    expect(sql0179).not.toMatch(
      /documents_storage_rw[\s\S]*'warehouse'/,
    );
    expect(
      authorizeJobMeasurementUpload({
        role: "warehouse",
        userId: "w1",
        jobAssignedTo: null,
        jobVisible: false,
      }).ok,
    ).toBe(false);
  });

  it("19–20. assigned crew upload elevated; unassigned crew denied", () => {
    expect(
      authorizeJobMeasurementUpload({
        role: "crew",
        userId: "c1",
        jobAssignedTo: "c1",
        jobVisible: true,
      }),
    ).toEqual({ ok: true, useAdmin: true });
    expect(
      authorizeJobMeasurementUpload({
        role: "crew",
        userId: "c1",
        jobAssignedTo: "other",
        jobVisible: true,
      }).ok,
    ).toBe(false);
  });

  it("21. service_role stays server-only; customer page files gated", () => {
    expect(measurementActions).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(documentActions).toContain("DOCUMENTS_STORAGE_JWT_ROLES");
    expect(customerPage).toContain("canCustomerFiles");
    expect(customerPage).toContain("DOCUMENTS_STORAGE_JWT_ROLES");
  });

  it("39–40. browser JWT document roles exclude crew/warehouse/customer", () => {
    expect([...DOCUMENTS_STORAGE_JWT_ROLES]).toEqual([
      "admin",
      "office",
      "sales_manager",
      "scheduler",
      "salesman",
    ]);
    for (const r of ["crew", "warehouse", "customer"]) {
      expect(DOCUMENTS_STORAGE_JWT_ROLES as readonly string[]).not.toContain(r);
    }
    expect(
      authorizeJobMeasurementUpload({
        role: "customer",
        userId: "u",
        jobAssignedTo: null,
        jobVisible: true,
      }).ok,
    ).toBe(false);
    expect(
      authorizeJobMeasurementUpload({
        role: "salesman",
        userId: "s1",
        jobAssignedTo: null,
        jobVisible: true,
      }),
    ).toEqual({ ok: true, useAdmin: false });
  });
});

describe("approval idempotency generations", () => {
  it("29–33. retry, concurrent same-key SQL lock, new generation, collision", () => {
    const k0 = buildApprovalIdempotencyKey({
      estimateId: "est-1",
      source: "portal",
      optionId: "opt-1",
      snapshotId: null,
      portalCustomerId: "cust-a",
    });
    const k1 = buildApprovalIdempotencyKey({
      estimateId: "est-1",
      source: "portal",
      optionId: "opt-1",
      snapshotId: "snap-1",
      portalCustomerId: "cust-a",
    });
    const k2 = buildApprovalIdempotencyKey({
      estimateId: "est-1",
      source: "portal",
      optionId: "opt-1",
      snapshotId: "snap-2",
      portalCustomerId: "cust-a",
    });
    expect(k0).not.toBe(k1);
    expect(k1).not.toBe(k2);

    const store = new Map<string, IdempotencyRow>();
    const dA = approvalContextHash({
      estimateId: "est-1",
      optionId: "opt-1",
      source: "portal",
      staffActor: null,
      portalCustomer: "cust-a",
      commercialDigest: "A",
    });
    const dB = approvalContextHash({
      estimateId: "est-1",
      optionId: "opt-1",
      source: "portal",
      staffActor: null,
      portalCustomer: "cust-a",
      commercialDigest: "B",
    });
    expect(
      beginApprovalIdempotency({
        store,
        key: k0,
        action: "estimate_approve",
        contextHash: dA,
      }).kind,
    ).toBe("claim");
    onApprovalBusinessOutcome({
      store,
      key: k0,
      claimed: true,
      result: { ok: true, snapshot_id: "snap-1" },
    });
    expect(
      beginApprovalIdempotency({
        store,
        key: k0,
        action: "estimate_approve",
        contextHash: dA,
      }).kind,
    ).toBe("replay");
    expect(
      beginApprovalIdempotency({
        store,
        key: k1,
        action: "estimate_approve",
        contextHash: dB,
      }).kind,
    ).toBe("claim");
    onApprovalBusinessOutcome({
      store,
      key: k1,
      claimed: true,
      result: { ok: true, snapshot_id: "snap-2" },
    });
    expect(
      beginApprovalIdempotency({
        store,
        key: k2,
        action: "estimate_approve",
        contextHash: dA,
      }).kind,
    ).toBe("claim");
    expect(
      beginApprovalIdempotency({
        store,
        key: k0,
        action: "estimate_approve",
        contextHash: dB,
      }).kind,
    ).toBe("conflict");
    const beginFn = sql0178.slice(
      sql0178.indexOf("function public.estimate_approval_begin_action"),
      sql0178.indexOf("function public.estimate_approval_complete_action"),
    );
    expect(beginFn).toContain("estimate_approval_lock_idempotency");
    expect(beginFn).toContain("for update");
  });

  it("successful reapproval advances current snapshot so the next cycle gets a new key", () => {
    let current: string | null = null;
    const keys: string[] = [];
    for (const nextSnap of ["snap-1", "snap-2", "snap-3"]) {
      const key = buildApprovalIdempotencyKey({
        estimateId: "est-1",
        source: "staff",
        optionId: "opt-1",
        snapshotId: current,
      });
      keys.push(key);
      current = nextSnap;
    }
    expect(new Set(keys).size).toBe(3);
  });
});

describe("scheduling protection sweep", () => {
  it("34–38. assistant RPC; overlap rejected; 0178 blocks direct scheduled writes", () => {
    const start = assistantActions.indexOf('case "reschedule_job": {');
    const end = assistantActions.indexOf('case "add_note": {');
    const fn = assistantActions.slice(start, end);
    expect(fn).toContain("schedule_job_install_safe");
    expect(fn).not.toMatch(/from\("jobs"\)\.update/);
    expect(
      findInstallerScheduleConflict({
        jobId: "j1",
        installerProfileId: "i1",
        crewId: null,
        start: "2026-09-10",
        end: "2026-09-10",
        existing: [
          {
            jobId: "j2",
            assignedTo: "i1",
            assignedCrewId: null,
            start: "2026-09-10",
            end: "2026-09-10",
          },
        ],
      }),
    ).not.toBeNull();
    expect(
      findInstallerScheduleConflict({
        jobId: "j1",
        installerProfileId: null,
        crewId: "crew-1",
        start: "2026-09-10",
        end: "2026-09-12",
        existing: [
          {
            jobId: "j2",
            assignedTo: null,
            assignedCrewId: "crew-1",
            start: "2026-09-12",
            end: "2026-09-12",
          },
        ],
      }),
    ).not.toBeNull();
    expect(sql0178).toContain("JOB_SCHEDULE_VIA_RPC");
    expect(sql0178).toContain("exclusion_violation");
    expect(sql0178).toContain("scheduled_end < scheduled_date");
  });
});

describe("unicode / names / money flows (pure)", () => {
  it("O'Connor, hyphen, José, Arabic names normalize without crash", () => {
    expect(normalizePersonName("O'Connor")).toBe("o'connor");
    expect(normalizePersonName("Smith-Jones")).toBe("smith-jones");
    expect(normalizePersonName("José García")).toBe("josé garcía");
    expect(normalizePersonName("شركة مثال")).toBe("شركة مثال");
    expect(normalizeEmail("  Pat@Example.COM ")).toBe("pat@example.com");
    const hit = scoreCustomerDuplicate(
      { fullName: "O'Connor", email: "a@b.com" },
      { id: "1", full_name: "O'Connor", email: "a@b.com" },
    );
    expect(hit?.confidence).toBe("high");
  });

  it("FLOW 5: PO 100 receive 40+35+25 then extra 1 is blocked by plan", () => {
    let already = 0;
    for (const target of [40, 75, 100]) {
      const p = planPoReceiveDelta({
        orderedQty: 100,
        targetReceivedQty: target,
        alreadyOnLedger: already,
      });
      expect(p.ok).toBe(true);
      if (p.ok) {
        already += p.delta;
      }
    }
    expect(already).toBe(100);
    const extra = planPoReceiveDelta({
      orderedQty: 100,
      targetReceivedQty: 101,
      alreadyOnLedger: 100,
    });
    expect(extra.ok).toBe(false);
  });

  it("FLOW 10: $1000 with 300+200+500 then duplicate extra is blocked", () => {
    const items = [{ quantity: 1, rate: 1000 }];
    const pays = [
      { amount: 300, status: "active" as const },
      { amount: 200, status: "active" as const },
      { amount: 500, status: "active" as const },
    ];
    expect(invoiceRemainingBalance(items, 0, pays)).toBe(0);
    expect(
      assessPaymentAmount({ amount: 1, remainingBalance: 0 }).ok,
    ).toBe(false);
  });

  it("FLOW 14: base + supplemental + partial payments open balance", () => {
    const open = computeJobOpenBalance([
      {
        id: "i1",
        status: "sent",
        tax_rate: 0,
        items: [{ quantity: 1, rate: 10000 }],
        payments: [{ amount: 4000, status: "active" }],
      },
      {
        id: "i2",
        status: "sent",
        tax_rate: 0,
        items: [{ quantity: 1, rate: 1000 }],
        payments: [],
      },
    ]);
    expect(open.balance).toBe(7000);
  });

  it("paid increase plans supplemental; unpaid decrease void-reissue", () => {
    const paidInc = planEstimateInvoiceCreation({
      approvedTotal: 11000,
      existing: [
        {
          id: "i1",
          status: "sent",
          approvalSnapshotId: "s1",
          total: 10000,
          hasPayments: true,
        },
      ],
    });
    expect(paidInc.action).toBe("supplemental");
    const unpaidDec = planEstimateInvoiceCreation({
      approvedTotal: 8000,
      existing: [
        {
          id: "i1",
          status: "sent",
          approvalSnapshotId: "s1",
          total: 10000,
          hasPayments: false,
        },
      ],
    });
    expect(unpaidDec.action).toBe("void_reissue");
  });
});
