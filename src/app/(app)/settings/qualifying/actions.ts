"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface QQFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function createQualifyingQuestion(
  _prev: QQFormState,
  formData: FormData,
): Promise<QQFormState> {
  const label = str(formData.get("label"));
  if (!label) return { error: "Enter the question." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("qualifying_questions")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((data?.position as number) ?? 0) + 10;
  const { error } = await supabase
    .from("qualifying_questions")
    .insert({ label, help: str(formData.get("help")) || null, position });
  if (error) return { error: error.message };
  revalidatePath("/settings/qualifying");
  return { error: null, ok: true };
}

export async function deleteQualifyingQuestion(
  formData: FormData,
): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("qualifying_questions").delete().eq("id", id);
  revalidatePath("/settings/qualifying");
}

export async function moveQualifyingQuestion(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const dir = str(formData.get("dir"));
  if (!id || (dir !== "up" && dir !== "down")) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("qualifying_questions")
    .select("id, position")
    .order("position", { ascending: true });
  const list = (data ?? []) as { id: string; position: number }[];
  const idx = list.findIndex((q) => q.id === id);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx];
  const b = list[swap];
  const posA = a.position === b.position ? a.position + (dir === "up" ? 1 : -1) : a.position;
  await supabase.from("qualifying_questions").update({ position: b.position }).eq("id", a.id);
  await supabase.from("qualifying_questions").update({ position: posA }).eq("id", b.id);
  revalidatePath("/settings/qualifying");
}
