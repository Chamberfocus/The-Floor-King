"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractPriceList, type PriceRow } from "@/lib/extract";
import { PRODUCT_CATEGORY_ORDER, type ProductCategory } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export interface ParseResult {
  error: string | null;
  rows?: PriceRow[];
}

export async function parsePriceList(formData: FormData): Promise<ParseResult> {
  const text = str(formData.get("text"));
  const file = formData.get("file");

  let rows: PriceRow[] | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > 20 * 1024 * 1024) return { error: "File too large (max 20 MB)." };
    const bytes = Buffer.from(await file.arrayBuffer());
    rows = await extractPriceList({
      base64: bytes.toString("base64"),
      mediaType: file.type || "application/octet-stream",
    });
  } else if (text) {
    rows = await extractPriceList({ text });
  } else {
    return { error: "Paste a price list or choose a file." };
  }

  if (!rows) {
    return {
      error:
        "Couldn't read that automatically. Make sure ANTHROPIC_API_KEY is set, or paste the rows as plain text.",
    };
  }
  if (!rows.length) return { error: "No products found in that price list." };
  return { error: null, rows };
}

export interface ImportResult {
  error: string | null;
  count?: number;
}

export async function importProducts(rows: PriceRow[]): Promise<ImportResult> {
  const valid = (rows ?? []).filter((r) => r.name?.trim());
  if (!valid.length) return { error: "Nothing to import." };

  const cats = new Set<string>(PRODUCT_CATEGORY_ORDER);
  const insertRows = valid.map((r) => ({
    name: r.name.trim(),
    category: (cats.has(r.category) ? r.category : "other") as ProductCategory,
    unit: r.unit || "sqft",
    material_rate: Number(r.material_rate) || 0,
    labor_rate: Number(r.labor_rate) || 0,
    sku: r.sku || null,
    notes: r.notes || null,
  }));

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert(insertRows);
  if (error) return { error: error.message };

  revalidatePath("/catalog");
  return { error: null, count: insertRows.length };
}
