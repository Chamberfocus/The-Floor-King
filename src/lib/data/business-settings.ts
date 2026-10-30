import { createClient } from "@/lib/supabase/server";
import type { BusinessSettings } from "@/lib/types";

export const BUSINESS_SETTING_DEFAULTS: BusinessSettings = {
  id: "default",
  target_gross_margin_pct: 40,
  monthly_revenue_goal: 0,
  sample_loan_days: 14,
  sample_reminder_lead_days: 2,
  sample_default_deposit: 0,
  sample_max_out: 0,
  installer_collects_balance: false,
  notify_staff: true,
  notify_customers: false,
  job_fuel_charge: 60, // added to the customer bill
  job_fuel_fee: 50, // of that gas, the salesperson's share — not a cost
  job_car_allowance: 110, // added to the customer bill
  job_commission_pct: 3.5, // percent of the flooring sale, added to the bill
  updated_at: "",
};

export async function getBusinessSettings(): Promise<BusinessSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  return { ...BUSINESS_SETTING_DEFAULTS, ...((data as Partial<BusinessSettings>) ?? {}) };
}
