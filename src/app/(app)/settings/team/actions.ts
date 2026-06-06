"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { positionById } from "./positions";
import type { UserRole } from "@/lib/types";

export interface TeamFormState {
  error: string | null;
  ok?: boolean;
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
  const email = str(formData.get("email")).toLowerCase();
  const password = str(formData.get("password"));
  const fullName = str(formData.get("full_name"));
  const pos = positionById(str(formData.get("position")));
  const role: UserRole = pos?.role ?? "office";
  const title = str(formData.get("title")) || pos?.label || "";

  if (!email) return { error: "Email is required." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
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
    .update({
      role,
      full_name: fullName || null,
      title: title || null,
      home_address: str(formData.get("home_address")) || null,
    })
    .eq("id", created.user.id);

  revalidatePath("/settings/team");
  return { error: null, ok: true };
}

export async function setMemberHome(formData: FormData): Promise<void> {
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
