"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

export interface TeamFormState {
  error: string | null;
  ok?: boolean;
}

const STAFF_ROLES: UserRole[] = ["admin", "office", "crew", "warehouse"];

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function inviteTeamMember(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const email = str(formData.get("email")).toLowerCase();
  const password = str(formData.get("password"));
  const fullName = str(formData.get("full_name"));
  const role = (str(formData.get("role")) || "crew") as UserRole;

  if (!email) return { error: "Email is required." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (!STAFF_ROLES.includes(role)) return { error: "Invalid role." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error: "Creating logins needs the Supabase secret key on the server.",
    };
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || null, role },
  });
  if (error || !created.user) {
    return { error: error?.message ?? "Could not create the login." };
  }

  await admin
    .from("profiles")
    .update({ role, full_name: fullName || null })
    .eq("id", created.user.id);

  revalidatePath("/settings/team");
  return { error: null, ok: true };
}

export async function setMemberRole(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const role = str(formData.get("role")) as UserRole;
  if (!id || !STAFF_ROLES.includes(role)) return;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  await admin.from("profiles").update({ role }).eq("id", id);
  revalidatePath("/settings/team");
}
