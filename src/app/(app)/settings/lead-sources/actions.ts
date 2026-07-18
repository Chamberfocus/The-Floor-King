"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SourceActionState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || `src_${label.length}`
  );
}

function refresh() {
  revalidatePath("/settings/lead-sources");
  revalidatePath("/reports/lead-sources");
  revalidatePath("/customers/new");
}

/** Confirm the signed-in user is staff before any write. */
async function requireStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "Please sign in again." as string | null };
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const staff = ["admin", "office", "sales_manager"].includes((me?.role as string) ?? "");
  return { supabase, error: staff ? null : "You don't have access to change this." };
}

// ---- Sources ---------------------------------------------------------------

export async function addSource(
  _prev: SourceActionState,
  formData: FormData,
): Promise<SourceActionState> {
  const { supabase, error: authErr } = await requireStaff();
  if (authErr) return { error: authErr };
  const label = str(formData.get("label"));
  if (!label) return { error: "Give the source a name." };

  // Next position = max + 1.
  const { data: last } = await supabase
    .from("lead_sources")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number) ?? -1) + 1;

  let key = slug(label);
  // Ensure key uniqueness.
  const { data: clash } = await supabase.from("lead_sources").select("id").eq("key", key).maybeSingle();
  if (clash) key = `${key}_${position}`;

  const detailMode = str(formData.get("detail_mode")) || "none";
  const { error } = await supabase.from("lead_sources").insert({
    key,
    label,
    active: true,
    position,
    detail_mode: detailMode,
    detail_label: str(formData.get("detail_label")) || null,
    detail_required: formData.get("detail_required") === "on",
  });
  if (error) return { error: error.message.includes("lead_sources") ? "Run migration 0112 first." : error.message };
  refresh();
  return { error: null, ok: true };
}

export async function updateSource(
  _prev: SourceActionState,
  formData: FormData,
): Promise<SourceActionState> {
  const { supabase, error: authErr } = await requireStaff();
  if (authErr) return { error: authErr };
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing source." };
  const label = str(formData.get("label"));
  if (!label) return { error: "Name can't be empty." };
  const { error } = await supabase
    .from("lead_sources")
    .update({
      label,
      detail_mode: str(formData.get("detail_mode")) || "none",
      detail_label: str(formData.get("detail_label")) || null,
      detail_required: formData.get("detail_required") === "on",
    })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { error: null, ok: true };
}

export async function setSourceActive(id: string, active: boolean): Promise<void> {
  const { supabase, error } = await requireStaff();
  if (error || !id) return;
  await supabase.from("lead_sources").update({ active }).eq("id", id);
  refresh();
}

export async function deleteSource(id: string): Promise<{ error: string | null }> {
  const { supabase, error: authErr } = await requireStaff();
  if (authErr) return { error: authErr };
  if (!id) return { error: "Missing source." };
  // Don't orphan customers: block delete if any reference it; deactivate instead.
  const { count } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("source_id", id);
  if ((count ?? 0) > 0) {
    await supabase.from("lead_sources").update({ active: false }).eq("id", id);
    refresh();
    return { error: null };
  }
  await supabase.from("lead_source_details").delete().eq("source_id", id);
  await supabase.from("lead_source_spend").delete().eq("source_id", id);
  const { error } = await supabase.from("lead_sources").delete().eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { error: null };
}

export async function moveSource(id: string, dir: -1 | 1): Promise<void> {
  const { supabase, error } = await requireStaff();
  if (error || !id) return;
  const { data: all } = await supabase
    .from("lead_sources")
    .select("id, position")
    .order("position");
  if (!all) return;
  const idx = all.findIndex((s) => s.id === id);
  const swap = idx + dir;
  if (idx < 0 || swap < 0 || swap >= all.length) return;
  const a = all[idx];
  const b = all[swap];
  await supabase.from("lead_sources").update({ position: b.position }).eq("id", a.id);
  await supabase.from("lead_sources").update({ position: a.position }).eq("id", b.id);
  refresh();
}

// ---- Sub-detail options ----------------------------------------------------

export async function addDetail(
  _prev: SourceActionState,
  formData: FormData,
): Promise<SourceActionState> {
  const { supabase, error: authErr } = await requireStaff();
  if (authErr) return { error: authErr };
  const sourceId = str(formData.get("source_id"));
  const label = str(formData.get("label"));
  if (!sourceId || !label) return { error: "Name the option first." };
  const { data: last } = await supabase
    .from("lead_source_details")
    .select("position")
    .eq("source_id", sourceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number) ?? -1) + 1;
  const { error } = await supabase
    .from("lead_source_details")
    .insert({ source_id: sourceId, label, active: true, position });
  if (error) return { error: error.message };
  refresh();
  return { error: null, ok: true };
}

export async function deleteDetail(id: string): Promise<void> {
  const { supabase, error } = await requireStaff();
  if (error || !id) return;
  // Deactivate if used, else hard delete.
  const { count } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("source_detail_id", id);
  if ((count ?? 0) > 0) await supabase.from("lead_source_details").update({ active: false }).eq("id", id);
  else await supabase.from("lead_source_details").delete().eq("id", id);
  refresh();
}

// ---- Ad spend --------------------------------------------------------------

export async function saveSpendValue(
  sourceId: string,
  detailId: string | null,
  period: string, // YYYY-MM
  amount: number,
): Promise<{ error: string | null }> {
  const { supabase, error: authErr } = await requireStaff();
  if (authErr) return { error: authErr };
  if (!sourceId || !/^\d{4}-\d{2}$/.test(period)) return { error: "Pick a source and month." };
  const amt = Number.isFinite(amount) && amount > 0 ? amount : 0;

  // Match the unique index (source, coalesce(detail), period): update existing or insert.
  let q = supabase
    .from("lead_source_spend")
    .select("id")
    .eq("source_id", sourceId)
    .eq("period", period);
  q = detailId ? q.eq("detail_id", detailId) : q.is("detail_id", null);
  const { data: existing } = await q.maybeSingle();

  if (amt <= 0) {
    if (existing) await supabase.from("lead_source_spend").delete().eq("id", existing.id);
    refresh();
    return { error: null };
  }
  if (existing) {
    const { error } = await supabase.from("lead_source_spend").update({ amount: amt }).eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("lead_source_spend")
      .insert({ source_id: sourceId, detail_id: detailId, period, amount: amt });
    if (error) return { error: error.message.includes("lead_source_spend") ? "Run migration 0112 first." : error.message };
  }
  refresh();
  return { error: null };
}
