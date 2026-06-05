"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SavePoInput } from "@/lib/po-calc";
import { lineQty } from "@/lib/estimate-calc";
import type { EstimateLineItem, PoStatus } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function toNumOrNull(v: string | number | null): number | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Generate a PO from an estimate's accepted (or first) option material lines. */
export async function createPOFromEstimate(formData: FormData): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  if (!estimateId) return;

  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("id, customer_id, accepted_option_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est) return;

  let optionId = (est.accepted_option_id as string | null) ?? null;
  if (!optionId) {
    const { data: opt } = await supabase
      .from("estimate_options")
      .select("id")
      .eq("estimate_id", estimateId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    optionId = (opt?.id as string) ?? null;
  }

  let lines: EstimateLineItem[] = [];
  if (optionId) {
    const { data } = await supabase
      .from("estimate_line_items")
      .select("*")
      .eq("option_id", optionId)
      .order("position", { ascending: true });
    lines = (data ?? []) as EstimateLineItem[];
  }

  // Product material rates for installed lines linked to a product.
  const productIds = [
    ...new Set(lines.map((l) => l.product_id).filter(Boolean) as string[]),
  ];
  const productCost = new Map<string, number>();
  const productName = new Map<string, string>();
  if (productIds.length) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, material_rate")
      .in("id", productIds);
    for (const p of prods ?? []) {
      productCost.set(p.id as string, Number(p.material_rate) || 0);
      productName.set(p.id as string, p.name as string);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      customer_id: est.customer_id,
      estimate_id: estimateId,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !po) return;

  const items = lines
    .filter((l) => l.line_type !== "flat" && (l.sqft ?? 0) > 0)
    .map((l, i) => {
      const unitCost =
        l.line_type === "mat_labor"
          ? (l.material_rate ?? 0)
          : l.product_id
            ? (productCost.get(l.product_id) ?? 0)
            : 0;
      const desc =
        l.description ||
        (l.product_id ? productName.get(l.product_id) : null) ||
        l.room ||
        "Material";
      return {
        po_id: po.id,
        position: i,
        product_id: l.product_id,
        description: desc,
        quantity: Math.round(lineQty(l) * 100) / 100,
        unit: l.measure_unit === "sqyd" ? "sqyd" : "sqft",
        unit_cost: unitCost,
      };
    });
  if (items.length) await supabase.from("po_items").insert(items);

  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${po.id}`);
}

export async function savePurchaseOrder(
  poId: string,
  input: SavePoInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      supplier: input.supplier || null,
      status: input.status,
      notes: input.notes || null,
    })
    .eq("id", poId);
  if (updateError) return { error: updateError.message };

  const { error: deleteError } = await supabase
    .from("po_items")
    .delete()
    .eq("po_id", poId);
  if (deleteError) return { error: deleteError.message };

  if (input.items.length) {
    const rows = input.items.map((it, i) => ({
      po_id: poId,
      position: i,
      product_id: it.product_id || null,
      description: it.description || "",
      quantity: toNumOrNull(it.quantity),
      unit: it.unit || "sqft",
      unit_cost: toNumOrNull(it.unit_cost),
    }));
    const { error: insertError } = await supabase.from("po_items").insert(rows);
    if (insertError) return { error: insertError.message };
  }

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  return { error: null };
}

export async function setPurchaseOrderStatus(
  formData: FormData,
): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as PoStatus;
  if (!id || !status) return;
  const supabase = await createClient();
  await supabase.from("purchase_orders").update({ status }).eq("id", id);
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
}

export async function deletePurchaseOrder(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("purchase_orders").delete().eq("id", id);
  revalidatePath("/purchase-orders");
  redirect("/purchase-orders");
}
