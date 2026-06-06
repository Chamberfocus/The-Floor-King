"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Reorder a rep's stops for a day (renumbers seq 0..n-1 in the new order). */
export async function moveAppointment(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const dir = str(formData.get("dir"));
  const rep = str(formData.get("rep"));
  const date = str(formData.get("date"));
  if (!id || !rep || !date || (dir !== "up" && dir !== "down")) return;

  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments")
    .select("id")
    .eq("salesperson_id", rep)
    .eq("status", "scheduled")
    .gte("starts_at", `${date}T00:00:00Z`)
    .lte("starts_at", `${date}T23:59:59Z`)
    .order("seq", { ascending: true })
    .order("starts_at", { ascending: true });
  const order = (data ?? []).map((x) => x.id as string);
  const idx = order.findIndex((x) => x === id);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= order.length) return;
  [order[idx], order[swap]] = [order[swap], order[idx]];

  for (let i = 0; i < order.length; i++) {
    await supabase.from("appointments").update({ seq: i }).eq("id", order[i]);
  }
  revalidatePath("/schedule/route");
  revalidatePath("/schedule");
}
