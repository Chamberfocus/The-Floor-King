import { createClient } from "@/lib/supabase/server";
import type { LeadSource } from "@/lib/types";

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
