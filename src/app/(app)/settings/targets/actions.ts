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
  const row: Record<string, unknown> = {
    id: "default",
    target_gross_margin_pct: num(formData.get("target_gross_margin_pct")),
    monthly_revenue_goal: num(formData.get("monthly_revenue_goal")),
    job_fuel_charge: num(formData.get("job_fuel_charge")),
    job_fuel_fee: num(formData.get("job_fuel_fee")),
    job_car_allowance: num(formData.get("job_car_allowance")),
    job_commission_pct: num(formData.get("job_commission_pct")),
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase
    .from("business_settings")
    .upsert(row, { onConflict: "id" });
  // Fallback for before the fuel/car/commission columns (0130/0131/0134) are run.
  if (
    error &&
    /job_fuel_charge|job_fuel_fee|job_car_allowance|job_commission_pct/i.test(
      error.message,
    )
  ) {
    delete row.job_fuel_charge;
    delete row.job_fuel_fee;
    delete row.job_car_allowance;
    delete row.job_commission_pct;
    ({ error } = await supabase
      .from("business_settings")
      .upsert(row, { onConflict: "id" }));
  }
  if (error) return { error: error.message };
  revalidatePath("/settings/targets");
  revalidatePath("/pulse");
  return { error: null, ok: true };
}
