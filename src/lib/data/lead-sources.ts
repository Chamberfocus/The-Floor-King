import "server-only";
import { createClient } from "@/lib/supabase/server";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";
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

// ---- Source ROI report ----------------------------------------------------

export interface SourceRoiRow {
  sourceId: string | null;
  sourceLabel: string;
  detailId: string | null;
  detailLabel: string | null;
  leads: number;
  jobs: number; // approved estimates (won jobs)
  converted: number; // distinct customers that became a job
  revenue: number; // approved-estimate value
  spend: number;
}
export interface ReferrerRow {
  name: string;
  leads: number;
  jobs: number;
  revenue: number;
}

/**
 * How people heard about us AND what it's worth, by source and sub-detail —
 * real leads (customers created in range), jobs (approved estimates), revenue
 * (approved-estimate totals), plus ad-spend for ROI. Returns empty if the
 * lead-source tables aren't set up yet.
 */
export async function getSourceRoiReport(
  startISO: string,
  endISO: string,
): Promise<{
  rows: SourceRoiRow[];
  referrers: ReferrerRow[];
  totals: { leads: number; jobs: number; converted: number; revenue: number; spend: number };
}> {
  const empty = { rows: [], referrers: [], totals: { leads: 0, jobs: 0, converted: 0, revenue: 0, spend: 0 } };
  try {
    const supabase = await createClient();
    const { data: custData, error } = await supabase
      .from("customers")
      .select("id, source_id, source_detail_id, source_detail_text, referred_by_customer_id, full_name, created_at")
      .is("cancelled_at", null)
      .gte("created_at", startISO)
      .lte("created_at", endISO);
    if (error) return empty;
    const customers = custData ?? [];
    const custIds = customers.map((c) => c.id as string);

    // Approved estimates → job count + revenue per customer. Fetch estimates and
    // their options separately: estimates has TWO FKs to estimate_options
    // (estimate_id + accepted_option_id), so a nested embed is ambiguous.
    const byCust = new Map<string, { count: number; revenue: number }>();
    if (custIds.length) {
      const { data: ests } = await supabase
        .from("estimates")
        .select("id, customer_id, tax_rate, discount_kind, discount_value, accepted_option_id")
        .eq("status", "approved")
        .in("customer_id", custIds);
      const estimates = ests ?? [];
      const estIds = estimates.map((e) => e.id as string);
      // Options (with their line items) for those estimates, in one query.
      const optsByEst = new Map<string, { id: string; line_items: unknown[] }[]>();
      if (estIds.length) {
        const { data: opts } = await supabase
          .from("estimate_options")
          .select("id, estimate_id, line_items:estimate_line_items(*)")
          .in("estimate_id", estIds);
        for (const o of opts ?? []) {
          const arr = optsByEst.get(o.estimate_id as string) ?? [];
          arr.push({ id: o.id as string, line_items: (o.line_items as unknown[]) ?? [] });
          optsByEst.set(o.estimate_id as string, arr);
        }
      }
      for (const e of estimates) {
        const opts = optsByEst.get(e.id as string) ?? [];
        const opt = opts.find((o) => o.id === (e.accepted_option_id as string)) ?? opts[0];
        const total = opt
          ? optionTotalsWithDiscount(
              opt.line_items as never,
              e.tax_rate as number,
              e.discount_kind as string,
              e.discount_value as number,
            ).total
          : 0;
        const cur = byCust.get(e.customer_id as string) ?? { count: 0, revenue: 0 };
        cur.count += 1;
        cur.revenue += total;
        byCust.set(e.customer_id as string, cur);
      }
    }

    const sources = await listLeadSources();
    const srcLabel = (id: string | null) =>
      id ? sources.find((s) => s.id === id)?.label ?? "Unknown" : "Not recorded";
    const detLabel = (sid: string | null, did: string | null) =>
      did ? sources.find((s) => s.id === sid)?.details?.find((d) => d.id === did)?.label ?? null : null;

    // Referrer names for any linked-customer referrals (may be outside the range).
    const refIds = customers.map((c) => c.referred_by_customer_id).filter(Boolean) as string[];
    const refNames = new Map<string, string>();
    if (refIds.length) {
      const { data } = await supabase.from("customers").select("id, full_name").in("id", refIds);
      for (const r of data ?? []) refNames.set(r.id as string, (r.full_name as string) ?? "");
    }

    const key = (sid: string | null, did: string | null) => `${sid ?? "none"}|${did ?? "none"}`;
    const map = new Map<string, SourceRoiRow>();
    const refMap = new Map<string, ReferrerRow>();
    for (const c of customers) {
      const k = key(c.source_id as string | null, c.source_detail_id as string | null);
      let row = map.get(k);
      if (!row) {
        row = {
          sourceId: (c.source_id as string) ?? null,
          sourceLabel: srcLabel((c.source_id as string) ?? null),
          detailId: (c.source_detail_id as string) ?? null,
          detailLabel: detLabel((c.source_id as string) ?? null, (c.source_detail_id as string) ?? null),
          leads: 0, jobs: 0, converted: 0, revenue: 0, spend: 0,
        };
        map.set(k, row);
      }
      row.leads += 1;
      const est = byCust.get(c.id as string);
      if (est && est.count > 0) {
        row.jobs += est.count;
        row.converted += 1;
        row.revenue += est.revenue;
      }
      // Referrer breakdown for referral-mode sources.
      const src = sources.find((s) => s.id === c.source_id);
      if (src?.detail_mode === "referrer") {
        const name =
          (c.referred_by_customer_id && refNames.get(c.referred_by_customer_id as string)) ||
          (c.source_detail_text as string)?.trim() ||
          "Unknown referrer";
        let rr = refMap.get(name);
        if (!rr) { rr = { name, leads: 0, jobs: 0, revenue: 0 }; refMap.set(name, rr); }
        rr.leads += 1;
        if (est) { rr.jobs += est.count; rr.revenue += est.revenue; }
      }
    }

    // Ad spend for months overlapping the range.
    const spend = await listLeadSourceSpend();
    const startM = startISO.slice(0, 7);
    const endM = endISO.slice(0, 7);
    for (const sp of spend) {
      if (sp.period < startM || sp.period > endM) continue;
      const k = key(sp.source_id, sp.detail_id);
      const row = map.get(k);
      if (row) row.spend += sp.amount;
      else
        map.set(k, {
          sourceId: sp.source_id,
          sourceLabel: srcLabel(sp.source_id),
          detailId: sp.detail_id,
          detailLabel: detLabel(sp.source_id, sp.detail_id),
          leads: 0, jobs: 0, converted: 0, revenue: 0, spend: sp.amount,
        });
    }

    const rows = [...map.values()].sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
    const referrers = [...refMap.values()].sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
    const totals = rows.reduce(
      (t, r) => ({ leads: t.leads + r.leads, jobs: t.jobs + r.jobs, converted: t.converted + r.converted, revenue: t.revenue + r.revenue, spend: t.spend + r.spend }),
      { leads: 0, jobs: 0, converted: 0, revenue: 0, spend: 0 },
    );
    return { rows, referrers, totals };
  } catch {
    return empty;
  }
}
