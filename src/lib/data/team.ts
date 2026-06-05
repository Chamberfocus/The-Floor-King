import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

export interface TeamMember {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .in("role", ["admin", "office", "crew", "warehouse"])
    .order("role", { ascending: true })
    .order("full_name", { ascending: true });
  return (data ?? []) as TeamMember[];
}
