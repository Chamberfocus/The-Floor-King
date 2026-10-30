/**
 * Loads the bill add for one estimate. The customer portal cannot read
 * business settings under its own session, so this uses the service role.
 * Kept out of bill-recovery.ts so the builder (a client component) can
 * import the math without pulling the server client into the browser.
 */
import "server-only";
import type { BillRecoverySettings } from "@/lib/bill-recovery";

export async function loadBillSettingsForEstimate(
  estimateId: string,
): Promise<BillRecoverySettings> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { getBusinessSettings } = await import("@/lib/data/business-settings");
  try {
    const admin = createAdminClient();
    const { data: biz } = await admin
      .from("business_settings")
      .select("job_fuel_charge, job_fuel_fee, job_car_allowance, job_commission_pct")
      .eq("id", "default")
      .maybeSingle();
    const { data: est } = await admin
      .from("estimates")
      .select("commission_override_pct, commission_override_amount")
      .eq("id", estimateId)
      .maybeSingle();
    const row = (biz ?? {}) as {
      job_fuel_charge?: number | null;
      job_fuel_fee?: number | null;
      job_car_allowance?: number | null;
      job_commission_pct?: number | null;
    };
    const estRow = (est ?? {}) as {
      commission_override_pct?: number | null;
      commission_override_amount?: number | null;
    };
    return {
      fuelCharge: Number(row.job_fuel_charge) || 0,
      salespersonGas: Number(row.job_fuel_fee) || 0,
      carAllowance: Number(row.job_car_allowance) || 0,
      commissionPct: Number(row.job_commission_pct) || 0,
      commissionOverridePct: estRow.commission_override_pct ?? null,
      commissionOverrideAmount: estRow.commission_override_amount ?? null,
    };
  } catch {
    const defaults = await getBusinessSettings().catch(() => null);
    return {
      fuelCharge: defaults?.job_fuel_charge ?? 0,
      salespersonGas: defaults?.job_fuel_fee ?? 0,
      carAllowance: defaults?.job_car_allowance ?? 0,
      commissionPct: defaults?.job_commission_pct ?? 0,
    };
  }
}
