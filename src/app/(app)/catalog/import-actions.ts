"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractPriceList, type PriceRow } from "@/lib/extract";
import { PRODUCT_CATEGORY_ORDER, type ProductCategory } from "@/lib/types";
import { chunkText } from "@/lib/pdf-client";
import { triggerImportProcessing } from "@/lib/import-worker";
import {
  listActiveImportJobs,
  listRecentImportJobs,
  type ImportJob,
} from "@/lib/data/import-jobs";

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
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 600);
    if (!signed?.signedUrl)
      return { error: "Couldn't open the uploaded file." };
    const mediaType =
      str(formData.get("storage_mime")) ||
      (storagePath.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "image/jpeg");
    const rows = await extractPriceList({
      url: signed.signedUrl,
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

export interface StartImportResult {
  error: string | null;
  jobId?: string;
  chunks?: number;
}

/**
 * Queue a price list to import in the background. The browser has already
 * extracted the text (or uploaded an image to storage); we chunk it, create an
 * import_jobs row, and kick off the server-side worker — so the user can keep
 * working while it parses and imports.
 */
export async function startPriceListImport(input: {
  label?: string;
  text?: string;
  storagePath?: string;
  storageMime?: string;
}): Promise<StartImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  if (!process.env.ANTHROPIC_API_KEY)
    return {
      error:
        "Background import needs the AI key (ANTHROPIC_API_KEY in Vercel).",
    };

  const text = (input.text ?? "").trim();
  const storagePath = (input.storagePath ?? "").trim();
  if (!text && !storagePath)
    return { error: "Nothing to import — choose a file or paste a list." };

  // Smaller chunks keep each AI call well under the function time limit.
  const chunks = text ? chunkText(text, 5000) : [];
  const total = storagePath && !chunks.length ? 1 : chunks.length;

  const { data: job, error } = await supabase
    .from("import_jobs")
    .insert({
      kind: "price_list",
      label: input.label || "Price list",
      status: "queued",
      total_chunks: total,
      chunks,
      storage_path: storagePath || null,
      storage_mime: input.storageMime || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !job) return { error: error?.message || "Couldn't queue import." };

  // Start the worker after the response is sent (doesn't block the user).
  after(() => triggerImportProcessing(job.id));

  return { error: null, jobId: job.id, chunks: total };
}

/** Snapshot of import jobs for the live progress banner. */
export async function getImportJobsState(
  sinceIso: string,
): Promise<{ active: ImportJob[]; recent: ImportJob[] }> {
  const [active, recent] = await Promise.all([
    listActiveImportJobs(),
    listRecentImportJobs(sinceIso),
  ]);
  return { active, recent };
}

export interface ImportResult {
  error: string | null;
  count?: number;
}

export async function importProducts(
  rows: PriceRow[],
  opts: { update?: boolean } = {},
): Promise<ImportResult> {
  const valid = (rows ?? []).filter((r) => r.name?.trim());
  if (!valid.length) return { error: "Nothing to import." };

  const cats = new Set<string>(PRODUCT_CATEGORY_ORDER);
  const items = valid.map((r) => ({
    name: r.name.trim(),
    category: (cats.has(r.category) ? r.category : "other") as ProductCategory,
    unit: r.unit || "sqft",
    material_rate: Number(r.material_rate) || 0,
    labor_rate: Number(r.labor_rate) || 0,
    sku: r.sku || "",
    manufacturer: r.manufacturer || "",
    style: r.style || "",
    color: r.color || "",
    notes: r.notes || "",
  }));

  const supabase = await createClient();

  // Preferred path: one bulk RPC call that inserts new products and (when
  // update=true) updates any product whose name already matches — no
  // duplicates. Requires migration 0039. If that migration hasn't been run,
  // the RPC is missing; we fall back to a plain insert so imports still work.
  let count = 0;
  let rpcUnavailable = false;
  for (let i = 0; i < items.length; i += 1000) {
    const batch = items.slice(i, i + 1000);
    const { data, error } = await supabase.rpc("import_products", {
      items: batch,
      do_update: opts.update ?? false,
    });
    if (error) {
      // Function not found / not yet created → fall back to direct insert.
      if (
        error.code === "PGRST202" ||
        error.code === "42883" ||
        /import_products|function|schema cache/i.test(error.message)
      ) {
        rpcUnavailable = true;
        break;
      }
      return { error: error.message, count };
    }
    count += (data as number) ?? batch.length;
  }

  if (rpcUnavailable) {
    // Direct insert fallback. Empty strings → null for cleaner rows.
    const toNull = (v: string) => (v && v.trim() ? v.trim() : null);
    const insertRows = items.map((it) => ({
      name: it.name,
      category: it.category,
      unit: it.unit,
      material_rate: it.material_rate,
      labor_rate: it.labor_rate,
      sku: toNull(it.sku),
      manufacturer: toNull(it.manufacturer),
      style: toNull(it.style),
      color: toNull(it.color),
      notes: toNull(it.notes),
    }));
    count = 0;
    for (let i = 0; i < insertRows.length; i += 500) {
      const batch = insertRows.slice(i, i + 500);
      const { error } = await supabase.from("products").insert(batch);
      if (error) return { error: error.message, count };
      count += batch.length;
    }
  }

  revalidatePath("/catalog");
  return { error: null, count };
}
