import { createClient } from "@/lib/supabase/server";
import { normalizeUnit } from "@/lib/units";
import {
  fcb2bRequest,
  isListPrice,
  parse832,
  priceFromResponse,
  type CatalogPriceRow,
} from "@/lib/fcb2b";

/**
 * Supplier price feeds — getting a supplier's costs into our catalog.
 *
 * The rule this whole module is built around: **a feed never changes a price
 * on its own.** Everything that arrives lands as a DRAFT import that a person
 * reviews and applies. Costs drive every estimate margin in the app, so a bad
 * catalog silently overwriting them would misprice work for weeks before
 * anyone noticed, and there would be no way to see what it used to be.
 */

type DB = Awaited<ReturnType<typeof createClient>>;

export type FeedKind = "fcb2b_rest" | "fcb2b_832" | "file" | "manual";

export interface SupplierFeed {
  id: string;
  supplier_id: string;
  kind: FeedKind;
  client_identifier: string | null;
  endpoint_url: string | null;
  credential_key: string | null;
  price_service_path: string | null;
  cadence_days: number | null;
  last_success_at: string | null;
  last_error: string | null;
  active: boolean;
  notes: string | null;
}

const FEED_COLUMNS =
  "id, supplier_id, kind, client_identifier, endpoint_url, credential_key, price_service_path, cadence_days, last_success_at, last_error, active, notes";

/** The path to call for prices when the supplier hasn't named a different one. */
export const DEFAULT_PRICE_SERVICE = "/priceinquiry";

/** How many items one REST refresh will ask for before it stops. */
export const REST_ITEM_CAP = 750;

export async function getSupplierFeed(
  db: DB,
  supplierId: string,
): Promise<SupplierFeed | null> {
  const { data } = await db
    .from("supplier_feeds")
    .select(FEED_COLUMNS)
    .eq("supplier_id", supplierId)
    .maybeSingle();
  return (data as SupplierFeed | null) ?? null;
}

/* ==========================================================================
 * Matching what they sent to what we sell
 * ======================================================================== */

interface CatalogProduct {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  material_rate: number | null;
  supplier_id: string | null;
}

/** Compare SKUs the way a human would — case and padding are not meaningful. */
function skuKey(sku: string | null | undefined): string {
  return (sku ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Look up every product whose SKU appears in this catalog.
 *
 * Chunked because the `in` list is the supplier's whole price list, which for
 * a mill like Shaw is thousands of SKUs — one query would be rejected.
 */
async function productsForSkus(db: DB, skus: string[]): Promise<CatalogProduct[]> {
  const unique = [...new Set(skus.filter(Boolean))];
  const out: CatalogProduct[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data } = await db
      .from("products")
      .select("id, name, sku, unit, material_rate, supplier_id")
      .in("sku", chunk);
    if (data) out.push(...(data as CatalogProduct[]));
  }
  return out;
}

export interface StagedCounts {
  importId: string | null;
  matched: number;
  unmatched: number;
  changed: number;
  error: string | null;
  warnings: string[];
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Turn parsed price rows into a draft import.
 *
 * Matching is by the SUPPLIER's SKU, and a product is only a confident match
 * when it is also attributed to that supplier — the same SKU string can belong
 * to two different mills, and paying Shaw's price for a Mohawk product is the
 * kind of error that survives a long time.
 */
export async function stagePriceImport(
  db: DB,
  input: {
    supplierId: string;
    kind: FeedKind;
    sourceName: string;
    effectiveDate?: string | null;
    rows: CatalogPriceRow[];
    createdBy?: string | null;
    warnings?: string[];
  },
): Promise<StagedCounts> {
  const warnings = [...(input.warnings ?? [])];
  const rows = input.rows.filter((r) => r.supplierSku);
  if (!rows.length) {
    return {
      importId: null,
      matched: 0,
      unmatched: 0,
      changed: 0,
      error: "Nothing to import — no priced items with a SKU were found.",
      warnings,
    };
  }

  const products = await productsForSkus(db, rows.map((r) => r.supplierSku));
  // Prefer this supplier's own product for a SKU; fall back to anyone's.
  const mine = new Map<string, CatalogProduct>();
  const anyone = new Map<string, CatalogProduct>();
  for (const p of products) {
    const k = skuKey(p.sku);
    if (!k) continue;
    if (p.supplier_id === input.supplierId) {
      if (!mine.has(k)) mine.set(k, p);
    } else if (!anyone.has(k)) anyone.set(k, p);
  }

  let matched = 0;
  let unmatched = 0;
  let changed = 0;
  let uomMismatches = 0;

  const lines = rows.map((r) => {
    const key = skuKey(r.supplierSku);
    const exact = mine.get(key);
    const loose = exact ? undefined : anyone.get(key);
    const product = exact ?? loose;
    const matchKind = exact ? "exact" : loose ? "sku" : "none";
    if (product) matched++;
    else unmatched++;

    const oldCost = product?.material_rate == null ? null : round4(Number(product.material_rate));
    const newCost = r.cost == null ? null : round4(r.cost);
    const isChange = product != null && newCost != null && oldCost !== newCost;
    if (isChange) changed++;

    // Their unit vs ours. Not fatal — but it must never apply unattended.
    const productUnit = normalizeUnit(product?.unit) || null;
    const uomMismatch = !!(product && r.uom && productUnit && r.uom !== productUnit);
    if (uomMismatch) uomMismatches++;

    return {
      supplier_sku: r.supplierSku,
      description: r.description,
      new_cost: newCost,
      uom: r.uom,
      product_id: product?.id ?? null,
      old_cost: oldCost,
      match_kind: matchKind,
      applied: false,
      raw: {
        ...r.raw,
        price_qualifier: r.priceQualifier,
        list_price: isListPrice(r.priceQualifier),
        raw_uom: r.rawUom,
        effective_date: r.effectiveDate,
        product_unit: productUnit,
        product_name: product?.name ?? null,
        uom_mismatch: uomMismatch,
        matched_other_supplier: matchKind === "sku",
      },
    };
  });

  if (uomMismatches) {
    warnings.push(
      `${uomMismatches} item${uomMismatches === 1 ? "" : "s"} priced in a different unit than we sell them in. These are held back — applying one would be a straight multiplication error in our cost.`,
    );
  }
  if (matched === 0) {
    warnings.push(
      "Not one SKU matched a product of this supplier's. Usually that means the products aren't attributed to them yet, or their catalog SKU isn't the one we store.",
    );
  }

  const { data: imp, error: impErr } = await db
    .from("price_imports")
    .insert({
      supplier_id: input.supplierId,
      kind: input.kind,
      source_name: input.sourceName,
      effective_date: input.effectiveDate ?? null,
      status: "draft",
      matched,
      unmatched,
      changed,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (impErr || !imp) {
    return { importId: null, matched, unmatched, changed, error: impErr?.message ?? "Could not start the import.", warnings };
  }

  const importId = imp.id as string;
  for (let i = 0; i < lines.length; i += 500) {
    const { error } = await db
      .from("price_import_lines")
      .insert(lines.slice(i, i + 500).map((l) => ({ ...l, import_id: importId })));
    if (error) {
      return { importId, matched, unmatched, changed, error: error.message, warnings };
    }
  }

  return { importId, matched, unmatched, changed, error: null, warnings };
}

/* ==========================================================================
 * Reading a feed
 * ======================================================================== */

export interface FetchResult {
  rows: CatalogPriceRow[];
  sourceName: string;
  effectiveDate: string | null;
  warnings: string[];
  error: string | null;
}

/** Parse an uploaded 832 document. */
export function readCatalogFile(text: string, fileName: string): FetchResult {
  const parsed = parse832(text);
  return {
    rows: parsed.rows,
    sourceName: fileName,
    effectiveDate: parsed.catalogDate,
    warnings: parsed.warnings,
    error: parsed.rows.length ? null : "No items could be read out of that file.",
  };
}

/**
 * Refresh prices over the REST services.
 *
 * The web services answer one item at a time, so a "full refresh" is really a
 * walk of the products WE stock from that supplier — which is the right scope
 * anyway: we don't need a price for 40,000 SKUs we've never sold.
 */
export async function fetchPricesOverRest(
  db: DB,
  feed: SupplierFeed,
  supplierName: string,
): Promise<FetchResult> {
  const warnings: string[] = [];
  if (!feed.endpoint_url) {
    return { rows: [], sourceName: "", effectiveDate: null, warnings, error: "No endpoint URL is configured." };
  }
  if (feed.credential_key && !process.env[feed.credential_key]) {
    return {
      rows: [],
      sourceName: "",
      effectiveDate: null,
      warnings,
      error: `The credential ${feed.credential_key} isn't set in this environment. Add it in Vercel → Settings → Environment Variables and redeploy.`,
    };
  }

  const { data: prods } = await db
    .from("products")
    .select("id, sku")
    .eq("supplier_id", feed.supplier_id)
    .not("sku", "is", null)
    .order("name");
  const skus = [...new Set(((prods ?? []) as { sku: string | null }[]).map((p) => (p.sku ?? "").trim()).filter(Boolean))];

  if (!skus.length) {
    return {
      rows: [],
      sourceName: "",
      effectiveDate: null,
      warnings,
      error: `No products are attributed to ${supplierName} with a SKU, so there is nothing to ask them about yet.`,
    };
  }

  const capped = skus.slice(0, REST_ITEM_CAP);
  if (skus.length > capped.length) {
    // Say so out loud. A silent cap reads as "everything is up to date".
    warnings.push(
      `Asked for the first ${capped.length} of ${skus.length} items — the rest were not checked in this run.`,
    );
  }

  const service = feed.price_service_path?.trim() || DEFAULT_PRICE_SERVICE;
  const rows: CatalogPriceRow[] = [];
  let failures = 0;
  let firstError: string | null = null;

  // Politely serial-ish: a handful at a time, so a price refresh doesn't look
  // like an attack to their gateway.
  const CONCURRENCY = 5;
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    const batch = capped.slice(i, i + CONCURRENCY);
    const answers = await Promise.all(
      batch.map(async (sku) => ({ sku, res: await fcb2bRequest(feed, service, sku) })),
    );
    for (const { sku, res } of answers) {
      if (!res.ok) {
        failures++;
        if (!firstError) firstError = res.error ?? `HTTP ${res.status}`;
        continue;
      }
      const row = priceFromResponse(res.body, sku);
      if (row.cost != null) rows.push(row);
      else failures++;
    }
    // If the very first batch fails outright, stop — the connection is wrong
    // and hammering them with 700 more requests helps nobody.
    if (i === 0 && rows.length === 0 && failures === batch.length) {
      return {
        rows: [],
        sourceName: "",
        effectiveDate: null,
        warnings,
        error: `${supplierName} rejected the first ${batch.length} requests: ${firstError ?? "no usable price in the response"}. Nothing else was sent.`,
      };
    }
  }

  if (failures) {
    warnings.push(
      `${failures} item${failures === 1 ? "" : "s"} came back without a usable price${firstError ? ` (first problem: ${firstError})` : ""}.`,
    );
  }

  return {
    rows,
    sourceName: `${supplierName} price inquiry (${rows.length} items)`,
    effectiveDate: null,
    warnings,
    error: rows.length ? null : "Every request came back without a price.",
  };
}

/** Record how a fetch went, so a feed that quietly died is visible. */
export async function recordFeedRun(
  db: DB,
  feedId: string,
  error: string | null,
): Promise<void> {
  await db
    .from("supplier_feeds")
    .update({
      last_error: error,
      ...(error ? {} : { last_success_at: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", feedId);
}

/* ==========================================================================
 * Review and apply
 * ======================================================================== */

export interface ImportLine {
  id: string;
  supplier_sku: string | null;
  description: string | null;
  new_cost: number | null;
  uom: string | null;
  product_id: string | null;
  old_cost: number | null;
  match_kind: string | null;
  applied: boolean;
  raw: Record<string, unknown> | null;
}

export interface PriceImport {
  id: string;
  supplier_id: string | null;
  kind: FeedKind;
  source_name: string | null;
  effective_date: string | null;
  status: string;
  matched: number;
  unmatched: number;
  changed: number;
  applied_at: string | null;
  discarded_at: string | null;
  created_at: string;
}

export async function getPriceImport(
  db: DB,
  importId: string,
): Promise<{ imp: PriceImport | null; lines: ImportLine[] }> {
  const { data: imp } = await db
    .from("price_imports")
    .select("id, supplier_id, kind, source_name, effective_date, status, matched, unmatched, changed, applied_at, discarded_at, created_at")
    .eq("id", importId)
    .maybeSingle();
  if (!imp) return { imp: null, lines: [] };
  const { data: lines } = await db
    .from("price_import_lines")
    .select("id, supplier_sku, description, new_cost, uom, product_id, old_cost, match_kind, applied, raw")
    .eq("import_id", importId)
    .order("supplier_sku");
  return { imp: imp as PriceImport, lines: (lines ?? []) as ImportLine[] };
}

export async function listPriceImports(
  db: DB,
  supplierId: string,
  limit = 10,
): Promise<PriceImport[]> {
  const { data } = await db
    .from("price_imports")
    .select("id, supplier_id, kind, source_name, effective_date, status, matched, unmatched, changed, applied_at, discarded_at, created_at")
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as PriceImport[];
}

/** Would applying this line move a cost, and is it safe to do unattended? */
export function isSafeToApply(l: ImportLine): boolean {
  const raw = l.raw ?? {};
  return (
    l.match_kind === "exact" &&
    l.product_id != null &&
    l.new_cost != null &&
    l.new_cost !== l.old_cost &&
    raw.uom_mismatch !== true &&
    raw.list_price !== true
  );
}

/** How big a jump this is, as a fraction (0.25 = 25% up). Null if unknowable. */
export function costSwing(l: ImportLine): number | null {
  if (l.old_cost == null || l.new_cost == null || l.old_cost === 0) return null;
  return (l.new_cost - l.old_cost) / l.old_cost;
}

export interface ApplyResult {
  applied: number;
  error: string | null;
}

/**
 * Write the accepted lines onto the products — the ONLY place a feed changes a
 * cost, and every change is logged to product_price_history first.
 */
export async function applyPriceImport(
  db: DB,
  importId: string,
  lineIds: string[],
  appliedBy: string | null,
  supplierName: string,
): Promise<ApplyResult> {
  const { data: imp } = await db
    .from("price_imports")
    .select("id, status")
    .eq("id", importId)
    .maybeSingle();
  if (!imp) return { applied: 0, error: "That import no longer exists." };
  // Money moves once. Re-posting the form must not double-apply.
  if (imp.status === "applied") return { applied: 0, error: "This import has already been applied." };
  if (imp.status === "discarded") return { applied: 0, error: "This import was discarded." };
  if (!lineIds.length) return { applied: 0, error: "No lines were selected." };

  const { data: lines } = await db
    .from("price_import_lines")
    .select("id, product_id, old_cost, new_cost")
    .eq("import_id", importId)
    .in("id", lineIds.slice(0, 5000));

  const usable = ((lines ?? []) as ImportLine[]).filter(
    (l) => l.product_id && l.new_cost != null,
  );
  if (!usable.length) return { applied: 0, error: "None of the selected lines could be applied." };

  let applied = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < usable.length; i += 25) {
    const batch = usable.slice(i, i + 25);
    await Promise.all(
      batch.map(async (l) => {
        // History FIRST: if the update fails we would rather have a record of
        // an attempt than a changed price nobody can explain.
        await db.from("product_price_history").insert({
          product_id: l.product_id,
          old_cost: l.old_cost,
          new_cost: l.new_cost,
          source: supplierName || "import",
          import_id: importId,
          changed_by: appliedBy,
        });
        const { error } = await db
          .from("products")
          .update({ material_rate: l.new_cost, updated_at: now })
          .eq("id", l.product_id as string);
        if (!error) {
          applied++;
          await db.from("price_import_lines").update({ applied: true }).eq("id", l.id);
        }
      }),
    );
  }

  await db
    .from("price_imports")
    .update({
      status: "applied",
      applied_at: now,
      applied_by: appliedBy,
      changed: applied,
    })
    .eq("id", importId);

  return { applied, error: null };
}

/** Reject an import outright. Kept, not deleted — a rejection is information. */
export async function discardPriceImport(
  db: DB,
  importId: string,
  by: string | null,
): Promise<{ error: string | null }> {
  const { error } = await db
    .from("price_imports")
    .update({ status: "discarded", discarded_at: new Date().toISOString(), discarded_by: by })
    .eq("id", importId)
    .eq("status", "draft");
  return { error: error?.message ?? null };
}

/** Active feeds whose cadence says they're due for a pull. */
export async function feedsDue(db: DB): Promise<(SupplierFeed & { supplier_name: string })[]> {
  const { data } = await db
    .from("supplier_feeds")
    .select(`${FEED_COLUMNS}, suppliers ( name )`)
    .eq("active", true)
    .eq("kind", "fcb2b_rest");
  const out: (SupplierFeed & { supplier_name: string })[] = [];
  for (const row of (data ?? []) as unknown as (SupplierFeed & { suppliers: { name: string } | null })[]) {
    const cadence = row.cadence_days ?? 0;
    if (cadence <= 0) continue; // no cadence = pull by hand only
    if (row.last_success_at) {
      const days = (Date.now() - new Date(row.last_success_at).getTime()) / 86400000;
      if (days < cadence) continue;
    }
    out.push({ ...row, supplier_name: row.suppliers?.name ?? "Supplier" });
  }
  return out;
}
