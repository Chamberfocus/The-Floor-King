// Shared helpers for background import jobs. SERVER ONLY.
import { createAdminClient } from "@/lib/supabase/admin";
import { extractPriceList } from "@/lib/extract";
import { PRODUCT_CATEGORY_ORDER, type ProductCategory } from "@/lib/types";
import { inferUnit } from "@/lib/units";

/** Absolute base URL for the app to call its own API routes. */
export function internalBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_SITE_URL)
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  return `http://localhost:${process.env.PORT || 3000}`;
}

/** Fire the background processor for a job (fresh serverless invocation). */
export async function triggerImportProcessing(jobId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  await fetch(`${internalBaseUrl()}/api/import/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ jobId }),
  }).catch(() => {
    /* best-effort; the cron sweeper will pick up stalled jobs */
  });
}

interface RawRow {
  name?: string;
  category?: string;
  unit?: string;
  sku?: string | null;
  material_rate?: number | null;
  labor_rate?: number | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  notes?: string | null;
}

/** Insert (or update-by-name) parsed rows into products. Returns how many rows
 *  were written. Uses the same import_products RPC as the foreground importer so
 *  update-mode de-duplicates by name; falls back to a plain insert if the RPC
 *  isn't present. Optionally stamps a supplier on rows that don't have one. */
async function insertProducts(
  admin: ReturnType<typeof createAdminClient>,
  rows: RawRow[],
  opts: { update?: boolean; supplier?: string } = {},
): Promise<number> {
  const cats = new Set<string>(PRODUCT_CATEGORY_ORDER);
  const items = (rows ?? [])
    .filter((r) => r.name?.trim())
    .map((r) => ({
      name: r.name!.trim(),
      category: (cats.has(r.category ?? "")
        ? r.category
        : "other") as ProductCategory,
      unit: inferUnit(r.name, r.unit, cats.has(r.category ?? "") ? r.category : "other"),
      material_rate: Number(r.material_rate) || 0,
      labor_rate: Number(r.labor_rate) || 0,
      sku: r.sku || "",
      manufacturer: r.manufacturer || "",
      style: r.style || "",
      color: r.color || "",
      notes: r.notes || "",
    }));
  if (!items.length) return 0;

  // Preferred: bulk RPC (insert new, update existing by name when do_update).
  const { data, error } = await admin.rpc("import_products", {
    items,
    do_update: opts.update ?? false,
  });
  let count: number;
  if (
    error &&
    (error.code === "PGRST202" ||
      error.code === "42883" ||
      /import_products|function|schema cache/i.test(error.message))
  ) {
    // RPC missing → plain insert fallback.
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
    const { error: insErr } = await admin.from("products").insert(insertRows);
    if (insErr) throw new Error(insErr.message);
    count = insertRows.length;
  } else if (error) {
    throw new Error(error.message);
  } else {
    count = (data as number) ?? items.length;
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
  return count;
}

/**
 * Process a price-list import job for up to `budgetMs`, parsing one chunk (or
 * the storage file) at a time and inserting products as it goes.
 * Returns whether the job still has work left (true => caller should re-trigger).
 */
export async function processImportJobBatch(
  jobId: string,
  budgetMs = 35_000,
): Promise<{ done: boolean; busy?: boolean; error?: string }> {
  const admin = createAdminClient();
  const started = Date.now();
  const nowIso = () => new Date().toISOString();

  // Atomically CLAIM the job: take it only if it's queued, or if a prior runner
  // crashed and left it "processing" but stale (>90s). This prevents two
  // runners (e.g. two open tabs) from double-processing the same chunks.
  const staleIso = new Date(Date.now() - 90_000).toISOString();
  const { data: job } = await admin
    .from("import_jobs")
    .update({ status: "processing", updated_at: nowIso() })
    .eq("id", jobId)
    .or(`status.eq.queued,and(status.eq.processing,updated_at.lt.${staleIso})`)
    .select(
      "id, chunks, rows, do_update, supplier, processed_chunks, imported_count, total_chunks, storage_path, storage_mime",
    )
    .maybeSingle();
  if (!job) {
    // Either already done/error, or another runner holds it right now.
    const { data: cur } = await admin
      .from("import_jobs")
      .select("status")
      .eq("id", jobId)
      .maybeSingle();
    if (cur && (cur.status === "done" || cur.status === "error"))
      return { done: true };
    return { done: false, busy: true };
  }

  const chunks: string[] = Array.isArray(job.chunks) ? job.chunks : [];
  const prebuilt: RawRow[] = Array.isArray(job.rows) ? job.rows : [];
  const writeOpts = {
    update: !!job.do_update,
    supplier: (job.supplier as string | null) ?? undefined,
  };
  let processed = job.processed_chunks ?? 0;
  let imported = job.imported_count ?? 0;

  try {
    // Reviewed-rows path: products were already parsed & priced in the browser.
    // Insert them in durable batches so a large list can't time out — nothing
    // to re-extract, so this is fast and can't lose the reviewed data.
    if (prebuilt.length) {
      const BATCH = 500;
      while (processed < prebuilt.length) {
        const batch = prebuilt.slice(processed, processed + BATCH);
        imported += await insertProducts(admin, batch, writeOpts);
        processed += batch.length;
        await admin
          .from("import_jobs")
          .update({
            status: processed < prebuilt.length ? "processing" : "done",
            processed_chunks: Math.min(
              job.total_chunks || 1,
              Math.ceil(processed / BATCH),
            ),
            imported_count: imported,
            updated_at: nowIso(),
          })
          .eq("id", jobId);
      }
      return { done: true };
    }

    // Image / scanned doc path: a single extract via signed URL.
    if (job.storage_path && chunks.length === 0) {
      const { data: signed } = await admin.storage
        .from("documents")
        .createSignedUrl(job.storage_path, 600);
      if (!signed?.signedUrl) throw new Error("Couldn't open the uploaded file.");
      const rows = await extractPriceList({
        url: signed.signedUrl,
        mediaType:
          job.storage_mime ||
          (job.storage_path.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : "image/jpeg"),
      });
      imported += await insertProducts(admin, rows ?? [], writeOpts);
      await admin
        .from("import_jobs")
        .update({
          status: "done",
          processed_chunks: job.total_chunks || 1,
          imported_count: imported,
          updated_at: nowIso(),
        })
        .eq("id", jobId);
      return { done: true };
    }

    // Text path: parse chunks one at a time within the time budget.
    while (processed < chunks.length) {
      if (Date.now() - started > budgetMs && processed > (job.processed_chunks ?? 0)) {
        // Out of time this invocation — release the job back to "queued" so the
        // next nudge/cron picks it up and continues.
        await admin
          .from("import_jobs")
          .update({
            status: "queued",
            processed_chunks: processed,
            imported_count: imported,
            updated_at: nowIso(),
          })
          .eq("id", jobId);
        return { done: false };
      }
      const rows = await extractPriceList({ text: chunks[processed] });
      imported += await insertProducts(admin, rows ?? [], writeOpts);
      processed += 1;
      await admin
        .from("import_jobs")
        .update({
          status: "processing",
          processed_chunks: processed,
          imported_count: imported,
          updated_at: nowIso(),
        })
        .eq("id", jobId);
    }

    await admin
      .from("import_jobs")
      .update({
        status: "done",
        imported_count: imported,
        updated_at: nowIso(),
      })
      .eq("id", jobId);
    return { done: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed.";
    await admin
      .from("import_jobs")
      .update({
        status: "error",
        error: msg,
        processed_chunks: processed,
        imported_count: imported,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return { done: true, error: msg };
  }
}
