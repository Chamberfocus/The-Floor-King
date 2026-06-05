"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { WizardQuestionInput, WizardQuestionKind } from "@/lib/types";

export interface QuestionFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function moneyOrNull(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function intOr(v: FormDataEntryValue | null, fallback: number): number {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function readFields(formData: FormData) {
  return {
    label: str(formData.get("label")),
    help: str(formData.get("help")) || null,
    kind: (str(formData.get("kind")) || "detail") as WizardQuestionKind,
    input: (str(formData.get("input")) || "text") as WizardQuestionInput,
    default_amount: moneyOrNull(formData.get("default_amount")),
    position: intOr(formData.get("position"), 0),
  };
}

export async function createQuestion(
  _prev: QuestionFormState,
  formData: FormData,
): Promise<QuestionFormState> {
  const fields = readFields(formData);
  if (!fields.label) return { error: "Enter the question text." };

  const supabase = await createClient();
  if (!fields.position) {
    const { data } = await supabase
      .from("wizard_questions")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    fields.position = ((data?.position as number) ?? 0) + 10;
  }

  const { error } = await supabase.from("wizard_questions").insert(fields);
  if (error) return { error: error.message };

  revalidatePath("/settings/wizard");
  redirect("/settings/wizard");
}

export async function updateQuestion(
  _prev: QuestionFormState,
  formData: FormData,
): Promise<QuestionFormState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing id." };
  const fields = readFields(formData);
  if (!fields.label) return { error: "Enter the question text." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("wizard_questions")
    .update({ ...fields, active: str(formData.get("active")) === "on" })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/settings/wizard");
  return { error: null, ok: true };
}

export async function deleteQuestion(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("wizard_questions").delete().eq("id", id);
  revalidatePath("/settings/wizard");
  redirect("/settings/wizard");
}

/** Swap a question's position with its neighbor (dir = "up" | "down"). */
export async function moveQuestion(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const dir = str(formData.get("dir"));
  if (!id || (dir !== "up" && dir !== "down")) return;

  const supabase = await createClient();
  const { data } = await supabase
    .from("wizard_questions")
    .select("id, position")
    .order("position", { ascending: true });
  const list = (data ?? []) as { id: string; position: number }[];

  const idx = list.findIndex((q) => q.id === id);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;

  const a = list[idx];
  const b = list[swapIdx];
  // Ensure distinct positions before swapping.
  const posA = a.position === b.position ? a.position + (dir === "up" ? 1 : -1) : a.position;
  await supabase.from("wizard_questions").update({ position: b.position }).eq("id", a.id);
  await supabase.from("wizard_questions").update({ position: posA }).eq("id", b.id);

  revalidatePath("/settings/wizard");
}
