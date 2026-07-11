"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveLeadStage } from "@/lib/workflow-engine";

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

/**
 * Re-align EVERY existing customer to the current stage builder:
 *  - any customer with no workflow stage gets one (mapped from its legacy stage),
 *  - every customer's dashboard `stage` mirror is recomputed from its current
 *    workflow stage under the present config.
 * It never advances a customer's real position — it only makes the dashboard and
 * the legacy mirror consistent with the stages you've defined. Re-run it any time
 * you change the stage builder. Admin/office only.
 */
export async function resyncAllStages(): Promise<{
  ok: boolean;
  synced?: number;
  assigned?: number;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || !["admin", "office"].includes(me.role as string))
    return { ok: false, error: "Admins only." };

  const admin = createAdminClient();
  const { data: stages } = await admin
    .from("workflow_stages")
    .select("id, name, position, auto_action, default_owner")
    .order("position", { ascending: true });
  if (!stages || !stages.length)
    return { ok: false, error: "No stages configured yet." };

  const stageById = new Map(stages.map((s) => [s.id as string, s] as const));
  const anchors = stages.map((s) => ({
    position: s.position as number,
    auto_action: (s.auto_action as string) ?? null,
    name: (s.name as string) ?? null,
  }));
  const byAuto = (aa: string) => stages.find((s) => s.auto_action === aa);
  const lostStage = stages.find((s) =>
    /lost|declin|dead|cancel/.test(((s.name as string) || "").toLowerCase()),
  );
  const first = stages[0];
  // Reverse map: a customer with no workflow stage is placed by its legacy stage.
  const targetFor = (leg: string | null) => {
    if (leg === "lost") return lostStage ?? first;
    if (leg === "won") return byAuto("collect_deposit") ?? first;
    if (leg === "quoted") return byAuto("build_quote") ?? first;
    if (leg === "estimate_scheduled") return byAuto("schedule_estimate") ?? first;
    return first; // new / contacted
  };

  const { data: custs } = await admin
    .from("customers")
    .select("id, stage, workflow_stage_id, workflow_owner_id");
  let synced = 0;
  let assigned = 0;
  for (const c of custs ?? []) {
    let wf = c.workflow_stage_id
      ? stageById.get(c.workflow_stage_id as string)
      : undefined;
    let didAssign = false;
    if (!wf) {
      wf = targetFor((c.stage as string) ?? null);
      didAssign = true;
    }
    if (!wf) continue;
    const lead = deriveLeadStage(
      { name: (wf.name as string) ?? null, position: wf.position as number },
      anchors,
    );
    const patch: Record<string, unknown> = { stage: lead };
    if (didAssign) {
      patch.workflow_stage_id = wf.id;
      if (!c.workflow_owner_id && wf.default_owner)
        patch.workflow_owner_id = wf.default_owner;
      assigned++;
    }
    await admin.from("customers").update(patch).eq("id", c.id);
    synced++;
  }

  revalidatePath("/dashboard");
  revalidatePath("/customers");
  revalidatePath("/pipeline");
  revalidatePath("/settings/stages");
  return { ok: true, synced, assigned };
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
