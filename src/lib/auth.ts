import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Returns the signed-in auth user, or null. Safe to call anywhere on the server. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Returns the current user's profile row (with role), or null if not signed in. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, title, role, customer_id, created_at")
    .eq("id", user.id)
    .single();

  return (data as Profile) ?? null;
}

/**
 * Use in a protected page/layout: returns the profile, or redirects to /login.
 * The proxy already guards routes, but this gives us the typed profile and a
 * second layer of safety.
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}
