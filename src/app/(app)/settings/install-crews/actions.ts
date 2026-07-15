"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole, getProfile } from "@/lib/auth";
import { createLogin, resetLoginPin } from "@/lib/auth-admin";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function numOrNull(v: FormDataEntryValue | null): number | null {
  const n = parseFloat(str(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type Result = { error: string | null };

export async function saveInstallCrew(formData: FormData): Promise<Result> {
  await assertRole(["admin", "office"]);
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  if (!name) return { error: "Give the crew a name." };

  const skills = formData
    .getAll("skills")
    .map(String)
    .filter((s) => s === "carpet" || s === "hard");
  const row = {
    name,
    kind: str(formData.get("kind")) === "employee" ? "employee" : "subcontractor",
    phone: str(formData.get("phone")) || null,
    email: str(formData.get("email")) || null,
    pay_basis: str(formData.get("pay_basis")) || null,
    pay_rate: numOrNull(formData.get("pay_rate")),
    notes: str(formData.get("notes")) || null,
    skills,
  };

  const pin = str(formData.get("pin"));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const write = (r: typeof row | Omit<typeof row, "skills">) =>
    (id
      ? supabase.from("install_crews").update(r).eq("id", id)
      : supabase.from("install_crews").insert({ ...r, created_by: user?.id ?? null })
    )
      .select("id, profile_id")
      .maybeSingle();

  let res = await write(row);
  // `skills` (migration 0103) may not exist yet — retry without it so saving a
  // crew still works before the migration is run.
  if (res.error && /skills/i.test(res.error.message)) {
    const { skills: _drop, ...rest } = row;
    void _drop;
    res = await write(rest);
  }
  if (res.error) return { error: res.error.message };
  const saved = res.data as { id: string; profile_id: string | null } | null;
  const crewId = saved?.id ?? id;
  let profileId = saved?.profile_id ?? null;

  if (pin) {
    // Provisioning a login is admin-only (the team page already gates to admin;
    // this guards the server action directly too).
    const me = await getProfile();
    if (me?.role !== "admin") {
      return { error: "Only an administrator can create or change a login." };
    }
    if (profileId) {
      // Already has a login → reset the PIN (and keep the phone in sync).
      const { error } = await resetLoginPin(profileId, pin, row.phone);
      if (error) return { error };
    } else {
      // New login for this crew, then link it so they become a real installer.
      const { userId, error } = await createLogin({
        email: row.email,
        phone: row.phone,
        password: pin,
        fullName: name,
        role: "crew",
      });
      if (error) return { error };
      if (userId && crewId) {
        await supabase
          .from("install_crews")
          .update({ profile_id: userId })
          .eq("id", crewId);
        profileId = userId;
      }
    }
    revalidatePath("/installer");
    revalidatePath("/install-scheduler");
    revalidatePath("/jobs");
  } else if (profileId) {
    // No PIN change, but keep the linked login's name/phone in sync on a rename,
    // so the installer page, job pages, and calendar don't show a stale name.
    await supabase
      .from("profiles")
      .update({ full_name: name, phone: row.phone })
      .eq("id", profileId);
    revalidatePath("/installer");
    revalidatePath("/install-scheduler");
    revalidatePath("/jobs");
  }

  revalidatePath("/settings/install-crews");
  revalidatePath("/settings/team");
  return { error: null };
}

export async function setInstallCrewActive(formData: FormData): Promise<Result> {
  await assertRole(["admin", "office"]);
  const id = str(formData.get("id"));
  const active = str(formData.get("active")) === "true";
  if (!id) return { error: "Missing crew." };
  const supabase = await createClient();
  const { error } = await supabase.from("install_crews").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settings/install-crews");
  return { error: null };
}
