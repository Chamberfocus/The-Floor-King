/**
 * Business-ops completeness — follow-up, collections, scheduler split,
 * installer issues, and wiring markers. Does not invent architecture docs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_SNOOZE_DAYS,
  ESTIMATE_FOLLOWUP_KIND,
  DEPOSIT_DUE_KIND,
  COLLECT_BALANCE_KIND,
  SERVICE_CALLBACK_KIND,
  INSTALLER_ISSUE_KIND,
  callbackCategoryForIssue,
  classifyInvoiceCollection,
  followUpDueAt,
  hasActiveDepositOnFile,
  installerIssueTitle,
  isInstallerIssueCategory,
  parsePoNumberQuery,
  shouldCreateCollectBalanceTask,
  shouldCreateDepositDueTask,
  shouldCreateEstimateFollowup,
  shouldStopEstimateFollowup,
  snoozeDueAt,
  splitUnscheduledByMaterialsReady,
} from "@/lib/ops-followup";
import {
  automationSourceKey,
  shouldCreateAutomatedTask,
} from "@/lib/office-task";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";
import { activePaymentsTotal } from "@/lib/payment-safety";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("estimate follow-up automation", () => {
  it("creates follow-up only when sent, stops on won/lost", () => {
    expect(shouldCreateEstimateFollowup("sent")).toBe(true);
    expect(shouldCreateEstimateFollowup("draft")).toBe(false);
    expect(shouldStopEstimateFollowup("approved")).toBe(true);
    expect(shouldStopEstimateFollowup("declined")).toBe(true);
    expect(shouldStopEstimateFollowup("sent")).toBe(false);
  });

  it("due date is +N UTC days", () => {
    expect(followUpDueAt(new Date("2026-09-13T12:00:00.000Z"), 2)).toBe(
      "2026-09-15T12:00:00.000Z",
    );
  });

  it("snooze only allows 1 / 3 / 7 days", () => {
    expect(ALLOWED_SNOOZE_DAYS).toEqual([1, 3, 7]);
    expect(snoozeDueAt(new Date("2026-09-13T12:00:00.000Z"), 3)).toBe(
      "2026-09-16T12:00:00.000Z",
    );
    expect(snoozeDueAt(new Date("2026-09-13T12:00:00.000Z"), 99)).toBe(
      snoozeDueAt(new Date("2026-09-13T12:00:00.000Z"), 3),
    );
  });

  it("idempotent source keys do not spam", () => {
    const key = automationSourceKey(ESTIMATE_FOLLOWUP_KIND, "est-1");
    expect(key).toBe("estimate_followup:est-1");
    expect(
      shouldCreateAutomatedTask({
        sourceKey: key,
        existingOpenSourceKeys: [key],
      }),
    ).toBe(false);
  });
});

describe("deposit / collect auto-tasks", () => {
  it("deposit due only after approval with no deposit on file", () => {
    expect(
      shouldCreateDepositDueTask({
        estimateStatus: "approved",
        availableDeposit: 0,
        appliedDeposit: 0,
      }),
    ).toBe(true);
    expect(
      hasActiveDepositOnFile({ availableDeposit: 500, appliedDeposit: 0 }),
    ).toBe(true);
    expect(
      shouldCreateDepositDueTask({
        estimateStatus: "approved",
        availableDeposit: 500,
        appliedDeposit: 0,
      }),
    ).toBe(false);
    expect(
      shouldCreateDepositDueTask({
        estimateStatus: "sent",
        availableDeposit: 0,
        appliedDeposit: 0,
      }),
    ).toBe(false);
  });

  it("collect task only after complete with open AR", () => {
    expect(
      shouldCreateCollectBalanceTask({ jobStatus: "completed", openBalance: 250 }),
    ).toBe(true);
    expect(
      shouldCreateCollectBalanceTask({ jobStatus: "completed", openBalance: 0 }),
    ).toBe(false);
    expect(
      shouldCreateCollectBalanceTask({ jobStatus: "in_progress", openBalance: 250 }),
    ).toBe(false);
  });
});

describe("collections buckets", () => {
  const now = new Date("2026-09-13T15:00:00.000Z");
  it("overdue when due date is in the past and balance remains", () => {
    expect(
      classifyInvoiceCollection({
        status: "sent",
        dueDate: "2026-09-01",
        balance: 400,
        now,
      }),
    ).toBe("overdue");
  });
  it("paid when canonical remaining is ~0", () => {
    const due = effectiveInvoiceBalance({
      items: [{ quantity: 1, rate: 1000 }],
      taxRate: 0,
      amountPaid: activePaymentsTotal([{ amount: 1000, status: "active" }]),
      appliedCredits: 0,
      appliedDeposits: 0,
      appliedWriteOffs: 0,
    }).amountDue;
    expect(
      classifyInvoiceCollection({
        status: "paid",
        dueDate: "2026-09-01",
        balance: due,
        now,
      }),
    ).toBe("paid");
  });
});

describe("scheduler materials split", () => {
  it("ready vs blocked without weakening the warehouse-ready gate", () => {
    const split = splitUnscheduledByMaterialsReady([
      { id: "a", warehouseReadyAt: "2026-09-01", hasMaterialNeed: true },
      { id: "b", warehouseReadyAt: null, hasMaterialNeed: true },
      { id: "c", warehouseReadyAt: null, hasMaterialNeed: false },
    ]);
    expect(split.ready.map((j) => j.id)).toEqual(["a", "c"]);
    expect(split.blocked.map((j) => j.id)).toEqual(["b"]);
    expect(
      assessMaterialsReadyForSchedule({
        warehouseReadyAt: null,
        hasMaterialNeed: true,
      }).ready,
    ).toBe(false);
  });
});

describe("installer issue categories", () => {
  it("maps field issues onto existing callback categories", () => {
    expect(isInstallerIssueCategory("shortage")).toBe(true);
    expect(callbackCategoryForIssue("shortage")).toBe("material");
    expect(callbackCategoryForIssue("damage")).toBe("damage");
    expect(installerIssueTitle("return_trip", "John Bossone")).toBe(
      "Return trip needed: John Bossone",
    );
  });
});

describe("wiring — send / approve / complete / crew report", () => {
  it("estimate send and approve call automation helpers", () => {
    const actions = read("src/app/(app)/estimates/actions.ts");
    expect(actions).toContain("onEstimateSentOps");
    expect(actions).toContain("onEstimateResolvedOps");
    const auto = read("src/lib/data/ops-automation.ts");
    expect(auto).toContain("ensureAutomatedOfficeTaskSafe");
    expect(auto).toContain("ESTIMATE_FOLLOWUP_KIND");
    expect(auto).toContain("completeAutomatedOfficeTasks");
    expect(auto).toContain("DEPOSIT_DUE_KIND");
  });

  it("portal approval completes follow-up and may open deposit task", () => {
    const portal = read("src/app/portal/actions.ts");
    expect(portal).toContain("onEstimateResolvedOps");
    expect(portal).not.toContain("mergeCustomer");
    const declineAt = portal.indexOf("onEstimateDeclined");
    const lastResolved = portal.lastIndexOf("onEstimateResolvedOps");
    expect(declineAt).toBeGreaterThan(0);
    expect(lastResolved).toBeGreaterThan(declineAt);
  });

  it("job complete can open a collect-balance task", () => {
    const jobs = read("src/app/(app)/jobs/actions.ts");
    expect(jobs).toContain("onJobCompletedOps");
    const auto = read("src/lib/data/ops-automation.ts");
    expect(auto).toContain("COLLECT_BALANCE_KIND");
    expect(auto).toContain("shouldCreateCollectBalanceTask");
  });

  it("installer issue report exists and does not expose costing", () => {
    const report = read("src/app/(app)/ops/actions.ts");
    expect(report).toContain("reportInstallerIssue");
    expect(report).toContain("INSTALLER_ISSUE_KIND");
    expect(report).not.toContain("target_gross_margin");
  });

  it("does not enable accounting or merge customers", () => {
    const auto = read("src/lib/data/ops-automation.ts");
    expect(auto).not.toContain("posting_enabled");
    expect(auto).not.toContain("mergeCustomer");
    expect(read("src/lib/ops-followup.ts")).not.toContain("posting_enabled = true");
  });

  it("kinds stay namespaced and search/nav are wired", () => {
    expect(SERVICE_CALLBACK_KIND).toBe("service_callback");
    expect(INSTALLER_ISSUE_KIND).toBe("installer_issue");
    expect(read("src/app/(app)/search/actions.ts")).toContain("street.ilike");
    expect(read("src/app/(app)/search/actions.ts")).toContain("parsePoNumberQuery");
    expect(read("src/lib/nav.ts")).toContain('href: "/service"');
  });
});

describe("declined follow-up and money received", () => {
  it("staff decline is outside the sent/approved-only workflow block", () => {
    const actions = read("src/app/(app)/estimates/actions.ts");
    expect(actions).toContain(
      'if (status === "sent" || status === "approved" || status === "declined")',
    );
    expect(actions).toContain("onEstimateResolvedOps");
  });

  it("payment and deposit recording complete chase tasks", () => {
    const invoices = read("src/app/(app)/invoices/actions.ts");
    expect(invoices).toContain("onMoneyReceivedOps");
    const auto = read("src/lib/data/ops-automation.ts");
    expect(auto).toContain("completeOpenAutomatedTasksForCustomer");
    expect(auto).toContain("DEPOSIT_DUE_KIND");
    expect(auto).toContain("COLLECT_BALANCE_KIND");
  });

  it("PO number search is exact integer match, not ilike", () => {
    expect(parsePoNumberQuery("1042")).toBe(1042);
    expect(parsePoNumberQuery("PO-1042")).toBeNull();
    expect(parsePoNumberQuery("12.5")).toBeNull();
    const search = read("src/app/(app)/search/actions.ts");
    expect(search).toContain('.eq("po_number", poNumber)');
    expect(search).not.toContain("po_number.ilike");
  });
});
