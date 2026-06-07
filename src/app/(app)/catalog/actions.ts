"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Product, ProductCategory } from "@/lib/types";

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
    manufacturer: str(formData.get("manufacturer")) || null,
    style: str(formData.get("style")) || null,
    color: str(formData.get("color")) || null,
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

/**
 * Create a product and return it — used by the estimate wizard's "add new
 * product" so a material entered on a line is saved to the catalog and linked.
 */
export async function createProductInline(input: {
  name: string;
  category?: string;
  unit?: string;
  material_rate?: number | string;
  labor_rate?: number | string;
  sku?: string;
  manufacturer?: string;
  style?: string;
  color?: string;
}): Promise<{ error: string | null; product?: Product }> {
  const name = input.name?.trim();
  if (!name) return { error: "A product name is required." };

  const numOr0 = (v: number | string | undefined) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : 0;
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      name,
      category: (input.category || "other") as ProductCategory,
      unit: input.unit?.trim() || "sqft",
      material_rate: numOr0(input.material_rate),
      labor_rate: numOr0(input.labor_rate),
      sku: input.sku?.trim() || null,
      manufacturer: input.manufacturer?.trim() || null,
      style: input.style?.trim() || null,
      color: input.color?.trim() || null,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/catalog");
  return { error: null, product: data as Product };
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
