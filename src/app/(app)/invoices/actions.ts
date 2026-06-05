"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  invoiceTotals,
  type SaveInvoiceInput,
} from "@/lib/invoice-calc";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import type {
  EstimateLineItem,
  InvoiceStatus,
  PaymentMethod,
} from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function toNumOrNull(v: string | number | null): number | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function nextInvoiceNumber(supabase: SupabaseServerClient): Promise<string> {
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true });
  return `INV-${1000 + (count ?? 0) + 1}`;
}

/** Recompute paid/partial status from items + payments. */
async function recomputeStatus(
  supabase: SupabaseServerClient,
  invoiceId: string,
) {
  const { data: inv } = await supabase
    .from("invoices")
    .select("tax_rate, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv || inv.status === "void") return;

  const { data: items } = await supabase
    .from("invoice_items")
    .select("quantity, rate")
    .eq("invoice_id", invoiceId);
  const { data: pays } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoiceId);

  const paid = (pays ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const { total } = invoiceTotals(
    (items ?? []) as { quantity: number | null; rate: number | null }[],
    inv.tax_rate as number,
    paid,
  );

  let status = inv.status as InvoiceStatus;
  if (total > 0 && paid >= total) status = "paid";
  else if (paid > 0) status = "partial";
  else if (status === "paid" || status === "partial") status = "sent";

  await supabase.from("invoices").update({ status }).eq("id", invoiceId);
}

export async function createInvoiceFromEstimate(
  formData: FormData,
): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  if (!estimateId) return;

  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("id, customer_id, tax_rate, title, accepted_option_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est) return;

  let optionId = (est.accepted_option_id as string | null) ?? null;
  if (!optionId) {
    const { data: opt } = await supabase
      .from("estimate_options")
      .select("id")
      .eq("estimate_id", estimateId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    optionId = (opt?.id as string) ?? null;
  }

  let lines: EstimateLineItem[] = [];
  if (optionId) {
    const { data } = await supabase
      .from("estimate_line_items")
      .select("*")
      .eq("option_id", optionId)
      .order("position", { ascending: true });
    lines = (data ?? []) as EstimateLineItem[];
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      customer_id: est.customer_id,
      estimate_id: estimateId,
      number: await nextInvoiceNumber(supabase),
      tax_rate: est.tax_rate,
      issue_date: today(),
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !invoice) return;

  const items = lines.map((l, i) => {
    if (l.line_type === "flat") {
      return {
        invoice_id: invoice.id,
        position: i,
        description: l.room ? `${l.room} — ${l.description}` : l.description,
        quantity: 1,
        unit: "ea",
        rate: l.flat_amount,
      };
    }
    const rate =
      l.line_type === "mat_labor"
        ? (l.material_rate ?? 0) + (l.labor_rate ?? 0)
        : (l.installed_rate ?? 0);
    return {
      invoice_id: invoice.id,
      position: i,
      description: l.room ? `${l.room} — ${l.description}` : l.description,
      quantity: l.sqft,
      unit: "sqft",
      rate,
    };
  });
  if (items.length) await supabase.from("invoice_items").insert(items);

  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}

export async function createInvoice(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      customer_id: customerId,
      number: await nextInvoiceNumber(supabase),
      issue_date: today(),
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !invoice) return;
  revalidatePath("/invoices");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/invoices/${invoice.id}`);
}

export async function saveInvoice(
  invoiceId: string,
  input: SaveInvoiceInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      number: input.number || null,
      status: input.status,
      issue_date: input.issue_date || null,
      due_date: input.due_date || null,
      tax_rate:
        typeof input.tax_rate === "number"
          ? input.tax_rate
          : parseFloat(input.tax_rate) || 0,
      notes: input.notes || null,
      terms: input.terms || null,
    })
    .eq("id", invoiceId);
  if (updateError) return { error: updateError.message };

  await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
  if (input.items.length) {
    const rows = input.items.map((it, i) => ({
      invoice_id: invoiceId,
      position: i,
      description: it.description || "",
      quantity: toNumOrNull(it.quantity),
      unit: it.unit || "sqft",
      rate: toNumOrNull(it.rate),
    }));
    const { error: insertError } = await supabase
      .from("invoice_items")
      .insert(rows);
    if (insertError) return { error: insertError.message };
  }

  await recomputeStatus(supabase, invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { error: null };
}

export async function recordPayment(formData: FormData): Promise<void> {
  const invoiceId = str(formData.get("invoice_id"));
  const amount = toNumOrNull(str(formData.get("amount")));
  if (!invoiceId || amount === null) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("payments").insert({
    invoice_id: invoiceId,
    amount,
    method: (str(formData.get("method")) || "other") as PaymentMethod,
    reference: str(formData.get("reference")) || null,
    paid_at: str(formData.get("paid_at")) || today(),
    notes: str(formData.get("notes")) || null,
    created_by: user?.id ?? null,
  });

  await recomputeStatus(supabase, invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
}

export async function deletePayment(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const invoiceId = str(formData.get("invoice_id"));
  if (!id || !invoiceId) return;
  const supabase = await createClient();
  await supabase.from("payments").delete().eq("id", id);
  await recomputeStatus(supabase, invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function setInvoiceStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as InvoiceStatus;
  if (!id || !status) return;
  const supabase = await createClient();
  await supabase.from("invoices").update({ status }).eq("id", id);
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
}

/** Mark an invoice as sent and email it to the customer. */
export async function emailInvoice(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("invoices").update({ status: "sent" }).eq("id", id);

  const { data: inv } = await supabase
    .from("invoices")
    .select("number, customer:customers(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  const cust = inv?.customer as unknown as {
    full_name: string | null;
    email: string | null;
  } | null;
  if (cust?.email) {
    await sendEmail({
      to: cust.email,
      subject: `Invoice ${inv?.number ?? ""} from Cleveland Floor King`.trim(),
      html: emailLayout(
        "You have a new invoice",
        `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
         <p>Your invoice${inv?.number ? ` ${inv.number}` : ""} is ready. Tap below to view it.</p>`,
        { label: "View invoice", url: `${siteUrl()}/portal/invoices/${id}` },
      ),
    });
  }

  revalidatePath(`/invoices/${id}`);
  redirect(`/invoices/${id}`);
}

export async function deleteInvoice(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const customerId = str(formData.get("customer_id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("invoices").delete().eq("id", id);
  revalidatePath("/invoices");
  if (customerId) redirect(`/customers/${customerId}`);
  redirect("/invoices");
}
