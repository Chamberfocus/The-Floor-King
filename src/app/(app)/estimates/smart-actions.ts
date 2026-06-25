"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProductCategory } from "@/lib/types";
import { sendEstimateById } from "./actions";

/** Clear a saved flooring-type default. */
export async function deleteRoomDefault(category: string): Promise<void> {
  if (!category) return;
  const supabase = await createClient();
  await supabase.from("room_defaults").delete().eq("category", category);
}

/** Clear a saved add-on default. */
export async function deleteAddonDefault(label: string): Promise<void> {
  if (!label) return;
  const supabase = await createClient();
  await supabase.from("addon_defaults").delete().eq("label", label);
}

/** Save a flooring type's material/labor rates + waste as the default. */
export async function saveRoomDefault(input: {
  category: string;
  materialCost: number;
  materialSell: number;
  laborCost: number;
  laborSell: number;
  waste: number;
}): Promise<{ error: string | null }> {
  if (!input.category) return { error: "Pick a flooring type first." };
  const supabase = await createClient();
  const { error } = await supabase.from("room_defaults").upsert(
    {
      category: input.category,
      material_cost: input.materialCost || null,
      material_sell: input.materialSell || null,
      labor_cost: input.laborCost || null,
      labor_sell: input.laborSell || null,
      waste: input.waste || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "category" },
  );
  if (error) {
    return {
      error: error.message.includes("room_defaults")
        ? "Run migration 0046 first (the defaults table is missing)."
        : error.message,
    };
  }
  return { error: null };
}

/** Save an add-on's unit/cost/price as the default, so it pre-fills next time. */
export async function saveAddonDefault(input: {
  label: string;
  unit: string;
  cost: number;
  sell: number;
  labor: boolean;
}): Promise<{ error: string | null }> {
  const label = input.label?.trim();
  if (!label) return { error: "Name the item before saving a default." };
  const supabase = await createClient();
  const { error } = await supabase.from("addon_defaults").upsert(
    {
      label,
      unit: input.unit || null,
      cost: input.cost || null,
      sell: input.sell || null,
      labor: !!input.labor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "label" },
  );
  if (error) {
    return {
      error: error.message.includes("addon_defaults")
        ? "Run migration 0045 first (the defaults table is missing)."
        : error.message,
    };
  }
  return { error: null };
}

export interface SmartLine {
  room: string | null;
  description: string;
  category: string;
  measure_unit: "sqft" | "sqyd";
  sqft: number | null;
  quantity: number | null;
  length_in: number | null;
  width_in: number | null;
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
  jobDescription?: string;
  presentation?: "detailed" | "summary";
  print?: boolean;
  send?: boolean;
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
      presentation: input.presentation || "detailed",
      job_description: input.jobDescription?.trim() || null,
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
    length_in: l.length_in && l.length_in > 0 ? l.length_in : null,
    width_in: l.width_in && l.width_in > 0 ? l.width_in : null,
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

  // Save & send: email the customer, advance their stage, then land on the
  // dashboard. Otherwise open the editor (optionally straight to print).
  if (input.send) {
    await sendEstimateById(est.id as string);
    redirect("/dashboard");
  }
  // Open the EDITOR so every price shows in an editable field and you can adjust
  // anything before it goes out. ("Create & print" opens the print dialog.)
  redirect(`/estimates/${est.id}/edit${input.print ? "?print=1" : ""}`);
}
