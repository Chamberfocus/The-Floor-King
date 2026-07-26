"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Crew self-service for their own availability. RLS on installer_availability
 * ties every row to auth.uid(), so these can only ever write the caller's own
 * blocks — installer_id is set server-side from the session, never trusted from
 * the form.
 */

function normTime(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}

export type AvailabilityFormState = { error: string | null; ok?: boolean };

export async function addAvailability(
  _prev: AvailabilityFormState,
  formData: FormData,
): Promise<AvailabilityFormState> {
  const profile = await requireProfile();
  if (!["crew", "admin", "office"].includes(profile.role)) {
    return { error: "Not allowed." };
  }

  const start = (formData.get("start_date") ?? "").toString().trim();
  const endRaw = (formData.get("end_date") ?? "").toString().trim();
  const end = endRaw || start;
  if (!start) return { error: "Pick a date." };
  if (end < start) return { error: "End date can't be before the start date." };

  const allDay = formData.get("all_day") === "on" || formData.get("all_day") === "true";
  const kind = formData.get("kind") === "busy" ? "busy" : "off";
  const isPrivate =
    formData.get("private") === "on" || formData.get("private") === "true";
  const note = (formData.get("note") ?? "").toString().trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("installer_availability").insert({
    installer_id: profile.id,
    start_date: start,
    end_date: end,
    all_day: allDay,
    start_time: allDay ? null : normTime(formData.get("start_time")),
    end_time: allDay ? null : normTime(formData.get("end_time")),
    kind,
    note,
    private: isPrivate,
  });
  if (error) return { error: error.message };

  revalidatePath("/installer");
  revalidatePath("/install-scheduler");
  return { error: null, ok: true };
}

export async function deleteAvailability(formData: FormData): Promise<void> {
  const profile = await requireProfile();
  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  const supabase = await createClient();
  // RLS also enforces ownership; the explicit filter keeps intent clear.
  await supabase
    .from("installer_availability")
    .delete()
    .eq("id", id)
    .eq("installer_id", profile.id);

  revalidatePath("/installer");
  revalidatePath("/install-scheduler");
}
