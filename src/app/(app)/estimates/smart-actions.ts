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
  from_stock?: boolean; // pulled from stock → kept off the PO
}

export interface SmartEstimateInput {
  customerId: string;
  title: string;
  taxRate: number;
  lines: SmartLine[];
  jobDescription?: string;
  presentation?: "detailed" | "summary";
  serviceAddressId?: string | null;
  discountKind?: "amount" | "percent";
  discountValue?: number;
  print?: boolean;
  send?: boolean;
  stash?: boolean; // "save for later" — keep as draft and land on the hub
  openEdit?: boolean; // land on the edit builder to review (questionnaire/AI paths)
  targetMargin?: number; // the gross-margin % the lines were priced at
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

  // Match the other estimate-creation paths: require a lead source first, and
  // stamp a quote expiry from org settings (default 30 days).
  const { data: cust } = await supabase
    .from("customers")
    .select("source")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust?.source) {
    return { error: "Set a lead source on the customer before creating an estimate." };
  }
  const { data: org } = await supabase
    .from("org_settings")
    .select("quote_valid_days")
    .eq("id", "default")
    .maybeSingle();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (Number(org?.quote_valid_days) || 30));

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
      valid_until: validUntil.toISOString().slice(0, 10),
      service_address_id: input.serviceAddressId || null,
      discount_kind: input.discountKind === "percent" ? "percent" : "amount",
      discount_value: Number(input.discountValue) || 0,
      target_margin: input.targetMargin != null ? Number(input.targetMargin) : null,
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
    from_stock: !!l.from_stock,
  }));
  const { error: lineErr } = await supabase
    .from("estimate_line_items")
    .insert(rows);
  if (lineErr) return { error: lineErr.message };

  // The estimate is finalized — clear any saved in-progress draft for this
  // customer so it doesn't resurface. Ignore if the table isn't there yet.
  await supabase.from("estimate_drafts").delete().eq("customer_id", customerId);

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/estimates");

  // Save for later: it's already a draft — just go to the hub to resume anytime.
  if (input.stash) redirect("/saved");

  // Questionnaire / AI paths: open the edit builder to review & adjust the
  // itemized draft before finalizing (never auto-sends).
  if (input.openEdit) redirect(`/estimates/${est.id}/edit`);

  // Save & send: email the customer, advance their stage, then land on the
  // dashboard. Otherwise land on the finished quote.
  if (input.send) {
    await sendEstimateById(est.id as string);
    redirect("/dashboard");
  }
  // Land on the finished, printable quote — totals, Print, Send, and an Edit
  // button if anything needs adjusting. ("Print" opens the print dialog.)
  redirect(`/estimates/${est.id}${input.print ? "?print=1" : ""}`);
}

// --- Save & resume: one in-progress draft per customer ----------------------

export interface EstimateDraft {
  serviceAddressId: string | null;
  answers: Record<string, unknown>;
  overrides: Record<string, unknown>;
  step: number;
}

/** Load a customer's in-progress questionnaire draft (null if none / not set up). */
export async function getEstimateDraft(
  customerId: string,
): Promise<EstimateDraft | null> {
  if (!customerId) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("estimate_drafts")
      .select("service_address_id, answers, overrides, step")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!data) return null;
    return {
      serviceAddressId: (data.service_address_id as string) ?? null,
      answers: (data.answers as Record<string, unknown>) ?? {},
      overrides: (data.overrides as Record<string, unknown>) ?? {},
      step: (data.step as number) ?? 0,
    };
  } catch {
    return null;
  }
}

/** Auto-save the questionnaire so it can be resumed from any device. Best-effort
 *  (no-op if the drafts table isn't there yet). */
export async function saveEstimateDraft(
  customerId: string,
  payload: EstimateDraft,
): Promise<void> {
  if (!customerId) return;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("estimate_drafts").upsert(
      {
        customer_id: customerId,
        service_address_id: payload.serviceAddressId || null,
        answers: payload.answers,
        overrides: payload.overrides,
        step: payload.step,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "customer_id" },
    );
  } catch {
    // best-effort
  }
}

/** Discard a customer's saved draft (e.g. "start over"). */
export async function deleteEstimateDraft(customerId: string): Promise<void> {
  if (!customerId) return;
  try {
    const supabase = await createClient();
    await supabase.from("estimate_drafts").delete().eq("customer_id", customerId);
  } catch {
    // best-effort
  }
}
