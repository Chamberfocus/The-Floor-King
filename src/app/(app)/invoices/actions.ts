"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  invoiceTotals,
  type SaveInvoiceInput,
} from "@/lib/invoice-calc";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { advanceFromAutoAction } from "@/lib/workflow-engine";
import { lineQty, discountAmount } from "@/lib/estimate-calc";
import type {
  EstimateLineItem,
  InvoiceStatus,
  PaymentMethod,
} from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Money changed → refresh every view that reports on money. */
/** Refresh the customer file and the linked job page (which show the invoice's
 *  balance / "collect balance") after an invoice/payment change. */
async function revalidateInvoiceLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string,
) {
  const { data: inv } = await supabase
    .from("invoices")
    .select("customer_id, job_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (inv?.customer_id) revalidatePath(`/customers/${inv.customer_id}`);
  if (inv?.job_id) revalidatePath(`/jobs/${inv.job_id}`);
}

function refreshMoneyViews() {
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/pulse");
  revalidatePath("/financials");
  revalidatePath("/reports");
}

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

/** The unit LABEL to bill a line under — the line's own unit (lnft / each /
 *  flat / sq yd…), matching exactly what the estimate shows. Only when a line
 *  has no unit do we fall back to its area measure. This is why a trim line no
 *  longer prints as "sqft" on the invoice. */
function unitLabelFor(l: EstimateLineItem): string {
  const u = (l.unit ?? "").trim();
  if (u) return u;
  return l.measure_unit === "sqyd" ? "sqyd" : "sqft";
}

/** The sell price of one estimate line — the exact number the invoice bills.
 *  Mirrors estimate-calc's lineTotal: waste rides on material, labor lines
 *  charge labor only, area lines price by measured area × rate × waste. */
function sellLineTotal(l: EstimateLineItem): number {
  if (l.line_type === "flat") return Number(l.flat_amount) || 0;
  const wasteMult = 1 + (Number(l.waste_pct) || 0) / 100;
  const isLabor = (l.category ?? null) === "labor";
  const unitRate =
    l.line_type === "mat_labor"
      ? (isLabor ? 0 : (Number(l.material_rate) || 0) * wasteMult) +
        (Number(l.labor_rate) || 0)
      : (Number(l.installed_rate) || 0) * wasteMult;
  return lineQty(l) * unitRate;
}

async function nextInvoiceNumber(supabase: SupabaseServerClient): Promise<string> {
  // Base the next number on the HIGHEST existing "INV-####", not the row count —
  // counting breaks when an invoice is deleted (the count drops and the next
  // number reuses a live one). Scan the current numbers and take max + 1.
  const { data } = await supabase.from("invoices").select("number").limit(10000);
  let max = 1000;
  for (const r of data ?? []) {
    const m = /(\d+)\s*$/.exec((r.number as string | null) ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `INV-${max + 1}`;
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
    .select("id, customer_id, tax_rate, title, accepted_option_id, discount_kind, discount_value")
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
    // Bill the EXACT same line total the customer approved. Waste raises the
    // material you ordered, so it rides in the rate. The estimate prices on the
    // FULL quantity; rounding it here (to a clean 2-dp quantity) would drift the
    // total, so we carry the precision in the rate instead:
    //   line total = fullQty × unitRate  (exactly the estimate's lineTotal)
    //   shown as    roundedQty × adjRate (same amount, tidy quantity)
    const wasteMult = 1 + (Number(l.waste_pct) || 0) / 100;
    // A labor line charges labor only — never re-add a stray material rate (this
    // must match the estimate's lineTotal, which zeroes material on labor lines).
    const isLabor = (l.category ?? null) === "labor";
    const unitRate =
      l.line_type === "mat_labor"
        ? (isLabor ? 0 : (l.material_rate ?? 0) * wasteMult) + (l.labor_rate ?? 0)
        : (l.installed_rate ?? 0) * wasteMult;
    const fullQty = lineQty(l);
    const shownQty = Math.round(fullQty * 100) / 100;
    const lineTotal = fullQty * unitRate;
    const adjRate = shownQty > 0 ? lineTotal / shownQty : unitRate;
    return {
      invoice_id: invoice.id,
      position: i,
      description: l.room ? `${l.room} — ${l.description}` : l.description,
      quantity: shownQty,
      // Use the line's OWN unit (lnft / each / flat / sq yd…), exactly like the
      // estimate — never force sqft, which mislabeled every non-area line.
      unit: unitLabelFor(l),
      rate: adjRate,
    };
  });
  // Carry the estimate's discount as a line so the invoice bills the same total
  // the customer approved (applied before tax, like the estimate).
  const sellSubtotal = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0),
    0,
  );
  const disc = discountAmount(sellSubtotal, est.discount_kind, est.discount_value);
  if (disc > 0) {
    items.push({
      invoice_id: invoice.id,
      position: items.length,
      description: "Discount",
      quantity: 1,
      unit: "ea",
      rate: -Math.round(disc * 100) / 100,
    });
  }

  if (items.length) await supabase.from("invoice_items").insert(items);

  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}

/** Create an invoice from a chosen subset of an estimate's line items. */
export async function createInvoiceFromSelection(
  formData: FormData,
): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  const lineIds = formData.getAll("line").map(String).filter(Boolean);
  if (!estimateId) return;

  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("id, customer_id, tax_rate, discount_kind, discount_value")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est) return;

  let lines: EstimateLineItem[] = [];
  if (lineIds.length) {
    const { data } = await supabase
      .from("estimate_line_items")
      .select("*")
      .in("id", lineIds)
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
    // Bill the EXACT same line total the customer approved. Waste raises the
    // material you ordered, so it rides in the rate. The estimate prices on the
    // FULL quantity; rounding it here (to a clean 2-dp quantity) would drift the
    // total, so we carry the precision in the rate instead:
    //   line total = fullQty × unitRate  (exactly the estimate's lineTotal)
    //   shown as    roundedQty × adjRate (same amount, tidy quantity)
    const wasteMult = 1 + (Number(l.waste_pct) || 0) / 100;
    // A labor line charges labor only — never re-add a stray material rate (this
    // must match the estimate's lineTotal, which zeroes material on labor lines).
    const isLabor = (l.category ?? null) === "labor";
    const unitRate =
      l.line_type === "mat_labor"
        ? (isLabor ? 0 : (l.material_rate ?? 0) * wasteMult) + (l.labor_rate ?? 0)
        : (l.installed_rate ?? 0) * wasteMult;
    const fullQty = lineQty(l);
    const shownQty = Math.round(fullQty * 100) / 100;
    const lineTotal = fullQty * unitRate;
    const adjRate = shownQty > 0 ? lineTotal / shownQty : unitRate;
    return {
      invoice_id: invoice.id,
      position: i,
      description: l.room ? `${l.room} — ${l.description}` : l.description,
      quantity: shownQty,
      unit: unitLabelFor(l),
      rate: adjRate,
    };
  });

  // Carry the estimate's discount so a billed subset matches the approved
  // price. A PERCENT discount applies cleanly to whatever subset is billed. A
  // FIXED-dollar discount belongs to the WHOLE estimate, so we bill only the
  // selected share of it (prorated by sell value) — never the full dollar
  // amount against a partial invoice.
  if (est.discount_value && Number(est.discount_value) > 0) {
    const selectedSub = lines.reduce((s, l) => s + sellLineTotal(l), 0);
    let disc = 0;
    if (est.discount_kind === "percent") {
      disc = discountAmount(selectedSub, "percent", est.discount_value);
    } else {
      // Prorate the fixed discount against the FULL option(s) the selected
      // lines belong to (line items are keyed by option, not estimate).
      const optionIds = [...new Set(lines.map((l) => l.option_id))];
      const { data: allLines } = optionIds.length
        ? await supabase
            .from("estimate_line_items")
            .select("*")
            .in("option_id", optionIds)
        : { data: [] };
      const fullSub = ((allLines ?? []) as EstimateLineItem[]).reduce(
        (s, l) => s + sellLineTotal(l),
        0,
      );
      const share = fullSub > 0 ? Math.min(1, selectedSub / fullSub) : 0;
      disc = Math.min(Number(est.discount_value) * share, selectedSub);
    }
    if (disc > 0) {
      items.push({
        invoice_id: invoice.id,
        position: items.length,
        description: "Discount",
        quantity: 1,
        unit: "ea",
        rate: -Math.round(disc * 100) / 100,
      });
    }
  }

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
      presentation: input.presentation || "detailed",
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

  // Crash-safe: insert the new items FIRST, then delete only the old ones. If
  // the insert fails the old line items survive, so an invoice can never be
  // left with no lines (a $0 invoice). The position index is non-unique, so
  // old + new rows can briefly coexist.
  const { data: oldItems } = await supabase
    .from("invoice_items")
    .select("id")
    .eq("invoice_id", invoiceId);
  const oldIds = (oldItems ?? []).map((r) => r.id as string);
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
  if (oldIds.length) {
    await supabase.from("invoice_items").delete().in("id", oldIds);
  }

  await recomputeStatus(supabase, invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  // Editing line items changes totals → refresh revenue/AR views and the
  // customer file + linked job balance too.
  await revalidateInvoiceLinks(supabase, invoiceId);
  refreshMoneyViews();
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

  // Intelligent flow: a deposit recorded while at "collect deposit" → order materials.
  const { data: inv } = await supabase
    .from("invoices")
    .select("customer_id, job_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (inv?.customer_id) {
    await advanceFromAutoAction(
      inv.customer_id as string,
      "collect_deposit",
    );
    revalidatePath(`/customers/${inv.customer_id}`);
  }
  // The job page shows this invoice's open balance / "collect balance" — refresh it.
  if (inv?.job_id) revalidatePath(`/jobs/${inv.job_id}`);

  revalidatePath(`/invoices/${invoiceId}`);
  refreshMoneyViews();
}

/**
 * Log a card payment straight onto a CUSTOMER (from the "Process card" flow).
 * Records it against the customer's active invoice, creating a minimal one if
 * they don't have any yet — so a card run always lands on the client as a
 * payment/deposit and updates their balance. Card data stays in the processor;
 * we only store the amount + method.
 */
export async function recordCardPayment(
  customerId: string,
  amount: number,
  note?: string | null,
): Promise<{ error: string | null }> {
  if (!customerId) return { error: "Missing customer." };
  if (!Number.isFinite(amount) || amount <= 0)
    return { error: "Enter the amount you charged." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Apply the card to the customer's invoice with an OPEN balance (the one they
  // actually owe on) — NOT just the most recent, which could be a fully-paid
  // invoice for a different job. If none is open, make a fresh invoice so the
  // deposit lands on its own record and never overpays a closed contract.
  const { data: candidates } = await supabase
    .from("invoices")
    .select("id, tax_rate, status")
    .eq("customer_id", customerId)
    .neq("status", "void")
    .order("created_at", { ascending: false });
  let invoiceId: string | undefined;
  for (const inv of candidates ?? []) {
    const [{ data: items }, { data: pays }] = await Promise.all([
      supabase.from("invoice_items").select("quantity, rate").eq("invoice_id", inv.id),
      supabase.from("payments").select("amount").eq("invoice_id", inv.id),
    ]);
    const total = invoiceTotals(
      (items ?? []) as { quantity: number | null; rate: number | null }[],
      inv.tax_rate as number,
      0,
    ).total;
    const paid = (pays ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (total - paid > 0.005) {
      invoiceId = inv.id as string;
      break;
    }
  }
  if (!invoiceId) {
    const { data: inv, error } = await supabase
      .from("invoices")
      .insert({
        customer_id: customerId,
        number: await nextInvoiceNumber(supabase),
        issue_date: today(),
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !inv) return { error: error?.message ?? "Could not create an invoice." };
    invoiceId = inv.id as string;
  }

  const { error: payErr } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    amount,
    method: "card" as PaymentMethod,
    reference: note?.trim() || "Card (SwipeSimple)",
    paid_at: today(),
    created_by: user?.id ?? null,
  });
  if (payErr) return { error: payErr.message };

  await recomputeStatus(supabase, invoiceId);
  await advanceFromAutoAction(customerId, "collect_deposit");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath(`/invoices/${invoiceId}`);
  refreshMoneyViews();
  return { error: null };
}

export async function deletePayment(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const invoiceId = str(formData.get("invoice_id"));
  if (!id || !invoiceId) return;
  const supabase = await createClient();
  await supabase.from("payments").delete().eq("id", id);
  await recomputeStatus(supabase, invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  await revalidateInvoiceLinks(supabase, invoiceId);
  refreshMoneyViews();
}

export async function setInvoiceStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as InvoiceStatus;
  if (!id || !status) return;
  const supabase = await createClient();
  await supabase.from("invoices").update({ status }).eq("id", id);
  revalidatePath(`/invoices/${id}`);
  await revalidateInvoiceLinks(supabase, id);
  refreshMoneyViews();
}

/** Mark an invoice as sent and email it to the customer. */
export async function emailInvoice(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  // The "send to client" popup can mark the invoice sent WITHOUT emailing.
  const skipClientEmail = str(formData.get("send_email")) === "no";
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
  if (!skipClientEmail && cust?.email) {
    await sendEmail({
      to: cust.email,
      subject: `Invoice ${inv?.number ?? ""} from Cleveland Floor King`.trim(),
      html: emailLayout(
        "Your invoice is ready",
        `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
         <p>Thank you for your business — it's truly appreciated! Your invoice${inv?.number ? ` ${inv.number}` : ""} is ready to view whenever you are.</p>
         <p>If you have any questions, just reply to this email and we'll be glad to help.</p>`,
        { label: "View your invoice", url: `${siteUrl()}/portal/invoices/${id}` },
        { preheader: `Your invoice${inv?.number ? ` ${inv.number}` : ""} is ready to view.` },
      ),
    });
  }

  revalidatePath(`/invoices/${id}`);
  redirect(`/invoices/${id}`);
}

/**
 * Permanently delete an invoice and everything attached to it: its line items
 * and ALL recorded payments (both cascade via their foreign keys). Any order
 * that pointed at it is unlinked automatically, and the linked job's balance,
 * the customer file, and the money views are all refreshed so the whole app
 * reflects the removal. Staff only; runs with the service role so it can never
 * silently fail on RLS.
 */
export async function deleteInvoice(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  let customerId = str(formData.get("customer_id"));
  if (!id) return;

  // Must be signed-in staff.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || (me.role as string) === "customer") return;

  const admin = createAdminClient();
  // Find what the invoice touches before removing it.
  const { data: inv } = await admin
    .from("invoices")
    .select("customer_id, job_id")
    .eq("id", id)
    .maybeSingle();
  if (inv) {
    if (!customerId) customerId = (inv.customer_id as string | null) ?? "";
    const jobId = (inv.job_id as string | null) ?? null;
    // invoice_items + payments cascade; orders.invoice_id is set null by the FK.
    await admin.from("invoices").delete().eq("id", id);
    if (jobId) revalidatePath(`/jobs/${jobId}`);
  }

  refreshMoneyViews();
  revalidatePath("/orders");
  revalidatePath("/invoices");
  if (customerId) revalidatePath(`/customers/${customerId}`);
  // Deleting from the list stays on the list; from a customer/invoice page it
  // returns to the customer file.
  const redirectTo = str(formData.get("redirect_to"));
  redirect(redirectTo || (customerId ? `/customers/${customerId}` : "/invoices"));
}
