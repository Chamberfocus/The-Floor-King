"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { StockMovementKind } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function numv(v: FormDataEntryValue | null): number {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : 0;
}

function refresh(productId?: string) {
  revalidatePath("/inventory");
  if (productId) revalidatePath(`/inventory/${productId}`);
  revalidatePath("/catalog");
}

/** Record a stock movement and adjust the product's on-hand. */
async function move(
  productId: string,
  delta: number,
  kind: StockMovementKind,
  opts: { note?: string; jobId?: string | null } = {},
): Promise<void> {
  if (!productId || !delta) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: prod } = await supabase
    .from("products")
    .select("on_hand")
    .eq("id", productId)
    .maybeSingle();
  if (!prod) return;

  await supabase.from("stock_movements").insert({
    product_id: productId,
    qty: delta,
    kind,
    job_id: opts.jobId ?? null,
    note: opts.note ?? null,
    created_by: user?.id ?? null,
  });

  const next = Math.round(((prod.on_hand as number) + delta) * 100) / 100;
  await supabase.from("products").update({ on_hand: next }).eq("id", productId);
  refresh(productId);
}

export async function receiveStock(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  const qty = Math.abs(numv(formData.get("qty")));
  if (!id || !qty) return;
  await move(id, qty, "receive", { note: str(formData.get("note")) || undefined });
}

export async function pullStock(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  const qty = Math.abs(numv(formData.get("qty")));
  if (!id || !qty) return;
  await move(id, -qty, "pull", {
    note: str(formData.get("note")) || undefined,
    jobId: str(formData.get("job_id")) || null,
  });
}

/** Set on-hand to an exact counted value (records the difference as an adjust). */
export async function adjustStock(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  const counted = numv(formData.get("counted"));
  if (!id) return;
  const supabase = await createClient();
  const { data: prod } = await supabase
    .from("products")
    .select("on_hand")
    .eq("id", id)
    .maybeSingle();
  if (!prod) return;
  const delta = Math.round((counted - (prod.on_hand as number)) * 100) / 100;
  if (delta === 0) return;
  await move(id, delta, "adjust", {
    note: str(formData.get("note")) || `Counted ${counted}`,
  });
}

/** Turn tracking on/off and set reorder point + bin. */
export async function setStockSettings(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("products")
    .update({
      track_stock: str(formData.get("track_stock")) === "on",
      reorder_point: numv(formData.get("reorder_point")),
      bin_location: str(formData.get("bin_location")) || null,
    })
    .eq("id", id);
  refresh(id);
}

/** Start tracking a catalog product (from the "add to inventory" picker). */
export async function startTracking(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("products")
    .update({
      track_stock: true,
      on_hand: numv(formData.get("on_hand")),
      reorder_point: numv(formData.get("reorder_point")),
      bin_location: str(formData.get("bin_location")) || null,
    })
    .eq("id", id);
  if (numv(formData.get("on_hand")) > 0) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("stock_movements").insert({
      product_id: id,
      qty: numv(formData.get("on_hand")),
      kind: "receive",
      note: "Opening count",
      created_by: user?.id ?? null,
    });
  }
  refresh(id);
}
