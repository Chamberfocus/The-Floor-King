"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, assertRole } from "@/lib/auth";
import { releaseJobReservations } from "@/lib/po-stock";
import { syncPosForEstimate } from "@/app/(app)/purchase-orders/actions";
import {
  num,
  type SaveEstimateInput,
  type WizardSubmit,
} from "@/lib/estimate-calc";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import {
  moveToAutoActionStage,
  advanceFromAutoAction,
  advanceToNamedStage,
} from "@/lib/workflow-engine";
import { ensureJobForEstimate } from "@/app/(app)/jobs/actions";
import { getCustomerSourceStatus } from "@/lib/data/lead-sources";
import type { EstimateStatus } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function toNumOrNull(v: string | number | null): number | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Quote expiration date = today + the org's quote_valid_days (default 30). */
async function quoteValidUntil(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string> {
  const { data } = await supabase
    .from("org_settings")
    .select("quote_valid_days")
    .eq("id", "default")
    .maybeSingle();
  const days = Number(data?.quote_valid_days) || 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Create a blank draft estimate for a customer and open the builder. */
export async function createEstimate(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;

  const supabase = await createClient();
  // Lead source (+ its required sub-detail) must be recorded. The dashboard's
  // inline gate normally handles this before we get here; this is the fallback.
  const { ok } = await getCustomerSourceStatus(customerId);
  if (!ok) redirect(`/customers/${customerId}`);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: estimate, error } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      created_by: user?.id ?? null,
      title: "New estimate",
      valid_until: await quoteValidUntil(supabase),
    })
    .select("id")
    .single();
  if (error || !estimate) return;

  await supabase
    .from("estimate_options")
    .insert({ estimate_id: estimate.id, name: "Option 1", position: 0 });

  revalidatePath(`/customers/${customerId}`);
  redirect(`/estimates/${estimate.id}/edit`);
}

/** Replace the estimate's options + lines with the builder's current state. */
export async function saveEstimate(
  estimateId: string,
  input: SaveEstimateInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { error: updateError } = await supabase
    .from("estimates")
    .update({
      title: input.title || null,
      tax_rate: num(input.tax_rate),
      presentation: input.presentation,
      notes: input.notes || null,
      job_description: input.job_description || null,
      target_margin: input.target_margin != null && input.target_margin !== "" ? num(input.target_margin) : null,
      discount_kind: input.discount_kind === "percent" ? "percent" : "amount",
      discount_value: num(input.discount_value),
    })
    .eq("id", estimateId);
  if (updateError) return { error: updateError.message };

  // Rebuild options + lines. CRITICAL: reuse existing option rows by position
  // instead of delete-and-recreate. jobs.option_id and estimates.accepted_option_id
  // reference an option; recreating options with new ids would cascade
  // jobs.option_id to NULL and blank the job's scope / warehouse materials for an
  // already-approved job. Reusing ids keeps those references intact.
  const { data: existingOpts } = await supabase
    .from("estimate_options")
    .select("id")
    .eq("estimate_id", estimateId)
    .order("position", { ascending: true });
  const existingIds = (existingOpts ?? []).map((o) => o.id as string);

  // The persisted option id at each position — so the owner-recommended option
  // (tracked by index in the builder) resolves to a stable id after the save.
  const savedOptionIds: string[] = [];

  for (let i = 0; i < input.options.length; i++) {
    const option = input.options[i];
    let optionId = existingIds[i];
    if (optionId) {
      // Update the option in place (keeps its id + any job/accepted reference).
      const { error: optUpErr } = await supabase
        .from("estimate_options")
        .update({
          name: option.name || `Option ${i + 1}`,
          position: i,
          notes: option.notes || null,
        })
        .eq("id", optionId);
      if (optUpErr) return { error: optUpErr.message };
      // Replace this option's line items (lines reference option_id only).
      await supabase.from("estimate_line_items").delete().eq("option_id", optionId);
    } else {
      const { data: optionRow, error: optionError } = await supabase
        .from("estimate_options")
        .insert({
          estimate_id: estimateId,
          name: option.name || `Option ${i + 1}`,
          position: i,
          notes: option.notes || null,
        })
        .select("id")
        .single();
      if (optionError || !optionRow) {
        return { error: optionError?.message ?? "Could not save an option." };
      }
      optionId = optionRow.id as string;
    }
    savedOptionIds[i] = optionId;

    if (option.lines.length) {
      const lineRows = option.lines.map((line, j) => {
        // A labor line charges labor only — never persist a material rate/cost on
        // it (that's what was double-charging installation labor).
        const isLabor = (line.category || null) === "labor";
        return {
        option_id: optionId,
        position: j,
        room: line.room || null,
        description: line.description || "",
        note: line.note?.trim() || null,
        line_type: line.line_type,
        category: line.category || null,
        sqft: toNumOrNull(line.sqft),
        length_in: toNumOrNull(line.length_in),
        width_in: toNumOrNull(line.width_in),
        measure_unit: line.measure_unit === "sqyd" ? "sqyd" : "sqft",
        material_rate: isLabor ? null : toNumOrNull(line.material_rate),
        labor_rate: toNumOrNull(line.labor_rate),
        installed_rate: toNumOrNull(line.installed_rate),
        flat_amount: toNumOrNull(line.flat_amount),
        waste_pct: toNumOrNull(line.waste_pct ?? null) ?? 0,
        product_id: line.product_id || null,
        manufacturer: line.manufacturer || null,
        style: line.style || null,
        color: line.color || null,
        item_no: line.item_no || null,
        material_cost: isLabor ? null : toNumOrNull(line.material_cost ?? null),
        labor_cost: toNumOrNull(line.labor_cost ?? null),
        quantity: toNumOrNull(line.quantity ?? null),
        unit: line.unit || null,
        from_stock: !!line.from_stock,
        margin_pct: toNumOrNull(line.margin_pct ?? null),
        order_as_roll: !!line.order_as_roll,
        roll_width_ft: toNumOrNull(line.roll_width_ft ?? null),
        sqft_per_box: toNumOrNull(line.sqft_per_box ?? null),
        is_fill: !!line.is_fill,
        is_optional: !!line.is_optional,
        coverage_sqft: toNumOrNull(line.coverage_sqft ?? null),
        coverage_thickness_in: toNumOrNull(line.coverage_thickness_in ?? null),
        prep_thickness_in: toNumOrNull(line.prep_thickness_in ?? null),
        prep_key: line.prep_key || null,
        // First-class measured pieces (areas / carpet cuts). Labor isn't measured.
        measurements:
          !isLabor && line.measurements && line.measurements.length
            ? line.measurements
            : null,
        };
      });
      let { error: lineError } = await supabase
        .from("estimate_line_items")
        .insert(lineRows);
      if (lineError) {
        // Fallback for before the line-note (0110) / measurements (0128) columns
        // are run — save the rest so the estimate still persists.
        const legacy = lineRows.map(({ note: _n, measurements: _m, ...rest }) => rest);
        ({ error: lineError } = await supabase.from("estimate_line_items").insert(legacy));
      }
      if (lineError) return { error: lineError.message };
    }
  }

  // Resolve the owner-recommended option (tracked by index) to its saved id.
  const recIdx = input.recommended_index;
  const recommendedId =
    recIdx != null && recIdx >= 0 && recIdx < savedOptionIds.length
      ? savedOptionIds[recIdx]
      : null;
  await supabase
    .from("estimates")
    .update({ recommended_option_id: recommendedId })
    .eq("id", estimateId);

  // Options removed in this edit (existing rows beyond the new count).
  const removedIds = existingIds.slice(input.options.length);
  if (removedIds.length) {
    await supabase.from("estimate_options").delete().in("id", removedIds);
  }

  // Editing an approved estimate's scope changes the linked job's materials
  // (getJobMaterials reads live by option_id), so refresh those surfaces too.
  const { data: est } = await supabase
    .from("estimates")
    .select("customer_id")
    .eq("id", estimateId)
    .maybeSingle();
  // Carpet cuts are the single source: re-derive any linked PO's ordered yardage
  // so the PO's "Order qty" tracks the edited cuts automatically (no re-entry).
  // Work order / staging read the cuts live, so they need no push.
  await syncPosForEstimate(estimateId);

  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath(`/estimates/${estimateId}/edit`);
  revalidatePath("/estimates");
  if (est?.customer_id) revalidatePath(`/customers/${est.customer_id}`);
  revalidatePath("/jobs");
  revalidatePath("/warehouse");
  revalidatePath("/purchase-orders");
  return { error: null };
}

/** Move an estimate through its status workflow. */
export async function setEstimateStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as EstimateStatus;
  if (!id || !status) return;
  // The "send to client" popup can opt OUT of the customer email (still marks
  // the estimate sent — just doesn't email). Absent field = send (back-compat).
  const skipClientEmail = str(formData.get("send_email")) === "no";

  const patch: Record<string, unknown> = { status };
  if (status === "sent") {
    patch.sent_at = new Date().toISOString();
    // The 2-hour follow-up is driven off thankyou_sent_at being null. When the
    // send popup opts OUT of emailing the client, stamp it now so the cron
    // doesn't email them anyway — the opt-out was being honoured for two hours
    // and then quietly overridden.
    patch.thankyou_sent_at = skipClientEmail ? new Date().toISOString() : null;
  }
  if (status === "approved") {
    patch.accepted_option_id = str(formData.get("accepted_option_id")) || null;
  }
  if (status === "declined" || status === "changes_requested") {
    patch.customer_response_note =
      str(formData.get("customer_response_note")) || null;
  }

  const supabase = await createClient();
  await supabase.from("estimates").update(patch).eq("id", id);

  if (status === "declined") await onEstimateDeclined(supabase, id);

  // Intelligent flow: approved → jump the customer to the deposit stage;
  // sent → advance out of the "build/price the quote" stage.
  if (status === "approved" || status === "sent") {
    const { data: ec } = await supabase
      .from("estimates")
      .select("customer_id")
      .eq("id", id)
      .maybeSingle();
    if (ec?.customer_id) {
      if (status === "approved")
        await moveToAutoActionStage(ec.customer_id as string, "collect_deposit");
      else await advanceFromAutoAction(ec.customer_id as string, "build_quote");
    }
    // Approval auto-creates the job (idempotent) so the win never stalls.
    if (status === "approved") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await ensureJobForEstimate(id, user?.id ?? null);
    }
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    revalidatePath("/jobs");
    if (ec?.customer_id) revalidatePath(`/customers/${ec.customer_id}`);
  }

  if (status === "sent" && !skipClientEmail) {
    const { data: est } = await supabase
      .from("estimates")
      .select("title, customer:customers(full_name, email)")
      .eq("id", id)
      .maybeSingle();
    const cust = est?.customer as unknown as {
      full_name: string | null;
      email: string | null;
    } | null;
    if (cust?.email) {
      await sendEmail({
        to: cust.email,
        subject: "Your estimate from Cleveland Floor King 🎉",
        html: emailLayout(
          "Thank you for the opportunity!",
          `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
           <p>Thank you so much for the opportunity to earn your business — we truly appreciate it and would be delighted to bring your floors to life.</p>
           <p>Your estimate${est?.title ? ` &ldquo;${est.title}&rdquo;` : ""} is ready to review. Tap below to view it and approve, decline, or request changes — whatever works best for you.</p>
           <p>We can't wait to work with you!</p>`,
          { label: "View & approve your estimate", url: `${siteUrl()}/portal/estimates/${id}` },
          { preheader: "Thank you for the opportunity — your estimate is ready to review." },
        ),
        tags: [
          { name: "category", value: "estimate" },
          { name: "estimate_id", value: id },
        ],
      });
    }
  }

  if (status === "approved") {
    const { data: est } = await supabase
      .from("estimates")
      .select("title, customer:customers(full_name, assigned_to, workflow_owner_id)")
      .eq("id", id)
      .maybeSingle();
    const cust = est?.customer as unknown as {
      full_name: string | null;
      assigned_to: string | null;
      workflow_owner_id: string | null;
    } | null;

    const recipients = new Set<string>([ownerEmail()]);
    const repId = cust?.assigned_to ?? cust?.workflow_owner_id ?? null;
    if (repId) {
      const { data: rep } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", repId)
        .maybeSingle();
      if (rep?.email) recipients.add(rep.email as string);
    }
    for (const to of recipients) {
      await sendEmail({
        to,
        subject: `Estimate approved 🎉 — ${cust?.full_name ?? "customer"}`,
        html: emailLayout(
          "Estimate approved",
          `<p><strong>${cust?.full_name ?? "A customer"}</strong> approved estimate${est?.title ? ` "${est.title}"` : ""}. Time to collect the deposit and order materials.</p>`,
          { label: "Open estimate", url: `${siteUrl()}/estimates/${id}` },
        ),
      });
    }
  }

  revalidatePath(`/estimates/${id}`);
  revalidatePath("/estimates");
  redirect(`/estimates/${id}`);
}

/** Build a complete estimate from the wizard: one line per room + add-on lines. */
export async function createEstimateFromWizard(
  customerId: string,
  input: WizardSubmit,
): Promise<{ error: string | null; id?: string }> {
  if (!customerId) return { error: "Missing customer." };

  const supabase = await createClient();
  const { ok } = await getCustomerSourceStatus(customerId);
  if (!ok) {
    return {
      error: "Record this customer's lead source (and its detail) before creating an estimate.",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Compile the job description from detail answers + included add-ons.
  const detailLines = input.answers
    .filter((a) => a.kind === "detail" && a.value.trim())
    .map((a) => `${a.label}: ${a.value.trim()}`);
  const addons = input.answers.filter((a) => a.kind === "addon" && a.included);
  const jobDescription = [
    ...detailLines,
    addons.length ? `Includes: ${addons.map((a) => a.label).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { data: estimate, error } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      created_by: user?.id ?? null,
      title: input.title || "Estimate",
      tax_rate: num(input.tax_rate),
      presentation: input.presentation,
      job_description: jobDescription || null,
      valid_until: await quoteValidUntil(supabase),
    })
    .select("id")
    .single();
  if (error || !estimate) {
    return { error: error?.message ?? "Could not create the estimate." };
  }

  const { data: option, error: optionError } = await supabase
    .from("estimate_options")
    .insert({ estimate_id: estimate.id, name: "Option 1", position: 0 })
    .select("id")
    .single();
  if (optionError || !option) {
    return { error: optionError?.message ?? "Could not create the option." };
  }

  const lines: Record<string, unknown>[] = [];
  let pos = 0;
  for (const r of input.rooms) {
    if (!r.name && !r.sqft && !r.description && !r.length_in && !r.width_in)
      continue;
    lines.push({
      option_id: option.id,
      position: pos++,
      room: r.name || null,
      description: r.description || r.name || "Flooring",
      line_type: r.line_type,
      sqft: toNumOrNull(r.sqft),
      length_in: toNumOrNull(r.length_in),
      width_in: toNumOrNull(r.width_in),
      measure_unit: r.measure_unit === "sqyd" ? "sqyd" : "sqft",
      material_rate: toNumOrNull(r.material_rate),
      labor_rate: toNumOrNull(r.labor_rate),
      installed_rate: toNumOrNull(r.installed_rate),
      flat_amount: null,
      product_id: r.product_id || null,
      material_cost: toNumOrNull(r.material_cost ?? null),
      labor_cost: toNumOrNull(r.labor_cost ?? null),
      quantity: null,
      unit: r.measure_unit === "sqyd" ? "sqyd" : "sqft",
      category: r.category || null,
      manufacturer: r.manufacturer || null,
      style: r.style || null,
      color: r.color || null,
      item_no: r.item_no || null,
    });
  }
  for (const a of addons) {
    const qty = toNumOrNull(a.quantity ?? null);
    const unitPrice = toNumOrNull(a.unit_price ?? null);
    const usesQty = qty != null || unitPrice != null;
    lines.push({
      option_id: option.id,
      position: pos++,
      room: null,
      description: a.label,
      line_type: usesQty ? "mat_labor" : "flat",
      sqft: null,
      measure_unit: "sqft",
      material_rate: usesQty ? unitPrice : null,
      labor_rate: usesQty ? 0 : null,
      installed_rate: null,
      flat_amount: usesQty ? null : toNumOrNull(a.amount),
      product_id: null,
      material_cost: toNumOrNull(a.material_cost ?? null),
      labor_cost: toNumOrNull(a.labor_cost ?? null),
      quantity: usesQty ? (qty ?? 1) : null,
      unit: a.unit || null,
    });
  }
  if (lines.length) {
    const { error: lineError } = await supabase
      .from("estimate_line_items")
      .insert(lines);
    if (lineError) return { error: lineError.message };
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/estimates");
  return { error: null, id: estimate.id };
}

/** Delete every DRAFT estimate (fast cleanup of test/unsent quotes). */
export async function deleteAllDraftEstimates(): Promise<void> {
  const supabase = await createClient();
  await supabase.from("estimates").delete().eq("status", "draft");
  revalidatePath("/estimates");
  revalidatePath("/dashboard");
  revalidatePath("/pulse");
  redirect("/estimates");
}

export interface EstimateDeleteImpact {
  jobs: number; // work orders
  purchaseOrders: number;
  invoices: number;
}

/** Count everything a delete would take down, so the warning is honest. */
export async function getEstimateDeleteImpact(id: string): Promise<EstimateDeleteImpact> {
  const empty = { jobs: 0, purchaseOrders: 0, invoices: 0 };
  if (!id) return empty;
  // Same gate as the delete it previews — otherwise it confirms which estimate
  // ids are real, and how much damage each one would do, to anyone signed in.
  await assertRole(["admin", "office"]);
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return empty;
  }
  const { data: jobRows } = await admin.from("jobs").select("id").eq("estimate_id", id);
  const jobIds = (jobRows ?? []).map((j) => j.id as string);
  const countWhere = async (table: string) => {
    const orParts = [`estimate_id.eq.${id}`];
    if (jobIds.length) orParts.push(`job_id.in.(${jobIds.join(",")})`);
    const { count } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .or(orParts.join(","));
    return count ?? 0;
  };
  return {
    jobs: jobIds.length,
    purchaseOrders: await countWhere("purchase_orders"),
    invoices: await countWhere("invoices"),
  };
}

/**
 * What actually happens when a quote is turned down.
 *
 * Declining used to write a status string and stop: the customer stayed on
 * "Awaiting Customer Response" in the pipeline, and next_action_due kept firing
 * the daily "stuck too long" nudge at the rep forever. The win/loss report
 * counted them as lost (it reads estimate status) while the pipeline counted
 * them as live (it reads workflow_stage_id) — two sources of truth disagreeing
 * about the same customer.
 *
 * Deliberately does NOT move the customer when they still have another live
 * quote: someone weighing two options who declines one is very much still a
 * live client. And it never sets cancelled_at — a declined quote is real
 * lost-business data that the win/loss report needs, not a cancellation.
 */
export async function onEstimateDeclined(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
): Promise<void> {
  const { data: est } = await supabase
    .from("estimates")
    .select("customer_id")
    .eq("id", estimateId)
    .maybeSingle();
  const customerId = (est?.customer_id as string | null) ?? null;
  if (!customerId) return;

  const { data: others } = await supabase
    .from("estimates")
    .select("id, status")
    .eq("customer_id", customerId)
    .neq("id", estimateId);
  const LIVE = ["draft", "sent", "changes_requested", "approved"];
  if ((others ?? []).some((o) => LIVE.includes(o.status as string))) return;

  await advanceToNamedStage(customerId, /lost|declin/i);
  // Stop the daily nudge chasing a dead lead, and let the coarse stage agree
  // with the detailed one.
  await supabase
    .from("customers")
    .update({ stage: "lost", next_action_due: null })
    .eq("id", customerId);
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath(`/customers/${customerId}`);
}

export interface UnapproveResult {
  error: string | null;
  removedJob?: boolean;
  releasedPos?: number;
}

/**
 * Undo an estimate approval.
 *
 * Approving is not a status change — it creates a job, reserves stock, raises
 * purchase orders and moves the customer to Collect Deposit. The "Reopen" button
 * only flipped the status back, leaving all of that behind: a phantom job on the
 * board, material held for work nobody sold, and a customer reading as Won.
 *
 * REFUSES when the job has real progress behind it. Once an invoice exists, a
 * payment has landed, material has been received or the crew has started, this
 * is no longer a mis-click to undo — it's a cancellation, and cancelling has its
 * own path that keeps the paperwork. Silently deleting that history to be
 * helpful would be the worst thing this function could do.
 */
export async function unapproveEstimate(
  formData: FormData,
): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  await assertRole(["admin", "office", "sales_manager"]);
  const supabase = await createClient();

  const { data: est } = await supabase
    .from("estimates")
    .select("id, customer_id, status, title")
    .eq("id", id)
    .maybeSingle();
  if (!est || est.status !== "approved") return;

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, status, scheduled_date, completed_at, actual_labor_cost")
    .eq("estimate_id", id);

  for (const j of jobs ?? []) {
    // Anything that means the world has moved on.
    const blockers: string[] = [];
    if (j.status === "completed") blockers.push("the job is completed");
    if (j.scheduled_date) blockers.push("the install is booked");
    if (j.actual_labor_cost != null) blockers.push("labor has been costed");

    const { count: invCount } = await supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("job_id", j.id);
    if ((invCount ?? 0) > 0) blockers.push("an invoice has been raised");

    const { data: received } = await supabase
      .from("purchase_orders")
      .select("id, status")
      .eq("estimate_id", id)
      .in("status", ["received", "closed"]);
    if (received?.length) blockers.push("material has been received");

    if (blockers.length) {
      redirect(
        `/estimates/${id}?undo=blocked&why=${encodeURIComponent(blockers.join("; "))}`,
      );
    }
  }

  const jobIds = (jobs ?? []).map((j) => j.id as string);

  // Give back anything the approval reserved, and drop the POs it auto-raised.
  // Only DRAFTS — an issued PO has a number the supplier has seen, and voiding
  // that is a deliberate act, not a side effect of undoing a click.
  let releasedPos = 0;
  if (jobIds.length) await releaseJobReservations(supabase, jobIds);
  const { data: draftPos } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("estimate_id", id)
    .eq("status", "draft");
  if (draftPos?.length) {
    const ids = draftPos.map((p) => p.id as string);
    await supabase.from("po_items").delete().in("po_id", ids);
    await supabase.from("purchase_orders").delete().in("id", ids);
    releasedPos = ids.length;
  }
  if (jobIds.length) await supabase.from("jobs").delete().in("id", jobIds);

  await supabase
    .from("estimates")
    .update({ status: "sent", accepted_option_id: null })
    .eq("id", id);

  // Put the customer back where they were: awaiting an answer, not Won. The
  // engine only moves forward, so this is written directly.
  //
  // But ONLY if nothing else of theirs is sold. A customer with two quotes who
  // un-approves one is still Won on the other, and dragging them back to
  // "Awaiting Customer Response" would take a live job off the pipeline. This
  // is exactly what happened undoing the Behun tile approval while the flooring
  // estimate was approved.
  if (est.customer_id) {
    const { count: stillSold } = await supabase
      .from("estimates")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", est.customer_id)
      .eq("status", "approved")
      .neq("id", id);

    if (!stillSold) {
      const { data: stages } = await supabase
        .from("workflow_stages")
        .select("id, name, position")
        .order("position");
      const back = (stages ?? []).find((s) =>
        /awaiting customer|customer response/i.test((s.name as string) ?? ""),
      );
      const patch: Record<string, unknown> = { stage: "quoted" };
      if (back) patch.workflow_stage_id = back.id;
      await supabase.from("customers").update(patch).eq("id", est.customer_id);
    }

    await supabase.from("activities").insert({
      customer_id: est.customer_id,
      type: "system",
      body: `Approval undone on "${est.title ?? "estimate"}" — back to Sent.${
        jobIds.length ? ` The job it created was removed.` : ""
      }${releasedPos ? ` ${releasedPos} draft purchase order(s) removed.` : ""} Any reserved material was released.`,
    });
    revalidatePath(`/customers/${est.customer_id}`);
  }

  revalidatePath(`/estimates/${id}`);
  revalidatePath("/estimates");
  revalidatePath("/jobs");
  revalidatePath("/board");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/purchase-orders");
  revalidatePath("/inventory");
  redirect(`/estimates/${id}?undo=ok`);
}

export async function deleteEstimate(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  let customerId = str(formData.get("customer_id"));
  if (!id) return;
  // requireProfile only proves you are SIGNED IN — it returns any role,
  // including a portal customer. This function then elevates to the service
  // role and cascade-deletes invoices AND their payments, which is the
  // accounting history. It must be office-and-above, matching the is_staff()
  // policy the service role is bypassing.
  await assertRole(["admin", "office"]);

  // Cascade EVERYTHING tied to this estimate. Jobs/POs/invoices reference the
  // estimate with `on delete set null`, so deleting the estimate alone would
  // orphan them — instead we delete them (their children cascade), then the
  // estimate (its options + line items cascade). Service-role client so the
  // cleanup can't be half-blocked by row-level security.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    admin = await createClient(); // fall back (may leave orphans under RLS)
  }

  // Always know the customer (some delete buttons don't pass it) — needed to wipe
  // that customer's questionnaire state below and to redirect back.
  if (!customerId) {
    const { data: estRow } = await admin
      .from("estimates")
      .select("customer_id")
      .eq("id", id)
      .maybeSingle();
    customerId = (estRow?.customer_id as string) || "";
  }

  const { data: jobRows } = await admin.from("jobs").select("id").eq("estimate_id", id);
  const jobIds = (jobRows ?? []).map((j) => j.id as string);
  const del = async (table: string) => {
    // Delete rows tied directly to the estimate…
    await admin.from(table).delete().eq("estimate_id", id);
    // …and rows tied to any of this estimate's work orders.
    if (jobIds.length) await admin.from(table).delete().in("job_id", jobIds);
  };
  await del("purchase_orders"); // PO items cascade
  await del("invoices"); // invoice items + payments cascade
  // Work orders — their labor, materials, stock movements, satisfaction, photos
  // cascade / detach on delete.
  await admin.from("jobs").delete().eq("estimate_id", id);
  // Finally the estimate itself (options + line items cascade).
  await admin.from("estimates").delete().eq("id", id);

  // Start-clean: wipe this customer's questionnaire state so a NEW guided estimate
  // begins completely blank — both any leftover in-progress answers (draft) and
  // the saved measured rooms that would otherwise pre-fill. (Confirmed behavior:
  // deleting an estimate resets the customer to a clean slate.)
  if (customerId) {
    await admin.from("estimate_drafts").delete().eq("customer_id", customerId);
    await admin.from("customer_areas").delete().eq("customer_id", customerId);
  }

  // An estimate drives pipeline value & quoted-revenue forecasts — refresh the
  // money views so they don't show a deleted estimate's numbers.
  revalidatePath("/estimates");
  revalidatePath("/jobs");
  revalidatePath("/purchase-orders");
  revalidatePath("/invoices");
  revalidatePath("/pulse");
  revalidatePath("/financials");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
  if (customerId) {
    revalidatePath(`/customers/${customerId}`);
    redirect(`/customers/${customerId}`);
  }
  redirect("/estimates");
}

// --- Builder auto-save: one in-progress draft per estimate --------------------
// Best-effort (no-op if the drafts table isn't there yet). Fire-and-forget from
// the builder: it READS the current builder state and persists it; it never
// writes anything back into the fields being edited.

/** Auto-save the estimate builder's in-progress state (debounced by the client). */
export async function saveEstimateBuilderDraft(
  estimateId: string,
  data: unknown,
): Promise<{ ok: boolean }> {
  if (!estimateId) return { ok: false };
  try {
    const supabase = await createClient();
    await supabase.from("estimate_builder_drafts").upsert(
      { estimate_id: estimateId, data, updated_at: new Date().toISOString() },
      { onConflict: "estimate_id" },
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Load a builder's in-progress draft (null if none / table not set up). */
export async function getEstimateBuilderDraft(estimateId: string): Promise<unknown | null> {
  if (!estimateId) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("estimate_builder_drafts")
      .select("data")
      .eq("estimate_id", estimateId)
      .maybeSingle();
    return (data?.data as unknown) ?? null;
  } catch {
    return null;
  }
}

/** Clear a builder's draft (on an explicit Save, or "discard"). */
export async function clearEstimateBuilderDraft(estimateId: string): Promise<void> {
  if (!estimateId) return;
  try {
    const supabase = await createClient();
    await supabase.from("estimate_builder_drafts").delete().eq("estimate_id", estimateId);
  } catch {
    // best-effort
  }
}

/** Save the notes shown on the estimate (and its printed / PDF copy). */
export async function saveEstimateNotes(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const notes = str(formData.get("notes"));
  const supabase = await createClient();
  await supabase.from("estimates").update({ notes: notes || null }).eq("id", id);
  revalidatePath(`/estimates/${id}`);
}

/**
 * How the customer copy prices the job: "detailed" = itemized (a price on each
 * line); "summary" = one lump-sum total. Presentation only — the underlying
 * totals never change.
 */
export async function setEstimatePresentation(
  id: string,
  presentation: "detailed" | "summary",
): Promise<void> {
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("estimates")
    .update({ presentation: presentation === "summary" ? "summary" : "detailed" })
    .eq("id", id);
  revalidatePath(`/estimates/${id}`);
}

/** Independently toggle whether the captured questionnaire answers (the Project
 *  details list) appear on the customer copy. */
export async function setEstimateProjectDetails(id: string, show: boolean): Promise<void> {
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("estimates").update({ show_project_details: !!show }).eq("id", id);
  revalidatePath(`/estimates/${id}`);
}

/**
 * Mark an estimate sent: email the customer their portal link and advance the
 * customer's workflow stage. No redirect — callers decide where to go next
 * (the builder's "Save & send" sends here, then goes to the dashboard).
 */
export async function sendEstimateById(
  id: string,
  notifyClient = true,
): Promise<void> {
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("estimates")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      // Same rule as setEstimateStatus: not emailing the client must also mean
      // not emailing them two hours later from the cron.
      thankyou_sent_at: notifyClient ? null : new Date().toISOString(),
    })
    .eq("id", id);

  const { data: est } = await supabase
    .from("estimates")
    .select("title, customer_id, customer:customers(full_name, email)")
    .eq("id", id)
    .maybeSingle();

  if (est?.customer_id)
    await advanceFromAutoAction(est.customer_id as string, "build_quote");

  const cust = est?.customer as unknown as {
    full_name: string | null;
    email: string | null;
  } | null;
  if (notifyClient && cust?.email) {
    await sendEmail({
      to: cust.email,
      subject: "Your estimate from Cleveland Floor King 🎉",
      html: emailLayout(
        "Thank you for the opportunity!",
        `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
         <p>Thank you so much for the opportunity to earn your business — we truly appreciate it and would be delighted to bring your floors to life.</p>
         <p>Your estimate${est?.title ? ` &ldquo;${est.title}&rdquo;` : ""} is ready to review. Tap below to view it and approve, decline, or request changes — whatever works best for you.</p>
         <p>We can't wait to work with you!</p>`,
        { label: "View & approve your estimate", url: `${siteUrl()}/portal/estimates/${id}` },
        { preheader: "Thank you for the opportunity — your estimate is ready to review." },
      ),
      tags: [
        { name: "category", value: "estimate" },
        { name: "estimate_id", value: id },
      ],
    });
  }

  revalidatePath(`/estimates/${id}`);
  revalidatePath("/estimates");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

/** Strip the per-row identity so a line item can be re-inserted under a new option. */
function copyLineRow(line: Record<string, unknown>, optionId: string) {
  const row: Record<string, unknown> = { ...line, option_id: optionId };
  delete row.id;
  delete row.created_at;
  delete row.updated_at;
  return row;
}

/** Copy an option (good/better/best) into a new option on the SAME estimate. */
export async function duplicateOption(formData: FormData): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  const optionId = str(formData.get("option_id"));
  if (!estimateId || !optionId) return;
  const supabase = await createClient();

  const { data: opts } = await supabase
    .from("estimate_options")
    .select("id")
    .eq("estimate_id", estimateId);
  const count = (opts ?? []).length;
  const letter = String.fromCharCode(65 + count); // A, B, C…

  const { data: newOpt } = await supabase
    .from("estimate_options")
    .insert({ estimate_id: estimateId, name: `Option ${letter}`, position: count })
    .select("id")
    .single();
  if (!newOpt) return;

  const { data: lines } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("option_id", optionId)
    .order("position", { ascending: true });
  const rows = (lines ?? []).map((l) => copyLineRow(l as Record<string, unknown>, newOpt.id as string));
  if (rows.length) await supabase.from("estimate_line_items").insert(rows);

  revalidatePath(`/estimates/${estimateId}`);
  redirect(`/estimates/${estimateId}`);
}

/** Customer search for the "copy to a new estimate" picker. */
export async function searchCustomersForCopy(
  query: string,
): Promise<{ id: string; name: string; city: string | null }[]> {
  const q = (query ?? "").trim();
  const supabase = await createClient();
  let sel = supabase
    .from("customers")
    .select("id, full_name, city")
    .order("updated_at", { ascending: false })
    .limit(8);
  if (q) {
    const like = `%${q.replace(/[%,]/g, "")}%`;
    sel = sel.or(`full_name.ilike.${like},company.ilike.${like},city.ilike.${like}`);
  }
  const { data } = await sel;
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: c.full_name as string,
    city: (c.city as string) ?? null,
  }));
}

/** Copy a whole estimate (every option + line) to a NEW estimate for a chosen client. */
/** A customer's saved service addresses, for the copy dialog's picker. */
export async function serviceAddressesForCustomer(customerId: string): Promise<
  { id: string; label: string | null; street: string | null; city: string | null; state: string | null; zip: string | null }[]
> {
  if (!customerId) return [];
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("service_addresses")
    .select("id, label, street, city, state, zip")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  return (data ?? []) as {
    id: string; label: string | null; street: string | null;
    city: string | null; state: string | null; zip: string | null;
  }[];
}

export interface CopyAddressInput {
  /** An existing saved address on the target customer. */
  serviceAddressId?: string | null;
  /** Or a new one to create and attach. */
  newAddress?: {
    label?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
}

/**
 * Change which property an EXISTING estimate is for.
 *
 * Until now the service address could only be set when the estimate was
 * created (guided/AI/smart) or when it was copied. Get it wrong on a landlord
 * or builder account — where every estimate is for the same customer but a
 * different unit — and there was no way back short of rebuilding the estimate.
 *
 * Follows through, because the address is not just a label on the estimate:
 *  - the job created from it inherits service_address_id (ensureJobForEstimate),
 *    so an estimate fixed BEFORE the job is enough;
 *  - a job that already exists is re-pointed here, site_* fields and all, or the
 *    crew still gets sent to the old door.
 */
export async function setEstimateAddress(
  estimateId: string,
  address: CopyAddressInput = {},
): Promise<{ error: string | null }> {
  if (!estimateId) return { error: "No estimate." };
  await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: est } = await supabase
    .from("estimates")
    .select("id, customer_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est) return { error: "Estimate not found." };
  const customerId = est.customer_id as string;

  // A typed address is saved against the customer, so the next estimate for
  // that property picks it from the list instead of retyping it.
  let serviceAddressId: string | null = address.serviceAddressId || null;
  const na = address.newAddress;
  if (!serviceAddressId && na && (na.street?.trim() || na.label?.trim())) {
    const { data: created, error } = await supabase
      .from("service_addresses")
      .insert({
        customer_id: customerId,
        label: na.label?.trim() || null,
        street: na.street?.trim() || null,
        city: na.city?.trim() || null,
        state: na.state?.trim() || null,
        zip: na.zip?.trim() || null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !created) return { error: error?.message || "Couldn't save the address." };
    serviceAddressId = created.id as string;
  }

  const { error: updErr } = await supabase
    .from("estimates")
    .update({ service_address_id: serviceAddressId })
    .eq("id", estimateId);
  if (updErr) return { error: updErr.message };

  // Re-point any job already made from this estimate. Copying the site_* fields
  // matters: the staging sheet, the work order and the warehouse all read those,
  // not the service_addresses row.
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("estimate_id", estimateId);
  if (jobs?.length) {
    let site: { street: string | null; city: string | null; state: string | null; zip: string | null } = {
      street: null, city: null, state: null, zip: null,
    };
    const src = serviceAddressId
      ? await supabase.from("service_addresses").select("street, city, state, zip").eq("id", serviceAddressId).maybeSingle()
      : await supabase.from("customers").select("street, city, state, zip").eq("id", customerId).maybeSingle();
    if (src.data)
      site = {
        street: (src.data.street as string) ?? null,
        city: (src.data.city as string) ?? null,
        state: (src.data.state as string) ?? null,
        zip: (src.data.zip as string) ?? null,
      };
    for (const j of jobs) {
      await supabase
        .from("jobs")
        .update({
          service_address_id: serviceAddressId,
          site_street: site.street,
          site_city: site.city,
          site_state: site.state,
          site_zip: site.zip,
        })
        .eq("id", j.id as string);
      revalidatePath(`/jobs/${j.id}`);
    }
    revalidatePath("/jobs");
    revalidatePath("/warehouse");
  }

  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}

export async function duplicateEstimateToCustomer(
  estimateId: string,
  customerId: string,
  address: CopyAddressInput = {},
): Promise<{ error: string | null; estimateId?: string }> {
  if (!estimateId || !customerId) return { error: "Pick a client first." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: src } = await supabase
    .from("estimates")
    .select("title, tax_rate, presentation, job_description")
    .eq("id", estimateId)
    .maybeSingle();
  if (!src) return { error: "Original estimate not found." };

  /**
   * Where the work happens.
   *
   * A copy is usually the same scope at a DIFFERENT property — a landlord's
   * next unit, a builder's next lot. The copy dropped service_address_id
   * entirely, so the new estimate silently inherited the customer's billing
   * address and the crew was sent to the wrong door.
   *
   * A typed address is saved against the customer, so the second time you quote
   * that property it's already in the list.
   */
  let serviceAddressId: string | null = address.serviceAddressId || null;
  const na = address.newAddress;
  if (!serviceAddressId && na && (na.street?.trim() || na.label?.trim())) {
    const { data: created } = await supabase
      .from("service_addresses")
      .insert({
        customer_id: customerId,
        label: na.label?.trim() || null,
        street: na.street?.trim() || null,
        city: na.city?.trim() || null,
        state: na.state?.trim() || null,
        zip: na.zip?.trim() || null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    serviceAddressId = (created?.id as string) ?? null;
  }

  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      title: src.title,
      status: "draft",
      tax_rate: src.tax_rate,
      presentation: src.presentation,
      job_description: src.job_description,
      service_address_id: serviceAddressId,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (estErr || !est) return { error: estErr?.message || "Couldn't create the copy." };

  const { data: opts } = await supabase
    .from("estimate_options")
    .select("id, name, position")
    .eq("estimate_id", estimateId)
    .order("position", { ascending: true });
  for (const o of opts ?? []) {
    const { data: no } = await supabase
      .from("estimate_options")
      .insert({ estimate_id: est.id, name: o.name, position: o.position })
      .select("id")
      .single();
    if (!no) continue;
    const { data: lines } = await supabase
      .from("estimate_line_items")
      .select("*")
      .eq("option_id", o.id)
      .order("position", { ascending: true });
    const rows = (lines ?? []).map((l) => copyLineRow(l as Record<string, unknown>, no.id as string));
    if (rows.length) await supabase.from("estimate_line_items").insert(rows);
  }

  revalidatePath("/estimates");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, estimateId: est.id as string };
}
