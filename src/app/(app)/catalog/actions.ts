"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProductCategory } from "@/lib/types";

export interface ProductFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function money(v: FormDataEntryValue | null): number {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : 0;
}

function readFields(formData: FormData) {
  return {
    name: str(formData.get("name")),
    category: (str(formData.get("category")) || "other") as ProductCategory,
    unit: str(formData.get("unit")) || "sqft",
    material_rate: money(formData.get("material_rate")),
    labor_rate: money(formData.get("labor_rate")),
    sku: str(formData.get("sku")) || null,
    notes: str(formData.get("notes")) || null,
  };
}

export async function createProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const fields = readFields(formData);
  if (!fields.name) return { error: "A product name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert(fields);
  if (error) return { error: error.message };

  revalidatePath("/catalog");
  redirect("/catalog");
}

export async function updateProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing product id." };
  const fields = readFields(formData);
  if (!fields.name) return { error: "A product name is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ ...fields, active: str(formData.get("active")) === "on" })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/catalog");
  return { error: null, ok: true };
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", id);
  revalidatePath("/catalog");
  redirect("/catalog");
}
