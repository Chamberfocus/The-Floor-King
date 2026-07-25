import { createClient } from "@/lib/supabase/server";
import type { CancelReason } from "@/lib/types";

/** The manageable cancellation-reason list (Settings → Cancellation reasons). */
export async function listCancelReasons(
  opts: { activeOnly?: boolean } = {},
): Promise<CancelReason[]> {
  try {
    const supabase = await createClient();
    let q = supabase.from("cancel_reasons").select("*").order("position", { ascending: true });
    if (opts.activeOnly) q = q.eq("active", true);
    const { data } = await q;
    return (data ?? []) as CancelReason[];
  } catch {
    // Pre-migration (0126 not run yet): no list — the cancel dialog falls back
    // to a free-text reason so cancelling still works.
    return [];
  }
}
