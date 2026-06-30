"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { LeadSource } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);
const n = (v: number | string | null | undefined): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

const STAMP = "Carried over from prior system at go-live.";

export interface CarryOverInput {
  // Customer: pick an existing one OR create a new one inline.
  customerId: string | null;
  newCustomer: {
    full_name: string;
    phone: string;
    email: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    source: string;
  } | null;
  // The deal.
  kind: "estimate" | "install";
  title: string;
  amount: number; // quote / contract total (sell)
  estCost: number; // optional all-in cost (materials + labor) if known
  taxRate: number;
  // Install-only: money already in + schedule.
  depositCollected: number;
  depositDate: string | null;
  depositMethod: string;
  soldDate: string | null; // when it was sold (invoice issue date)
  scheduledDate: string | null;
  jobStatus: "scheduled" | "in_progress" | "unscheduled";
}

export interface CarryOverResult {
  error: string | null;
  ok?: boolean;
  customerId?: string;
}

/**
 * Bring ONE in-process deal over from the old system at its current state —
 * without re-entering line items. Creates real, connected records so pipeline,
 * the job board, AR and Business Pulse all read true:
 *   • a customer (picked or quick-added)
 *   • an estimate (open → "sent"; sold → "approved") with one summary line
 *   • for a sold install: a job, plus an invoice for the balance and a payment
 *     for any deposit already collected
 * Everything is stamped as a carry-over so it's distinguishable from fresh work.
 */
export async function carryOverDeal(
  input: CarryOverInput,
): Promise<CarryOverResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user?.id ?? null;

  const isInstall = input.kind === "install";
  const targetStage = isInstall ? "won" : "quoted";
  const amount = n(input.amount);
  if (amount <= 0) return { error: "Enter the quote / contract amount." };

  // 1) Resolve the customer ----------------------------------------------------
  let customerId = input.customerId ?? null;
  if (!customerId) {
    const nc = input.newCustomer;
    if (!nc?.full_name?.trim()) return { error: "Add the customer's name." };
    const { data: created, error: custErr } = await supabase
      .from("customers")
      .insert({
        full_name: nc.full_name.trim(),
        phone: nc.phone?.trim() || null,
        email: nc.email?.trim() || null,
        street: nc.street?.trim() || null,
        city: nc.city?.trim() || null,
        state: nc.state?.trim() || null,
        zip: nc.zip?.trim() || null,
        source: (nc.source || "repeat") as LeadSource,
        stage: targetStage,
        notes: STAMP,
        created_by: uid,
        assigned_to: uid,
      })
      .select("id")
      .single();
    if (custErr || !created) return { error: custErr?.message || "Couldn't add the customer." };
    customerId = created.id as string;
  } else {
    // Existing customer: make sure it has a lead source (estimates require one)
    // and move it to the right stage for this deal.
    const { data: c } = await supabase
      .from("customers")
      .select("source")
      .eq("id", customerId)
      .maybeSingle();
    await supabase
      .from("customers")
      .update({
        stage: targetStage,
        source: (c?.source as string | null) || "repeat",
      })
      .eq("id", customerId);
  }

  // 2) Site address for the job ------------------------------------------------
  const { data: cust } = await supabase
    .from("customers")
    .select("street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();

  // 3) Quote expiry from org settings -----------------------------------------
  const { data: org } = await supabase
    .from("org_settings")
    .select("quote_valid_days")
    .eq("id", "default")
    .maybeSingle();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (Number(org?.quote_valid_days) || 30));

  // 4) Estimate + option + one summary line -----------------------------------
  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      title: input.title?.trim() || "Carried-over work",
      status: isInstall ? "approved" : "sent",
      tax_rate: n(input.taxRate),
      presentation: "summary",
      job_description: STAMP,
      valid_until: validUntil.toISOString().slice(0, 10),
      created_by: uid,
    })
    .select("id")
    .single();
  if (estErr || !est) return { error: estErr?.message || "Couldn't create the estimate." };

  const { data: opt, error: optErr } = await supabase
    .from("estimate_options")
    .insert({ estimate_id: est.id, name: "Option A", position: 0 })
    .select("id")
    .single();
  if (optErr || !opt) return { error: optErr?.message || "Couldn't create the option." };

  // One flat summary line: sell = amount, cost = the all-in cost if known.
  // The cost goes in labor_cost so the freight markup (material-only) doesn't
  // double-count a carry-over cost that already includes freight.
  const { error: lineErr } = await supabase.from("estimate_line_items").insert({
    option_id: opt.id,
    position: 0,
    line_type: "flat",
    category: "other",
    description: input.title?.trim() || "Carried-over work",
    unit: "each",
    flat_amount: amount,
    material_cost: 0,
    labor_cost: n(input.estCost),
    material_rate: 0,
    labor_rate: 0,
    waste_pct: 0,
  });
  if (lineErr) return { error: lineErr.message };

  if (isInstall) {
    // Mark the estimate's accepted option so won/job logic is consistent.
    await supabase
      .from("estimates")
      .update({ accepted_option_id: opt.id })
      .eq("id", est.id);

    // 5) The job (sold work, at its current stage) ----------------------------
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        customer_id: customerId,
        estimate_id: est.id,
        option_id: opt.id,
        title: input.title?.trim() || "Carried-over job",
        status: input.jobStatus || "scheduled",
        scheduled_date: input.scheduledDate || null,
        site_street: cust?.street ?? null,
        site_city: cust?.city ?? null,
        site_state: cust?.state ?? null,
        site_zip: cust?.zip ?? null,
        created_by: uid,
      })
      .select("id")
      .single();
    if (jobErr || !job) return { error: jobErr?.message || "Couldn't create the job." };

    // 6) Invoice for the contract + record any deposit already collected ------
    const deposit = n(input.depositCollected);
    const total = amount * (1 + n(input.taxRate) / 100);
    const status =
      deposit >= total - 0.005 ? "paid" : deposit > 0 ? "partial" : "sent";
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        customer_id: customerId,
        job_id: job.id,
        issue_date: input.soldDate || today(),
        status,
        tax_rate: n(input.taxRate),
        notes: STAMP,
        created_by: uid,
      })
      .select("id")
      .single();
    if (inv) {
      await supabase.from("invoice_items").insert({
        invoice_id: inv.id,
        position: 0,
        description: input.title?.trim() || "Carried-over work",
        quantity: 1,
        unit: "each",
        rate: amount,
      });
      if (deposit > 0) {
        await supabase.from("payments").insert({
          invoice_id: inv.id,
          amount: deposit,
          method: (input.depositMethod || "other") as
            | "card"
            | "cash"
            | "check"
            | "echeck"
            | "financing"
            | "link"
            | "other",
          paid_at: input.depositDate || today(),
          notes: STAMP,
          created_by: uid,
        });
      }
    }
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/jobs");
  revalidatePath("/invoices");
  revalidatePath("/estimates");
  revalidatePath("/pulse");
  return { error: null, ok: true, customerId };
}
