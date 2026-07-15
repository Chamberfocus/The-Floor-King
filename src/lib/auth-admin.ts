import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

/**
 * Admin-only helpers for provisioning logins. This is the SINGLE place a staff
 * or installer login is created, so the team-invite form and the crew form can't
 * drift apart (same validation, same phone-uniqueness, same placeholder email
 * for phone-only crew). Server-only — it uses the Supabase service-role key.
 */

/** Phone → digits only, dropping a leading US country code. */
export function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

export interface CreateLoginInput {
  email?: string | null;
  phone?: string | null;
  password: string; // the PIN (min 6)
  fullName?: string | null;
  role: UserRole;
  title?: string | null;
  homeAddress?: string | null;
}

/**
 * Create an auth login + its profile. A profile row is created by the
 * on_auth_user_created trigger (role read from user_metadata); we then set the
 * remaining profile fields. Returns the new user id, or a human error.
 */
export async function createLogin(
  input: CreateLoginInput,
): Promise<{ userId: string | null; error: string | null }> {
  const email = (input.email ?? "").trim().toLowerCase();
  const phone = normalizePhone(input.phone ?? "");
  const password = input.password ?? "";

  if (!email && !phone)
    return { userId: null, error: "Enter an email or a phone number for the login." };
  if (phone && phone.length < 10)
    return { userId: null, error: "Enter a valid 10-digit phone number." };
  if (password.length < 6)
    return { userId: null, error: "The PIN / password must be at least 6 characters." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { userId: null, error: "Creating logins needs the Supabase secret key on the server." };
  }

  // Phone must be unique so phone login is unambiguous.
  if (phone) {
    const { data: dupe } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (dupe) return { userId: null, error: "That phone number already has a login." };
  }

  // Supabase auth needs an email. For a phone-only crew, mint a private
  // placeholder so the account can exist; they still sign in with phone + PIN.
  const authEmail = email || `p${phone}@crew.floorking.local`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName || null, role: input.role },
  });
  if (error || !created.user) {
    return { userId: null, error: error?.message ?? "Could not create the login." };
  }

  await admin
    .from("profiles")
    .update({
      role: input.role,
      full_name: input.fullName || null,
      phone: phone || null,
      title: input.title || null,
      home_address: input.homeAddress || null,
    })
    .eq("id", created.user.id);

  return { userId: created.user.id, error: null };
}

/** Set or reset an existing login's PIN (and optionally its phone). */
export async function resetLoginPin(
  userId: string,
  pin: string,
  phone?: string | null,
): Promise<{ error: string | null }> {
  if (!userId || (pin ?? "").length < 6)
    return { error: "The PIN must be at least 6 characters." };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Creating logins needs the Supabase secret key on the server." };
  }
  const ph = phone != null ? normalizePhone(phone) : null;
  if (ph) {
    const { data: dupe } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", ph)
      .neq("id", userId)
      .maybeSingle();
    if (dupe) return { error: "That phone number already has a login." };
  }
  const { error } = await admin.auth.admin.updateUserById(userId, { password: pin });
  if (error) return { error: error.message };
  if (ph) await admin.from("profiles").update({ phone: ph }).eq("id", userId);
  return { error: null };
}
