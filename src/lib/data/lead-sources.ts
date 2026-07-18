import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LeadSourceRow, LeadSourceDetailOption, LeadSourceSpendRow } from "@/lib/types";

/**
 * The manageable "How did you hear about us?" sources with their drill-down
 * sub-detail options. Returns [] if the tables aren't set up yet (0112), so the
 * app never breaks before the migration is run.
 */
export async function listLeadSources(
  opts: { activeOnly?: boolean } = {},
): Promise<LeadSourceRow[]> {
  try {
    const supabase = await createClient();
    let sq = supabase.from("lead_sources").select("*").order("position");
    if (opts.activeOnly) sq = sq.eq("active", true);
    const { data: sources, error } = await sq;
    if (error || !sources) return [];
    const ids = sources.map((s) => s.id as string);
    let details: LeadSourceDetailOption[] = [];
    if (ids.length) {
      let dq = supabase.from("lead_source_details").select("*").in("source_id", ids).order("position");
      if (opts.activeOnly) dq = dq.eq("active", true);
      const { data } = await dq;
      details = (data ?? []) as LeadSourceDetailOption[];
    }
    return (sources as LeadSourceRow[]).map((s) => ({
      ...s,
      details: details.filter((d) => d.source_id === s.id),
    }));
  } catch {
    return [];
  }
}

/** Ad spend rows (source / sub-detail / month) for the ROI report + Settings. */
export async function listLeadSourceSpend(): Promise<LeadSourceSpendRow[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("lead_source_spend").select("*");
    return (data ?? []).map((r) => ({
      id: r.id as string,
      source_id: r.source_id as string,
      detail_id: (r.detail_id as string) ?? null,
      period: r.period as string,
      amount: Number(r.amount) || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Whether a customer's lead source (and its required sub-detail) is filled in —
 * used to block estimate creation and drive the inline prompt.
 */
export async function getCustomerSourceStatus(customerId: string): Promise<{
  ok: boolean;
  hasSource: boolean;
}> {
  if (!customerId) return { ok: false, hasSource: false };
  try {
    const supabase = await createClient();
    const { data: cust } = await supabase
      .from("customers")
      .select("source_id, source_detail_id, source_detail_text, referred_by_customer_id")
      .eq("id", customerId)
      .maybeSingle();
    if (!cust?.source_id) return { ok: false, hasSource: false };
    const { data: src } = await supabase
      .from("lead_sources")
      .select("detail_mode, detail_required")
      .eq("id", cust.source_id)
      .maybeSingle();
    if (!src?.detail_required) return { ok: true, hasSource: true };
    const detailFilled =
      src.detail_mode === "referrer"
        ? !!(cust.source_detail_text?.trim() || cust.referred_by_customer_id)
        : !!(cust.source_detail_id || cust.source_detail_text?.trim());
    return { ok: detailFilled, hasSource: true };
  } catch {
    // Tables not set up yet → don't block (fall back to legacy behavior).
    return { ok: true, hasSource: true };
  }
}
