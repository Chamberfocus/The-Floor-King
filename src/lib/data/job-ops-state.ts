/**
 * Load signals + assessJobOperationalState for one job.
 */
import { isMaterialLine } from "@/lib/job-scope";
import { loadOperationalJobLines } from "@/lib/data/job-operational-lines";
import { getJobOpenBalance } from "@/lib/data/invoices";
import {
  getActiveJobHold,
  listOpenServiceCallbacksForJob,
} from "@/lib/data/ops-glue";
import { createClient } from "@/lib/supabase/server";
import {
  assessJobOperationalState,
  type JobOperationalState,
} from "@/lib/job-operational-state";
import { computeLineCoverage } from "@/lib/po-coverage";
import { loadJobCoverageItems } from "@/lib/data/job-purchasing";
import { lineOrderQty } from "@/lib/estimate-calc";
import type { CalcLine } from "@/lib/estimate-calc";

export async function getJobOperationalStateForJob(
  job: {
    id: string;
    status: string;
    scheduled_date: string | null;
    warehouse_ready_at?: string | null;
    estimate_id?: string | null;
  },
): Promise<{
  state: JobOperationalState;
  activeHoldId: string | null;
}> {
  const supabase = await createClient();
  const lines = await loadOperationalJobLines(supabase, job.id);
  const hasMaterialNeed = lines.some((l) => isMaterialLine(l));

  let hasPurchasingGap = false;
  try {
    const coverageItems = await loadJobCoverageItems(
      supabase,
      job.id,
      job.estimate_id ?? null,
    );
    for (const l of lines) {
      if (!isMaterialLine(l)) continue;
      const src = (l as { source?: string | null }).source;
      if (src === "stock") continue;
      const need = lineOrderQty(l as CalcLine);
      if (need <= 0) continue;
      const cov = computeLineCoverage(l.id, need, coverageItems);
      if (cov.gap > 0.005) {
        hasPurchasingGap = true;
        break;
      }
    }
  } catch {
    // Fail closed: unknown coverage must not look "ready to schedule".
    hasPurchasingGap = true;
  }

  const [hold, callbacks, openBal] = await Promise.all([
    getActiveJobHold(job.id).catch(() => null),
    listOpenServiceCallbacksForJob(job.id).catch(() => []),
    getJobOpenBalance(job.id).catch(() => ({ balance: 0 })),
  ]);

  const state = assessJobOperationalState({
    status: job.status,
    scheduledDate: job.scheduled_date,
    warehouseReadyAt: job.warehouse_ready_at,
    hasMaterialNeed,
    activeHold: hold
      ? { reason: hold.reason, category: hold.category }
      : null,
    openBalance: openBal.balance,
    hasPurchasingGap,
    hasOpenServiceCallback: callbacks.length > 0,
  });

  return { state, activeHoldId: hold?.id ?? null };
}
