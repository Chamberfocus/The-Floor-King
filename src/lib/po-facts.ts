/**
 * Factual purchasing presentation.
 *
 * Material need stays on job lines (materialNeedQty). These helpers only
 * label purchase orders and same-unit coverage that job_line_id already
 * links. They do not schedule, post accounting, or tell an employee what
 * to do next.
 */
import { normalizeUnit, unitLabel } from "@/lib/units";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function employeePoError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "This purchase order could not be saved. Try again.";
  if (/^PO_SUPPLIER_REQUIRED\b/i.test(msg)) {
    return "Pick a vendor before marking this purchase order ordered.";
  }
  if (
    /sqlstate|postgres|pgrst|violates|duplicate key|constraint|syntax error/i.test(
      msg,
    )
  ) {
    return "This purchase order could not be saved. Try again.";
  }
  if (msg.length > 240) return "This purchase order could not be saved. Try again.";
  return msg;
}

export function employeeReceiptError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "This receipt could not be recorded. Try again.";
  if (/^PO_SUPPLIER_REQUIRED\b/i.test(msg)) {
    return "Pick a vendor before receiving this purchase order.";
  }
  if (
    /sqlstate|postgres|pgrst|violates|duplicate key|constraint|syntax error/i.test(
      msg,
    )
  ) {
    return "This receipt could not be recorded. Try again.";
  }
  if (msg.length > 240) return "This receipt could not be recorded. Try again.";
  return msg;
}

export interface PoReceiptLine {
  quantity?: number | null;
  received_qty?: number | null;
  received_at?: string | null;
  unit?: string | null;
}

export type PoReceiptKind = "none" | "partial" | "received";

/**
 * Per-line receipt. Quantities on different lines are never added together.
 */
export function poReceiptKind(items: PoReceiptLine[]): PoReceiptKind {
  const lines = items.filter((i) => (Number(i.quantity) || 0) > 0.00005);
  if (!lines.length) return "none";
  let anyReceived = false;
  let allFull = true;
  for (const line of lines) {
    const ordered = Number(line.quantity) || 0;
    const checked = line.received_at != null || line.received_qty != null;
    const received = Number(line.received_qty) || 0;
    if (checked && received > 0.00005) anyReceived = true;
    if (!checked || received + 0.00005 < ordered) allFull = false;
  }
  if (allFull && anyReceived) return "received";
  if (anyReceived || lines.some((l) => l.received_at != null)) return "partial";
  return "none";
}

export function poAttentionFact(input: {
  status?: string | null;
  backordered?: boolean | null;
  items?: PoReceiptLine[];
}): string {
  const status = input.status ?? "";
  if (status === "void" || status === "cancelled") return "Void";
  if (input.backordered) return "Backordered";
  const receipt = poReceiptKind(input.items ?? []);
  if (status === "received" || status === "closed") return "Received";
  if (receipt === "partial") return "Partially received";
  if (status === "ordered") return "Ordered";
  if (status === "draft") return "Not ordered";
  return status || "Purchase order";
}

/** Active draft/ordered POs with no date. Received orders keep a blank ETA quiet. */
export function poEtaMissing(input: {
  status?: string | null;
  eta_date?: string | null;
}): boolean {
  const status = input.status ?? "";
  if (status === "void" || status === "cancelled") return false;
  if (status === "received" || status === "closed") return false;
  return !input.eta_date;
}

export function poItemScan(item: {
  description?: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  item_no?: string | null;
  quantity?: number | null;
  unit?: string | null;
  roll_width_ft?: number | null;
}): string {
  const name =
    [item.manufacturer, item.style, item.color, item.description]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .filter((p, i, arr) => arr.indexOf(p) === i)
      .slice(0, 3)
      .join(" · ") || "Material";
  const qty = Number(item.quantity);
  const unit = unitLabel(item.unit) || (item.unit ?? "").trim();
  const qtyBit =
    Number.isFinite(qty) && qty > 0 ? `${qty}${unit ? ` ${unit}` : ""}` : "";
  const sku = (item.item_no ?? "").trim();
  const roll =
    item.roll_width_ft != null && Number(item.roll_width_ft) > 0
      ? `${item.roll_width_ft} ft roll width`
      : "";
  return [name, qtyBit, sku ? `item ${sku}` : "", roll].filter(Boolean).join(" · ");
}

export type CoverageKind =
  | "no_need"
  | "not_ordered"
  | "draft_only"
  | "partial"
  | "full"
  | "unit_mismatch";

export interface CoverageItem {
  quantity: number;
  unit?: string | null;
  status: string;
}

const ISSUED = new Set(["ordered", "received", "closed"]);

/**
 * Same-unit coverage for one job line. A purchase order does not create need.
 * Draft quantity is not treated as ordered. Differing units are not added.
 */
export function procurementCoverage(args: {
  need: number;
  needUnit: string;
  items: CoverageItem[];
}): { kind: CoverageKind; orderedQty: number; draftQty: number } {
  const need = round2(Math.max(0, args.need));
  if (need <= 0) return { kind: "no_need", orderedQty: 0, draftQty: 0 };
  const needUnit = normalizeUnit(args.needUnit);
  let orderedQty = 0;
  let draftQty = 0;
  for (const item of args.items) {
    const status = item.status;
    if (status === "void" || status === "cancelled") continue;
    const qty = round2(Math.max(0, Number(item.quantity) || 0));
    if (qty <= 0) continue;
    const itemUnit = normalizeUnit(item.unit);
    if (itemUnit !== needUnit) {
      return { kind: "unit_mismatch", orderedQty: 0, draftQty: 0 };
    }
    if (status === "draft") draftQty = round2(draftQty + qty);
    else if (ISSUED.has(status)) orderedQty = round2(orderedQty + qty);
  }
  if (orderedQty >= need - 0.001) return { kind: "full", orderedQty, draftQty };
  if (orderedQty > 0.001) return { kind: "partial", orderedQty, draftQty };
  if (draftQty > 0.001) return { kind: "draft_only", orderedQty, draftQty };
  return { kind: "not_ordered", orderedQty, draftQty };
}

export function coverageSentence(args: {
  need: number;
  unit: string;
  kind: CoverageKind;
  orderedQty: number;
  draftQty: number;
}): string | null {
  const unit = unitLabel(args.unit) || args.unit || "units";
  const need = round2(args.need);
  if (args.kind === "no_need") return null;
  if (args.kind === "unit_mismatch") {
    return `Required ${need} ${unit}. A linked purchase order uses a different unit, so quantities are not compared.`;
  }
  if (args.kind === "full") {
    return `Fully ordered: ${args.orderedQty} ${unit} on purchase orders. Another order would be supplemental.`;
  }
  if (args.kind === "partial") {
    const short = round2(Math.max(0, need - args.orderedQty));
    return `Partially ordered: ${args.orderedQty} ${unit} ordered, ${short} ${unit} not ordered.`;
  }
  if (args.kind === "draft_only") {
    return `Not ordered. A draft purchase order lists ${args.draftQty} ${unit}. Required: ${need} ${unit}.`;
  }
  return `Not ordered. Required: ${need} ${unit}.`;
}

/** Stock replenishment is not a customer job. */
export function poOwnershipFact(isStock: boolean | null | undefined): "stock" | "job" {
  return isStock ? "stock" : "job";
}
