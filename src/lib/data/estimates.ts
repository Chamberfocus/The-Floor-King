import { createClient } from "@/lib/supabase/server";
import type {
  Estimate,
  EstimateLineItem,
  EstimateOption,
} from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** The name of the staff member who created a record — for the "Estimator" line
 *  on a printed estimate. Returns null when unknown. */
export async function getEstimatorName(
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return (data?.full_name as string | null) ?? null;
}

/** Loads options + line items for the given estimates and attaches them. */
async function attachOptions(
  supabase: SupabaseServerClient,
  estimates: Estimate[],
): Promise<Estimate[]> {
  if (!estimates.length) return estimates;

  const estimateIds = estimates.map((e) => e.id);
  const { data: optionData } = await supabase
    .from("estimate_options")
    .select("*")
    .in("estimate_id", estimateIds)
    .order("position", { ascending: true });
  const options = (optionData ?? []) as EstimateOption[];

  const optionIds = options.map((o) => o.id);
  let lines: EstimateLineItem[] = [];
  if (optionIds.length) {
    const { data: lineData } = await supabase
      .from("estimate_line_items")
      .select("*")
      .in("option_id", optionIds)
      .order("position", { ascending: true });
    lines = (lineData ?? []) as EstimateLineItem[];
  }

  const linesByOption = new Map<string, EstimateLineItem[]>();
  for (const line of lines) {
    const arr = linesByOption.get(line.option_id) ?? [];
    arr.push(line);
    linesByOption.set(line.option_id, arr);
  }
  for (const option of options) {
    option.line_items = linesByOption.get(option.id) ?? [];
  }

  const optionsByEstimate = new Map<string, EstimateOption[]>();
  for (const option of options) {
    const arr = optionsByEstimate.get(option.estimate_id) ?? [];
    arr.push(option);
    optionsByEstimate.set(option.estimate_id, arr);
  }
  for (const estimate of estimates) {
    estimate.options = optionsByEstimate.get(estimate.id) ?? [];
  }

  return estimates;
}

export async function getEstimate(id: string): Promise<Estimate | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [withOptions] = await attachOptions(supabase, [data as Estimate]);
  return withOptions;
}

export async function listEstimatesForCustomer(
  customerId: string,
): Promise<Estimate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return attachOptions(supabase, (data ?? []) as Estimate[]);
}

export interface EstimateListRow extends Estimate {
  customer_name: string | null;
}

export async function listAllEstimates(): Promise<EstimateListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("*, customer:customers(full_name)")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as (Estimate & {
    customer?: { full_name: string | null } | null;
  })[];
  const estimates: EstimateListRow[] = rows.map((r) => ({
    ...r,
    customer_name: r.customer?.full_name ?? null,
  }));
  await attachOptions(supabase, estimates);
  return estimates;
}

/**
 * Distinct colors and manufacturers already used on estimate lines and in the
 * catalog. Carpet price lists rarely list every color, so colors are typed per
 * line — these power an autocomplete that grows as you quote, so you build up a
 * color vocabulary instead of retyping.
 */
export async function listLineSuggestions(): Promise<{
  colors: string[];
  manufacturers: string[];
}> {
  const supabase = await createClient();
  const colors = new Set<string>();
  const manufacturers = new Set<string>();
  const collect = (
    rows: { color?: string | null; manufacturer?: string | null }[] | null,
  ) => {
    for (const r of rows ?? []) {
      const c = (r.color ?? "").trim();
      if (c) colors.add(c);
      const m = (r.manufacturer ?? "").trim();
      if (m) manufacturers.add(m);
    }
  };
  const [{ data: lines }, { data: prods }] = await Promise.all([
    supabase
      .from("estimate_line_items")
      .select("color, manufacturer")
      .limit(5000),
    supabase.from("products").select("color, manufacturer").limit(5000),
  ]);
  collect(lines as { color?: string | null; manufacturer?: string | null }[]);
  collect(prods as { color?: string | null; manufacturer?: string | null }[]);
  const sort = (s: Set<string>) =>
    [...s].sort((a, b) => a.localeCompare(b));
  return { colors: sort(colors), manufacturers: sort(manufacturers) };
}
