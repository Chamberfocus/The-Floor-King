/**
 * F2 canonical job operational state — derived from existing SoT signals.
 * Does not invent a second job status system.
 */
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";

export type JobOpsSeverity = "info" | "attention" | "urgent";

export type JobOpsResponsibleArea =
  | "Sales"
  | "Office"
  | "Purchasing"
  | "Warehouse"
  | "Scheduling"
  | "Install"
  | "Management";

export type JobOpsBlockerCode =
  | "manual_hold"
  | "awaiting_approval"
  | "payment_due"
  | "needs_purchasing"
  | "materials_not_ready"
  | "ready_to_schedule"
  | "scheduled"
  | "in_progress"
  | "completion_needed"
  | "completed"
  | "cancelled"
  | "open_service_callback"
  | "ok";

export interface JobOperationalInput {
  status: string;
  scheduledDate: string | null | undefined;
  warehouseReadyAt: string | null | undefined;
  hasMaterialNeed: boolean;
  /** Active manual hold (released_at null). */
  activeHold: { reason: string; category?: string | null } | null;
  /** Estimate linked but not yet approved (optional soft signal). */
  awaitingCustomerApproval?: boolean;
  /** Open collectible balance on job invoices. */
  openBalance?: number;
  /** Purchasing gap remains on order-sourced lines. */
  hasPurchasingGap?: boolean;
  /** Open/waiting service callbacks on this job. */
  hasOpenServiceCallback?: boolean;
}

export interface JobOperationalState {
  blocked: boolean;
  blockerCode: JobOpsBlockerCode;
  blockerLabel: string;
  nextAction: string;
  responsibleArea: JobOpsResponsibleArea;
  severity: JobOpsSeverity;
  explanation: string;
  materialsReady: boolean;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Single source for job attention strip + ops queue.
 * Priority order: cancelled → completed → manual hold → callback → payment →
 * purchasing → materials → schedule lifecycle → approval.
 */
export function assessJobOperationalState(
  input: JobOperationalInput,
): JobOperationalState {
  const materials = assessMaterialsReadyForSchedule({
    warehouseReadyAt: input.warehouseReadyAt,
    hasMaterialNeed: input.hasMaterialNeed,
  });
  const materialsReady = materials.ready;

  if (input.status === "cancelled") {
    return {
      blocked: false,
      blockerCode: "cancelled",
      blockerLabel: "Cancelled",
      nextAction: "No further operational action",
      responsibleArea: "Office",
      severity: "info",
      explanation: "This job is cancelled.",
      materialsReady,
    };
  }

  if (input.status === "completed") {
    if (input.hasOpenServiceCallback) {
      return {
        blocked: true,
        blockerCode: "open_service_callback",
        blockerLabel: "Service follow-up open",
        nextAction: "Resolve service callback",
        responsibleArea: "Office",
        severity: "attention",
        explanation: "Install is complete but a service/callback is still open.",
        materialsReady,
      };
    }
    return {
      blocked: false,
      blockerCode: "completed",
      blockerLabel: "Complete",
      nextAction: "No purchasing or scheduling action",
      responsibleArea: "Office",
      severity: "info",
      explanation: "Installation is marked complete.",
      materialsReady,
    };
  }

  if (input.activeHold) {
    return {
      blocked: true,
      blockerCode: "manual_hold",
      blockerLabel: "On hold",
      nextAction: `Resolve hold: ${input.activeHold.reason}`,
      responsibleArea: "Management",
      severity: "urgent",
      explanation: `Manual hold — ${input.activeHold.reason}`,
      materialsReady,
    };
  }

  if (input.hasOpenServiceCallback) {
    return {
      blocked: true,
      blockerCode: "open_service_callback",
      blockerLabel: "Service follow-up",
      nextAction: "Work the open service callback",
      responsibleArea: "Office",
      severity: "attention",
      explanation: "A service/callback record is open on this job.",
      materialsReady,
    };
  }

  const bal = round2(input.openBalance ?? 0);
  if (bal > 0.005 && input.status === "in_progress") {
    return {
      blocked: false,
      blockerCode: "payment_due",
      blockerLabel: "Payment due",
      nextAction: "Collect remaining balance",
      responsibleArea: "Office",
      severity: "attention",
      explanation: `Open balance about $${bal.toFixed(2)}.`,
      materialsReady,
    };
  }

  if (input.hasPurchasingGap) {
    return {
      blocked: true,
      blockerCode: "needs_purchasing",
      blockerLabel: "Needs purchasing",
      nextAction: "Cover outstanding material order qty",
      responsibleArea: "Purchasing",
      severity: "urgent",
      explanation: "Material need is not fully covered by valid PO/stock coverage.",
      materialsReady: false,
    };
  }

  if (input.hasMaterialNeed && !materialsReady) {
    return {
      blocked: true,
      blockerCode: "materials_not_ready",
      blockerLabel: "Materials not ready",
      nextAction: "Receive / stage materials; mark warehouse ready",
      responsibleArea: "Warehouse",
      severity: "attention",
      explanation: "Required materials are not marked warehouse-ready.",
      materialsReady: false,
    };
  }

  if (input.status === "in_progress") {
    return {
      blocked: false,
      blockerCode: "in_progress",
      blockerLabel: "Install in progress",
      nextAction: "Confirm completion when finished",
      responsibleArea: "Install",
      severity: "info",
      explanation: "Crew is installing.",
      materialsReady,
    };
  }

  if (
    input.status === "scheduled" ||
    (!!input.scheduledDate && input.status !== "unscheduled")
  ) {
    return {
      blocked: false,
      blockerCode: "scheduled",
      blockerLabel: "Install scheduled",
      nextAction: "Prepare for install day",
      responsibleArea: "Install",
      severity: "info",
      explanation: "Installation is on the schedule.",
      materialsReady,
    };
  }

  // Unscheduled
  if (materialsReady || !input.hasMaterialNeed) {
    return {
      blocked: false,
      blockerCode: "ready_to_schedule",
      blockerLabel: "Ready to schedule",
      nextAction: "Schedule installation",
      responsibleArea: "Scheduling",
      severity: "attention",
      explanation: "Materials are ready (or none required). Book the install.",
      materialsReady: true,
    };
  }

  if (input.awaitingCustomerApproval) {
    return {
      blocked: true,
      blockerCode: "awaiting_approval",
      blockerLabel: "Waiting on customer",
      nextAction: "Obtain approval",
      responsibleArea: "Sales",
      severity: "attention",
      explanation: "Customer approval is still needed.",
      materialsReady,
    };
  }

  if (bal > 0.005) {
    return {
      blocked: false,
      blockerCode: "payment_due",
      blockerLabel: "Payment due",
      nextAction: "Collect remaining balance",
      responsibleArea: "Office",
      severity: "attention",
      explanation: `Open balance about $${bal.toFixed(2)}.`,
      materialsReady,
    };
  }

  return {
    blocked: false,
    blockerCode: "ok",
    blockerLabel: "In progress",
    nextAction: "Continue workflow",
    responsibleArea: "Office",
    severity: "info",
    explanation: "No blocking issue detected from current signals.",
    materialsReady,
  };
}

/** Queue grouping for ops attention view. */
export function opsQueueGroup(
  state: JobOperationalState,
):
  | "urgent"
  | "blocked"
  | "needs_purchasing"
  | "waiting_on_material"
  | "ready_to_schedule"
  | "payment_office"
  | "waiting_on_customer"
  | "other" {
  if (state.severity === "urgent" || state.blockerCode === "manual_hold")
    return "urgent";
  if (state.blockerCode === "needs_purchasing") return "needs_purchasing";
  if (state.blockerCode === "materials_not_ready") return "waiting_on_material";
  if (state.blockerCode === "ready_to_schedule") return "ready_to_schedule";
  if (state.blockerCode === "payment_due") return "payment_office";
  if (state.blockerCode === "awaiting_approval") return "waiting_on_customer";
  if (state.blocked) return "blocked";
  return "other";
}
