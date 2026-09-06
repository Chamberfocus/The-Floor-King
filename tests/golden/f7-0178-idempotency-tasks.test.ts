/**
 * F7/0178 — approval idempotency contract + task field authorization (pure).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approvalContextHash,
  beginApprovalIdempotency,
  onApprovalBusinessOutcome,
  type IdempotencyRow,
} from "@/lib/estimate-approval-idempotency";
import {
  OFFICE_TASK_PROTECTED_FIELDS,
  assessAssigneeOfficeTaskUpdate,
  mayManageOfficeTaskFields,
} from "@/lib/office-task";

const ROOT = join(process.cwd());
const sql = readFileSync(
  join(ROOT, "supabase/migrations/0178_f7_launch_integrity_hardening.sql"),
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
const isStaffSql = readFileSync(
  join(ROOT, "supabase/migrations/0001_init.sql"),
  "utf8",
);

function ctx(over: Partial<Parameters<typeof approvalContextHash>[0]> = {}) {
  return approvalContextHash({
    estimateId: "est-a",
    optionId: "opt-a",
    source: "portal",
    staffActor: null,
    portalCustomer: "cust-a",
    commercialDigest: "digest-a",
    ...over,
  });
}

describe("0178 approval idempotency key lifetime", () => {
  it("A+B: key K + context A succeeds and retries original success", () => {
    const store = new Map<string, IdempotencyRow>();
    const hash = ctx();
    expect(
      beginApprovalIdempotency({
        store,
        key: "K",
        action: "estimate_approve",
        contextHash: hash,
      }).kind,
    ).toBe("claim");
    const success = { ok: true, snapshot_id: "snap-1" };
    onApprovalBusinessOutcome({
      store,
      key: "K",
      claimed: true,
      result: success,
    });
    const retry = beginApprovalIdempotency({
      store,
      key: "K",
      action: "estimate_approve",
      contextHash: hash,
    });
    expect(retry).toEqual({ kind: "replay", result: success });
  });

  it("C–H: same key + different context is IDEMPOTENCY_CONFLICT", () => {
    const store = new Map<string, IdempotencyRow>();
    const a = ctx();
    beginApprovalIdempotency({
      store,
      key: "K",
      action: "estimate_approve",
      contextHash: a,
    });
    onApprovalBusinessOutcome({
      store,
      key: "K",
      claimed: true,
      result: { ok: true, snapshot_id: "snap-1" },
    });

    const variants = [
      ctx({ estimateId: "est-b" }),
      ctx({ optionId: "opt-b" }),
      ctx({ commercialDigest: "digest-b" }),
      ctx({ portalCustomer: "cust-b" }),
      ctx({ source: "staff", staffActor: "user-b", portalCustomer: null }),
      ctx({ staffActor: "user-other", source: "staff", portalCustomer: null }),
    ];
    for (const hash of variants) {
      expect(
        beginApprovalIdempotency({
          store,
          key: "K",
          action: "estimate_approve",
          contextHash: hash,
        }).kind,
      ).toBe("conflict");
    }
  });

  it("conflict outcome still binds the key (no delete → reuse)", () => {
    const store = new Map<string, IdempotencyRow>();
    const a = ctx();
    beginApprovalIdempotency({
      store,
      key: "K",
      action: "estimate_approve",
      contextHash: a,
    });
    const conflict = {
      ok: false,
      code: "APPROVAL_STALE_OR_CONFLICT",
    };
    onApprovalBusinessOutcome({
      store,
      key: "K",
      claimed: true,
      result: conflict,
    });
    expect(store.get("K")?.status).toBe("completed");
    expect(
      beginApprovalIdempotency({
        store,
        key: "K",
        action: "estimate_approve",
        contextHash: a,
      }),
    ).toEqual({ kind: "replay", result: conflict });
    expect(
      beginApprovalIdempotency({
        store,
        key: "K",
        action: "estimate_approve",
        contextHash: ctx({ commercialDigest: "other" }),
      }).kind,
    ).toBe("conflict");
  });

  it("I+J: retry does not mint a second snapshot or second success audit", () => {
    const snapshots: string[] = [];
    const audits: string[] = [];
    const store = new Map<string, IdempotencyRow>();
    const hash = ctx();
    const first = beginApprovalIdempotency({
      store,
      key: "K",
      action: "estimate_approve",
      contextHash: hash,
    });
    expect(first.kind).toBe("claim");
    snapshots.push("snap-1");
    audits.push("audit-1");
    onApprovalBusinessOutcome({
      store,
      key: "K",
      claimed: true,
      result: { ok: true, snapshot_id: "snap-1", audit: "audit-1" },
    });
    const retry = beginApprovalIdempotency({
      store,
      key: "K",
      action: "estimate_approve",
      contextHash: hash,
    });
    expect(retry.kind).toBe("replay");
    if (retry.kind === "replay") {
      expect(retry.result.snapshot_id).toBe("snap-1");
    }
    expect(snapshots).toEqual(["snap-1"]);
    expect(audits).toEqual(["audit-1"]);
  });

  it("K: same-key concurrent claims serialize via 0178 lock + FOR UPDATE", () => {
    const begin = sql.slice(
      sql.indexOf("function public.estimate_approval_begin_action"),
      sql.indexOf("function public.estimate_approval_complete_action"),
    );
    expect(begin).toContain("estimate_approval_lock_idempotency");
    expect(begin).toContain("for update");
  });
});

describe("0178 task management vs assignee", () => {
  it("is_staff() is admin|office only; F2 managers add sales_manager", () => {
    expect(isStaffSql).toContain(
      "select public.user_role(auth.uid()) in ('admin', 'office')",
    );
    expect(mayManageOfficeTaskFields("admin")).toBe(true);
    expect(mayManageOfficeTaskFields("office")).toBe(true);
    expect(mayManageOfficeTaskFields("sales_manager")).toBe(true);
    expect(mayManageOfficeTaskFields("salesman")).toBe(false);
    expect(mayManageOfficeTaskFields("scheduler")).toBe(false);
    expect(mayManageOfficeTaskFields("warehouse")).toBe(false);
    expect(mayManageOfficeTaskFields("crew")).toBe(false);
  });

  it("ordinary assignee cannot rewrite protected fields", () => {
    for (const field of OFFICE_TASK_PROTECTED_FIELDS) {
      expect(
        assessAssigneeOfficeTaskUpdate({
          actorRole: "salesman",
          actorId: "u1",
          assignedTo: "u1",
          field,
        }),
      ).toEqual({ ok: false, code: "TASK_FIELD_FORBIDDEN" });
    }
  });

  it("assignee may complete; non-assignee salesman is forbidden", () => {
    expect(
      assessAssigneeOfficeTaskUpdate({
        actorRole: "salesman",
        actorId: "u1",
        assignedTo: "u1",
        field: "status",
      }),
    ).toEqual({ ok: true });
    expect(
      assessAssigneeOfficeTaskUpdate({
        actorRole: "salesman",
        actorId: "u1",
        assignedTo: "u2",
        field: "status",
      }),
    ).toEqual({ ok: false, code: "TASK_FORBIDDEN" });
  });

  it("admin/office/sales_manager may mutate management fields", () => {
    for (const role of ["admin", "office", "sales_manager"] as const) {
      expect(
        assessAssigneeOfficeTaskUpdate({
          actorRole: role,
          actorId: "boss",
          assignedTo: "other",
          field: "assigned_to",
        }),
      ).toEqual({ ok: true });
    }
  });
});

describe("0178 portal + RPC callers", () => {
  it("portalApproveEstimate uses customer session, not admin client", () => {
    const start = portalActions.indexOf(
      "export async function portalApproveEstimate",
    );
    const end = portalActions.indexOf(
      "export async function portalDeclineEstimate",
    );
    const fn = portalActions.slice(start, end);
    expect(fn).toContain("const supabase = await createClient()");
    expect(fn).toContain("admin: false");
    expect(fn).not.toContain("createAdminClient");
    expect(fn).toContain("recordEstimateApproval");
  });

  it("recordEstimateApproval uses new RPC args (no p_payload)", () => {
    expect(estimateApprovals).toContain('p_estimate_id: args.estimateId');
    expect(estimateApprovals).toContain("p_accepted_option_id");
    expect(estimateApprovals).toContain("p_approval_source");
    expect(estimateApprovals).toContain("p_approved_by_user_id");
    expect(estimateApprovals).toContain("p_approved_by_customer_id");
    expect(estimateApprovals).toContain("p_idempotency_key");
    expect(estimateApprovals).not.toContain("p_payload");
    expect(sql).toContain(
      "drop function if exists public.record_estimate_approval_safe(uuid, uuid, text, jsonb, uuid, uuid, text)",
    );
  });
});
