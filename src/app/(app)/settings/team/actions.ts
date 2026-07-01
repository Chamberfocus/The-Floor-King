"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertRole, getProfile } from "@/lib/auth";
import { positionById } from "./positions";
import type { UserRole } from "@/lib/types";

export interface TeamFormState {
  error: string | null;
  ok?: boolean;
}

/** Toggle whether installers may collect the on-site balance. Admin only. */
export async function setInstallerCollects(formData: FormData): Promise<void> {
  await assertRole(["admin"]);
  const on = formData.get("on") === "true";
  const supabase = await createClient();
  await supabase
    .from("business_settings")
    .update({ installer_collects_balance: on })
    .eq("id", "default");
  revalidatePath("/settings/team");
}

const STAFF_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
  "crew",
  "warehouse",
];

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Phone → digits only, dropping a leading US country code. */
function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

export async function inviteTeamMember(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const me = await getProfile();
  if (me?.role !== "admin") {
    return { error: "Only an administrator can manage the team." };
  }
  const email = str(formData.get("email")).toLowerCase();
  const phone = normalizePhone(str(formData.get("phone")));
  const password = str(formData.get("password"));
  const fullName = str(formData.get("full_name"));
  const pos = positionById(str(formData.get("position")));
  const role: UserRole = pos?.role ?? "office";
  const title = str(formData.get("title")) || pos?.label || "";

  if (!email && !phone) {
    return { error: "Enter an email or a phone number for the login." };
  }
  if (phone && phone.length < 10) {
    return { error: "Enter a valid 10-digit phone number." };
  }
  if (password.length < 6) {
    return { error: "The PIN / password must be at least 6 characters." };
  }
  if (!pos) return { error: "Pick a position." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error: "Creating logins needs the Supabase secret key on the server.",
    };
  }

  // Phone must be unique so phone login is unambiguous.
  if (phone) {
    const { data: dupe } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (dupe) return { error: "That phone number already has a login." };
  }

  // Email is what Supabase auth uses. If only a phone was given, create a
  // private placeholder email so the account can exist; the employee still
  // signs in with their phone + PIN.
  const authEmail = email || `p${phone}@crew.floorking.local`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || null, role },
  });
  if (error || !created.user) {
    return { error: error?.message ?? "Could not create the login." };
  }

  await admin
    .from("profiles")
    .update({
      role,
      full_name: fullName || null,
      phone: phone || null,
      title: title || null,
      home_address: str(formData.get("home_address")) || null,
    })
    .eq("id", created.user.id);

  revalidatePath("/settings/team");
  return { error: null, ok: true };
}

/** Set or change an existing member's phone + PIN (enables phone login). */
export async function setMemberPhonePin(formData: FormData): Promise<void> {
  await assertRole(["admin"]);
  const id = str(formData.get("id"));
  const phone = normalizePhone(str(formData.get("phone")));
  const pin = str(formData.get("pin"));
  if (!id || !phone || pin.length < 6) return;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  // Don't steal a phone already used by someone else.
  const { data: dupe } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .neq("id", id)
    .maybeSingle();
  if (dupe) return;

  await admin.auth.admin.updateUserById(id, { password: pin });
  await admin.from("profiles").update({ phone }).eq("id", id);
  revalidatePath("/settings/team");
}

export async function setMemberHome(formData: FormData): Promise<void> {
  await assertRole(["admin"]);
  const id = str(formData.get("id"));
  if (!id) return;
  const home = str(formData.get("home_address"));
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  await admin
    .from("profiles")
    .update({ home_address: home || null })
    .eq("id", id);
  revalidatePath("/settings/team");
}

export async function setMemberTitle(formData: FormData): Promise<void> {
  await assertRole(["admin"]);
  const id = str(formData.get("id"));
  if (!id) return;
  const title = str(formData.get("title"));
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  await admin.from("profiles").update({ title: title || null }).eq("id", id);
  revalidatePath("/settings/team");
}

export async function setMemberRole(formData: FormData): Promise<void> {
  await assertRole(["admin"]);
  const id = str(formData.get("id"));
  const role = str(formData.get("role")) as UserRole;
  if (!id || !STAFF_ROLES.includes(role)) return;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  // Don't let the last active admin be demoted — that would lock everyone out
  // of Settings. Make someone else an admin first.
  if (role !== "admin") {
    const { data: target } = await admin
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    if (target?.role === "admin") {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("active", true);
      if ((count ?? 0) <= 1) return; // refuse — keep at least one admin
    }
  }
  await admin.from("profiles").update({ role }).eq("id", id);
  revalidatePath("/settings/team");
}

export async function setMemberName(formData: FormData): Promise<void> {
  await assertRole(["admin"]);
  const id = str(formData.get("id"));
  if (!id) return;
  const fullName = str(formData.get("full_name"));
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  await admin
    .from("profiles")
    .update({ full_name: fullName || null })
    .eq("id", id);
  revalidatePath("/settings/team");
}

export interface RemoveResult {
  error: string | null;
  ok?: boolean;
}

const BAN_FOREVER = "876600h"; // ~100 years

/**
 * Deactivate (or reactivate) a member. Deactivating disables their sign-in but
 * keeps their profile and their name on past records. Reactivating restores
 * access. Guards against deactivating yourself or the last active admin.
 */
export async function setMemberActive(
  id: string,
  active: boolean,
): Promise<RemoveResult> {
  const me = await getProfile();
  if (me?.role !== "admin") return { error: "Only an administrator can do that." };
  if (!id) return { error: "Missing member." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "This needs the Supabase secret key on the server." };
  }

  if (!active) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id === id) return { error: "You can't deactivate your own login." };

    const { data: target } = await admin
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    if (target?.role === "admin") {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("active", true);
      if ((count ?? 0) <= 1) {
        return {
          error: "That's the only active administrator — make someone else an admin first.",
        };
      }
    }
  }

  // Block / restore sign-in at the auth layer, and flag the profile.
  const { error: banErr } = await admin.auth.admin.updateUserById(id, {
    ban_duration: active ? "none" : BAN_FOREVER,
  });
  if (banErr) return { error: banErr.message };
  await admin.from("profiles").update({ active }).eq("id", id);

  revalidatePath("/settings/team");
  return { error: null, ok: true };
}

/**
 * Permanently remove a team member's login and all their access. Their past
 * work (jobs, estimates, etc.) stays but is unassigned. Guards against deleting
 * yourself or the last administrator.
 */
export async function removeTeamMember(id: string): Promise<RemoveResult> {
  const me = await getProfile();
  if (me?.role !== "admin") return { error: "Only an administrator can do that." };
  if (!id) return { error: "Missing member." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Removing logins needs the Supabase secret key on the server." };
  }

  // Can't remove yourself.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === id) {
    return { error: "You can't remove your own login." };
  }

  // Don't remove the last admin (you'd lock everyone out of settings).
  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();
  if (target?.role === "admin") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return { error: "That's the only administrator — make someone else an admin first." };
    }
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return { error: null, ok: true };
}
