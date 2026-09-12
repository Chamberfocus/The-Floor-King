/**
 * Website P1 function remediation — 12 audit findings from
 * canvases/website-function-audit.canvas.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checklistCanOneTapApprove,
  estimateApproveOptionMode,
  APPROVE_OPTION_REQUIRED_MESSAGE,
} from "@/lib/estimate-approve-ui";
import {
  describeMessageSend,
  messageWasSent,
  messageSendQueryValue,
  combineMessageSends,
  type MessageSendResult,
} from "@/lib/message-send";
import {
  stepGate,
  workflowAdvanceGate,
  type FlowFacts,
} from "@/lib/job-flow";
import { defaultInvoiceJobId } from "@/lib/invoice-job-link";
import {
  isMaterialsNotReadyError,
  MATERIALS_NOT_READY_MESSAGE,
} from "@/lib/materials-ready";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const emptyFacts = (over: Partial<FlowFacts> = {}): FlowFacts => ({
  hasActivity: false,
  estimateBooked: false,
  hasEstimate: false,
  estimateSent: false,
  estimateApproved: false,
  depositPaid: false,
  workOrderExists: false,
  materialsStaged: false,
  installBooked: false,
  installComplete: false,
  balancePaid: false,
  satisfactionSigned: false,
  ...over,
});

describe("P1-01 salesman can open estimate order page", () => {
  it("order page ALLOWED includes salesman", () => {
    const src = read("src/app/(app)/estimates/[id]/order/page.tsx");
    expect(src).toMatch(/ALLOWED[\s\S]*salesman/);
    expect(src).not.toMatch(
      /const ALLOWED = \["admin", "office", "sales_manager", "warehouse"\]/,
    );
  });
});

describe("P1-02 one canonical estimate approve control", () => {
  it("next-steps no longer silently approves first option", () => {
    const src = read("src/app/(app)/estimates/[id]/page.tsx");
    expect(src).not.toMatch(/Approve &amp; continue/);
    expect(src).toContain('id="workflow"');
    expect(src).toContain("Accept which option?");
  });
});

describe("P1-03 checklist approve requires a chosen option", () => {
  it("one-tap only when exactly one option exists", () => {
    expect(estimateApproveOptionMode([])).toBe("blocked");
    expect(estimateApproveOptionMode(["a"])).toBe("single");
    expect(estimateApproveOptionMode(["a", "b"])).toBe("picker");
    expect(checklistCanOneTapApprove(["only"])).toBe(true);
    expect(checklistCanOneTapApprove(["a", "b"])).toBe(false);
  });

  it("setEstimateStatus fails closed without accepted_option_id", () => {
    const src = read("src/app/(app)/estimates/actions.ts");
    expect(src).toContain("APPROVE_OPTION_REQUIRED_MESSAGE");
    expect(APPROVE_OPTION_REQUIRED_MESSAGE).toMatch(/option/i);
  });

  it("checklist links to picker when multiple options", () => {
    const src = read("src/components/checklist-slots.tsx");
    expect(src).toContain("checklistCanOneTapApprove");
    expect(src).toContain("Pick option");
    expect(src).toContain("accepted_option_id");
  });
});

describe("P1-04 stage change uses stepGate", () => {
  it("blocks advancing off approve until the estimate is approved", () => {
    const blocked = workflowAdvanceGate({
      currentStep: "approve",
      facts: emptyFacts(),
      targetOffSpine: false,
      movingForward: true,
    });
    expect(blocked.done).toBe(false);
    expect(blocked.reason).toMatch(/approved/i);

    const ok = workflowAdvanceGate({
      currentStep: "approve",
      facts: emptyFacts({ estimateApproved: true }),
      targetOffSpine: false,
      movingForward: true,
    });
    expect(ok.done).toBe(true);
  });

  it("allows lost/hold and moving backward without the gate", () => {
    const lost = workflowAdvanceGate({
      currentStep: "approve",
      facts: emptyFacts(),
      targetOffSpine: true,
      movingForward: true,
    });
    expect(lost.done).toBe(true);
    const back = workflowAdvanceGate({
      currentStep: "approve",
      facts: emptyFacts(),
      targetOffSpine: false,
      movingForward: false,
    });
    expect(back.done).toBe(true);
  });

  it("advanceWorkflow calls workflowAdvanceGate", () => {
    const src = read("src/app/(app)/customers/actions.ts");
    expect(src).toContain("workflowAdvanceGate");
    expect(src).toContain("loadCustomerFlowFacts");
  });

  it("stepGate still exists as the canonical helper", () => {
    expect(stepGate("build_quote", emptyFacts()).done).toBe(false);
  });
});

describe("P1-05 customer file materials-not-ready warning", () => {
  it("customer file builds InstallSchedule via buildInstallScheduleProps", () => {
    const src = read("src/app/(app)/customers/[id]/page.tsx");
    expect(src).toContain("buildInstallScheduleProps");
    expect(src).toContain("installScheduleProps");
  });

  it("shared builder computes materialsReady from warehouse-ready, not default true", () => {
    const src = read("src/lib/data/install-schedule.ts");
    expect(src).toContain("assessMaterialsReadyForSchedule");
    expect(src).toContain("materialsReady");
    const ui = read("src/app/(app)/customers/[id]/install-schedule.tsx");
    expect(ui).not.toMatch(/materialsReady = true/);
    const manual = read("src/app/(app)/customers/[id]/manual-booking.tsx");
    expect(manual).not.toMatch(/materialsReady = true/);
  });
});

describe("P1-06 install grid/calendar drag can enter override reason", () => {
  it("detects materials-not-ready errors", () => {
    expect(isMaterialsNotReadyError(MATERIALS_NOT_READY_MESSAGE)).toBe(true);
    expect(isMaterialsNotReadyError("Schedule conflict")).toBe(false);
  });

  it("calendar and grid pass override reason into rescheduleInstall", () => {
    const cal = read("src/app/(app)/install-scheduler/installer-calendar.tsx");
    const grid = read("src/app/(app)/install-scheduler/installer-grid.tsx");
    expect(cal).toContain("isMaterialsNotReadyError");
    expect(cal).toContain("Move with override");
    expect(grid).toContain("isMaterialsNotReadyError");
    expect(grid).toContain("overrideReason");
    expect(cal).not.toMatch(/customer & installer notified/i);
    expect(grid).not.toMatch(/are notified/);
  });
});

describe("P1-07 board claim does not mark scheduled with no date", () => {
  it("assignInstaller does not set status scheduled without a date", () => {
    const src = read("src/app/(app)/jobs/actions.ts");
    const fn = src.slice(src.indexOf("export async function assignInstaller"));
    const undated = fn.slice(fn.indexOf("Undated board assign"), fn.indexOf("revalidateJobEverywhere"));
    expect(undated).toContain("keep unscheduled");
    expect(undated).not.toMatch(/status:\s*"scheduled"/);
    expect(fn).toContain("enforceMaterialsReadyForSchedule");
  });
});

describe("P1-08 printed invoice balance uses credits", () => {
  it("invoice builder print totals use effectiveInvoiceBalance", () => {
    const src = read("src/app/(app)/invoices/invoice-builder.tsx");
    expect(src).toContain("effectiveInvoiceBalance");
    expect(src).toContain("Balance due");
    const due = effectiveInvoiceBalance({
      items: [{ quantity: 1, rate: 100 }],
      taxRate: 0,
      amountPaid: 0,
      appliedCredits: 40,
    }).amountDue;
    expect(due).toBe(60);
  });
});

describe("P1-09 email/SMS never reports sent unless send succeeded", () => {
  it("classifies success / failed / not_attempted", () => {
    const ok: MessageSendResult = { status: "success" };
    const fail: MessageSendResult = { status: "failed", error: "provider 500" };
    const skip: MessageSendResult = {
      status: "not_attempted",
      reason: "Customer email notifications are turned off.",
    };
    expect(messageWasSent(ok)).toBe(true);
    expect(messageWasSent(fail)).toBe(false);
    expect(messageWasSent(skip)).toBe(false);
    expect(messageSendQueryValue(ok)).toBe("success");
    expect(describeMessageSend(skip)).toMatch(/turned off/);
    expect(combineMessageSends([ok, skip]).status).toBe("success");
    expect(combineMessageSends([ok, fail]).status).toBe("failed");
    expect(combineMessageSends([skip]).status).toBe("not_attempted");
  });

  it("sendEmail returns structured results; estimate send checks them", () => {
    const notify = read("src/lib/notify.ts");
    expect(notify).toContain("MessageSendResult");
    expect(notify).toContain("not_attempted");
    const actions = read("src/app/(app)/estimates/actions.ts");
    expect(actions).toContain("describeMessageSend");
    expect(actions).toContain("MessageSendResult");
    const onway = read("src/app/(app)/customers/[id]/on-the-way-button.tsx");
    expect(onway).toContain("r.notify.status === \"success\"");
    expect(onway).toContain("notify failed");
    const chat = read("src/app/(app)/customers/[id]/customer-chat.tsx");
    expect(chat).toContain("state.notify?.status === \"failed\"");
    const warehouse = read("src/app/(app)/warehouse/warehouse-job-actions.tsx");
    expect(warehouse).not.toMatch(/installer, sales & admin notified/);
  });
});

describe("P1-10 ad-hoc invoice links to the job when unambiguous", () => {
  it("defaultInvoiceJobId links a single active job and not many", () => {
    expect(defaultInvoiceJobId(["j1"])).toBe("j1");
    expect(defaultInvoiceJobId([])).toBe(null);
    expect(defaultInvoiceJobId(["j1", "j2"])).toBe(null);
  });

  it("createInvoice writes job_id", () => {
    const src = read("src/app/(app)/invoices/actions.ts");
    expect(src).toMatch(/createInvoice[\s\S]*job_id: jobId/);
  });
});

describe("P1-11 goodwill credit and write-off UI exist", () => {
  it("office invoice page can issue manual credit and write off", () => {
    const page = read("src/app/(app)/invoices/[id]/page.tsx");
    expect(page).toContain("issueGoodwillCredit");
    expect(page).toContain("writeOffInvoiceBalance");
    expect(page).toContain("Issue goodwill credit");
    const form = page.slice(
      page.indexOf("Issue goodwill credit"),
      page.indexOf("Write off remaining"),
    );
    expect(form).toContain("PaymentIdempotencyField");
    const actions = read("src/app/(app)/credits/actions.ts");
    expect(actions).toContain('p_kind: "manual"');
    expect(actions).toContain("write_off_invoice_safe");
  });
});

describe("P1-12 PO receive revalidates inventory", () => {
  it("receivePoLines and unreceive revalidate /inventory", () => {
    const src = read("src/app/(app)/warehouse/receiving-actions.ts");
    expect(src).toContain('revalidatePath("/inventory")');
    const inv = read("src/app/(app)/inventory/page.tsx");
    expect(inv).toContain('export const dynamic = "force-dynamic"');
  });
});
