/**
 * Helpers to present an approval snapshot on the customer portal / staff views.
 */
import { buildCustomerScope, customerLineLabel, parseProjectDetails } from "@/lib/customer-scope";
import type { ApprovalSnapshotPayload } from "@/lib/estimate-approval";
import type { EstimateLineItem } from "@/lib/types";

export function snapshotLinesAsEstimateLines(
  payload: ApprovalSnapshotPayload,
): EstimateLineItem[] {
  return payload.option.lines.map((l) => ({
    id: l.id,
    option_id: payload.option.id,
    position: l.position,
    room: l.room,
    description: l.description,
    note: l.note,
    line_type: l.line_type as EstimateLineItem["line_type"],
    sqft: l.sqft,
    length_in: l.length_in,
    width_in: l.width_in,
    measure_unit: (l.measure_unit as EstimateLineItem["measure_unit"]) ?? "sqft",
    material_rate: l.material_rate,
    labor_rate: l.labor_rate,
    installed_rate: l.installed_rate,
    flat_amount: l.flat_amount,
    waste_pct: l.waste_pct,
    product_id: l.product_id,
    manufacturer: l.manufacturer,
    style: l.style,
    color: l.color,
    item_no: l.item_no,
    material_cost: null,
    labor_cost: null,
    quantity: l.quantity,
    unit: l.unit,
    category: l.category as EstimateLineItem["category"],
    measurements: (l.measurements as EstimateLineItem["measurements"]) ?? null,
  }));
}

export function snapshotItemGroups(payload: ApprovalSnapshotPayload) {
  const itemized = payload.presentation !== "summary";
  const lines = snapshotLinesAsEstimateLines(payload);
  const itemGroups: {
    room: string;
    items: { label: string; note: string; amount: number }[];
  }[] = [];
  if (itemized) {
    const at = new Map<string, number>();
    for (const l of lines) {
      const amount = payload.option.lines.find((x) => x.id === l.id)?.line_total ?? 0;
      if (!(amount > 0)) continue;
      const room = (l.room ?? "").trim() || "Project";
      if (!at.has(room)) {
        at.set(room, itemGroups.length);
        itemGroups.push({ room, items: [] });
      }
      itemGroups[at.get(room)!].items.push({
        label: customerLineLabel(l),
        note: (l.note ?? "").trim(),
        amount,
      });
    }
  }
  const scope = buildCustomerScope(lines, payload.notes);
  const projectDetails =
    payload.show_project_details === false
      ? []
      : parseProjectDetails(payload.job_description).details;
  return {
    itemized,
    itemGroups,
    scope,
    projectDetails,
    totals: {
      subtotal: payload.subtotal,
      discount: payload.discount_amount,
      tax: payload.tax_amount,
      total: payload.total,
    },
    optionName: payload.option.name,
  };
}
