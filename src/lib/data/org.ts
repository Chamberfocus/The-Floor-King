import { createClient } from "@/lib/supabase/server";
import { COMPANY_NAME } from "@/lib/nav";
import type { OrgSettings } from "@/lib/types";

const DEFAULTS: OrgSettings = {
  id: "default",
  company_name: COMPANY_NAME,
  logo_url: null,
  primary_color: null,
  phone: null,
  email: null,
  address: null,
  website: null,
  financing_url: null,
  google_review_url: null,
  fuel_surcharge_pct: 0,
  freight_markup_pct: 0,
  quote_valid_days: 30,
  freight_disclaimer: null,
  updated_at: "",
};

export async function getOrgSettings(): Promise<OrgSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("org_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  return { ...DEFAULTS, ...(data ?? {}) } as OrgSettings;
}
