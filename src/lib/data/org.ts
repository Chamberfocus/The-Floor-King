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
