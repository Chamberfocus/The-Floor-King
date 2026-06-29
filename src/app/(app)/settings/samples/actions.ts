"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";

function int(v: FormDataEntryValue | null, fallback: number): number {
  const n = parseInt(typeof v === "string" ? v : "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function money(v: FormDataEntryValue | null): number {
  const n = parseFloat(typeof v === "string" ? v.replace(/[^0-9.]/g, "") : "");
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function saveSampleSettings(
  formData: FormData,
): Promise<{ error: string | null }> {
  await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("business_settings")
    .update({
      sample_loan_days: int(formData.get("loan_days"), 14),
      sample_reminder_lead_days: int(formData.get("lead_days"), 2),
      sample_default_deposit: money(formData.get("deposit")),
      sample_max_out: int(formData.get("max_out"), 0),
    })
    .eq("id", "default");
  if (error) return { error: error.message };
  revalidatePath("/settings/samples");
  return { error: null };
}
