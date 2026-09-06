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
  "Materials are not marked warehouse-ready. Schedule only with an override reason, or wait until the warehouse marks this job ready.";

export const MATERIALS_OVERRIDE_REASON_REQUIRED =
  "An override reason is required to schedule before materials are ready.";

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
