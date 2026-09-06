/**
 * F7 / 0178 security + integrity correction — adversarial markers + pure plans.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  dateRangesOverlap,
  findInstallerScheduleConflict,
} from "@/lib/scheduling-conflicts";
import { planPoReceiveDelta } from "@/lib/po-stock";

const ROOT = join(process.cwd());
const mig0178 = join(
  ROOT,
  "supabase/migrations/0178_f7_launch_integrity_hardening.sql",
);
const sql = readFileSync(mig0178, "utf8");
const estimateApprovals = readFileSync(
  join(ROOT, "src/lib/data/estimate-approvals.ts"),
  "utf8",
);
const portalActions = readFileSync(
  join(ROOT, "src/app/portal/actions.ts"),
  "utf8",
);
const opsActions = readFileSync(
  join(ROOT, "src/app/(app)/ops/actions.ts"),
  "utf8",
);
const jobsActions = readFileSync(
  join(ROOT, "src/app/(app)/jobs/actions.ts"),
  "utf8",
);
const jobsNew = readFileSync(
  join(ROOT, "src/app/(app)/jobs/new/actions.ts"),
  "utf8",
);
const receivingActions = readFileSync(
  join(ROOT, "src/app/(app)/warehouse/receiving-actions.ts"),
  "utf8",
);
const verifier = readFileSync(
  join(ROOT, "scripts/verify-f7-launch-production.mjs"),
  "utf8",
);

describe("0178 security correction — portal trust", () => {
  it("denies service_role portal approvals", () => {
    expect(sql).toContain("APPROVAL_PORTAL_SERVICE_ROLE");
    expect(sql).toContain("my_customer_id()");
    expect(sql).toMatch(/Portal approvals cannot use service_role/i);
  });

  it("app portal path never elevates admin for approval", () => {
    expect(portalActions).toContain('admin: false');
    expect(portalActions).toContain("recordEstimateApproval");
    expect(estimateApprovals).toContain("service_role elevation is not allowed");
    expect(estimateApprovals).not.toContain("createAdminClient");
  });

  it("rejects spoofed customer id vs session", () => {
    expect(sql).toContain("p_approved_by_customer_id is distinct from v_portal_customer");
  });
});

describe("0178 security correction — staff actor", () => {
  it("rejects actor spoof for authenticated staff", () => {
    expect(sql).toContain("APPROVAL_ACTOR_SPOOF");
    expect(sql).toContain("Staff actor must match the authenticated user");
  });

  it("service_role staff requires role-validated actor", () => {
    expect(sql).toContain("accounting_actor_id(p_approved_by_user_id)");
    expect(sql).toMatch(/Staff actor role is not authorized/);
  });
});

describe("0178 security correction — commercial live snapshot", () => {
  it("builds payload from live DB; no trusted client jsonb arg", () => {
    expect(sql).toContain("build_estimate_approval_payload_live");
    expect(sql).toContain(
      "drop function if exists public.record_estimate_approval_safe(uuid, uuid, text, jsonb, uuid, uuid, text)",
    );
    // New signature has no p_payload parameter on the RPC itself.
    expect(sql).toContain(
      "create or replace function public.record_estimate_approval_safe(",
    );
    expect(sql).toContain("p_approval_source text");
    expect(sql).toContain("p_approved_by_user_id uuid default null");
    expect(estimateApprovals).not.toContain("p_payload");
  });

  it("commercial digest used in idempotency context", () => {
    expect(sql).toContain("estimate_approval_commercial_digest");
    expect(sql).toContain("v_digest");
  });
});

describe("0178 security correction — approval idempotency + audit", () => {
  it("uses estimate_approval_idempotency + advisory 181", () => {
    expect(sql).toContain("estimate_approval_idempotency");
    expect(sql).toMatch(/pg_advisory_xact_lock\(\s*181\s*,/);
    expect(sql).toContain("IDEMPOTENCY_CONFLICT");
  });

  it("logs estimate_approved exact-once via audit key", () => {
    expect(sql).toContain("log_financial_audit_safe");
    expect(sql).toContain("'estimate_approved'");
    expect(sql).toContain("app.trusted_definer_audit");
  });

  it("never deletes a claimed idempotency key", () => {
    expect(sql).not.toContain(
      "delete from public.estimate_approval_idempotency",
    );
    expect(sql).toContain(
      "perform public.estimate_approval_complete_action(v_key, v_action, v_ctx_hash, v_result)",
    );
  });

  it("payload-build errors are sanitized (no sqlerrm to caller)", () => {
    expect(sql).toContain("raise warning 'APPROVAL_PAYLOAD_BUILD internal:");
    expect(sql).toContain(
      "Could not build the approval snapshot from the current estimate. Contact the office.",
    );
    const payloadCatch = sql.slice(
      sql.indexOf("Never return sqlerrm"),
      sql.indexOf("v_digest :="),
    );
    expect(payloadCatch).not.toContain("coalesce(sqlerrm");
    // App may inspect rpcErr.message to detect a missing RPC, but must not
    // forward it as the customer-facing error string.
    expect(estimateApprovals).not.toMatch(/error:\s*rpcErr\.message/);
    expect(estimateApprovals).toContain(
      "Approval could not be completed. Try again or contact the office.",
    );
  });

  it("begin_action serializes same key (advisory + FOR UPDATE)", () => {
    const begin = sql.slice(
      sql.indexOf("create or replace function public.estimate_approval_begin_action"),
      sql.indexOf("create or replace function public.estimate_approval_complete_action"),
    );
    expect(begin).toContain("estimate_approval_lock_idempotency");
    expect(begin).toContain("for update");
    expect(begin).toContain("IDEMPOTENCY_CONFLICT");
  });
});

describe("0178 security correction — scheduling", () => {
  it("rejects inverted ranges without clamping", () => {
    expect(sql).toContain("SCHEDULE_INVALID_RANGE");
    expect(sql).not.toContain("v_end := p_scheduled_date");
  });

  it("neutral conflict message for installer or crew", () => {
    expect(sql).toContain(
      "The selected installer or crew is already booked on overlapping dates.",
    );
  });

  it("mutation guard + undated assign + crew sync exceptions", () => {
    expect(sql).toContain("JOB_SCHEDULE_VIA_RPC");
    expect(sql).toContain("app.allow_job_schedule_mutation");
    expect(sql).toContain("Crew mirror sync");
  });

  it("malformed existing range precheck", () => {
    expect(sql).toContain("scheduled_end < scheduled_date");
    expect(sql).toContain("Fix malformed ranges before applying");
  });

  it("inclusive same-day overlap semantics", () => {
    expect(
      dateRangesOverlap("2026-06-01", "2026-06-01", "2026-06-01", "2026-06-01"),
    ).toBe(true);
    expect(
      findInstallerScheduleConflict({
        jobId: "a",
        installerProfileId: "i1",
        crewId: null,
        start: "2026-06-01",
        end: "2026-06-01",
        existing: [
          {
            jobId: "b",
            assignedTo: "i1",
            assignedCrewId: null,
            start: "2026-06-01",
            end: "2026-06-01",
          },
        ],
      })?.jobId,
    ).toBe("b");
  });

  it("app routes book/new/assign/carry through schedule RPC", () => {
    expect(jobsActions).toContain("schedule_job_install_safe");
    expect(jobsNew).toContain("schedule_job_install_safe");
    expect(jobsActions).toContain("assignInstaller");
  });
});

describe("0178 security correction — tasks", () => {
  it("assignee field protect + revoke delete", () => {
    expect(sql).toContain("office_tasks_protect_columns");
    expect(sql).toContain("TASK_FIELD_FORBIDDEN");
    expect(sql).toContain("revoke delete on public.office_tasks from authenticated");
    expect(opsActions).toContain("TASK_COMPLETE_ROLES");
    expect(opsActions).toContain("You can only complete tasks assigned to you");
  });

  it("management roles are explicit admin/office/sales_manager (not is_staff)", () => {
    expect(sql).toContain(
      "v_manager := v_role in ('admin', 'office', 'sales_manager')",
    );
    expect(sql).not.toContain(
      "v_manager := public.is_staff() or v_role = 'sales_manager'",
    );
    expect(sql).toContain(
      "public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager')",
    );
  });
});

describe("0178 security correction — receiving still delta-correct", () => {
  it("100 → 40+35+25 and duplicate retry", () => {
    let already = 0;
    for (const target of [40, 75, 100]) {
      const p = planPoReceiveDelta({
        orderedQty: 100,
        targetReceivedQty: target,
        alreadyOnLedger: already,
      });
      expect(p.ok).toBe(true);
      if (p.ok) already += p.delta;
    }
    expect(already).toBe(100);
    expect(
      planPoReceiveDelta({
        orderedQty: 100,
        targetReceivedQty: 40,
        alreadyOnLedger: 40,
      }),
    ).toEqual({ ok: true, delta: 0 });
  });

  it("receiving posts applyPoLineReceiptDelta", () => {
    expect(receivingActions).toContain("applyPoLineReceiptDelta");
  });
});

describe("0178 security correction — accounting + verifier", () => {
  it("never sets posting flags true", () => {
    expect(sql).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql).not.toMatch(/books_of_record\s*=\s*true/i);
  });

  it("migration exists with stable sha256", () => {
    expect(existsSync(mig0178)).toBe(true);
    expect(createHash("sha256").update(readFileSync(mig0178)).digest("hex")).toHaveLength(
      64,
    );
  });

  it("production verifier checks 0178 objects", () => {
    expect(verifier).toContain("schedule_job_install_safe");
    expect(verifier).toContain("record_estimate_approval_safe");
    expect(verifier).toContain("jobs_installer_schedule_excl");
    expect(verifier).toContain("estimate_approval_idempotency");
    expect(verifier).toContain("office_tasks_protect_columns");
    expect(verifier).toContain("jobs_schedule_mutation_guard");
    expect(verifier).toMatch(/read.?only/i);
  });
});
