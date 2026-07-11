"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractPriceList,
  getLastExtractError,
  type PriceRow,
} from "@/lib/extract";
import { PRODUCT_CATEGORY_ORDER, type ProductCategory } from "@/lib/types";
import { chunkText } from "@/lib/pdf-client";
import { parseStructuredRows } from "@/lib/catalog-csv";
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

/**
 * Extract text from a PDF on the server (no browser worker). Rebuilds real
 * lines using pdf.js text-item geometry (end-of-line flags + Y position) so a
 * price list comes out one product per row — not as one giant blob.
 */
async function pdfTextFromStorage(storagePath: string): Promise<string> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.storage
      .from("documents")
      .download(storagePath);
    if (!data) return "";
    const buf = new Uint8Array(await data.arrayBuffer());
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);

    const lines: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items as {
        str?: string;
        hasEOL?: boolean;
        transform?: number[];
      }[];

      // Group text fragments into rows by their vertical (Y) position, then
      // order each row left-to-right. Big horizontal gaps become tabs (columns).
      const byRow = new Map<number, { x: number; s: string }[]>();
      let usedGeometry = false;
      let flat = "";
      for (const it of items) {
        const s = it.str ?? "";
        flat += s + (it.hasEOL ? "\n" : " ");
        if (it.transform && it.transform.length >= 6) {
          usedGeometry = true;
          const y = Math.round(it.transform[5]);
          const x = it.transform[4];
          const arr = byRow.get(y) ?? [];
          arr.push({ x, s });
          byRow.set(y, arr);
        }
      }

      if (usedGeometry && byRow.size > 1) {
        const ys = [...byRow.keys()].sort((a, b) => b - a); // top → bottom
        for (const y of ys) {
          const cells = byRow.get(y)!.sort((a, b) => a.x - b.x);
          let line = "";
          let prevX: number | null = null;
          for (const c of cells) {
            if (prevX !== null && c.x - prevX > 8) line += "\t";
            line += c.s;
            prevX = c.x + c.s.length;
          }
          const trimmed = line.replace(/\t{2,}/g, "\t").trim();
          if (trimmed) lines.push(trimmed);
        }
      } else {
        for (const l of flat.split("\n")) {
          const t = l.trim();
          if (t) lines.push(t);
        }
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export interface PdfTextResult {
  text: string;
  structured: PriceRow[] | null; // clean column layout, parsed instantly
  error: string | null;
}

/**
 * Fast, bounded server action: extract a PDF's text (no AI) and, if it has a
 * clean column layout, parse it instantly. The browser then sends any messy
 * text through the AI in short chunks — keeping every request well under the
 * function time limit.
 */
export async function extractStoragePdfText(
  storagePath: string,
): Promise<PdfTextResult> {
  if (!storagePath) return { text: "", structured: null, error: "No file." };
  const text = await pdfTextFromStorage(storagePath);
  if (!text || text.trim().length < 20)
    return { text: "", structured: null, error: null };
  const structured = parseStructuredRows(text);
  return {
    text,
    structured: structured?.length ? structured : null,
    error: null,
  };
}

export async function parsePriceList(formData: FormData): Promise<ParseResult> {
  const text = str(formData.get("text"));
  const file = formData.get("file");
  const storagePath = str(formData.get("storage_path"));
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  // Storage path is now ONLY the AI-vision fallback (scanned PDFs / photos),
  // which is a single API call. Text PDFs are handled via extractStoragePdfText
  // + client-side chunked parsing so we never exceed the function time limit.
  if (storagePath) {
    const isPdf =
      storagePath.toLowerCase().endsWith(".pdf") ||
      str(formData.get("storage_mime")).includes("pdf");

    if (!hasKey)
      return {
        error: isPdf
          ? "That PDF has no readable text (it's a scan). Reading scans needs the AI key (ANTHROPIC_API_KEY in Vercel) — or export to Excel/CSV, or paste the rows."
          : "Reading an image needs the AI key (ANTHROPIC_API_KEY in Vercel). Paste the rows as text instead.",
      };
    const supabase = await createClient();
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 600);
    if (!signed?.signedUrl)
      return { error: "Couldn't open the uploaded file." };
    const mediaType =
      str(formData.get("storage_mime")) ||
      (isPdf ? "application/pdf" : "image/jpeg");
    const rows = await extractPriceList({
      url: signed.signedUrl,
      mediaType,
    });
    if (!rows || !rows.length) {
      const why = getLastExtractError();
      return {
        error: why
          ? `${why} (try a clearer scan, or import the Excel/CSV)`
          : "Couldn't read that file — try a clearer PDF/scan, or paste the rows as text.",
      };
    }
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
      const why = getLastExtractError();
      return {
        error: why
          ? `${why} (or import the Excel/CSV)`
          : "Couldn't read that file — try a clearer PDF/scan, or paste the rows as text.",
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

/**
 * Import reviewed products DIRECTLY and synchronously — one request, no
 * background worker, no self-calls, no polling. This is the reliable path: it
 * verifies the caller is staff, then writes with the service-role client so a
 * stale session or RLS can never silently swallow the rows. Everything is
 * wrapped so the action can never throw (a thrown Server Action is what can
 * bounce the page). Returns a clear count or a clear error — nothing in between.
 */
export async function importProducts(
  rows: PriceRow[],
  opts: { update?: boolean; supplier?: string } = {},
): Promise<ImportResult> {
  try {
    const valid = (rows ?? []).filter((r) => r.name?.trim());
    if (!valid.length) return { error: "Nothing to import." };

    // Must be signed-in staff.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Your session expired — please sign in again." };
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.role === "customer")
      return { error: "You don't have permission to import products." };

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

    // Service-role client: the caller is verified staff above, so bypass RLS to
    // guarantee the write lands (no silent RLS/session failures).
    const admin = createAdminClient();

    // Preferred path: one bulk RPC that inserts new products and (when
    // update=true) updates any product whose name already matches — no
    // duplicates. If the RPC isn't present, fall back to a plain insert.
    let count = 0;
    let rpcUnavailable = false;
    for (let i = 0; i < items.length; i += 1000) {
      const batch = items.slice(i, i + 1000);
      const { data, error } = await admin.rpc("import_products", {
        items: batch,
        do_update: opts.update ?? false,
      });
      if (error) {
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
        const { error } = await admin.from("products").insert(batch);
        if (error) return { error: error.message, count };
        count += batch.length;
      }
    }

    // Stamp the supplier where it's blank (a price list is one vendor).
    const supplier = opts.supplier?.trim();
    if (supplier) {
      const names = [...new Set(items.map((it) => it.name))];
      for (let i = 0; i < names.length; i += 200) {
        await admin
          .from("products")
          .update({ supplier })
          .in("name", names.slice(i, i + 200))
          .or("supplier.is.null,supplier.eq.");
      }
    }

    revalidatePath("/catalog");
    return { error: null, count };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Import failed unexpectedly.",
    };
  }
}
