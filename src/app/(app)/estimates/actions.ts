"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  num,
  type SaveEstimateInput,
  type WizardSubmit,
} from "@/lib/estimate-calc";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import {
  moveToAutoActionStage,
  advanceFromAutoAction,
} from "@/lib/workflow-engine";
import { ensureJobForEstimate } from "@/app/(app)/jobs/actions";
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
  const { data: cust } = await supabase
    .from("customers")
    .select("source")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust?.source) redirect(`/customers/${customerId}`);

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
    })
    .eq("id", estimateId);
  if (updateError) return { error: updateError.message };

  // Rebuild options + lines (cascade clears old lines).
  const { error: deleteError } = await supabase
    .from("estimate_options")
    .delete()
    .eq("estimate_id", estimateId);
  if (deleteError) return { error: deleteError.message };

  for (let i = 0; i < input.options.length; i++) {
    const option = input.options[i];
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

    if (option.lines.length) {
      const lineRows = option.lines.map((line, j) => ({
        option_id: optionRow.id,
        position: j,
        room: line.room || null,
        description: line.description || "",
        line_type: line.line_type,
        category: line.category || null,
        sqft: toNumOrNull(line.sqft),
        length_in: toNumOrNull(line.length_in),
        width_in: toNumOrNull(line.width_in),
        measure_unit: line.measure_unit === "sqyd" ? "sqyd" : "sqft",
        material_rate: toNumOrNull(line.material_rate),
        labor_rate: toNumOrNull(line.labor_rate),
        installed_rate: toNumOrNull(line.installed_rate),
        flat_amount: toNumOrNull(line.flat_amount),
        waste_pct: toNumOrNull(line.waste_pct ?? null) ?? 0,
        product_id: line.product_id || null,
        manufacturer: line.manufacturer || null,
        style: line.style || null,
        color: line.color || null,
        item_no: line.item_no || null,
        material_cost: toNumOrNull(line.material_cost ?? null),
        labor_cost: toNumOrNull(line.labor_cost ?? null),
        quantity: toNumOrNull(line.quantity ?? null),
        unit: line.unit || null,
        from_stock: !!line.from_stock,
        margin_pct: toNumOrNull(line.margin_pct ?? null),
      }));
      const { error: lineError } = await supabase
        .from("estimate_line_items")
        .insert(lineRows);
      if (lineError) return { error: lineError.message };
    }
  }

  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath(`/estimates/${estimateId}/edit`);
  revalidatePath("/estimates");
  return { error: null };
}

/** Move an estimate through its status workflow. */
export async function setEstimateStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as EstimateStatus;
  if (!id || !status) return;

  const patch: Record<string, unknown> = { status };
  if (status === "sent") {
    patch.sent_at = new Date().toISOString();
    patch.thankyou_sent_at = null;
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
  }

  if (status === "sent") {
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
        subject: "Your estimate from Cleveland Floor King",
        html: emailLayout(
          "Your estimate is ready",
          `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
           <p>Your estimate${est?.title ? ` &ldquo;${est.title}&rdquo;` : ""} is ready to review. Tap below to view it and approve, decline, or request changes.</p>`,
          { label: "View & approve", url: `${siteUrl()}/portal/estimates/${id}` },
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
  const { data: cust } = await supabase
    .from("customers")
    .select("source")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust?.source) {
    return {
      error: "Set this customer's lead source before creating an estimate.",
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

export async function deleteEstimate(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const customerId = str(formData.get("customer_id"));
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("estimates").delete().eq("id", id);

  // An estimate drives pipeline value & quoted-revenue forecasts — refresh the
  // money views so they don't show a deleted estimate's numbers.
  revalidatePath("/estimates");
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
 * Mark an estimate sent: email the customer their portal link and advance the
 * customer's workflow stage. No redirect — callers decide where to go next
 * (the builder's "Save & send" sends here, then goes to the dashboard).
 */
export async function sendEstimateById(id: string): Promise<void> {
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("estimates")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      thankyou_sent_at: null,
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
  if (cust?.email) {
    await sendEmail({
      to: cust.email,
      subject: "Your estimate from Cleveland Floor King",
      html: emailLayout(
        "Your estimate is ready",
        `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
         <p>Your estimate${est?.title ? ` &ldquo;${est.title}&rdquo;` : ""} is ready to review. Tap below to view it and approve, decline, or request changes.</p>`,
        { label: "View & approve", url: `${siteUrl()}/portal/estimates/${id}` },
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
export async function duplicateEstimateToCustomer(
  estimateId: string,
  customerId: string,
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

  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      title: src.title,
      status: "draft",
      tax_rate: src.tax_rate,
      presentation: src.presentation,
      job_description: src.job_description,
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
