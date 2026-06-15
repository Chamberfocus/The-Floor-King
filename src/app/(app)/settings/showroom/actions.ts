"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { AppointmentColor, AppointmentKind } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function int(v: FormDataEntryValue | null, def = 0): number {
  const n = parseInt(str(v).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
}

export interface ShowroomState {
  error: string | null;
  ok?: boolean;
}

export async function saveShowroomSettings(
  _prev: ShowroomState,
  formData: FormData,
): Promise<ShowroomState> {
  const open = [0, 1, 2, 3, 4, 5, 6]
    .filter((d) => str(formData.get(`day_${d}`)) === "on")
    .join(",");

  const supabase = await createClient();
  const { error } = await supabase.from("showroom_settings").upsert(
    {
      id: "default",
      open_days: open || "1,2,3,4,5",
      day_start: str(formData.get("day_start")) || "09:00",
      day_end: str(formData.get("day_end")) || "17:00",
      slot_interval_min: int(formData.get("slot_interval_min"), 30),
      capacity: Math.max(1, int(formData.get("capacity"), 2)),
      buffer_min: int(formData.get("buffer_min"), 0),
      booking_enabled: str(formData.get("booking_enabled")) === "on",
      booking_notice_hours: int(formData.get("booking_notice_hours"), 2),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { error: error.message };
  revalidatePath("/settings/showroom");
  revalidatePath("/calendar");
  revalidatePath("/book");
  return { error: null, ok: true };
}

export async function createApptType(formData: FormData): Promise<void> {
  const name = str(formData.get("name"));
  if (!name) return;
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("appointment_types")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabase.from("appointment_types").insert({
    name,
    duration_min: Math.max(5, int(formData.get("duration_min"), 45)),
    color: (str(formData.get("color")) || "blue") as AppointmentColor,
    kind: (str(formData.get("kind")) || "showroom") as AppointmentKind,
    requires_rep: str(formData.get("requires_rep")) === "on",
    active: true,
    position: ((last?.position as number) ?? -1) + 1,
  });
  revalidatePath("/settings/showroom");
  revalidatePath("/calendar");
}

export async function updateApptType(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("appointment_types")
    .update({
      name: str(formData.get("name")),
      duration_min: Math.max(5, int(formData.get("duration_min"), 45)),
      color: (str(formData.get("color")) || "blue") as AppointmentColor,
      requires_rep: str(formData.get("requires_rep")) === "on",
      active: str(formData.get("active")) === "on",
    })
    .eq("id", id);
  revalidatePath("/settings/showroom");
  revalidatePath("/calendar");
  revalidatePath("/book");
}

export async function deleteApptType(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("appointment_types").delete().eq("id", id);
  revalidatePath("/settings/showroom");
  revalidatePath("/calendar");
}
