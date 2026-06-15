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
  active: boolean;
}

const STAFF_ROLES = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
  "crew",
  "warehouse",
];

export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient();
  // Try with the `active` column; if migration 0042 hasn't been run yet, fall
  // back to the older columns and treat everyone as active.
  const withActive = await supabase
    .from("profiles")
    .select("id, email, full_name, title, role, home_address, phone, active")
    .in("role", STAFF_ROLES)
    .order("role", { ascending: true })
    .order("full_name", { ascending: true });
  if (!withActive.error) {
    return (withActive.data ?? []) as TeamMember[];
  }
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, title, role, home_address, phone")
    .in("role", STAFF_ROLES)
    .order("role", { ascending: true })
    .order("full_name", { ascending: true });
  return ((data ?? []) as Omit<TeamMember, "active">[]).map((m) => ({
    ...m,
    active: true,
  }));
}
