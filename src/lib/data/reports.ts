import { createClient } from "@/lib/supabase/server";
import { listAllEstimates } from "@/lib/data/estimates";
import { getProfileNames } from "@/lib/data/customers";
import { optionTotals } from "@/lib/estimate-calc";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@/lib/types";

export interface LeadSourceRow {
  source: LeadSource | "unknown";
  leads: number;
  won: number;
}

export interface LeadSourceReport {
  rows: LeadSourceRow[];
  totalLeads: number;
  totalWon: number;
}

export async function getLeadSourceReport(
  startISO: string,
  endISO: string,
): Promise<LeadSourceReport> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("source, stage, created_at")
    .is("cancelled_at", null)
    .gte("created_at", startISO)
    .lte("created_at", endISO);
  const customers = (data ?? []) as {
    source: LeadSource | null;
    stage: string;
  }[];

  const map = new Map<string, { leads: number; won: number }>();
  for (const c of customers) {
    const key = c.source ?? "unknown";
    const entry = map.get(key) ?? { leads: 0, won: 0 };
    entry.leads += 1;
    if (c.stage === "won") entry.won += 1;
    map.set(key, entry);
  }

  const rows: LeadSourceRow[] = [...map.entries()]
    .map(([source, v]) => ({ source: source as LeadSourceRow["source"], ...v }))
    .sort((a, b) => b.leads - a.leads);

  return {
    rows,
    totalLeads: customers.length,
    totalWon: customers.filter((c) => c.stage === "won").length,
  };
}

// ---- Win / Loss tracker (quoted deals: approved = won, declined = lost) ----

export interface WinLossDeal {
  estimateId: string;
  title: string;
  customer: string | null;
  salesman: string | null;
  source: string;
  value: number;
  decidedAt: string | null;
  reason: string | null;
}
export interface WinLossGroup {
  key: string;
  label: string;
  won: number;
  lost: number;
  winRate: number; // won / (won + lost)
  wonValue: number;
  lostValue: number;
}
export interface WinLossReport {
  won: number;
  lost: number;
  open: number; // still out (sent / changes requested) — current snapshot
  winRate: number;
  wonValue: number;
  lostValue: number;
  openValue: number;
  bySalesman: WinLossGroup[];
  bySource: WinLossGroup[];
  lostDeals: WinLossDeal[];
}

/**
 * Win/loss across quoted deals: an approved estimate is won, a declined one is
 * lost. Won/lost are filtered by decision date (the estimate's last update);
 * "open" is a live snapshot of quotes still on the table. Broken down by the
 * salesperson who quoted it and by lead source, with lost reasons for the why.
 */
export async function getWinLossReport(
  start?: string,
  end?: string,
): Promise<WinLossReport> {
  const supabase = await createClient();
  const estimates = await listAllEstimates();

  const custIds = [...new Set(estimates.map((e) => e.customer_id))];
  const sourceById = new Map<string, LeadSource | null>();
  const cancelled = new Set<string>();
  if (custIds.length) {
    const { data } = await supabase
      .from("customers")
      .select("id, source, cancelled_at")
      .in("id", custIds);
    for (const c of data ?? []) {
      sourceById.set(c.id as string, (c.source as LeadSource | null) ?? null);
      if (c.cancelled_at) cancelled.add(c.id as string);
    }
  }
  const names = await getProfileNames(
    estimates.map((e) => e.created_by).filter(Boolean) as string[],
  );

  const inRange = (iso: string | null | undefined) => {
    if (!start && !end) return true;
    if (!iso) return false;
    const d = iso.slice(0, 10);
    return (!start || d >= start) && (!end || d <= end);
  };
  const dealValue = (e: (typeof estimates)[number]) => {
    const opts = e.options ?? [];
    const opt =
      (e.accepted_option_id && opts.find((o) => o.id === e.accepted_option_id)) ||
      opts[0];
    return opt ? optionTotals(opt.line_items ?? [], e.tax_rate).total : 0;
  };

  let won = 0, lost = 0, open = 0, wonValue = 0, lostValue = 0, openValue = 0;
  const bySalesman = new Map<string, WinLossGroup>();
  const bySource = new Map<string, WinLossGroup>();
  const lostDeals: WinLossDeal[] = [];

  const bump = (
    map: Map<string, WinLossGroup>,
    key: string,
    label: string,
    outcome: "won" | "lost",
    v: number,
  ) => {
    const g =
      map.get(key) ??
      { key, label, won: 0, lost: 0, winRate: 0, wonValue: 0, lostValue: 0 };
    if (outcome === "won") { g.won += 1; g.wonValue += v; }
    else { g.lost += 1; g.lostValue += v; }
    map.set(key, g);
  };

  for (const e of estimates) {
    if (cancelled.has(e.customer_id)) continue;
    const v = dealValue(e);
    const salesId = e.created_by ?? null;
    const salesman = salesId ? (names[salesId] ?? null) : null;
    const src = sourceById.get(e.customer_id) ?? null;
    const sourceLabel = src ? LEAD_SOURCE_LABELS[src] : "Unknown";

    if (e.status === "approved" || e.status === "declined") {
      if (!inRange(e.updated_at)) continue;
      const outcome = e.status === "approved" ? "won" : "lost";
      if (outcome === "won") { won += 1; wonValue += v; }
      else {
        lost += 1; lostValue += v;
        lostDeals.push({
          estimateId: e.id,
          title: e.title ?? "Estimate",
          customer: e.customer_name,
          salesman,
          source: sourceLabel,
          value: v,
          decidedAt: e.updated_at ?? null,
          reason: e.customer_response_note ?? null,
        });
      }
      bump(bySalesman, salesId ?? "none", salesman ?? "Unattributed", outcome, v);
      bump(bySource, sourceLabel, sourceLabel, outcome, v);
    } else if (e.status === "sent" || e.status === "changes_requested") {
      open += 1; openValue += v;
    }
  }

  const finalize = (map: Map<string, WinLossGroup>) =>
    [...map.values()]
      .map((g) => ({
        ...g,
        winRate: g.won + g.lost > 0 ? (g.won / (g.won + g.lost)) * 100 : 0,
      }))
      .sort((a, b) => b.won + b.lost - (a.won + a.lost));

  lostDeals.sort((a, b) => b.value - a.value);
  return {
    won,
    lost,
    open,
    winRate: won + lost > 0 ? (won / (won + lost)) * 100 : 0,
    wonValue,
    lostValue,
    openValue,
    bySalesman: finalize(bySalesman),
    bySource: finalize(bySource),
    lostDeals,
  };
}
