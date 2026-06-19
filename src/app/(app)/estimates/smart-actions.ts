"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProductCategory } from "@/lib/types";

export interface SmartLine {
  room: string | null;
  description: string;
  category: string;
  measure_unit: "sqft" | "sqyd";
  sqft: number | null;
  quantity: number | null;
  unit: string;
  material_rate: number;
  labor_rate: number;
  material_cost: number;
  labor_cost: number;
  waste_pct: number;
  product_id: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
}

export interface SmartEstimateInput {
  customerId: string;
  title: string;
  taxRate: number;
  lines: SmartLine[];
}

export interface SmartResult {
  error: string | null;
}

/** Create an estimate from the smart builder's computed line items. */
export async function createSmartEstimate(
  input: SmartEstimateInput,
): Promise<SmartResult> {
  const { customerId, title, taxRate } = input;
  const lines = (input.lines ?? []).filter((l) => l.description?.trim());
  if (!customerId) return { error: "Missing customer." };
  if (!lines.length) return { error: "Add at least one room/material." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      title: title?.trim() || "Flooring estimate",
      status: "draft",
      tax_rate: Number(taxRate) || 0,
      presentation: "detailed",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (estErr || !est) return { error: estErr?.message || "Couldn't create the estimate." };

  const { data: opt, error: optErr } = await supabase
    .from("estimate_options")
    .insert({ estimate_id: est.id, name: "Option A", position: 0 })
    .select("id")
    .single();
  if (optErr || !opt) return { error: optErr?.message || "Couldn't create the option." };

  const rows = lines.map((l, i) => ({
    option_id: opt.id,
    position: i,
    room: l.room || null,
    description: l.description,
    line_type: "mat_labor",
    category: (l.category || "other") as ProductCategory,
    measure_unit: l.measure_unit,
    sqft: l.sqft && l.sqft > 0 ? l.sqft : null,
    quantity: l.quantity && l.quantity > 0 ? l.quantity : null,
    unit: l.unit || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft"),
    material_rate: Number(l.material_rate) || 0,
    labor_rate: Number(l.labor_rate) || 0,
    material_cost: Number(l.material_cost) || 0,
    labor_cost: Number(l.labor_cost) || 0,
    waste_pct: Number(l.waste_pct) || 0,
    product_id: l.product_id || null,
    manufacturer: l.manufacturer || null,
    style: l.style || null,
    color: l.color || null,
  }));
  const { error: lineErr } = await supabase
    .from("estimate_line_items")
    .insert(rows);
  if (lineErr) return { error: lineErr.message };

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/estimates");
  redirect(`/estimates/${est.id}/edit`);
}
