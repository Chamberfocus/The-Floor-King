"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { moveToAutoActionStage } from "@/lib/workflow-engine";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The first thing we do with a fresh lead: capture the intake answers, mark it
 * qualified, hand it to an owner, and push it forward to "Estimate Needs
 * Scheduled" — all in one move. This is the guided flow's step 1.
 */
export async function qualifyAndAssign(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const owner = str(formData.get("owner")) || null;
  const skipped = str(formData.get("skip")) === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body = "Lead marked qualified.";
  if (!skipped) {
    const { data: qs } = await supabase
      .from("qualifying_questions")
      .select("id, label")
      .eq("active", true)
      .order("position", { ascending: true });
    const lines: string[] = [];
    for (const q of qs ?? []) {
      const answer = str(formData.get(`q_${q.id}`));
      if (answer) lines.push(`• ${q.label}\n    ${answer}`);
    }
    if (lines.length) body = `Lead qualified:\n${lines.join("\n")}`;
  } else {
    body = "Qualification skipped.";
  }

  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: skipped ? "system" : "note",
    body,
  });

  // Mark qualified and assign the owner before advancing, so the workflow
  // engine carries the chosen owner forward to the next stage.
  // The qualify step assigns the SALESPERSON — lock them in as the permanent
  // account owner (assigned_to) too, so the client stays theirs through every
  // later handoff to admin/warehouse.
  const qualifyPatch: Record<string, unknown> = {
    qualified: true,
    workflow_owner_id: owner,
  };
  let ownerIsSalesperson = false;
  if (owner) {
    const { data: op } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", owner)
      .maybeSingle();
    ownerIsSalesperson = ["salesman", "sales_manager"].includes(
      (op?.role as string) ?? "",
    );
    if (ownerIsSalesperson) qualifyPatch.assigned_to = owner;
  }
  await supabase.from("customers").update(qualifyPatch).eq("id", customerId);

  // Credit any already-booked estimate visit to the assigned salesperson too.
  if (ownerIsSalesperson) {
    await supabase
      .from("appointments")
      .update({ salesperson_id: owner })
      .eq("customer_id", customerId)
      .eq("kind", "estimate")
      .eq("status", "scheduled");
  }

  // Forward to the stage that schedules the estimate (skips the old standalone
  // "Qualifying" parking stage — qualify is now the first stage's action).
  await moveToAutoActionStage(customerId, "schedule_estimate");

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/pipeline");
  redirect(`/customers/${customerId}`);
}

export async function saveQualification(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: qs } = await supabase
    .from("qualifying_questions")
    .select("id, label")
    .eq("active", true)
    .order("position", { ascending: true });

  const lines: string[] = [];
  for (const q of qs ?? []) {
    const answer = str(formData.get(`q_${q.id}`));
    if (answer) lines.push(`• ${q.label}\n    ${answer}`);
  }
  const body = lines.length
    ? `Lead qualified:\n${lines.join("\n")}`
    : "Lead marked qualified.";

  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: "note",
    body,
  });
  await supabase.from("customers").update({ qualified: true }).eq("id", customerId);

  revalidatePath(`/customers/${customerId}`);
}

export async function skipQualification(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: "system",
    body: "Qualification skipped.",
  });
  await supabase.from("customers").update({ qualified: true }).eq("id", customerId);
  revalidatePath(`/customers/${customerId}`);
}
