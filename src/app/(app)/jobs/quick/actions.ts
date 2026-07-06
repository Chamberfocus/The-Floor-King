"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { LeadSource } from "@/lib/types";

const STAMP = "Quick install — added straight to the schedule (no estimate).";

export interface QuickInstallInput {
  customerId: string | null;
  newCustomer: {
    full_name: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  title: string;
  scheduledDate: string | null;
  arrivalWindow: string | null; // "HH:MM-HH:MM"
  installerId: string | null;
  notes: string;
}

export interface QuickInstallResult {
  error: string | null;
  ok?: boolean;
  jobId?: string;
}

/**
 * Drop a sold, materials-in-hand job straight onto the schedule / installer
 * board — a customer + a job, nothing else. No estimate, no invoice, no money.
 * For work already sold in the old system that just needs to get installed.
 */
export async function createQuickInstall(
  input: QuickInstallInput,
): Promise<QuickInstallResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user?.id ?? null;

  if (!input.title.trim()) return { error: "Say what the work is." };

  // 1) Customer — pick an existing one, or make a minimal record.
  let customerId = input.customerId ?? null;
  if (!customerId) {
    const nc = input.newCustomer;
    if (!nc?.full_name?.trim()) return { error: "Add the customer's name." };
    const { data: created, error: custErr } = await supabase
      .from("customers")
      .insert({
        full_name: nc.full_name.trim(),
        phone: nc.phone?.trim() || null,
        street: nc.street?.trim() || null,
        city: nc.city?.trim() || null,
        state: nc.state?.trim() || null,
        zip: nc.zip?.trim() || null,
        source: "repeat" as LeadSource,
        stage: "won",
        qualified: true,
        notes: STAMP,
        workflow_owner_id: uid,
        assigned_to: uid,
        created_by: uid,
      })
      .select("id")
      .single();
    if (custErr || !created)
      return { error: custErr?.message || "Couldn't add the customer." };
    customerId = created.id as string;
  }

  // Pull the address onto the job so the crew/work order has the site.
  const { data: cust } = await supabase
    .from("customers")
    .select("street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();

  // 2) Job — schedulable, on the board. No estimate attached.
  const jobNote = [input.notes?.trim(), STAMP].filter(Boolean).join("\n");
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      customer_id: customerId,
      title: input.title.trim(),
      status: input.scheduledDate ? "scheduled" : "unscheduled",
      scheduled_date: input.scheduledDate || null,
      arrival_window: input.scheduledDate ? input.arrivalWindow || null : null,
      assigned_to: input.installerId || null,
      notes: jobNote,
      migrated: true,
      site_street: cust?.street ?? null,
      site_city: cust?.city ?? null,
      site_state: cust?.state ?? null,
      site_zip: cust?.zip ?? null,
      created_by: uid,
    })
    .select("id")
    .single();
  if (jobErr || !job)
    return { error: jobErr?.message || "Couldn't create the job." };

  revalidatePath("/jobs");
  revalidatePath("/board");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true, jobId: job.id as string };
}
