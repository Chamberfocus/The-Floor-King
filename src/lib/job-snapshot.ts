/**
 * Flooring job snapshot — factual chips only.
 *
 * Built from the same signals the schedule gate and the job record already
 * use. It does not choose a next step, and it does not write status.
 * A purchase order does not create a material need by itself.
 */
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";

export interface JobSnapshotInput {
  status: string;
  scheduledDate?: string | null;
  /** Shop calendar day, YYYY-MM-DD. */
  todayYmd: string;
  hasMaterialNeed: boolean;
  warehouseReadyAt?: string | null;
  purchaseOrders?: { status?: string | null }[];
  hasOpenServiceCallback?: boolean;
  /** Null hides money chips. Zero does not mean paid. */
  openBalance?: number | null;
  onHold?: boolean;
}

export interface JobSnapshot {
  chips: string[];
  /** One factual sentence. Not an instruction. */
  fact: string;
}

const RECEIVED = new Set(["received", "closed"]);
const ORDERED = new Set(["ordered", "draft"]);

function push(chips: string[], label: string) {
  if (!chips.includes(label)) chips.push(label);
}

export function flooringJobSnapshot(input: JobSnapshotInput): JobSnapshot {
  if (input.status === "cancelled") {
    return { chips: ["Cancelled"], fact: "This job is cancelled." };
  }

  const materials = assessMaterialsReadyForSchedule({
    warehouseReadyAt: input.warehouseReadyAt,
    hasMaterialNeed: input.hasMaterialNeed,
  });
  const chips: string[] = [];
  if (input.onHold) push(chips, "On hold");

  const orders = (input.purchaseOrders ?? []).filter(
    (row) => row.status !== "void" && row.status !== "cancelled",
  );
  if (input.hasMaterialNeed) {
    if (materials.ready) {
      push(chips, "Material received");
    } else if (orders.some((row) => row.status && RECEIVED.has(row.status))) {
      push(chips, "Material received");
    } else if (orders.some((row) => row.status && ORDERED.has(row.status))) {
      push(chips, "Material ordered");
    } else {
      push(chips, "Waiting for material");
    }
  }

  const day = input.scheduledDate ? input.scheduledDate.slice(0, 10) : "";
  if (input.status === "completed") {
    push(chips, "Install complete");
  } else if (input.status === "in_progress" || (day && day === input.todayYmd)) {
    push(chips, "Installing today");
  } else if (input.status === "scheduled" || !!day) {
    push(chips, "Install booked");
  } else if (materials.ready) {
    push(chips, "Ready to schedule");
  }

  if (input.hasOpenServiceCallback) push(chips, "Service needed");

  const balance = input.openBalance;
  if (balance != null && balance > 0.005) push(chips, "Balance due");

  return { chips, fact: snapshotFact(input, materials.ready) };
}

function snapshotFact(input: JobSnapshotInput, materialsReady: boolean): string {
  if (input.onHold) return "This job is on hold.";
  if (input.status === "completed" && input.hasOpenServiceCallback) {
    return "The install is complete. A service visit is still open.";
  }
  if (input.status === "completed") return "The install is complete.";
  if (input.status === "in_progress") return "The crew is on this install today.";
  const day = input.scheduledDate ? input.scheduledDate.slice(0, 10) : "";
  if (day && day === input.todayYmd) return "This install is on today's schedule.";
  if (input.status === "scheduled" || !!day) return "The install is booked.";
  if (input.hasMaterialNeed && !materialsReady) return "Material isn't ready yet.";
  if (materialsReady) return "The install is not booked yet.";
  return "This job is open.";
}

/** Cleveland shop day. Snapshot callers pass this in so tests stay explicit. */
export function shopTodayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
