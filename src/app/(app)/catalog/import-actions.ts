"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractPriceList,
  extractPriceSheet,
  getLastExtractError,
  type PriceRow,
} from "@/lib/extract";
import { catalogProductCategory } from "@/lib/types";
import { chunkText } from "@/lib/pdf-client";
import {
  parsePriceSheet,
  readPriceText,
  sheetLinesToPriceRows,
} from "@/lib/price-sheet";
import { specFieldsFor } from "@/lib/product-fields";
import { parseBishopPriceList } from "@/lib/bishop-price";
import { parsePdHappyFeetPriceList } from "@/lib/pd-happy-feet-price";
import { parseLwFlooringPriceList } from "@/lib/lw-flooring-price";
import { parseSomersetPriceList } from "@/lib/somerset-price";
import { layoutPdfJsItems, pdfJsItems } from "@/lib/pdf-layout";
import { triggerImportProcessing } from "@/lib/import-worker";
import {
  listActiveImportJobs,
  listRecentImportJobs,
  type ImportJob,
} from "@/lib/data/import-jobs";
import { inferUnit, parseCoverage } from "@/lib/units";
import {
  normalizeProductName,
  planPriceListReplace,
  type ExistingPriceListProduct,
} from "@/lib/price-list-replace";

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
      // Infer from the name so per-container items (adhesive, gallon, pail…)
      // aren't defaulted to square feet.
      unit: inferUnit(name, null, "other"),
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
async function pdfTextFromStorage(storagePath: string): Promise<{
  text: string;
  book: { rows: PriceRow[]; distributor: string } | null;
}> {
  const empty = { text: "", book: null as { rows: PriceRow[]; distributor: string } | null };
  try {
    const supabase = await createClient();
    const { data } = await supabase.storage
      .from("documents")
      .download(storagePath);
    if (!data) return empty;
    const buf = new Uint8Array(await data.arrayBuffer());
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);

    const lines: string[] = [];
    const bishopPages: { str: string; x: number; y: number }[][] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items as {
        str?: string;
        hasEOL?: boolean;
        transform?: number[];
        width?: number;
        height?: number;
      }[];
      bishopPages.push(pdfJsItems(items));

      // Column gaps become tabs. "12" and "00" stay $12.00, not 1200.
      // A two-column page is read left side, then right side.
      const laid = layoutPdfJsItems(items);
      if (laid.trim()) {
        for (const line of laid.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) lines.push(trimmed);
        }
        continue;
      }
      let flat = "";
      for (const it of items) {
        flat += (it.str ?? "") + (it.hasEOL ? "\n" : " ");
      }
      for (const line of flat.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) lines.push(trimmed);
      }
    }
    const text = lines.join("\n");
    const lw = parseLwFlooringPriceList(bishopPages);
    const somerset = parseSomersetPriceList(bishopPages);
    const happyFeet = parsePdHappyFeetPriceList(bishopPages);
    const bishop = parseBishopPriceList(bishopPages);
    const book = lw ?? somerset ?? happyFeet ?? bishop;
    return {
      text,
      book: book?.rows.length ? { rows: book.rows, distributor: book.distributor } : null,
    };
  } catch {
    return empty;
  }
}

export interface PdfTextResult {
  text: string;
  structured: PriceRow[] | null; // clean column layout, parsed instantly
  /** Rows already name their own category and unit. Do not lock the file to one material. */
  preserveCategories?: boolean;
  /** Who you order this list from, when the sheet names one distributor. */
  distributor?: string | null;
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
  const extracted = await pdfTextFromStorage(storagePath);
  const text = extracted.text;
  if (extracted.book?.rows.length) {
    return {
      text,
      structured: extracted.book.rows,
      preserveCategories: true,
      distributor: extracted.book.distributor,
      error: null,
    };
  }
  if (!text || text.trim().length < 20)
    return { text: "", structured: null, error: null };
  // A price book often starts with a title, so the header is not on line 1.
  // Cut/roll sheets, then color-matrix books, then a normal spreadsheet.
  const read = readPriceText(text);
  return {
    text,
    structured: read?.rows ?? null,
    preserveCategories: read?.preserveCategories ?? false,
    distributor: null,
    error: null,
  };
}

export async function parsePriceList(formData: FormData): Promise<ParseResult> {
  const text = str(formData.get("text"));
  const file = formData.get("file");
  const storagePath = str(formData.get("storage_path"));
  const sheetMode = str(formData.get("mode")) === "sheet";
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
    const rows = await (sheetMode ? extractPriceSheet : extractPriceList)({
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
    const rows = await (sheetMode ? extractPriceSheet : extractPriceList)({
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
    const localBook = readPriceText(text);
    if (localBook?.preserveCategories && localBook.rows.length) {
      return { error: null, rows: localBook.rows };
    }
    if (sheetMode) {
      const local = parsePriceSheet(text);
      if (local?.length) return { error: null, rows: sheetLinesToPriceRows(local) };
      const rows = hasKey ? await extractPriceSheet({ text }) : null;
      if (!rows?.length) {
        return {
          error: hasKey
            ? "Couldn't find styles, colors, and prices in that PDF."
            : "That PDF didn't come out as columns. Reading it needs the AI key (ANTHROPIC_API_KEY), or export the sheet to Excel.",
        };
      }
      return { error: null, rows };
    }
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
  skipped?: number; // rows held back because they had no usable price
  inserted?: number; // brand-new products added
  updated?: number; // existing products whose price/attrs actually changed
  unchanged?: number; // matched an existing product, nothing changed
  retired?: number; // old prices turned off because they are not on this list
  /** The colors imported, but a follow-up (roll price, vendor link) did not. */
  warning?: string | null;
}

/** Parse to a finite number, else null — never a silent 0. */
function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

type StampedItem = {
  name: string;
  category: string;
  material_rate: number;
  roll_rate: number | null;
};

/** Specs the upload form is allowed to write. Anything else is ignored. */
function sheetSpecPatch(
  category: string,
  specs: Record<string, string> | undefined,
): Record<string, string | number> {
  const allowed = new Map(specFieldsFor(category).map((f) => [f.key, f.kind]));
  const patch: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(specs ?? {})) {
    const kind = allowed.get(key);
    const value = (raw ?? "").trim();
    if (!kind || !value) continue;
    if (kind === "number") {
      const n = parseFloat(value);
      if (Number.isFinite(n) && n > 0) patch[key] = n;
    } else {
      patch[key] = value;
    }
  }
  return patch;
}

async function ensureSupplier(
  admin: ReturnType<typeof createAdminClient>,
  name: string,
  kind: "manufacturer" | "distributor",
): Promise<{ id: string; name: string } | null> {
  const clean = name.trim();
  if (!clean) return null;
  const { data: found } = await admin
    .from("suppliers")
    .select("id, name")
    .ilike("name", clean)
    .limit(1);
  const existing = (found ?? [])[0] as { id?: string; name?: string } | undefined;
  if (existing?.id) {
    await admin.from("suppliers").update({ active: true }).eq("id", existing.id);
    return { id: existing.id, name: existing.name || clean };
  }
  const { data, error } = await admin
    .from("suppliers")
    .insert({ name: clean, kind, active: true })
    .select("id, name")
    .single();
  if (error || !data) return null;
  return { id: data.id as string, name: (data.name as string) || clean };
}

/** Quote a value for a PostgREST `.or()` filter. `%` and `_` are not wildcards here. */
function quoteExactIlike(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return `"${escaped}"`;
}

/** Products just written, matched even when the stored name differs only by case. */
async function loadProductsForNames(
  admin: ReturnType<typeof createAdminClient>,
  names: string[],
): Promise<{ id: string; name: string }[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const found = new Map<string, { id: string; name: string; active: boolean }>();
  for (let i = 0; i < unique.length; i += 25) {
    const slice = unique.slice(i, i + 25);
    const wanted = new Set(slice.map((n) => n.toLowerCase()));
    const ilike = await admin
      .from("products")
      .select("id, name, active")
      .or(slice.map((n) => `name.ilike.${quoteExactIlike(n)}`).join(","));
    const rows = ilike.error
      ? (
          await admin.from("products").select("id, name, active").in("name", slice)
        ).data
      : ilike.data;
    for (const row of rows ?? []) {
      const key = String(row.name ?? "").toLowerCase();
      if (!wanted.has(key)) continue;
      const next = { id: row.id as string, name: row.name as string, active: row.active !== false };
      const prev = found.get(key);
      if (prev?.active && !next.active) continue;
      found.set(key, next);
    }
  }
  return [...found.values()].map(({ id, name }) => ({ id, name }));
}

/** Roll price, the specs for this material, and the distributor you buy it from. */
async function stampImportedSheet(
  admin: ReturnType<typeof createAdminClient>,
  items: StampedItem[],
  opts: {
    supplier?: string;
    manufacturer?: string;
    specs?: Record<string, string>;
    category?: string;
  },
): Promise<string | null> {
  const warnings: string[] = [];
  const category = opts.category || items[0]?.category || "";
  const products = await loadProductsForNames(
    admin,
    items.map((it) => it.name),
  );
  const idByName = new Map(products.map((p) => [p.name.toLowerCase(), p.id]));

  const byRoll = new Map<number, string[]>();
  for (const it of items) {
    if (it.roll_rate == null || !(it.roll_rate > 0)) continue;
    const id = idByName.get(it.name.toLowerCase());
    if (!id) continue;
    const list = byRoll.get(it.roll_rate) ?? [];
    list.push(id);
    byRoll.set(it.roll_rate, list);
  }
  let rollMissing = false;
  for (const [price, ids] of byRoll) {
    if (rollMissing) break;
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await admin
        .from("products")
        .update({ roll_rate: price })
        .in("id", ids.slice(i, i + 200));
      if (!error) continue;
      if (/roll_rate/i.test(error.message)) {
        rollMissing = true;
        break;
      }
      warnings.push(error.message);
      break;
    }
  }
  if (rollMissing) {
    warnings.push(
      "Roll prices were read but not saved. Run 0509_product_roll_rate.sql in the Supabase SQL editor, then import this list again.",
    );
  }

  const distributorName = opts.supplier?.trim() ?? "";
  const manufacturerName = opts.manufacturer?.trim() ?? "";
  let supplierId: string | null = null;
  let supplierName = distributorName;
  if (distributorName) {
    const vendor = await ensureSupplier(admin, distributorName, "distributor");
    if (vendor) {
      supplierId = vendor.id;
      supplierName = vendor.name;
    } else {
      warnings.push(`Couldn't save distributor “${distributorName}”.`);
    }
  }
  if (manufacturerName && manufacturerName.toLowerCase() !== distributorName.toLowerCase()) {
    await ensureSupplier(admin, manufacturerName, "manufacturer");
  }

  const specPatch = sheetSpecPatch(category, opts.specs);
  const shared: Record<string, unknown> = { ...specPatch };
  if (supplierName) {
    shared.supplier = supplierName;
    if (supplierId) shared.supplier_id = supplierId;
  }
  const ids = products.map((p) => p.id);
  if (Object.keys(shared).length && ids.length) {
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { error } = await admin.from("products").update(shared).in("id", slice);
      if (!error) continue;
      const supplierOnly: Record<string, unknown> = {};
      if (shared.supplier) supplierOnly.supplier = shared.supplier;
      if (shared.supplier_id) supplierOnly.supplier_id = shared.supplier_id;
      if (Object.keys(supplierOnly).length) {
        const retry = await admin.from("products").update(supplierOnly).in("id", slice);
        if (retry.error) warnings.push(retry.error.message);
      }
      break;
    }
  }

  if (supplierId) {
    const linkWarning = await linkDistributorCost(admin, products, supplierId, items);
    if (linkWarning) warnings.push(linkWarning);
  }
  return warnings[0] ?? null;
}

/** The cut price is what we pay this distributor. Estimates use that cost. */
async function linkDistributorCost(
  admin: ReturnType<typeof createAdminClient>,
  products: { id: string; name: string }[],
  vendorId: string,
  items: StampedItem[],
): Promise<string | null> {
  const costByName = new Map(items.map((it) => [it.name.toLowerCase(), it.material_rate]));
  const existing = new Map<string, string>();
  const ids = products.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("product_vendors")
      .select("id, product_id, vendor_id")
      .in("product_id", ids.slice(i, i + 200));
    if (error) return null;
    for (const row of data ?? []) {
      if (row.vendor_id === vendorId) existing.set(row.product_id as string, row.id as string);
    }
  }
  const inserts: {
    product_id: string;
    vendor_id: string;
    cost: number;
    position: number;
  }[] = [];
  const updatesByCost = new Map<number, string[]>();
  for (const p of products) {
    const cost = costByName.get(p.name.toLowerCase());
    if (cost == null) continue;
    const rowId = existing.get(p.id);
    if (rowId) {
      const list = updatesByCost.get(cost) ?? [];
      list.push(rowId);
      updatesByCost.set(cost, list);
    } else {
      inserts.push({ product_id: p.id, vendor_id: vendorId, cost, position: 0 });
    }
  }
  if (inserts.length) {
    const { error } = await admin.from("product_vendors").insert(inserts);
    if (error) return error.message;
  }
  for (const [cost, rowIds] of updatesByCost) {
    for (let i = 0; i < rowIds.length; i += 200) {
      const { error } = await admin
        .from("product_vendors")
        .update({ cost })
        .in("id", rowIds.slice(i, i + 200));
      if (error) return error.message;
    }
  }
  return null;
}

type ImportWriteItem = {
  name: string;
  category: string;
  unit: string;
  material_rate: number;
  roll_rate: number | null;
  labor_rate: number;
  sku: string;
  manufacturer: string;
  style: string;
  color: string;
  notes: string;
  coverage_sqft: number | null;
  coverage_thickness_in: number | null;
};

type LoadedProduct = ExistingPriceListProduct & {
  sku?: string | null;
  notes?: string | null;
  roll_rate?: number | null;
  labor_rate?: number | null;
};

const PRODUCT_MATCH_COLUMNS =
  "id, name, manufacturer, style, color, unit, category, sku, notes, active, updated_at, material_rate, roll_rate, labor_rate";

function loadedProduct(row: Record<string, unknown>): LoadedProduct {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    manufacturer: (row.manufacturer as string | null) ?? null,
    style: (row.style as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    unit: (row.unit as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    sku: (row.sku as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    active: row.active !== false,
    updated_at: (row.updated_at as string | null) ?? null,
    material_rate: row.material_rate == null ? null : Number(row.material_rate),
    roll_rate: row.roll_rate == null || row.roll_rate === undefined ? null : Number(row.roll_rate),
    labor_rate: row.labor_rate == null ? null : Number(row.labor_rate),
  };
}

function textSame(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

/** The kept row already has this list's name and price. */
function priceAlreadyCurrent(row: LoadedProduct, item: ImportWriteItem): boolean {
  if (row.active === false) return false;
  if (row.name.trim().replace(/\s+/g, " ") !== item.name.trim().replace(/\s+/g, " ")) return false;
  if (Number(row.material_rate ?? 0) !== Number(item.material_rate)) return false;
  if ((row.roll_rate ?? null) !== (item.roll_rate ?? null)) return false;
  if (item.style.trim() && !textSame(row.style, item.style)) return false;
  if (item.color.trim() && !textSame(row.color, item.color)) return false;
  if (!textSame(row.unit, item.unit)) return false;
  if (!textSame(row.category, item.category)) return false;
  if (item.manufacturer.trim() && !textSame(row.manufacturer, item.manufacturer)) return false;
  if (item.sku.trim() && !textSame(row.sku, item.sku)) return false;
  if (item.notes.trim() && !textSame(row.notes, item.notes)) return false;
  return true;
}

function replacementPatch(item: ImportWriteItem): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: item.name,
    category: item.category,
    unit: item.unit,
    material_rate: item.material_rate,
    roll_rate: item.roll_rate,
    sku: item.sku.trim() || null,
    manufacturer: item.manufacturer.trim() || null,
    style: item.style.trim() || null,
    color: item.color.trim() || null,
    notes: item.notes.trim() || null,
    active: true,
  };
  if (item.labor_rate > 0) patch.labor_rate = item.labor_rate;
  if (item.coverage_sqft != null) patch.coverage_sqft = item.coverage_sqft;
  if (item.coverage_thickness_in != null) patch.coverage_thickness_in = item.coverage_thickness_in;
  return patch;
}

async function readProductPage(
  columns: string,
  load: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: Record<string, unknown>[]; columns: string }> {
  let activeColumns = columns;
  let result = await load(activeColumns);
  if (result.error && /roll_rate/i.test(result.error.message)) {
    activeColumns = PRODUCT_MATCH_COLUMNS.replace(", roll_rate", "");
    result = await load(activeColumns);
  }
  if (result.error) throw new Error(result.error.message);
  const data = Array.isArray(result.data) ? result.data : [];
  return { rows: data as Record<string, unknown>[], columns: activeColumns };
}

/** Products this list can match: that manufacturer, plus any row with the same name. */
async function loadCatalogForReplace(
  admin: ReturnType<typeof createAdminClient>,
  items: ImportWriteItem[],
): Promise<LoadedProduct[]> {
  const found = new Map<string, LoadedProduct>();
  let columns = PRODUCT_MATCH_COLUMNS;
  const keep = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const loaded = loadedProduct(row);
      if (loaded.id) found.set(loaded.id, loaded);
    }
  };

  const makers = [...new Set(items.map((item) => item.manufacturer.trim()).filter(Boolean))];
  for (const maker of makers) {
    for (let from = 0; ; from += 1000) {
      const page = await readProductPage(columns, (cols) =>
        admin.from("products").select(cols).ilike("manufacturer", maker).range(from, from + 999),
      );
      columns = page.columns;
      keep(page.rows);
      if (page.rows.length < 1000) break;
    }
  }

  const names = [...new Set(items.map((item) => item.name.trim()).filter(Boolean))];
  for (let i = 0; i < names.length; i += 25) {
    const slice = names.slice(i, i + 25);
    const page = await readProductPage(columns, (cols) =>
      admin
        .from("products")
        .select(cols)
        .or(slice.map((name) => `name.ilike.${quoteExactIlike(name)}`).join(",")),
    );
    columns = page.columns;
    keep(page.rows);
  }
  return [...found.values()];
}

async function writeReplacementPrices(
  admin: ReturnType<typeof createAdminClient>,
  existing: LoadedProduct[],
  items: ImportWriteItem[],
  updates: { id: string; index: number }[],
): Promise<{ updated: number; unchanged: number }> {
  const byId = new Map(existing.map((row) => [row.id, row]));
  let updated = 0;
  let unchanged = 0;
  const jobs = updates.map((update) => ({
    id: update.id,
    item: items[update.index],
    current: byId.get(update.id),
  }));
  for (let i = 0; i < jobs.length; i += 20) {
    const slice = jobs.slice(i, i + 20);
    const results = await Promise.all(
      slice.map(async (job) => {
        if (job.current && priceAlreadyCurrent(job.current, job.item)) return "unchanged" as const;
        const patch = replacementPatch(job.item);
        const { error } = await admin.from("products").update(patch).eq("id", job.id);
        if (error && /roll_rate/i.test(error.message)) {
          const { roll_rate, ...rest } = patch;
          void roll_rate;
          const retry = await admin.from("products").update(rest).eq("id", job.id);
          if (retry.error) throw new Error(retry.error.message);
          return "updated" as const;
        }
        if (error) throw new Error(error.message);
        return "updated" as const;
      }),
    );
    for (const result of results) {
      if (result === "updated") updated += 1;
      else unchanged += 1;
    }
  }
  return { updated, unchanged };
}

async function turnOffOldPrices(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<number> {
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const { error } = await admin
      .from("products")
      .update({ active: false })
      .in("id", unique.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  return unique.length;
}

/**
 * Import reviewed products DIRECTLY and synchronously — one request, no
 * background worker, no self-calls, no polling. This is the reliable path: it
 * verifies the caller is staff, then writes with the service-role client so a
 * stale session or RLS can never silently swallow the rows. Everything is
 * wrapped so the action can never throw (a thrown Server Action is what can
 * bounce the page). Returns a clear count or a clear error — nothing in between.
 *
 * A new price list replaces that manufacturer's old prices. Matching products
 * get the new cost. Colors in the same categories that are not on the list
 * are turned off. Rows are not deleted.
 */
export async function importProducts(
  rows: PriceRow[],
  opts: {
    /** Distributor — who this upload is ordered from. Applied to every color. */
    supplier?: string;
    /** Manufacturer name, remembered as a supplier so the next upload can pick it. */
    manufacturer?: string;
    /** Specs that apply to every color (roll width, face weight, …). */
    specs?: Record<string, string>;
    category?: string;
  } = {},
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

    // A price is REQUIRED. A row with no parseable material rate AND no labor
    // rate has no usable price — it is held back and counted, NEVER stored as $0
    // (a silent $0 is the catastrophic failure this importer exists to prevent).
    // Labor is not a product: those rows are held back, never filed as Other.
    let skipped = 0;
    let laborSkipped = 0;
    const items = valid
      .map((r) => {
        const category = catalogProductCategory(r.category);
        if (!category) {
          skipped += 1;
          laborSkipped += 1;
          return null;
        }
        const mat = numOrNull(r.material_rate);
        const lab = numOrNull(r.labor_rate);
        const hasPrice = (mat != null && mat > 0) || (lab != null && lab > 0);
        if (!hasPrice) {
          skipped += 1;
          return null;
        }
        const cov = parseCoverage(r.name);
        const roll = numOrNull(r.roll_rate);
        return {
          name: r.name.trim(),
          category,
          // Trust a parsed unit; otherwise infer (container → each, flooring →
          // area) instead of blindly defaulting to square feet.
          unit: inferUnit(r.name, r.unit, category),
          material_rate: mat ?? 0,
          roll_rate: roll != null && roll > 0 ? roll : null,
          labor_rate: lab ?? 0,
          sku: r.sku || "",
          manufacturer: r.manufacturer || "",
          style: r.style || "",
          color: r.color || "",
          notes: r.notes || "",
          // Prep goods: "28 SF @ 1/4"" → coverage the bag calculator scales.
          coverage_sqft: cov?.coverage_sqft ?? null,
          coverage_thickness_in: cov?.coverage_thickness_in ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    if (!items.length)
      return {
        error:
          laborSkipped > 0 && laborSkipped === skipped
            ? "Labor is not a product, so those rows were not imported."
            : `No products had a usable price — all ${skipped} row${skipped === 1 ? "" : "s"} were held back. Check the price column mapping.`,
        skipped,
      };

    // Service-role client: the caller is verified staff above, so bypass RLS to
    // guarantee the write lands (no silent RLS/session failures).
    const admin = createAdminClient();
    const sheetManufacturer = (opts.manufacturer ?? "").trim();
    const priced: ImportWriteItem[] = items.map((item) => ({
      ...item,
      name: item.name.trim().replace(/\s+/g, " "),
      manufacturer: item.manufacturer.trim() || sheetManufacturer,
    }));

    // The new list is the price. Update the matching row, add only what is
    // new, then turn off this manufacturer's colors that the list left off.
    const existing = await loadCatalogForReplace(admin, priced);
    const plan = planPriceListReplace(existing, priced);
    const written = await writeReplacementPrices(admin, existing, priced, plan.updates);

    let inserted = 0;
    const updated = written.updated;
    const unchanged = written.unchanged;
    const fresh = plan.inserts.map((index) => priced[index]);
    const toNull = (v: string) => (v && v.trim() ? v.trim() : null);
    const insertRows = fresh.map((it) => ({
      name: it.name,
      category: it.category,
      unit: it.unit,
      material_rate: it.material_rate,
      roll_rate: it.roll_rate,
      labor_rate: it.labor_rate,
      sku: toNull(it.sku),
      manufacturer: toNull(it.manufacturer),
      style: toNull(it.style),
      color: toNull(it.color),
      notes: toNull(it.notes),
      coverage_sqft: it.coverage_sqft ?? null,
      coverage_thickness_in: it.coverage_thickness_in ?? null,
    }));
    let dropRoll = false;
    for (let i = 0; i < insertRows.length; i += 500) {
      const batch = insertRows.slice(i, i + 500).map((row) => {
        if (!dropRoll) return row;
        const { roll_rate, ...rest } = row;
        void roll_rate;
        return rest;
      });
      const { error } = await admin.from("products").insert(batch);
      if (error && /roll_rate/i.test(error.message) && !dropRoll) {
        dropRoll = true;
        i -= 500;
        continue;
      }
      if (error) return { error: error.message, count: inserted + updated + unchanged, skipped };
      inserted += batch.length;
    }

    const retired = await turnOffOldPrices(admin, plan.retire);
    const warning = await stampImportedSheet(admin, priced, opts);
    const count = inserted + updated + unchanged;

    revalidatePath("/catalog");
    return { error: null, count, skipped, inserted, updated, unchanged, retired, warning };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Import failed unexpectedly.",
    };
  }
}
