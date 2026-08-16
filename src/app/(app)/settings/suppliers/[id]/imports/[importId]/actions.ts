"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { applyPriceImport, discardPriceImport } from "@/lib/data/supplier-feeds";

export interface ApplyState {
  error: string | null;
  applied?: number;
}

/**
 * Apply the reviewed lines.
 *
 * Costs feed every estimate margin in the app, so this is deliberately the one
 * and only path that writes a supplier price onto a product — and it records
 * who did it and what the price used to be.
 */
export async function applyImport(
  supplierId: string,
  importId: string,
  lineIds: string[],
): Promise<ApplyState> {
  const profile = await assertRole(["admin", "office"]);
  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("name")
    .eq("id", supplierId)
    .maybeSingle();

  const res = await applyPriceImport(
    supabase,
    importId,
    lineIds,
    profile.id,
    (supplier?.name as string) ?? "import",
  );
  if (res.error) return { error: res.error };

  // Costs changed — anywhere that reads a product price has to catch up.
  revalidatePath(`/settings/suppliers/${supplierId}/imports/${importId}`);
  revalidatePath(`/settings/suppliers/${supplierId}/connect`);
  revalidatePath("/catalog");
  revalidatePath("/inventory");
  return { error: null, applied: res.applied };
}

export async function discardImport(
  supplierId: string,
  importId: string,
): Promise<ApplyState> {
  const profile = await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const { error } = await discardPriceImport(supabase, importId, profile.id);
  if (error) return { error };
  revalidatePath(`/settings/suppliers/${supplierId}/imports/${importId}`);
  revalidatePath(`/settings/suppliers/${supplierId}/connect`);
  return { error: null };
}
