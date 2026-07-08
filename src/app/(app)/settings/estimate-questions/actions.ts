"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  EstimateEmit,
  EstimateQuestionConfig,
  EstimateQuestionKind,
} from "@/lib/types";

export interface EQFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function numOr(v: FormDataEntryValue | null, fallback: number): number {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : fallback;
}
function on(v: FormDataEntryValue | null): boolean {
  return str(v) === "on";
}

/** Build an emit spec from the common emit_* fields (role/category/…/cost). */
function readEmit(formData: FormData): EstimateEmit | null {
  const description = str(formData.get("emit_description"));
  const cost = numOr(formData.get("emit_cost"), 0);
  if (!description && cost <= 0) return null;
  const role = str(formData.get("emit_role")) === "material" ? "material" : "labor";
  return {
    role,
    category: str(formData.get("emit_category")) || (role === "material" ? "other" : "labor"),
    description: description || "Line item",
    unit: str(formData.get("emit_unit")) || "flat",
    per: (str(formData.get("emit_per")) || "flat") as EstimateEmit["per"],
    cost,
  };
}

/** Parse "Label | cost" lines into rate options. */
function readRateOptions(v: FormDataEntryValue | null): { label: string; cost: number }[] {
  return str(v)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, cost] = l.split("|").map((x) => x.trim());
      return { label: label || "Option", cost: numOr(cost ?? "", 0) };
    });
}

/** Parse choice options: "Label | cost | description" (labor/flat defaults). */
function readChoiceOptions(v: FormDataEntryValue | null): { label: string; emit?: EstimateEmit | null }[] {
  return str(v)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split("|").map((x) => x.trim());
      const label = parts[0] || "Option";
      const cost = numOr(parts[1] ?? "", 0);
      const description = parts[2] || label;
      const emit: EstimateEmit | null =
        cost > 0
          ? { role: "labor", category: "labor", description, unit: "flat", per: "flat", cost }
          : null;
      return { label, emit };
    });
}

/** Assemble the kind-specific config JSON from the form. */
function readConfig(kind: EstimateQuestionKind, formData: FormData): EstimateQuestionConfig {
  switch (kind) {
    case "areas":
      return {};
    case "text":
      return { note: true };
    case "product":
      return {
        category: str(formData.get("cfg_category")) || "carpet",
        ask_source: on(formData.get("cfg_ask_source")),
        allow_additional: on(formData.get("cfg_allow_additional")),
      };
    case "yesno":
      return { emit: readEmit(formData), default: on(formData.get("cfg_default")), note: on(formData.get("cfg_note")) };
    case "number":
      return { emit: readEmit(formData), rate_options: readRateOptions(formData.get("rate_options")) };
    case "choice":
      return { multi: on(formData.get("cfg_multi")), options: readChoiceOptions(formData.get("options")), note: on(formData.get("cfg_note")) };
    default:
      return {};
  }
}

function readFields(formData: FormData) {
  const kind = (str(formData.get("kind")) || "yesno") as EstimateQuestionKind;
  return {
    label: str(formData.get("label")),
    help: str(formData.get("help")) || null,
    section: str(formData.get("section")) || "Carpet",
    kind,
    config: readConfig(kind, formData),
    required: on(formData.get("required")),
    position: Math.round(numOr(formData.get("position"), 0)),
  };
}

export async function createEstimateQuestion(
  _prev: EQFormState,
  formData: FormData,
): Promise<EQFormState> {
  const fields = readFields(formData);
  if (!fields.label) return { error: "Enter the question." };
  const supabase = await createClient();
  if (!fields.position) {
    const { data } = await supabase
      .from("estimate_questions")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    fields.position = ((data?.position as number) ?? 0) + 10;
  }
  const { error } = await supabase.from("estimate_questions").insert(fields);
  if (error) {
    return {
      error: error.message.includes("estimate_questions")
        ? "Run the estimate_questions migration first (paste the SQL in Supabase)."
        : error.message,
    };
  }
  revalidatePath("/settings/estimate-questions");
  return { error: null, ok: true };
}

export async function updateEstimateQuestion(
  _prev: EQFormState,
  formData: FormData,
): Promise<EQFormState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing id." };
  const fields = readFields(formData);
  if (!fields.label) return { error: "Enter the question." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("estimate_questions")
    .update({ ...fields, active: on(formData.get("active")) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settings/estimate-questions");
  return { error: null, ok: true };
}

export async function deleteEstimateQuestion(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("estimate_questions").delete().eq("id", id);
  revalidatePath("/settings/estimate-questions");
}

/** Reorder within the question's own section. */
export async function moveEstimateQuestion(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const dir = str(formData.get("dir"));
  if (!id || (dir !== "up" && dir !== "down")) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimate_questions")
    .select("id, position, section")
    .order("position", { ascending: true });
  const all = (data ?? []) as { id: string; position: number; section: string }[];
  const target = all.find((q) => q.id === id);
  if (!target) return;
  const list = all.filter((q) => q.section === target.section);
  const idx = list.findIndex((q) => q.id === id);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx];
  const b = list[swap];
  const posA = a.position === b.position ? a.position + (dir === "up" ? 1 : -1) : a.position;
  await supabase.from("estimate_questions").update({ position: b.position }).eq("id", a.id);
  await supabase.from("estimate_questions").update({ position: posA }).eq("id", b.id);
  revalidatePath("/settings/estimate-questions");
}
