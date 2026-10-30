import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_SETTING_DEFAULTS } from "@/lib/data/business-settings";
import { jobBillRatesFromSettings, type JobBillRates } from "@/lib/job-bill";

/** Rates that get buried in a customer price. Portal pages must not name the pieces. */
export async function loadCustomerBillRates(): Promise<JobBillRates> {
  try {
    const ratesAdmin = createAdminClient();
    const { data } = await ratesAdmin
      .from("business_settings")
      .select("job_fuel_charge, job_fuel_fee, job_car_allowance, job_commission_pct")
      .eq("id", "default")
      .maybeSingle();
    return jobBillRatesFromSettings({
      ...BUSINESS_SETTING_DEFAULTS,
      ...(data ?? {}),
    });
  } catch {
    return jobBillRatesFromSettings(BUSINESS_SETTING_DEFAULTS);
  }
}
