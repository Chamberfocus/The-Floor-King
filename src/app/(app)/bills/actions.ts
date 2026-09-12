"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extractBill, getLastExtractError, type ExtractedBill } from "@/lib/extract";
import {
  AP_IMPORT_IDEMPOTENCY_REQUIRED_MESSAGE,
  resolveApDraftSaveIdempotencyKey,
  resolveApImportIdempotencyKey,
} from "@/lib/financial-idempotency";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function termDays(terms: string): number {
  if (terms === "due_on_receipt") return 0;
  const m = terms.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 30;
}
function addDaysYmd(base: string, days: number): number {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.getTime();
}
function addDaysYmdStr(base: string, days: number): string {
  const d = new Date(addDaysYmd(base, days));
  return ymd(d);
}

async function staffClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || !["admin", "office"].includes(me.role as string)) return null;
  return { supabase, userId: user.id };
}

function refreshAP() {
  revalidatePath("/bills");
  revalidatePath("/pulse");
  revalidatePath("/purchase-orders");
}

function rpcError(
  error: { message?: string } | null,
  data: unknown,
): string | null {
  if (error?.message) return error.message;
  if (data && typeof data === "object" && "ok" in data && (data as { ok?: boolean }).ok === false) {
    return String((data as { error?: string }).error || "Request failed.");
  }
  return null;
}

export async function extractBillFromUpload(
  storagePath: string,
  storageMime: string,
): Promise<{ error: string | null; bill?: ExtractedBill }> {
  if (!storagePath) return { error: "No file uploaded." };
  const ctx = await staffClient();
  if (!ctx) return { error: "You must be signed in as office staff." };
  if (!process.env.ANTHROPIC_API_KEY)
    return { error: "Reading bills needs the AI key (ANTHROPIC_API_KEY in Vercel)." };

  const { data: signed } = await ctx.supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, 600);
  if (!signed?.signedUrl) return { error: "Couldn't open the uploaded file." };

  const isPdf =
    storagePath.toLowerCase().endsWith(".pdf") || storageMime.includes("pdf");
  const bill = await extractBill({
    url: signed.signedUrl,
    mediaType: storageMime || (isPdf ? "application/pdf" : "image/jpeg"),
  });
  if (!bill)
    return {
      error:
        getLastExtractError() ||
        "Couldn't read that bill — try a clearer scan or enter it by hand.",
    };
  return { error: null, bill };
}

export interface ImportBillInput {
  vendor: string;
  bill_number: string;
  bill_date: string;
  due_date: string;
  terms: string;
  memo: string;
  idempotencyKey: string;
  items: {
    description: string;
    quantity: number | null;
    unit: string;
    unit_cost: number | null;
  }[];
}

export async function createBillFromImport(
  input: ImportBillInput,
): Promise<{ ok: boolean; billId?: string; error?: string }> {
  const idem = resolveApImportIdempotencyKey(input.idempotencyKey);
  if (!idem) return { ok: false, error: AP_IMPORT_IDEMPOTENCY_REQUIRED_MESSAGE };

  const ctx = await staffClient();
  if (!ctx) return { ok: false, error: "You must be signed in as office staff." };
  const { supabase } = ctx;

  const items = (input.items ?? []).filter(
    (i) => i.description?.trim() || (i.unit_cost ?? 0) !== 0,
  );
  if (!input.vendor?.trim() && !items.length)
    return { ok: false, error: "Nothing to import — no vendor or line items found." };

  if (!input.vendor?.trim()) {
    return { ok: false, error: "Pick a saved vendor. New bills cannot use a free-text vendor name as identity." };
  }

  const { data: sup } = await supabase
    .from("suppliers")
    .select("id")
    .ilike("name", input.vendor.trim())
    .limit(1)
    .maybeSingle();
  if (!sup?.id) {
    return {
      ok: false,
      error: `No saved vendor named “${input.vendor.trim()}”. Create the vendor under Settings → Suppliers first.`,
    };
  }

  const billDate = input.bill_date || ymd(new Date());
  const terms = input.terms || "net_30";
  const dueDate = input.due_date || addDaysYmdStr(billDate, termDays(terms));
  const lines = items.map((it, i) => ({
    position: i,
    description: it.description?.trim() || "Line",
    quantity: it.quantity ?? 1,
    unit: it.unit || "ea",
    unit_cost: it.unit_cost ?? 0,
  }));
  if (!lines.length) {
    return { ok: false, error: "Add at least one line item." };
  }

  const { data, error } = await supabase.rpc("create_vendor_bill_safe", {
    p_supplier_id: sup.id,
    p_lines: lines,
    p_bill_date: billDate,
    p_due_date: dueDate,
    p_bill_number: input.bill_number?.trim() || null,
    p_terms: terms,
    p_memo: input.memo?.trim() || null,
    p_job_id: null,
    p_po_id: null,
    p_accounting_category: "review_required",
    p_source_type: "manual",
    p_idempotency_key: idem,
  });
  const fail = rpcError(error, data);
  if (fail) return { ok: false, error: fail };
  const billId = (data as { bill_id?: string })?.bill_id;
  if (!billId) return { ok: false, error: "Couldn't create the bill." };
  refreshAP();
  return { ok: true, billId };
}

export async function createBillFromPO(formData: FormData): Promise<void> {
  const poId = str(formData.get("po_id"));
  if (!poId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  const { supabase } = ctx;

  const { data: existing } = await supabase
    .from("bills")
    .select("id, ap_lifecycle")
    .eq("po_id", poId)
    .neq("ap_lifecycle", "void")
    .limit(1)
    .maybeSingle();
  if (existing) redirect(`/bills/${existing.id}`);

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, supplier, supplier_id, customer_id, job_id")
    .eq("id", poId)
    .maybeSingle();
  if (!po?.supplier_id) return;
  const { data: items } = await supabase
    .from("po_items")
    .select("position, description, quantity, unit, unit_cost")
    .eq("po_id", poId)
    .order("position", { ascending: true });

  const terms = "net_30";
  const billDate = ymd(new Date());
  const lines = (items ?? []).map((it, i) => ({
    position: (it.position as number) ?? i,
    description: (it.description as string) ?? "PO line",
    quantity: (it.quantity as number | null) ?? 1,
    unit: (it.unit as string) ?? "sqft",
    unit_cost: (it.unit_cost as number | null) ?? 0,
  }));
  if (!lines.length) return;

  const { data, error } = await supabase.rpc("create_vendor_bill_safe", {
    p_supplier_id: po.supplier_id,
    p_lines: lines,
    p_bill_date: billDate,
    p_due_date: addDaysYmdStr(billDate, termDays(terms)),
    p_bill_number: null,
    p_terms: terms,
    p_memo: null,
    p_job_id: po.job_id ?? null,
    p_po_id: poId,
    p_accounting_category: "material_purchase",
    p_source_type: "purchase_order",
    p_idempotency_key: `ap-po:${poId}`,
  });
  if (rpcError(error, data)) return;
  const billId = (data as { bill_id?: string })?.bill_id;
  if (!billId) return;
  refreshAP();
  redirect(`/bills/${billId}`);
}

export async function activateBill(formData: FormData): Promise<void> {
  const billId = str(formData.get("bill_id"));
  if (!billId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  await ctx.supabase.rpc("activate_vendor_bill_safe", {
    p_bill_id: billId,
    p_idempotency_key: `ap-activate:${billId}`,
  });
  refreshAP();
  revalidatePath(`/bills/${billId}`);
}

export async function recordBillPayment(formData: FormData): Promise<void> {
  const billId = str(formData.get("bill_id"));
  const amount = parseFloat(str(formData.get("amount")));
  if (!billId || !Number.isFinite(amount) || amount <= 0) return;
  const ctx = await staffClient();
  if (!ctx) return;
  const { supabase, userId } = ctx;
  const date = str(formData.get("date")) || ymd(new Date());
  const method = str(formData.get("method")) || null;
  const note = str(formData.get("note")) || null;
  const idem =
    str(formData.get("idempotency_key")) ||
    `billpay:${billId}:${amount}:${date}:${userId}`;

  await supabase.rpc("record_bill_payment_safe", {
    p_bill_id: billId,
    p_amount: amount,
    p_date: date,
    p_method: method,
    p_note: note,
    p_created_by: userId,
    p_idempotency_key: idem,
  });

  refreshAP();
  revalidatePath(`/bills/${billId}`);
}

export async function voidBillPayment(formData: FormData): Promise<void> {
  const paymentId = str(formData.get("payment_id"));
  const billId = str(formData.get("bill_id"));
  const reason = str(formData.get("reason")) || "Reversed from bills screen";
  if (!paymentId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  await ctx.supabase.rpc("void_bill_payment_safe", {
    p_bill_payment_id: paymentId,
    p_voided_by: ctx.userId,
    p_void_reason: reason,
  });
  refreshAP();
  if (billId) revalidatePath(`/bills/${billId}`);
}

/** Draft-only metadata save. Active bills are immutable. */
export async function updateBillMeta(formData: FormData): Promise<void> {
  const billId = str(formData.get("bill_id"));
  if (!billId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  const { data: bill } = await ctx.supabase
    .from("bills")
    .select("ap_lifecycle, supplier_id, accounting_category, job_id")
    .eq("id", billId)
    .maybeSingle();
  if (!bill || (bill.ap_lifecycle as string) !== "draft") return;

  const { data: items } = await ctx.supabase
    .from("bill_items")
    .select("description, quantity, unit, unit_cost")
    .eq("bill_id", billId)
    .order("position", { ascending: true });
  const lines = (items ?? []).map((it, i) => ({
    position: i,
    description: it.description,
    quantity: it.quantity,
    unit: it.unit,
    unit_cost: it.unit_cost,
  }));
  if (!bill.supplier_id || !lines.length) return;

  const billDate = str(formData.get("bill_date"));
  const terms = str(formData.get("terms"));
  const dueDate = str(formData.get("due_date"));
  const billNumber = str(formData.get("bill_number"));
  const memo = str(formData.get("memo"));
  const idem = resolveApDraftSaveIdempotencyKey({
    billId,
    billDate,
    dueDate,
    billNumber,
    terms,
    memo,
  });
  await ctx.supabase.rpc("save_vendor_bill_draft_safe", {
    p_bill_id: billId,
    p_supplier_id: bill.supplier_id,
    p_lines: lines,
    p_bill_date: billDate || null,
    p_due_date: dueDate || null,
    p_bill_number: billNumber || null,
    p_terms: terms || null,
    p_memo: memo || null,
    p_job_id: bill.job_id,
    p_accounting_category: bill.accounting_category,
    p_idempotency_key: idem,
  });
  refreshAP();
  revalidatePath(`/bills/${billId}`);
}

export async function voidBill(formData: FormData): Promise<void> {
  const billId = str(formData.get("bill_id"));
  const reason = str(formData.get("reason")) || "Voided from bills screen";
  if (!billId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  await ctx.supabase.rpc("void_vendor_bill_safe", {
    p_bill_id: billId,
    p_reason: reason,
    p_idempotency_key: `ap-void:${billId}`,
  });
  refreshAP();
  revalidatePath(`/bills/${billId}`);
}

/** @deprecated Hard delete is forbidden. Use voidBill. */
export async function deleteBill(formData: FormData): Promise<void> {
  await voidBill(formData);
  redirect("/bills");
}

/** @deprecated Payments are reversed, never deleted. */
export async function deleteBillPayment(formData: FormData): Promise<void> {
  await voidBillPayment(formData);
}
