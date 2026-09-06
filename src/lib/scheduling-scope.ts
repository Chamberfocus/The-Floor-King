/**
 * Shared operational scope for install scheduling (office + portal).
 * Prefer job_line_items; fall back to estimate option for legacy unseeded jobs.
 * Duration uses measured qty (lineQty) via installDaysForJob — never lineOrderQty.
 */
import { loadOperationalJobLines } from "@/lib/data/job-operational-lines";
import type { EstimateLineItem } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/**
 * Load lines used for install day/capacity math.
 * Seeds empty job scope once when option_id is available (same policy as materials).
 */
export async function loadSchedulingScopeLines(
  db: Db,
  jobId: string,
  optionId: string | null,
): Promise<EstimateLineItem[]> {
  return loadOperationalJobLines(db, jobId, {
    seedIfEmpty: true,
    optionId,
  });
}
