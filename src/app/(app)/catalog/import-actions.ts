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

/** Plain-text fallback parser (no AI): one product per line. */
function parseTextRows(text: string): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let name = line;
    let sku: string | null = null;
    let rate: number | null = null;

    const parts = line.includes("\t")
      ? line.split("\t")
      : line.includes(",")
        ? line.split(",")
        : null;
    if (parts && parts.length > 1) {
      const cells = parts.map((p) => p.trim());
      name = cells[0] || line;
      for (let k = cells.length - 1; k >= 1; k--) {
        const n = parseFloat(cells[k].replace(/[^0-9.]/g, ""));
        if (Number.isFinite(n) && /\d/.test(cells[k])) {
          rate = n;
          break;
        }
      }
      const skuCell = cells
        .slice(1)
        .find((c) => /[a-z]/i.test(c) && /\d/.test(c) && c.length <= 20);
      if (skuCell) sku = skuCell;
    } else {
      const m = line.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\b/);
      if (m) rate = parseFloat(m[1]);
      const skuM = line.match(/\b(?:sku|item|style)\s*#?\s*([a-z0-9-]+)/i);
      if (skuM) sku = skuM[1];
      name = line
        .replace(/\$?\s*[0-9]+(?:\.[0-9]+)?\s*\/?\s*(?:sf|sq\s?ft|sqft|sy|sq\s?yd|sqyd|yd|lf|lnft|each|ea)?\b/gi, " ")
        .replace(/\b(?:sku|item|style)\s*#?\s*[a-z0-9-]+/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!name) name = line;
    }
    rows.push({
      name,
      category: "other",
      unit: "sqft",
      sku,
      material_rate: rate,
      labor_rate: null,
      notes: null,
    });
  }
  return rows;
}

export async function parsePriceList(formData: FormData): Promise<ParseResult> {
  const text = str(formData.get("text"));
  const file = formData.get("file");
  const storagePath = str(formData.get("storage_path"));
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  // Preferred path: file already uploaded to storage by the browser.
  if (storagePath) {
    if (!hasKey)
      return {
        error:
          "Reading a file needs the AI key (ANTHROPIC_API_KEY in Vercel). Paste the rows as text instead.",
      };
    const supabase = await createClient();
    const { data: blob, error } = await supabase.storage
      .from("documents")
      .download(storagePath);
    if (error || !blob) return { error: "Couldn't open the uploaded file." };
    const bytes = Buffer.from(await blob.arrayBuffer());
    const mediaType =
      str(formData.get("storage_mime")) || blob.type || "application/pdf";
    const rows = await extractPriceList({
      base64: bytes.toString("base64"),
      mediaType,
    });
    if (!rows || !rows.length)
      return {
        error:
          "Couldn't read that file — try a clearer PDF/scan, or paste the rows as text.",
      };
    return { error: null, rows };
  }

  if (file instanceof File && file.size > 0) {
    if (file.size > 20 * 1024 * 1024) return { error: "File too large (max 20 MB)." };
    if (!hasKey) {
      return {
        error:
          "Reading a file needs the AI key (ANTHROPIC_API_KEY in Vercel). For now, paste the rows as text instead.",
      };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const rows = await extractPriceList({
      base64: bytes.toString("base64"),
      mediaType: file.type || "application/octet-stream",
    });
    if (!rows || !rows.length) {
      return {
        error:
          "Couldn't read that file — try a clearer PDF/scan, or paste the rows as text.",
      };
    }
    return { error: null, rows };
  }

  if (text) {
    let rows = hasKey ? await extractPriceList({ text }) : null;
    if (!rows || !rows.length) rows = parseTextRows(text); // AI-free fallback
    if (!rows.length) return { error: "No products found in that text." };
    return { error: null, rows };
  }

  return { error: "Paste a price list or choose a file." };
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
