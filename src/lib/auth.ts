import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

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

/**
 * Page guard: require one of the given roles, else send home. Use at the top of
 * a protected page so the wrong role never sees it.
 */
export async function requireRole(roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}

/**
 * Server-ACTION guard. Server actions can be POSTed directly regardless of the
 * page, so privileged mutations must re-check the caller's role here — RLS does
 * not protect actions that use the service-role (admin) client. Throws if the
 * signed-in user isn't one of the allowed roles.
 */
export async function assertRole(roles: UserRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile || !roles.includes(profile.role)) {
    throw new Error("Not authorized.");
  }
  return profile;
}
