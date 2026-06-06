"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface QQFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function intOr(v: FormDataEntryValue | null, fallback: number): number {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) ? n : fallback;
}
function optionsOrNull(v: FormDataEntryValue | null): string[] | null {
  const s = str(v);
  if (!s) return null;
  const arr = s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

function readFields(formData: FormData) {
  return {
    label: str(formData.get("label")),
    help: str(formData.get("help")) || null,
    section: str(formData.get("section")) || "Qualifying",
    options: optionsOrNull(formData.get("options")),
    required: str(formData.get("required")) === "on",
    position: intOr(formData.get("position"), 0),
  };
}

export async function createQualifyingQuestion(
  _prev: QQFormState,
  formData: FormData,
): Promise<QQFormState> {
  const fields = readFields(formData);
  if (!fields.label) return { error: "Enter the question." };
  const supabase = await createClient();
  if (!fields.position) {
    const { data } = await supabase
      .from("qualifying_questions")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    fields.position = ((data?.position as number) ?? 0) + 10;
  }
  const { error } = await supabase.from("qualifying_questions").insert(fields);
  if (error) return { error: error.message };
  revalidatePath("/settings/qualifying");
  return { error: null, ok: true };
}

export async function updateQualifyingQuestion(
  _prev: QQFormState,
  formData: FormData,
): Promise<QQFormState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing id." };
  const fields = readFields(formData);
  if (!fields.label) return { error: "Enter the question." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("qualifying_questions")
    .update({ ...fields, active: str(formData.get("active")) === "on" })
    .eq("id", id);
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

/** Reorder within the question's own section. */
export async function moveQualifyingQuestion(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const dir = str(formData.get("dir"));
  if (!id || (dir !== "up" && dir !== "down")) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("qualifying_questions")
    .select("id, position, section")
    .order("position", { ascending: true });
  const all = (data ?? []) as {
    id: string;
    position: number;
    section: string;
  }[];
  const target = all.find((q) => q.id === id);
  if (!target) return;
  const list = all.filter((q) => q.section === target.section);
  const idx = list.findIndex((q) => q.id === id);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx];
  const b = list[swap];
  const posA =
    a.position === b.position ? a.position + (dir === "up" ? 1 : -1) : a.position;
  await supabase
    .from("qualifying_questions")
    .update({ position: b.position })
    .eq("id", a.id);
  await supabase
    .from("qualifying_questions")
    .update({ position: posA })
    .eq("id", b.id);
  revalidatePath("/settings/qualifying");
}
