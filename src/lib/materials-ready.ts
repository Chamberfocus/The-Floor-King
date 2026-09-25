/**
 * F0 materials-ready for install scheduling — canonical helper.
 *
 * Rule: a job that has purchase/stock material need is ready when warehouse
 * has marked it ready (`warehouse_ready_at`). Jobs with no material lines do
 * not require the gate.
 *
 * Does not invent a second status model. Waste/order need stays on operational
 * job lines elsewhere; this gate is the warehouse-ready signal staff already use.
 */
export interface MaterialsReadyInput {
  warehouseReadyAt: string | null | undefined;
  /** True when the job has at least one material (non-labor) operational line. */
  hasMaterialNeed: boolean;
}

export type MaterialsReadyResult =
  | { ready: true; reason: "no_material_need" | "warehouse_ready" }
  | { ready: false; reason: "materials_not_ready" };

export const MATERIALS_NOT_READY_MESSAGE =
  "This job cannot be scheduled yet because required material has not been received. Materials are not marked warehouse-ready. Schedule only with an override reason, or wait until the warehouse marks this job ready.";

export const MATERIALS_OVERRIDE_REASON_REQUIRED =
  "An override reason is required to schedule before materials are ready.";

export function isMaterialsNotReadyError(msg: string | null | undefined): boolean {
  return (msg ?? "").includes("Materials are not marked warehouse-ready");
}

export const JOBS_BOARD_SCHEDULE_LABEL = "Schedule the install";
export const JOBS_BOARD_MATERIALS_LABEL = "Materials not ready";

/**
 * Jobs-board cue for an unscheduled, still-open job.
 * Delegates the gate to assessMaterialsReadyForSchedule.
 * Money collected and buying gaps are not inputs.
 */
export function jobsBoardUnscheduledLabel(
  input: MaterialsReadyInput,
): string {
  const ready = assessMaterialsReadyForSchedule(input);
  return ready.ready ? JOBS_BOARD_SCHEDULE_LABEL : JOBS_BOARD_MATERIALS_LABEL;
}

export function assessMaterialsReadyForSchedule(
  input: MaterialsReadyInput,
): MaterialsReadyResult {
  if (!input.hasMaterialNeed) {
    return { ready: true, reason: "no_material_need" };
  }
  if (input.warehouseReadyAt) {
    return { ready: true, reason: "warehouse_ready" };
  }
  return { ready: false, reason: "materials_not_ready" };
}

export function assessScheduleMaterialsGate(args: {
  warehouseReadyAt: string | null | undefined;
  hasMaterialNeed: boolean;
  overrideReason?: string | null;
}):
  | { ok: true; override: boolean }
  | { ok: false; error: string } {
  const ready = assessMaterialsReadyForSchedule({
    warehouseReadyAt: args.warehouseReadyAt,
    hasMaterialNeed: args.hasMaterialNeed,
  });
  if (ready.ready) return { ok: true, override: false };
  const reason = (args.overrideReason ?? "").trim();
  if (!reason) {
    return { ok: false, error: MATERIALS_OVERRIDE_REASON_REQUIRED };
  }
  return { ok: true, override: true };
}

export const MATERIALS_ARRIVAL_INCOMPLETE =
  "Required material has not been received yet. Receive the PO first, or enter an override reason if this job is staged from existing stock.";

/**
 * Warehouse "mark staged & ready" must not claim materials ready when required
 * material has not physically arrived, unless staff records an override.
 */
export function assessWarehouseMarkReady(args: {
  hasMaterialNeed: boolean;
  outstandingArrival: number;
  overrideReason?: string | null;
}):
  | { ok: true; override: boolean }
  | { ok: false; error: string } {
  if (!args.hasMaterialNeed) return { ok: true, override: false };
  const outstanding = Number(args.outstandingArrival) || 0;
  if (!(outstanding > 0.005)) return { ok: true, override: false };
  const reason = (args.overrideReason ?? "").trim();
  if (!reason) {
    return { ok: false, error: MATERIALS_ARRIVAL_INCOMPLETE };
  }
  return { ok: true, override: true };
}
