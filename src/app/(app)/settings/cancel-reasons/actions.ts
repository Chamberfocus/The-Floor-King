"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: FormDataEntryValue | null, fallback: number): number {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function staffOnly() {
  const p = await requireProfile();
  return ["admin", "office"].includes(p.role);
}

export async function addCancelReason(formData: FormData): Promise<void> {
  if (!(await staffOnly())) return;
  const label = str(formData.get("label"));
  if (!label) return;
  const supabase = await createClient();
  await supabase
    .from("cancel_reasons")
    .insert({ label, position: num(formData.get("position"), 500) });
  revalidatePath("/settings/cancel-reasons");
}

export async function updateCancelReason(formData: FormData): Promise<void> {
  if (!(await staffOnly())) return;
  const id = str(formData.get("id"));
  const label = str(formData.get("label"));
  if (!id || !label) return;
  const supabase = await createClient();
  await supabase
    .from("cancel_reasons")
    .update({ label, position: num(formData.get("position"), 500) })
    .eq("id", id);
  revalidatePath("/settings/cancel-reasons");
}

export async function toggleCancelReason(formData: FormData): Promise<void> {
  if (!(await staffOnly())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  const active = str(formData.get("active")) === "true";
  await supabase.from("cancel_reasons").update({ active: !active }).eq("id", id);
  revalidatePath("/settings/cancel-reasons");
}

export async function deleteCancelReason(formData: FormData): Promise<void> {
  if (!(await staffOnly())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("cancel_reasons").delete().eq("id", id);
  revalidatePath("/settings/cancel-reasons");
}
