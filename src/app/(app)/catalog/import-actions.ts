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
  pdfItemsToLines,
  readPriceText,
  sheetLinesToPriceRows,
  type PdfTextItem,
} from "@/lib/price-sheet";
import { specFieldsFor } from "@/lib/product-fields";
import { triggerImportProcessing } from "@/lib/import-worker";
import {
  listActiveImportJobs,
  listRecentImportJobs,
  type ImportJob,
} from "@/lib/data/import-jobs";
import { inferUnit, parseCoverage } from "@/lib/units";

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
        width?: number;
        height?: number;
      }[];

      // Group fragments by their real position. A gap between columns becomes a
      // tab so "Style / Color / Cut / Roll" stays four cells, not one sentence.
      const positioned: PdfTextItem[] = [];
      let flat = "";
      for (const it of items) {
        const s = it.str ?? "";
        flat += s + (it.hasEOL ? "\n" : " ");
        if (!s.trim() || !it.transform || it.transform.length < 6) continue;
        const height =
          typeof it.height === "number" && it.height > 0
            ? it.height
            : Math.abs(it.transform[3]) || 0;
        positioned.push({
          str: s,
          x: it.transform[4],
          y: it.transform[5],
          width: typeof it.width === "number" ? it.width : 0,
          height,
        });
      }

      const geometric = pdfItemsToLines(positioned);
      if (geometric.length > 1) {
        lines.push(...geometric);
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
  // A price book often starts with a title, so the header is not on line 1.
  // Cut/roll sheets, then color-matrix books, then a normal spreadsheet.
  const read = readPriceText(text);
  return { text, structured: read?.rows ?? null, error: null };
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
  const found = new Map<string, { id: string; name: string }>();
  for (let i = 0; i < unique.length; i += 25) {
    const slice = unique.slice(i, i + 25);
    const wanted = new Set(slice.map((n) => n.toLowerCase()));
    const ilike = await admin
      .from("products")
      .select("id, name")
      .or(slice.map((n) => `name.ilike.${quoteExactIlike(n)}`).join(","));
    const rows = ilike.error
      ? (
          await admin.from("products").select("id, name").in("name", slice)
        ).data
      : ilike.data;
    for (const row of rows ?? []) {
      const key = String(row.name ?? "").toLowerCase();
      if (!wanted.has(key) || found.has(key)) continue;
      found.set(key, { id: row.id as string, name: row.name as string });
    }
  }
  return [...found.values()];
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
  opts: {
    update?: boolean;
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

    // Preferred path: one bulk RPC that inserts new products and (when
    // update=true) updates any product whose name already matches — no
    // duplicates. If the RPC isn't present, fall back to a plain insert.
    let count = 0;
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
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
      // Newer RPC (0100) returns a breakdown object; the older one returns a
      // bare int. Handle both so this works before and after the migration.
      if (data && typeof data === "object") {
        const d = data as { inserted?: number; updated?: number; unchanged?: number; total?: number };
        inserted += d.inserted ?? 0;
        updated += d.updated ?? 0;
        unchanged += d.unchanged ?? 0;
        count += d.total ?? batch.length;
      } else {
        count += (data as number) ?? batch.length;
      }
    }

    if (rpcUnavailable) {
      const toNull = (v: string) => (v && v.trim() ? v.trim() : null);
      const insertRows = items.map((it) => ({
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
      count = 0;
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
        if (error) return { error: error.message, count };
        count += batch.length;
      }
      inserted = count; // fallback path only ever inserts
      updated = 0;
      unchanged = 0;
    }

    const warning = await stampImportedSheet(admin, items, opts);

    revalidatePath("/catalog");
    return { error: null, count, skipped, inserted, updated, unchanged, warning };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Import failed unexpectedly.",
    };
  }
}
