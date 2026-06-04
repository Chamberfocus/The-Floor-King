import { createClient } from "@/lib/supabase/server";
import {
  OPEN_STAGES,
  type Activity,
  type Customer,
  type LeadStage,
} from "@/lib/types";

/** Strip characters that would break PostgREST's `or` filter grammar. */
function sanitize(term: string) {
  return term.replace(/[,()]/g, " ").trim();
}

export async function listCustomers(
  opts: { search?: string; stage?: LeadStage; stages?: LeadStage[] } = {},
): Promise<Customer[]> {
  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("*")
    .order("updated_at", { ascending: false });

  if (opts.stage) query = query.eq("stage", opts.stage);
  if (opts.stages?.length) query = query.in("stage", opts.stages);

  const search = opts.search ? sanitize(opts.search) : "";
  if (search) {
    const like = `%${search}%`;
    query = query.or(
      [
        `full_name.ilike.${like}`,
        `company.ilike.${like}`,
        `email.ilike.${like}`,
        `phone.ilike.${like}`,
        `city.ilike.${like}`,
      ].join(","),
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Customer[];
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Customer) ?? null;
}

export async function listActivities(customerId: string): Promise<Activity[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activities")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Activity[];
}

/** Map of profile id -> display name, for showing who logged an activity. */
export async function getProfileNames(
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unique);
  const map: Record<string, string> = {};
  for (const p of data ?? []) {
    map[p.id as string] = (p.full_name as string) || (p.email as string);
  }
  return map;
}

export interface DashboardCounts {
  openLeads: number;
  quoted: number;
  wonCustomers: number;
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const supabase = await createClient();

  const countIn = async (stages: LeadStage[]) => {
    const { count } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .in("stage", stages);
    return count ?? 0;
  };

  const [openLeads, quoted, wonCustomers] = await Promise.all([
    countIn(OPEN_STAGES),
    countIn(["quoted"]),
    countIn(["won"]),
  ]);

  return { openLeads, quoted, wonCustomers };
}
