// Shared helpers for background import jobs. SERVER ONLY.
import { createAdminClient } from "@/lib/supabase/admin";
import { extractPriceList } from "@/lib/extract";
import { PRODUCT_CATEGORY_ORDER, type ProductCategory } from "@/lib/types";

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

/** Insert parsed rows into products. Returns how many were inserted. */
async function insertProducts(
  admin: ReturnType<typeof createAdminClient>,
  rows: RawRow[],
): Promise<number> {
  const cats = new Set<string>(PRODUCT_CATEGORY_ORDER);
  const insertRows = (rows ?? [])
    .filter((r) => r.name?.trim())
    .map((r) => ({
      name: r.name!.trim(),
      category: (cats.has(r.category ?? "")
        ? r.category
        : "other") as ProductCategory,
      unit: r.unit || "sqft",
      material_rate: Number(r.material_rate) || 0,
      labor_rate: Number(r.labor_rate) || 0,
      sku: r.sku || null,
      manufacturer: r.manufacturer || null,
      style: r.style || null,
      color: r.color || null,
      notes: r.notes || null,
    }));
  if (!insertRows.length) return 0;
  const { error } = await admin.from("products").insert(insertRows);
  if (error) throw new Error(error.message);
  return insertRows.length;
}

/**
 * Process a price-list import job for up to `budgetMs`, parsing one chunk (or
 * the storage file) at a time and inserting products as it goes.
 * Returns whether the job still has work left (true => caller should re-trigger).
 */
export async function processImportJobBatch(
  jobId: string,
  budgetMs = 40_000,
): Promise<{ done: boolean; error?: string }> {
  const admin = createAdminClient();
  const started = Date.now();

  const { data: job, error: loadErr } = await admin
    .from("import_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (loadErr || !job) return { done: true, error: "Job not found." };
  if (job.status === "done" || job.status === "error")
    return { done: true };

  await admin
    .from("import_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  const chunks: string[] = Array.isArray(job.chunks) ? job.chunks : [];
  let processed = job.processed_chunks ?? 0;
  let imported = job.imported_count ?? 0;

  try {
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
      imported += await insertProducts(admin, rows ?? []);
      await admin
        .from("import_jobs")
        .update({
          status: "done",
          processed_chunks: job.total_chunks || 1,
          imported_count: imported,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return { done: true };
    }

    // Text path: parse chunks one at a time within the time budget.
    while (processed < chunks.length) {
      if (Date.now() - started > budgetMs && processed > (job.processed_chunks ?? 0)) {
        // Out of time this invocation — save progress and ask for a re-trigger.
        await admin
          .from("import_jobs")
          .update({
            processed_chunks: processed,
            imported_count: imported,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        return { done: false };
      }
      const rows = await extractPriceList({ text: chunks[processed] });
      imported += await insertProducts(admin, rows ?? []);
      processed += 1;
      await admin
        .from("import_jobs")
        .update({
          processed_chunks: processed,
          imported_count: imported,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    await admin
      .from("import_jobs")
      .update({
        status: "done",
        imported_count: imported,
        updated_at: new Date().toISOString(),
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
