import { createClient } from "@/lib/supabase/server";
import type { BusinessSettings } from "@/lib/types";

const DEFAULTS: BusinessSettings = {
  id: "default",
  target_gross_margin_pct: 40,
  monthly_revenue_goal: 0,
  updated_at: "",
};

export async function getBusinessSettings(): Promise<BusinessSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  return (data as BusinessSettings) ?? DEFAULTS;
}
