import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

export interface TeamMember {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  role: UserRole;
  home_address: string | null;
  phone: string | null;
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, title, role, home_address, phone")
    .in("role", [
      "admin",
      "office",
      "sales_manager",
      "salesman",
      "scheduler",
      "crew",
      "warehouse",
    ])
    .order("role", { ascending: true })
    .order("full_name", { ascending: true });
  return (data ?? []) as TeamMember[];
}
