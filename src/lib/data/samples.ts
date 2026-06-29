import { createClient } from "@/lib/supabase/server";
import type { SampleCheckout } from "@/lib/types";

const SELECT = "*, items:sample_checkout_items(*)";

function normalize(rows: unknown[]): SampleCheckout[] {
  return (rows as SampleCheckout[]).map((c) => ({
    ...c,
    items: (c.items ?? []).sort((a, b) =>
      a.created_at < b.created_at ? -1 : 1,
    ),
  }));
}

/** A customer's sample checkouts (active first, then most recent). Defensive:
 *  returns [] if the table isn't there yet (migration 0052 not run). */
export async function listCustomerCheckouts(
  customerId: string,
): Promise<SampleCheckout[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sample_checkouts")
      .select(SELECT)
      .eq("customer_id", customerId)
      .order("checked_out_at", { ascending: false });
    if (error) return [];
    const list = normalize(data ?? []);
    // Out first (due soonest), then returned/lost by recency.
    return list.sort((a, b) => {
      const aOpen = a.status === "out" ? 0 : 1;
      const bOpen = b.status === "out" ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      if (aOpen === 0) return a.due_date < b.due_date ? -1 : 1;
      return a.checked_out_at < b.checked_out_at ? 1 : -1;
    });
  } catch {
    return [];
  }
}

/** Every checkout still out — for the staff Samples board + reminders. */
export async function listOutstandingCheckouts(): Promise<SampleCheckout[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sample_checkouts")
      .select(`${SELECT}, customer:customers(full_name)`)
      .eq("status", "out")
      .order("due_date", { ascending: true });
    if (error) return [];
    return normalize(data ?? []).map((c) => ({
      ...c,
      customer_name:
        (c as { customer?: { full_name: string | null } | null }).customer
          ?.full_name ?? null,
    }));
  } catch {
    return [];
  }
}
