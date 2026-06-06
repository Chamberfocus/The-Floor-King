"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function n(v: FormDataEntryValue | null, fallback: number): number {
  const x = parseFloat(str(v));
  return Number.isFinite(x) ? x : fallback;
}

export async function saveSchedulingSettings(formData: FormData): Promise<void> {
  const days = formData
    .getAll("work_days")
    .map((d) => str(d))
    .filter(Boolean)
    .join(",");

  const supabase = await createClient();
  await supabase
    .from("scheduling_settings")
    .update({
      work_days: days || "1,2,3,4,5,6",
      day_start: str(formData.get("day_start")) || "09:00",
      day_end: str(formData.get("day_end")) || "17:00",
      estimate_duration_min: n(formData.get("estimate_duration_min"), 60),
      travel_buffer_min: n(formData.get("travel_buffer_min"), 30),
      cap_carpet_yd: n(formData.get("cap_carpet_yd"), 100),
      cap_lvt_sf: n(formData.get("cap_lvt_sf"), 250),
      cap_laminate_sf: n(formData.get("cap_laminate_sf"), 250),
      cap_hardwood_sf: n(formData.get("cap_hardwood_sf"), 175),
      cap_tile_teardown_sf: n(formData.get("cap_tile_teardown_sf"), 100),
      cap_subfloor_sheets: n(formData.get("cap_subfloor_sheets"), 10),
      cap_selflevel_sf: n(formData.get("cap_selflevel_sf"), 600),
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");

  revalidatePath("/settings/scheduling");
}
