import { createClient } from "@/lib/supabase/server";
import type { Supplier } from "@/lib/types";

export async function listSuppliers(): Promise<Supplier[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("*")
    .order("name", { ascending: true });
  return (data ?? []) as Supplier[];
}
