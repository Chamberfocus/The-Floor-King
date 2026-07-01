import { createClient } from "@/lib/supabase/server";
import type { ServiceAddress } from "@/lib/types";

/**
 * Additional service addresses for an account (property managers / commercial
 * clients with several properties). Defensive: returns [] if the table isn't
 * there yet (migration 0058 not run), so pages never crash.
 */
export async function listServiceAddresses(
  customerId: string,
): Promise<ServiceAddress[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("service_addresses")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: true });
    if (error) return [];
    return (data ?? []) as ServiceAddress[];
  } catch {
    return [];
  }
}

export async function getServiceAddress(
  id: string,
): Promise<ServiceAddress | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("service_addresses")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return (data as ServiceAddress) ?? null;
  } catch {
    return null;
  }
}
