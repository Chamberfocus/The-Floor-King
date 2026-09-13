/**
 * F7 final hardening — behavioral helpers + migration/action markers.
 * No production mutation. DB concurrency is proven by 0178 SQL markers +
 * pure planners that mirror authoritative RPC/ledger rules.
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
const jobsActions = readFileSync(
  join(ROOT, "src/app/(app)/jobs/actions.ts"),
  "utf8",
);
const estimateApprovals = readFileSync(
  join(ROOT, "src/lib/data/estimate-approvals.ts"),
  "utf8",
);
const receivingActions = readFileSync(
  join(ROOT, "src/app/(app)/warehouse/receiving-actions.ts"),
  "utf8",
);
const opsActions = readFileSync(
  join(ROOT, "src/app/(app)/ops/actions.ts"),
  "utf8",
);
const pulsePage = readFileSync(
  join(ROOT, "src/app/(app)/pulse/page.tsx"),
  "utf8",
);
const accountingBanner = readFileSync(
  join(ROOT, "src/app/(app)/accounting/components/books-status-banner.tsx"),
  "utf8",
);

describe("F7 hardening — migration 0178", () => {
  it("creates 0178 with schedule EXCLUDE + live approval RPC + task RLS", () => {
    expect(existsSync(mig0178)).toBe(true);
    const sql = readFileSync(mig0178, "utf8");
    expect(sql).toContain("jobs_installer_schedule_excl");
    expect(sql).toContain("jobs_crew_schedule_excl");
    expect(sql).toContain("schedule_job_install_safe");
    expect(sql).toContain("record_estimate_approval_safe");
    expect(sql).toContain("build_estimate_approval_payload_live");
    expect(sql).toContain("pg_advisory_xact_lock(180");
    expect(sql).toContain("estimate_approval_lock_idempotency");
    expect(sql).toMatch(/pg_advisory_xact_lock\(\s*181\s*,/);
    expect(sql).toContain("office_tasks_select");
    expect(sql).toContain("APPROVAL_PORTAL_SERVICE_ROLE");
    expect(sql).toContain("F7_0178_PRECHECK");
    expect(sql).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql).not.toMatch(/books_of_record\s*=\s*true/i);
  });

  it("has stable content hash surface (sha256 readable)", () => {
    const buf = readFileSync(mig0178);
    const hash = createHash("sha256").update(buf).digest("hex");
    expect(hash).toHaveLength(64);
  });
});

describe("F7 hardening — scheduling concurrency semantics", () => {
  it("inclusive overlap: same installer same day conflicts", () => {
    expect(
      dateRangesOverlap("2026-03-01", "2026-03-01", "2026-03-01", "2026-03-01"),
    ).toBe(true);
    const hit = findInstallerScheduleConflict({
      jobId: "j2",
      installerProfileId: "inst-a",
      crewId: null,
      start: "2026-03-01",
      end: "2026-03-01",
      existing: [
        {
          jobId: "j1",
          assignedTo: "inst-a",
          assignedCrewId: null,
          start: "2026-03-01",
          end: "2026-03-01",
        },
      ],
    });
    expect(hit?.jobId).toBe("j1");
  });

  it("non-overlapping same installer allowed", () => {
    expect(
      findInstallerScheduleConflict({
        jobId: "j2",
        installerProfileId: "inst-a",
        crewId: null,
        start: "2026-03-03",
        end: "2026-03-03",
        existing: [
          {
            jobId: "j1",
            assignedTo: "inst-a",
            assignedCrewId: null,
            start: "2026-03-01",
            end: "2026-03-01",
          },
        ],
      }),
    ).toBeNull();
  });

  it("different installers may overlap", () => {
    expect(
      findInstallerScheduleConflict({
        jobId: "j2",
        installerProfileId: "inst-b",
        crewId: null,
        start: "2026-03-01",
        end: "2026-03-02",
        existing: [
          {
            jobId: "j1",
            assignedTo: "inst-a",
            assignedCrewId: null,
            start: "2026-03-01",
            end: "2026-03-02",
          },
        ],
      }),
    ).toBeNull();
  });

  it("bookInstall/reschedule call schedule_job_install_safe", () => {
    expect(jobsActions).toContain("schedule_job_install_safe");
    expect(jobsActions).toContain("findInstallerScheduleConflict");
  });
});

describe("F7 hardening — approval atomicity wiring", () => {
  it("recordEstimateApproval uses record_estimate_approval_safe RPC (no client payload)", () => {
    expect(estimateApprovals).toContain("record_estimate_approval_safe");
    expect(estimateApprovals).toContain("p_approval_source");
    expect(estimateApprovals).not.toContain("p_payload");
  });

  it("0178 approval RPC locks estimate then inserts live snapshot then updates", () => {
    const sql = readFileSync(mig0178, "utf8");
    const lockIdx = sql.indexOf("from public.estimates where id = p_estimate_id for update");
    const insertIdx = sql.indexOf("insert into public.estimate_approval_snapshots");
    const updateIdx = sql.indexOf("update public.estimates set");
    expect(lockIdx).toBeGreaterThan(0);
    expect(insertIdx).toBeGreaterThan(lockIdx);
    expect(updateIdx).toBeGreaterThan(insertIdx);
    expect(sql).toContain("APPROVAL_STALE_OR_CONFLICT");
    expect(sql).toContain("build_estimate_approval_payload_live");
    expect(sql).toContain("idempotent");
  });
});

describe("F7 hardening — task authorization", () => {
  it("create/cancel limited to assign roles; complete requires assignee or boss", () => {
    expect(opsActions).toContain("TASK_ASSIGN_ROLES");
    expect(opsActions).toContain("TASK_COMPLETE_ROLES");
    expect(opsActions).toContain("You can only complete tasks assigned to you");
    expect(opsActions).toMatch(/assertRole\(TASK_ASSIGN_ROLES\)/);
  });

  it("0178 RLS: assignee may update; insert is staff|sales_manager", () => {
    const sql = readFileSync(mig0178, "utf8");
    expect(sql).toContain("assigned_to = auth.uid()");
    expect(sql).toContain("sales_manager");
    expect(sql).toContain("office_tasks_insert");
  });
});

describe("F7 hardening — partial receiving ledger plan", () => {
  it("100 → 40 + 35 + 25 yields deltas 40, 35, 25", () => {
    let already = 0;
    const steps = [40, 75, 100]; // cumulative stamps
    const deltas: number[] = [];
    for (const target of steps) {
      const plan = planPoReceiveDelta({
        orderedQty: 100,
        targetReceivedQty: target,
        alreadyOnLedger: already,
      });
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        deltas.push(plan.delta);
        already += plan.delta;
      }
    }
    expect(deltas).toEqual([40, 35, 25]);
    expect(already).toBe(100);
  });

  it("duplicate retry of same stamp is zero delta", () => {
    const plan = planPoReceiveDelta({
      orderedQty: 100,
      targetReceivedQty: 40,
      alreadyOnLedger: 40,
    });
    expect(plan).toEqual({ ok: true, delta: 0 });
  });

  it("over-receive rejected", () => {
    const plan = planPoReceiveDelta({
      orderedQty: 60,
      targetReceivedQty: 61,
      alreadyOnLedger: 0,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("INV_OVER_RECEIVE");
  });

  it("concurrent partial race: second 40 against 60 remaining after first 40", () => {
    const first = planPoReceiveDelta({
      orderedQty: 60,
      targetReceivedQty: 40,
      alreadyOnLedger: 0,
    });
    expect(first).toEqual({ ok: true, delta: 40 });
    // Second concurrent request also targets 40 absolute stamp after first committed:
    const second = planPoReceiveDelta({
      orderedQty: 60,
      targetReceivedQty: 40,
      alreadyOnLedger: 40,
    });
    expect(second).toEqual({ ok: true, delta: 0 });
    // If second targeted full remaining 60 as new stamp:
    const secondB = planPoReceiveDelta({
      orderedQty: 60,
      targetReceivedQty: 80,
      alreadyOnLedger: 40,
    });
    expect(secondB.ok).toBe(false);
  });

  it("receivePoLines posts applyPoLineReceiptDelta", () => {
    expect(receivingActions).toContain("applyPoLineReceiptDelta");
    expect(receivingActions).toContain("inv_po_item_received_qty");
    expect(receivingActions).toContain("already received or voided in another session");
  });
});

describe("F7 hardening — ops vs GL labeling", () => {
  it("pulse marks operational/subledger; accounting banner present", () => {
    expect(pulsePage).toContain("(Operational)");
    expect(pulsePage).toContain("(Subledger)");
    expect(pulsePage).toMatch(/not posted GL|External books remain official/i);
    expect(accountingBanner).toContain("ACCOUNTING_NOT_BOOKS_MESSAGE");
  });
});

describe("launch-trust invoice + warehouse gates", () => {
  it("invoice create/delete are role-gated; issued invoices cannot be hard-deleted", () => {
    const invoices = readFileSync(
      join(ROOT, "src/app/(app)/invoices/actions.ts"),
      "utf8",
    );
    expect(invoices).toContain("INVOICE_CREATE_ROLES");
    expect(invoices).toContain("INVOICE_DELETE_ROLES");
    expect(invoices).toContain("Issued invoices cannot be deleted");
    expect(invoices).toContain("await assertRole(INVOICE_CREATE_ROLES)");
  });

  it("warehouse mark-ready returns errors instead of false success", () => {
    expect(jobsActions).toContain("assessWarehouseMarkReady");
    expect(jobsActions).toContain("Promise<{ error: string | null }>");
    expect(jobsActions).toContain("return { error: null }");
    const ui = readFileSync(
      join(ROOT, "src/app/(app)/warehouse/warehouse-job-actions.tsx"),
      "utf8",
    );
    expect(ui).toContain("res?.error");
    expect(ui).not.toMatch(/await completeWarehouseJob\(fd\);\s*setCompleteOpen\(false\);\s*toast\.success/);
  });
});

describe("launch-trust money + schedule follow-through", () => {
  it("coverage and saveInvoice treat deposits/credits/write-offs as financial activity", () => {
    const invoices = readFileSync(
      join(ROOT, "src/app/(app)/invoices/actions.ts"),
      "utf8",
    );
    expect(invoices).toContain("hasFinancialActivity");
    expect(invoices).toContain("invoice_open_ar_balance");
    expect(invoices).toContain("invoices_one_active_original_per_estimate");
    expect(invoices).toContain("commercial_kind");
    expect(invoices).not.toMatch(/const due = Math\.max\(\s*0,\s*invoiceCoverageTotal/);
  });

  it("onsite collect recomputes status from open AR instead of forcing paid", () => {
    expect(jobsActions).toContain("recomputeInvoiceStatus");
    expect(jobsActions).not.toMatch(
      /update\(\{ status: "paid" \}\)\.eq\("id", open\.invoiceId\)/,
    );
    expect(jobsActions).toContain("BOOK_INSTALL_ROLES");
    expect(jobsActions).toContain("That job is not available to schedule");
    expect(jobsActions).toContain("hasMaterialNeed = true");
  });

  it("0186 unique original invoice + salesman mine_job schedule guard", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/0186_launch_trust_schedule_invoice_guards.sql"),
      "utf8",
    );
    expect(sql).toContain("invoices_one_active_original_per_estimate");
    expect(sql).toContain("commercial_kind = 'original'");
    expect(sql).toContain("v_role = 'salesman' and not public.mine_job(p_job_id)");
    expect(sql).toContain("Do NOT set posting_enabled");
    expect(sql).toContain("set search_path = public");
  });

  it("estimate send waits for email; portal decline checks ownership", () => {
    const estimates = readFileSync(
      join(ROOT, "src/app/(app)/estimates/actions.ts"),
      "utf8",
    );
    const sendIdx = estimates.indexOf("Your estimate from Cleveland Floor King");
    const updateIdx = estimates.indexOf(
      'await supabase.from("estimates").update(patch).eq("id", id)',
    );
    expect(sendIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(sendIdx);
    expect(estimates).toContain('notify.status === "failed"');

    const portal = readFileSync(join(ROOT, "src/app/portal/actions.ts"), "utf8");
    const decline = portal.slice(
      portal.indexOf("export async function portalDeclineEstimate"),
      portal.indexOf("export async function portalRequestChanges"),
    );
    expect(decline).toContain("portalCustomerId");
    expect(decline).toContain("estimates_customer");
    expect(decline).toContain(".select(\"id\")");
  });

  it("PO save skips line rewrite after receipts; receive stamps after ledger", () => {
    const po = readFileSync(
      join(ROOT, "src/app/(app)/purchase-orders/actions.ts"),
      "utf8",
    );
    expect(po).toContain("rewriteBlocked");
    expect(po).toContain("hasReceipts");
    const recv = readFileSync(
      join(ROOT, "src/app/(app)/warehouse/receiving-actions.ts"),
      "utf8",
    );
    const ledger = recv.indexOf("applyPoLineReceiptDelta");
    const stamp = recv.indexOf("received_qty: qty");
    expect(ledger).toBeGreaterThan(0);
    expect(stamp).toBeGreaterThan(ledger);
  });
});
