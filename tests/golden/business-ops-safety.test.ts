/**
 * PR #4 safety review — ACL, allowlisted automation kinds, installer
 * assignment, search sanitization. Does not invent architecture docs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLLECT_BALANCE_KIND,
  DEPOSIT_DUE_KIND,
  ESTIMATE_FOLLOWUP_KIND,
  INSTALLER_ISSUE_KIND,
  SERVICE_CALLBACK_KIND,
  automationSourceKeyPrefix,
  installerMayReportIssue,
  isAutomationSourceKind,
  maySnoozeCustomerFollowup,
  parsePoNumberQuery,
  reuseOpenInstallerIssueId,
  sanitizeIlikeQuery,
  shouldCreateCollectBalanceTask,
  shouldCreateDepositDueTask,
} from "@/lib/ops-followup";
import {
  automationSourceKey,
  shouldCreateAutomatedTask,
} from "@/lib/office-task";
import { installerSeesJob } from "@/lib/installer-assignment";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("automation kind allowlist", () => {
  it("accepts only the five ops kinds", () => {
    expect(isAutomationSourceKind(ESTIMATE_FOLLOWUP_KIND)).toBe(true);
    expect(isAutomationSourceKind(DEPOSIT_DUE_KIND)).toBe(true);
    expect(isAutomationSourceKind(COLLECT_BALANCE_KIND)).toBe(true);
    expect(isAutomationSourceKind(SERVICE_CALLBACK_KIND)).toBe(true);
    expect(isAutomationSourceKind(INSTALLER_ISSUE_KIND)).toBe(true);
    expect(isAutomationSourceKind("deposit_due:%")).toBe(false);
    expect(isAutomationSourceKind("%")).toBe(false);
    expect(isAutomationSourceKind("estimate_followup:est-1")).toBe(false);
    expect(automationSourceKeyPrefix("%")).toBeNull();
    expect(automationSourceKeyPrefix(DEPOSIT_DUE_KIND)).toBe("deposit_due:");
  });

  it("admin insert/complete/snooze refuse unknown kinds before querying", () => {
    const auto = read("src/lib/data/ops-automation.ts");
    expect(auto).toContain("isAutomationSourceKind(args.sourceKind)");
    expect(auto).toContain("automationSourceKeyPrefix(args.sourceKind)");
    expect(auto).toContain("tryAdmin()");
    expect(auto).not.toContain("from(\"payments\")");
    expect(auto).not.toContain("from(\"invoices\")");
    expect(auto).not.toContain("posting_enabled");
  });

  it("retries do not create a second open task for the same source_key", () => {
    const key = automationSourceKey(ESTIMATE_FOLLOWUP_KIND, "est-1");
    expect(
      shouldCreateAutomatedTask({
        sourceKey: key,
        existingOpenSourceKeys: [key],
      }),
    ).toBe(false);
  });
});

describe("snooze ACL", () => {
  it("salesman may only snooze owned customers; portal/crew cannot", () => {
    expect(
      maySnoozeCustomerFollowup({
        role: "salesman",
        actorId: "rep-a",
        assignedTo: "rep-a",
        workflowOwnerId: null,
      }),
    ).toBe(true);
    expect(
      maySnoozeCustomerFollowup({
        role: "salesman",
        actorId: "rep-a",
        assignedTo: "rep-b",
        workflowOwnerId: "rep-b",
      }),
    ).toBe(false);
    expect(
      maySnoozeCustomerFollowup({
        role: "customer",
        actorId: "cust",
        assignedTo: "cust",
        workflowOwnerId: "cust",
      }),
    ).toBe(false);
    expect(
      maySnoozeCustomerFollowup({
        role: "office",
        actorId: "office-1",
        assignedTo: "rep-b",
        workflowOwnerId: null,
      }),
    ).toBe(true);
    const action = read("src/app/(app)/customers/actions.ts");
    expect(action).toContain("maySnoozeCustomerFollowup");
    expect(action).toContain("ESTIMATE_FOLLOWUP_KIND");
    expect(action).toContain('.eq("customer_id", id)');
  });
});

describe("installer issue ACL", () => {
  it("crew cannot report on another installer's job or an unclaimed board job", () => {
    expect(
      installerMayReportIssue({
        role: "crew",
        actorId: "crew-a",
        assignedTo: "crew-b",
        assignedCrewId: null,
        memberCrewIds: [],
      }),
    ).toBe(false);
    expect(
      installerMayReportIssue({
        role: "crew",
        actorId: "crew-a",
        assignedTo: "crew-a",
        assignedCrewId: null,
        memberCrewIds: [],
      }),
    ).toBe(true);
    expect(
      installerMayReportIssue({
        role: "crew",
        actorId: "crew-a",
        assignedTo: "other",
        assignedCrewId: "crew-row",
        memberCrewIds: ["crew-row"],
      }),
    ).toBe(true);
    expect(
      installerMayReportIssue({
        role: "salesman",
        actorId: "rep",
        assignedTo: "rep",
        assignedCrewId: null,
        memberCrewIds: [],
      }),
    ).toBe(false);
    expect(
      installerSeesJob({
        assignedTo: "other",
        assignedCrewId: null,
        userId: "crew-a",
        memberCrewIds: [],
      }),
    ).toBe(false);
  });

  it("same open description is reused; client customer_id is not trusted", () => {
    expect(
      reuseOpenInstallerIssueId({
        existingOpen: [{ id: "cb-1", description: "Short on glue" }],
        description: "Short on glue",
      }),
    ).toBe("cb-1");
    expect(
      reuseOpenInstallerIssueId({
        existingOpen: [{ id: "cb-1", description: "Short on glue" }],
        description: "Different problem",
      }),
    ).toBeNull();
    const report = read("src/app/(app)/ops/actions.ts");
    const start = report.indexOf("export async function reportInstallerIssue");
    const body = report.slice(start);
    expect(body).toContain("installerMayReportIssue");
    expect(body).not.toContain('formData.get("customer_id")');
    expect(body.indexOf("createAdminClient")).toBeGreaterThan(
      body.indexOf("installerMayReportIssue"),
    );
    expect(body).toContain("reuseOpenInstallerIssueId");
    expect(report).not.toContain("target_gross_margin");
  });

  it("resolve completes only the matching callback and installer-issue keys", () => {
    const report = read("src/app/(app)/ops/actions.ts");
    const start = report.indexOf("export async function resolveServiceCallback");
    const next = report.indexOf("export async function cancelServiceCallback");
    const body = report.slice(start, next);
    expect(body).toContain("assertRole(CALLBACK_ROLES)");
    expect(body).toContain("SERVICE_CALLBACK_KIND");
    expect(body).toContain("INSTALLER_ISSUE_KIND");
    expect(body).toContain("entityId: id");
    expect(body).not.toContain("completeOpenAutomatedTasksForCustomer");
  });
});

describe("dashboard / search ACL", () => {
  it("today queues use the session client and the dashboard is office-plus", () => {
    const dash = read("src/app/(app)/dashboard/page.tsx");
    expect(dash).toContain(
      'if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/")',
    );
    const queues = read("src/lib/data/ops-queues.ts");
    expect(queues).toContain("createClient");
    expect(queues).not.toContain("createAdminClient");
  });

  it("search sanitizes or-filter / LIKE metacharacters and keeps session RLS", () => {
    expect(sanitizeIlikeQuery("Smith,id.eq.other")).toBe("Smith id.eq.other");
    expect(sanitizeIlikeQuery("12%_Main")).toBe("12 Main");
    expect(parsePoNumberQuery("1042")).toBe(1042);
    const search = read("src/app/(app)/search/actions.ts");
    expect(search).toContain("sanitizeIlikeQuery");
    expect(search).toContain("createClient");
    expect(search).not.toContain("createAdminClient");
    expect(search).not.toContain("po_number.ilike");
  });
});

describe("money vs tasks", () => {
  it("completing a deposit/collect task is not the same as recording money", () => {
    expect(
      shouldCreateDepositDueTask({
        estimateStatus: "approved",
        availableDeposit: 0,
        appliedDeposit: 0,
      }),
    ).toBe(true);
    expect(
      shouldCreateCollectBalanceTask({
        jobStatus: "completed",
        openBalance: 250,
      }),
    ).toBe(true);
    const auto = read("src/lib/data/ops-automation.ts");
    expect(auto).toContain("onMoneyReceivedOps");
    expect(auto).not.toContain("record_invoice_payment_safe");
    expect(auto).not.toContain("record_customer_deposit_safe");
    const invoices = read("src/app/(app)/invoices/actions.ts");
    expect(invoices.indexOf("rpcRecordPayment")).toBeLessThan(
      invoices.lastIndexOf("onMoneyReceivedOps"),
    );
  });
});

describe("portal ownership before automation", () => {
  it("approve and decline check portal customer_id before onEstimateResolvedOps", () => {
    const portal = read("src/app/portal/actions.ts");
    const approve = portal.indexOf("export async function portalApproveEstimate");
    const decline = portal.indexOf("export async function portalDeclineEstimate");
    const approveBody = portal.slice(approve, decline);
    const declineBody = portal.slice(decline);
    expect(approveBody.indexOf("estRow.customer_id !== portalCustomerId")).toBeLessThan(
      approveBody.indexOf("onEstimateResolvedOps"),
    );
    expect(approveBody.indexOf("recordEstimateApproval")).toBeLessThan(
      approveBody.indexOf("onEstimateResolvedOps"),
    );
    expect(declineBody.indexOf("estRow.customer_id !== portalCustomerId")).toBeLessThan(
      declineBody.indexOf("onEstimateResolvedOps"),
    );
    expect(portal).not.toContain("mergeCustomer");
  });
});
