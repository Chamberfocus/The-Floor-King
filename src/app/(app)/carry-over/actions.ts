"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { finalizeInvoiceSafe } from "@/lib/invoice-issue";
import { applyEligibleDepositsToInvoice } from "@/lib/data/apply-customer-deposits";
import { resolveOrCreateCustomer } from "@/lib/data/customer-resolve";
import type { ScoredCustomerMatch } from "@/lib/customer-resolve";
import type { LeadSource, LeadStage } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);
const n = (v: number | string | null | undefined): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

const STAMP = "Carried over from prior system at go-live.";

// The real states a deal can be in when you switch systems.
export type CarryKind =
  | "estimate_appt" // estimate appointment booked, not quoted yet
  | "quoted" // quote is out, waiting on a yes/no
  | "awaiting_materials" // sold, materials on order
  | "install_scheduled" // sold, install booked, not started
  | "balance_due"; // work done, customer still owes

type PaymentMethod =
  | "card"
  | "cash"
  | "check"
  | "echeck"
  | "financing"
  | "link"
  | "other";

export interface CarryOverInput {
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
  useExistingId?: string | null;
  forceCreate?: boolean;
  overrideReason?: string | null;
  salespersonId: string | null; // the client's owner + estimate rep
  kind: CarryKind;
  title: string;
  amount: number; // quote / contract total (not used for estimate_appt)
  estCost: number; // optional all-in cost if known
  taxRate: number;
  // money already collected (deposit, or paid-so-far for balance due)
  collected: number;
  collectedDate: string | null;
  method: string;
  soldDate: string | null; // invoice issue date
  // scheduling
  apptAt: string | null; // estimate appointment datetime (estimate_appt)
  scheduledDate: string | null; // install date
  // ops (sold installs only) — installer + what the warehouse should stage
  installerId: string | null;
  stageNotes: string;
}

export interface CarryOverResult {
  error: string | null;
  ok?: boolean;
  customerId?: string;
  matches?: ScoredCustomerMatch[];
}

const stageFor = (kind: CarryKind): LeadStage => {
  if (kind === "estimate_appt") return "estimate_scheduled";
  if (kind === "quoted") return "quoted";
  return "won";
};

/**
 * Bring ONE in-process deal over from the old system at its current state,
 * without re-entering line items. Creates real, connected records so the
 * pipeline, the estimate schedule, the job board, AR and Business Pulse all
 * read true. Everything is stamped as a carry-over.
 */
export async function carryOverDeal(
  input: CarryOverInput,
): Promise<CarryOverResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user?.id ?? null;

  // The client's owner + estimate rep = the chosen salesperson (falls back to
  // the person doing the carry-over if none was picked).
  const ownerId = input.salespersonId || uid;

  const kind = input.kind;
  const targetStage = stageFor(kind);
  const amount = n(input.amount);
  const needsAmount = kind !== "estimate_appt";
  if (needsAmount && amount <= 0)
    return { error: "Enter the quote / contract amount." };
  if (kind === "estimate_appt" && !input.apptAt)
    return { error: "Pick the estimate appointment date & time." };

  // 1) Resolve the customer ----------------------------------------------------
  let customerId = input.customerId ?? null;
  let custName = "";
  if (!customerId) {
    const nc = input.newCustomer;
    if (!nc?.full_name?.trim()) return { error: "Add the customer's name." };
    custName = nc.full_name.trim();
    const resolved = await resolveOrCreateCustomer({
      input: {
        fullName: custName,
        phone: nc.phone?.trim() || null,
        email: nc.email?.trim() || null,
        address: nc.street?.trim() || null,
        city: nc.city?.trim() || null,
        state: nc.state?.trim() || null,
        zip: nc.zip?.trim() || null,
      },
      insert: {
        full_name: custName,
        phone: nc.phone?.trim() || null,
        email: nc.email?.trim() || null,
        street: nc.street?.trim() || null,
        city: nc.city?.trim() || null,
        state: nc.state?.trim() || null,
        zip: nc.zip?.trim() || null,
        source: (nc.source || "repeat") as LeadSource,
        stage: targetStage,
        notes: STAMP,
        qualified: true,
        workflow_owner_id: ownerId,
        created_by: uid,
        assigned_to: ownerId,
      },
      useExistingId: input.useExistingId,
      forceCreate: input.forceCreate,
      overrideReason: input.overrideReason,
    });
    if (resolved.action === "needs_choice") {
      return { error: null, matches: resolved.matches };
    }
    if (resolved.action === "error") return { error: resolved.error };
    customerId = resolved.customerId;
  } else {
    const { data: c } = await supabase
      .from("customers")
      .select("source, full_name")
      .eq("id", customerId)
      .maybeSingle();
    custName = (c?.full_name as string) ?? "";
    await supabase
      .from("customers")
      .update({
        stage: targetStage,
        source: (c?.source as string | null) || "repeat",
        qualified: true,
        // Only set the owner when a salesperson was explicitly chosen — don't
        // clobber an existing client's owner otherwise.
        ...(input.salespersonId
          ? { assigned_to: input.salespersonId, workflow_owner_id: input.salespersonId }
          : {}),
      })
      .eq("id", customerId);
  }

  const { data: cust } = await supabase
    .from("customers")
    .select("street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();
  const address = [cust?.street, cust?.city, cust?.state, cust?.zip]
    .filter(Boolean)
    .join(", ");

  // 2) Estimate appointment (not quoted yet) — book it and we're done ---------
  if (kind === "estimate_appt") {
    // Land the lead on the "schedule estimate" workflow stage so the guided
    // flow shows the booked appointment (not a nag to schedule it).
    const { data: schedStage } = await supabase
      .from("workflow_stages")
      .select("id")
      .eq("auto_action", "schedule_estimate")
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (schedStage?.id) {
      await supabase
        .from("customers")
        .update({ workflow_stage_id: schedStage.id })
        .eq("id", customerId);
    }
    const { error: apptErr } = await supabase.from("appointments").insert({
      customer_id: customerId,
      salesperson_id: ownerId,
      kind: "estimate",
      starts_at: input.apptAt,
      address: address || null,
      contact_name: custName || null,
      notes: STAMP,
      status: "scheduled",
      source: "staff",
      created_by: uid,
    });
    if (apptErr) return { error: apptErr.message };
    revalidatePath("/schedule");
    revalidatePath("/calendar");
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/customers");
    return { error: null, ok: true, customerId };
  }

  // 3) Estimate + option + one summary line -----------------------------------
  const isSold = kind !== "quoted";
  const { data: org } = await supabase
    .from("org_settings")
    .select("quote_valid_days")
    .eq("id", "default")
    .maybeSingle();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (Number(org?.quote_valid_days) || 30));

  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      title: input.title?.trim() || "Carried-over work",
      status: isSold ? "approved" : "sent",
      tax_rate: n(input.taxRate),
      presentation: "summary",
      job_description: STAMP,
      valid_until: validUntil.toISOString().slice(0, 10),
      migrated: true,
      created_by: uid,
    })
    .select("id")
    .single();
  if (estErr || !est)
    return { error: estErr?.message || "Couldn't create the estimate." };

  const { data: opt, error: optErr } = await supabase
    .from("estimate_options")
    .insert({ estimate_id: est.id, name: "Option A", position: 0 })
    .select("id")
    .single();
  if (optErr || !opt)
    return { error: optErr?.message || "Couldn't create the option." };

  // Flat summary line: sell = amount, cost = all-in cost (kept in labor_cost so
  // the material-only freight markup doesn't double-count it).
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

  if (!isSold) {
    // Open quote — done. Lands in the pipeline.
    revalidatePath("/estimates");
    revalidatePath("/client-status");
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/customers");
    return { error: null, ok: true, customerId };
  }

  // Sold: mark accepted option so won/job logic is consistent.
  await supabase
    .from("estimates")
    .update({ accepted_option_id: opt.id })
    .eq("id", est.id);

  // 4) Job — for sold work that isn't finished (materials/scheduled) ----------
  let jobId: string | null = null;
  if (kind === "awaiting_materials" || kind === "install_scheduled") {
    const jobStatus =
      kind === "install_scheduled"
        ? "scheduled"
        : input.scheduledDate
          ? "scheduled"
          : "unscheduled";
    // Build the crew/warehouse note: what to stage + status + carry-over marker.
    const noteParts: string[] = [];
    if (input.stageNotes?.trim())
      noteParts.push(`To stage: ${input.stageNotes.trim()}`);
    if (kind === "awaiting_materials") noteParts.push("Awaiting materials");
    noteParts.push(STAMP);
    const jobNote = noteParts.join("\n");
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        customer_id: customerId,
        estimate_id: est.id,
        option_id: opt.id,
        title: input.title?.trim() || "Carried-over job",
        status: "unscheduled",
        // Schedule via schedule_job_install_safe when dated (0178 guard).
        notes: jobNote,
        migrated: true,
        site_street: cust?.street ?? null,
        site_city: cust?.city ?? null,
        site_state: cust?.state ?? null,
        site_zip: cust?.zip ?? null,
        created_by: uid,
        ...(input.installerId && !input.scheduledDate
          ? { assigned_to: input.installerId }
          : {}),
      })
      .select("id")
      .single();
    if (jobErr || !job)
      return { error: jobErr?.message || "Couldn't create the job." };
    jobId = job.id as string;

    if (input.scheduledDate) {
      const { data: schedRes, error: schedErr } = await supabase.rpc(
        "schedule_job_install_safe",
        {
          p_job_id: jobId,
          p_scheduled_date: input.scheduledDate,
          p_scheduled_end: null,
          p_assigned_to: input.installerId || null,
          p_assigned_crew_id: null,
          p_set_arrival_window: false,
          p_open_for_claim: false,
        },
      );
      if (schedErr) return { error: schedErr.message };
      const body = schedRes as { ok?: boolean; error?: string } | null;
      if (body && body.ok === false) {
        return { error: body.error || "Could not schedule the carried-over install." };
      }
    } else if (jobStatus === "scheduled") {
      // Status-only: already handled if dated; undated "scheduled" is unusual —
      // leave unscheduled unless office books.
    }
  }

  // 5) Invoice for the contract + record money already collected --------------
  // For "balance due" this is the whole point; for sold-in-progress it captures
  // the deposit taken and the balance still owed.
  const collected = n(input.collected);
  const total = amount * (1 + n(input.taxRate) / 100);
  const paidStatus =
    collected >= total - 0.005 ? "paid" : collected > 0 ? "partial" : "sent";
  const { data: inv } = await supabase
    .from("invoices")
    .insert({
      customer_id: customerId,
      job_id: jobId,
      issue_date: input.soldDate || today(),
      status: "draft",
      tax_rate: n(input.taxRate),
      notes: STAMP,
      migrated: true,
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
    const fin = await finalizeInvoiceSafe(
      supabase,
      inv.id as string,
      uid ?? null,
    );
    if (!fin.ok) {
      return { error: fin.error || "Couldn't finalize carry-over invoice." };
    }
    await applyEligibleDepositsToInvoice(supabase, {
      invoiceId: inv.id as string,
      createdBy: uid ?? null,
      appliedOn: input.soldDate || today(),
    });
    if (collected > 0) {
      const paidAt = input.collectedDate || input.soldDate || today();
      const { data: payRes, error: payErr } = await supabase.rpc(
        "record_invoice_payment_safe",
        {
          p_invoice_id: inv.id,
          p_amount: collected,
          p_method: (input.method || "other") as PaymentMethod,
          p_reference: STAMP,
          p_paid_at: paidAt,
          p_notes: STAMP,
          p_created_by: uid,
          p_idempotency_key: `carryover:${inv.id}:${collected}:${paidAt}`,
          p_allow_deposit_on_zero_total: false,
        },
      );
      if (payErr) {
        return {
          error:
            payErr.message ||
            "Couldn't record carry-over payment via safe RPC.",
        };
      }
      const parsed = payRes as { ok?: boolean; error?: string };
      if (!parsed?.ok) {
        return {
          error: parsed?.error || "Couldn't record carry-over payment.",
        };
      }
    }
    if (paidStatus !== "sent") {
      await supabase
        .from("invoices")
        .update({ status: paidStatus })
        .eq("id", inv.id);
    }
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/jobs");
  revalidatePath("/board");
  revalidatePath("/invoices");
  revalidatePath("/estimates");
  revalidatePath("/client-status");
  revalidatePath("/pulse");
  return { error: null, ok: true, customerId };
}
