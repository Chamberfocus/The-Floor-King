import type { PoSourceType, PoStatus } from "@/lib/types";

export interface CalcPoItem {
  quantity?: number | string | null;
  unit_cost?: number | string | null;
}

function n(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
}

export function poItemTotal(item: CalcPoItem): number {
  return n(item.quantity) * n(item.unit_cost);
}

export function poTotal(items: CalcPoItem[]): number {
  return items.reduce((sum, i) => sum + poItemTotal(i), 0);
}

export interface SavePoItemInput {
  product_id: string | null;
  description: string;
  quantity: string | number | null;
  unit: string;
  unit_cost: string | number | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  item_no?: string | null;
  // When this line is for a DIFFERENT job/client than the PO header (a shared
  // order), attribute it so the material can always be tracked back.
  for_job_id?: string | null;
  for_customer_id?: string | null;
  note?: string | null;
  category?: string | null;
  sqft_per_box?: string | number | null;
  roll_width_ft?: string | number | null;
}

export interface SavePoInput {
  supplier: string;
  supplier_id: string | null;
  source_type: PoSourceType | null;
  status: PoStatus;
  notes: string;
  eta_date: string | null;
  backordered: boolean;
  items: SavePoItemInput[];
}
