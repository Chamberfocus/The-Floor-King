"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertRole, getProfile } from "@/lib/auth";
import { createLogin, normalizePhone } from "@/lib/auth-admin";
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

export async function inviteTeamMember(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const me = await getProfile();
  if (me?.role !== "admin") {
    return { error: "Only an administrator can manage the team." };
  }
  const pos = positionById(str(formData.get("position")));
  if (!pos) return { error: "Pick a position." };
  const role: UserRole = pos.role ?? "office";

  // Single source of truth for provisioning a login (shared with the crew form).
  const { error } = await createLogin({
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    password: str(formData.get("password")),
    fullName: str(formData.get("full_name")),
    role,
    title: str(formData.get("title")) || pos.label || null,
    homeAddress: str(formData.get("home_address")) || null,
  });
  if (error) return { error };

  revalidatePath("/settings/team");
  return { error: null, ok: true };
}

/**
 * Set which materials a logged-in installer works on ('carpet' | 'hard'). The
 * skill lives on the installer's install_crews row (that's what the Job Board
 * reads by profile_id); if a login-holding installer has no crew row yet, one is
 * created for them so the skill — and job assignment — has somewhere to live.
 */
export async function setMemberSkills(formData: FormData): Promise<void> {
  await assertRole(["admin"]);
  const id = str(formData.get("id"));
  if (!id) return;
  const skills = formData
    .getAll("skills")
    .map(String)
    .filter((s) => s === "carpet" || s === "hard");

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  const { data: crew } = await admin
    .from("install_crews")
    .select("id")
    .eq("profile_id", id)
    .maybeSingle();

  const run = (withSkills: boolean, crewId?: string) => {
    if (crewId) {
      return admin
        .from("install_crews")
        .update(withSkills ? { skills } : {})
        .eq("id", crewId);
    }
    // No crew row for this installer yet — make one and link it.
    const base = { kind: "employee", profile_id: id, active: true };
    return admin.from("install_crews").insert(
      withSkills
        ? { ...base, name: str(formData.get("name")) || "Installer", skills }
        : { ...base, name: str(formData.get("name")) || "Installer" },
    );
  };

  let res = await run(true, crew?.id as string | undefined);
  // `skills` (migration 0103) may not exist yet — still create/keep the crew row.
  if (res.error && /skills/i.test(res.error.message)) {
    res = await run(false, crew?.id as string | undefined);
  }
  revalidatePath("/settings/team");
  revalidatePath("/board");
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
