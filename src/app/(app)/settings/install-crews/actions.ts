"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";

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

  const row = {
    name,
    kind: str(formData.get("kind")) === "employee" ? "employee" : "subcontractor",
    phone: str(formData.get("phone")) || null,
    email: str(formData.get("email")) || null,
    pay_basis: str(formData.get("pay_basis")) || null,
    pay_rate: numOrNull(formData.get("pay_rate")),
    notes: str(formData.get("notes")) || null,
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const res = id
    ? await supabase.from("install_crews").update(row).eq("id", id)
    : await supabase.from("install_crews").insert({ ...row, created_by: user?.id ?? null });
  if (res.error) return { error: res.error.message };

  // If this crew is linked to a login installer, keep the profile's name/phone in
  // sync so the installer page, job pages, and calendar (which read the profile,
  // not the crew) don't show a stale name after a rename. select("*") is
  // migration-safe (profile_id column may not exist yet).
  if (id) {
    const { data: crew } = await supabase
      .from("install_crews")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const profileId =
      (crew as { profile_id?: string | null } | null)?.profile_id ?? null;
    if (profileId) {
      await supabase
        .from("profiles")
        .update({ full_name: name, phone: row.phone })
        .eq("id", profileId);
      revalidatePath("/installer");
      revalidatePath("/install-scheduler");
      revalidatePath("/jobs");
    }
  }

  revalidatePath("/settings/install-crews");
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
