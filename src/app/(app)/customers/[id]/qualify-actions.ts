"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { employeeDbError } from "@/lib/employee-error";
import { moveToAutoActionStage } from "@/lib/workflow-engine";
import { leadAcceptanceForAssignment } from "@/lib/lead-acceptance";
import { notifySalespersonOfLead } from "@/lib/lead-assignment-notify";

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
  let ownerEmail: string | null = null;
  let ownerPhone: string | null = null;
  let ownerName: string | null = null;
  if (owner) {
    const { data: op } = await supabase
      .from("profiles")
      .select("full_name, email, phone, role")
      .eq("id", owner)
      .maybeSingle();
    ownerIsSalesperson = ["salesman", "sales_manager"].includes(
      (op?.role as string) ?? "",
    );
    ownerEmail = (op?.email as string | null) ?? null;
    ownerPhone = (op?.phone as string | null) ?? null;
    ownerName = (op?.full_name as string) || ownerEmail;
    if (ownerIsSalesperson) qualifyPatch.assigned_to = owner;
  }
  const acceptance = leadAcceptanceForAssignment({
    actorId: user?.id ?? "",
    assigneeId: owner,
    assigneeIsSales: ownerIsSalesperson,
  });
  if (acceptance) Object.assign(qualifyPatch, acceptance);
  const { error: assignError } = await supabase
    .from("customers")
    .update(qualifyPatch)
    .eq("id", customerId);
  if (assignError && acceptance && /lead_acceptance|lead_assigned_by/i.test(assignError.message)) {
    const plain = { ...qualifyPatch };
    delete plain.lead_acceptance;
    delete plain.lead_acceptance_note;
    delete plain.lead_acceptance_at;
    delete plain.lead_assigned_by;
    await supabase.from("customers").update(plain).eq("id", customerId);
  }
  if (acceptance?.lead_acceptance === "pending" && owner && owner !== user?.id) {
    const { data: named } = await supabase
      .from("customers")
      .select("full_name")
      .eq("id", customerId)
      .maybeSingle();
    const delivery = await notifySalespersonOfLead({
      toEmail: ownerEmail,
      toPhone: ownerPhone,
      customerName: (named?.full_name as string) || "A new lead",
      customerId,
    });
    await supabase.from("activities").insert({
      customer_id: customerId,
      user_id: user?.id ?? null,
      type: "system",
      body: `Assigned to ${ownerName ?? "a salesperson"}. They need to accept the lead. ${delivery}`,
    });
  }

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
  revalidatePath("/client-status");
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

/** Save the questionnaire answers to the customer + mark qualified. Returns a
 *  result so the pop-up can confirm success (no owner assign, no stage change). */
export async function qualifyAnswers(
  _prev: { error: string | null; ok?: boolean },
  formData: FormData,
): Promise<{ error: string | null; ok?: boolean }> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return { error: "Missing customer." };
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
  const { error } = await supabase
    .from("customers")
    .update({ qualified: true })
    .eq("id", customerId);
  if (error) {
    console.error("[qualifyCustomer]", error.code);
    return {
      error: employeeDbError(error.message, "This customer could not be updated. Refresh and try again."),
    };
  }

  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
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
