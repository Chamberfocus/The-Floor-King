import { createClient } from "@/lib/supabase/server";

export type ImportJobStatus = "queued" | "processing" | "done" | "error";

export interface ImportJob {
  id: string;
  kind: string;
  label: string | null;
  status: ImportJobStatus;
  total_chunks: number;
  processed_chunks: number;
  imported_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const COLS =
  "id, kind, label, status, total_chunks, processed_chunks, imported_count, error, created_at, updated_at";

/** Jobs still running (for the live progress banner). */
export async function listActiveImportJobs(): Promise<ImportJob[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_jobs")
    .select(COLS)
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false });
  return (data ?? []) as ImportJob[];
}

/** Recently finished or failed jobs (shown briefly so the user sees the result). */
export async function listRecentImportJobs(
  sinceIso: string,
): Promise<ImportJob[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_jobs")
    .select(COLS)
    .in("status", ["done", "error"])
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(10);
  return (data ?? []) as ImportJob[];
}
