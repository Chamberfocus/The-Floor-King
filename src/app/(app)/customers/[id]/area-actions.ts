"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function numOrNull(v: FormDataEntryValue | null): number | null {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : null;
}
const feetIn = (ft: number | null, inch: number | null) => (ft ?? 0) + (inch ?? 0) / 12;

/** Add or update one saved area from the customer dashboard card. */
export async function saveCustomerArea(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const id = str(formData.get("id"));
  const lenFt = numOrNull(formData.get("len_ft"));
  const lenIn = numOrNull(formData.get("len_in"));
  const widFt = numOrNull(formData.get("wid_ft"));
  const widIn = numOrNull(formData.get("wid_in"));
  const lengthIn = lenFt != null || lenIn != null ? Math.round(feetIn(lenFt, lenIn) * 12) : null;
  const widthIn = widFt != null || widIn != null ? Math.round(feetIn(widFt, widIn) * 12) : null;
  const explicitSqft = numOrNull(formData.get("sqft"));
  const sqft =
    explicitSqft != null && explicitSqft > 0
      ? explicitSqft
      : lengthIn && widthIn
        ? Math.round(((lengthIn / 12) * (widthIn / 12)) * 100) / 100
        : null;

  const supabase = await createClient();
  const row = {
    customer_id: customerId,
    name: str(formData.get("name")),
    length_in: lengthIn,
    width_in: widthIn,
    sqft,
    note: str(formData.get("note")) || null,
    differs: str(formData.get("differs")) === "on",
  };
  if (id) {
    await supabase.from("customer_areas").update(row).eq("id", id);
  } else {
    const { data } = await supabase
      .from("customer_areas")
      .select("position")
      .eq("customer_id", customerId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    await supabase.from("customer_areas").insert({ ...row, position: ((data?.position as number) ?? 0) + 10 });
  }
  revalidatePath(`/customers/${customerId}`);
}

export async function deleteCustomerArea(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const customerId = str(formData.get("customer_id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("customer_areas").delete().eq("id", id);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function moveCustomerArea(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const customerId = str(formData.get("customer_id"));
  const dir = str(formData.get("dir"));
  if (!id || !customerId || (dir !== "up" && dir !== "down")) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_areas")
    .select("id, position")
    .eq("customer_id", customerId)
    .order("position", { ascending: true });
  const list = (data ?? []) as { id: string; position: number }[];
  const idx = list.findIndex((x) => x.id === id);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx];
  const b = list[swap];
  const posA = a.position === b.position ? a.position + (dir === "up" ? 1 : -1) : a.position;
  await supabase.from("customer_areas").update({ position: b.position }).eq("id", a.id);
  await supabase.from("customer_areas").update({ position: posA }).eq("id", b.id);
  revalidatePath(`/customers/${customerId}`);
}

/** Replace the whole saved-areas set for a customer (used by the questionnaire
 *  when an estimate is generated, so the dashboard reflects what was measured). */
export async function replaceCustomerAreas(
  customerId: string,
  rooms: { name: string; length_in: number | null; width_in: number | null; sqft: number | null; differs: boolean }[],
): Promise<void> {
  if (!customerId) return;
  const supabase = await createClient();
  await supabase.from("customer_areas").delete().eq("customer_id", customerId);
  const rows = rooms
    .filter((r) => (r.sqft ?? 0) > 0 || r.name.trim())
    .map((r, i) => ({
      customer_id: customerId,
      position: (i + 1) * 10,
      name: r.name || `Area ${i + 1}`,
      length_in: r.length_in,
      width_in: r.width_in,
      sqft: r.sqft,
      differs: r.differs,
    }));
  if (rows.length) await supabase.from("customer_areas").insert(rows);
  revalidatePath(`/customers/${customerId}`);
}
