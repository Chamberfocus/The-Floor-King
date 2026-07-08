import { createClient } from "@/lib/supabase/server";
import type { CustomerArea } from "@/lib/types";

/** Saved room/area measurements for a customer (ordered). [] if table missing. */
export async function listCustomerAreas(customerId: string): Promise<CustomerArea[]> {
  if (!customerId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_areas")
    .select("*")
    .eq("customer_id", customerId)
    .order("position", { ascending: true });
  if (error) return [];
  return (data ?? []) as CustomerArea[];
}
