"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function num(v: FormDataEntryValue | null): number {
  const s = typeof v === "string" ? v.replace(/[^0-9.]/g, "") : "";
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export interface TargetsState {
  error: string | null;
  ok?: boolean;
}

export async function saveTargets(
  _prev: TargetsState,
  formData: FormData,
): Promise<TargetsState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("business_settings")
    .upsert(
      {
        id: "default",
        target_gross_margin_pct: num(formData.get("target_gross_margin_pct")),
        monthly_revenue_goal: num(formData.get("monthly_revenue_goal")),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (error) return { error: error.message };
  revalidatePath("/settings/targets");
  revalidatePath("/pulse");
  return { error: null, ok: true };
}
