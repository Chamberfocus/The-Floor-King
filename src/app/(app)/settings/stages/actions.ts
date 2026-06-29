"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface StageFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Read "target time" (value + hours/days unit) into hours; 0 = no SLA. */
function slaHours(formData: FormData): number {
  const v = parseFloat(str(formData.get("sla_value")));
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * (str(formData.get("sla_unit")) === "days" ? 24 : 1));
}

function refresh() {
  revalidatePath("/settings/stages");
  revalidatePath("/pipeline");
}

export async function createStage(
  _prev: StageFormState,
  formData: FormData,
): Promise<StageFormState> {
  const name = str(formData.get("name"));
  if (!name) return { error: "Stage name is required." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("workflow_stages")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((data?.position as number) ?? 0) + 10;
  const row = {
    name,
    color: str(formData.get("color")) || "zinc",
    default_owner: str(formData.get("default_owner")) || null,
    auto_action: str(formData.get("auto_action")) || "none",
    next_action: str(formData.get("next_action")) || null,
    sla_hours: slaHours(formData),
    position,
  };
  const owner_duty = str(formData.get("owner_duty")) || null;
  let { error } = await supabase.from("workflow_stages").insert({ ...row, owner_duty });
  if (error) ({ error } = await supabase.from("workflow_stages").insert(row));
  if (error) return { error: error.message };
  refresh();
  return { error: null, ok: true };
}

export async function updateStage(
  _prev: StageFormState,
  formData: FormData,
): Promise<StageFormState> {
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id) return { error: "Missing stage." };
  if (!name) return { error: "Stage name is required." };
  const supabase = await createClient();
  const row = {
    name,
    color: str(formData.get("color")) || "zinc",
    default_owner: str(formData.get("default_owner")) || null,
    auto_action: str(formData.get("auto_action")) || "none",
    next_action: str(formData.get("next_action")) || null,
    sla_hours: slaHours(formData),
  };
  const owner_duty = str(formData.get("owner_duty")) || null;
  let { error } = await supabase
    .from("workflow_stages")
    .update({ ...row, owner_duty })
    .eq("id", id);
  if (error)
    ({ error } = await supabase.from("workflow_stages").update(row).eq("id", id));
  if (error) return { error: error.message };
  refresh();
  return { error: null, ok: true };
}

export async function deleteStage(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("workflow_stages").delete().eq("id", id);
  refresh();
}

/** Persist a new stage order (drag-and-drop). */
export async function reorderStages(orderedIds: string[]): Promise<void> {
  if (!orderedIds?.length) return;
  const supabase = await createClient();
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("workflow_stages")
      .update({ position: (i + 1) * 10 })
      .eq("id", orderedIds[i]);
  }
  refresh();
}

export async function moveStage(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const dir = str(formData.get("dir"));
  if (!id || (dir !== "up" && dir !== "down")) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("workflow_stages")
    .select("id, position")
    .order("position", { ascending: true });
  const list = (data ?? []) as { id: string; position: number }[];
  const idx = list.findIndex((s) => s.id === id);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx];
  const b = list[swap];
  const posA = a.position === b.position ? a.position + (dir === "up" ? 1 : -1) : a.position;
  await supabase.from("workflow_stages").update({ position: b.position }).eq("id", a.id);
  await supabase.from("workflow_stages").update({ position: posA }).eq("id", b.id);
  refresh();
}
