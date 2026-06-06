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
import type { EstimateStatus } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function toNumOrNull(v: string | number | null): number | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
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
        sqft: toNumOrNull(line.sqft),
        length_in: toNumOrNull(line.length_in),
        width_in: toNumOrNull(line.width_in),
        measure_unit: line.measure_unit === "sqyd" ? "sqyd" : "sqft",
        material_rate: toNumOrNull(line.material_rate),
        labor_rate: toNumOrNull(line.labor_rate),
        installed_rate: toNumOrNull(line.installed_rate),
        flat_amount: toNumOrNull(line.flat_amount),
        product_id: line.product_id || null,
        manufacturer: line.manufacturer || null,
        style: line.style || null,
        color: line.color || null,
        item_no: line.item_no || null,
        material_cost: toNumOrNull(line.material_cost ?? null),
        labor_cost: toNumOrNull(line.labor_cost ?? null),
        quantity: toNumOrNull(line.quantity ?? null),
        unit: line.unit || null,
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

export async function deleteEstimate(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const customerId = str(formData.get("customer_id"));
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("estimates").delete().eq("id", id);

  revalidatePath("/estimates");
  if (customerId) {
    revalidatePath(`/customers/${customerId}`);
    redirect(`/customers/${customerId}`);
  }
  redirect("/estimates");
}
