"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** Terms → days for the due date. */
function termDays(terms: string): number {
  if (terms === "due_on_receipt") return 0;
  const m = terms.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 30;
}
function addDaysYmd(base: string, days: number): string {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
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
  if (!me || (me.role as string) === "customer") return null;
  return { supabase, userId: user.id };
}

function refreshAP() {
  revalidatePath("/bills");
  revalidatePath("/pulse");
  revalidatePath("/purchase-orders");
}

/** Turn a purchase order into a Bill (accounts payable): copies the vendor and
 *  line items, sets a bill date + due date from the terms. Then opens the bill. */
export async function createBillFromPO(formData: FormData): Promise<void> {
  const poId = str(formData.get("po_id"));
  if (!poId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  const { supabase, userId } = ctx;

  // Don't create a second bill for the same PO.
  const { data: existing } = await supabase
    .from("bills")
    .select("id")
    .eq("po_id", poId)
    .limit(1)
    .maybeSingle();
  if (existing) redirect(`/bills/${existing.id}`);

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, supplier, supplier_id, customer_id, job_id")
    .eq("id", poId)
    .maybeSingle();
  if (!po) return;
  const { data: items } = await supabase
    .from("po_items")
    .select("position, description, quantity, unit, unit_cost")
    .eq("po_id", poId)
    .order("position", { ascending: true });

  const terms = "net_30";
  const billDate = ymd(new Date());
  const { data: bill, error } = await supabase
    .from("bills")
    .insert({
      po_id: poId,
      supplier: po.supplier ?? null,
      supplier_id: po.supplier_id ?? null,
      customer_id: po.customer_id ?? null,
      job_id: po.job_id ?? null,
      bill_date: billDate,
      due_date: addDaysYmd(billDate, termDays(terms)),
      terms,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !bill) return;

  const rows = (items ?? []).map((it, i) => ({
    bill_id: bill.id,
    position: (it.position as number) ?? i,
    description: (it.description as string) ?? "",
    quantity: it.quantity as number | null,
    unit: (it.unit as string) ?? "sqft",
    unit_cost: it.unit_cost as number | null,
  }));
  if (rows.length) await supabase.from("bill_items").insert(rows);

  refreshAP();
  redirect(`/bills/${bill.id}`);
}

/** Record a payment against a bill AND post a linked materials expense so the
 *  P&L reflects it — no separate manual entry. */
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

  const { data: bill } = await supabase
    .from("bills")
    .select("supplier, bill_number, job_id")
    .eq("id", billId)
    .maybeSingle();

  // Post to the P&L as a materials expense, linked back to this bill.
  const { data: expense } = await supabase
    .from("expenses")
    .insert({
      date,
      category: "materials",
      amount,
      vendor: (bill?.supplier as string | null) ?? null,
      note: `Bill payment${bill?.bill_number ? ` · ${bill.bill_number}` : ""}`,
      job_id: (bill?.job_id as string | null) ?? null,
      bill_id: billId,
      created_by: userId,
    })
    .select("id")
    .single();

  await supabase.from("bill_payments").insert({
    bill_id: billId,
    date,
    amount,
    method,
    note,
    expense_id: expense?.id ?? null,
    created_by: userId,
  });

  refreshAP();
  revalidatePath(`/bills/${billId}`);
  revalidatePath("/financials/expenses");
}

/** Remove a payment and its linked P&L expense. */
export async function deleteBillPayment(formData: FormData): Promise<void> {
  const paymentId = str(formData.get("payment_id"));
  const billId = str(formData.get("bill_id"));
  if (!paymentId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  const { supabase } = ctx;

  const { data: pay } = await supabase
    .from("bill_payments")
    .select("expense_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (pay?.expense_id) await supabase.from("expenses").delete().eq("id", pay.expense_id);
  await supabase.from("bill_payments").delete().eq("id", paymentId);

  refreshAP();
  if (billId) revalidatePath(`/bills/${billId}`);
  revalidatePath("/financials/expenses");
}

/** Edit the bill's dates / number / terms / memo. */
export async function updateBillMeta(formData: FormData): Promise<void> {
  const billId = str(formData.get("bill_id"));
  if (!billId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  const { supabase } = ctx;
  const billDate = str(formData.get("bill_date"));
  const terms = str(formData.get("terms"));
  const patch: Record<string, unknown> = {
    bill_number: str(formData.get("bill_number")) || null,
    memo: str(formData.get("memo")) || null,
  };
  if (billDate) {
    patch.bill_date = billDate;
    patch.terms = terms || "net_30";
    patch.due_date =
      str(formData.get("due_date")) || addDaysYmd(billDate, termDays(terms || "net_30"));
  }
  await supabase.from("bills").update(patch).eq("id", billId);
  refreshAP();
  revalidatePath(`/bills/${billId}`);
}

/** Delete a bill and everything it created: its items, payments, and the
 *  P&L expenses those payments posted. */
export async function deleteBill(formData: FormData): Promise<void> {
  const billId = str(formData.get("bill_id"));
  if (!billId) return;
  const ctx = await staffClient();
  if (!ctx) return;
  const { supabase } = ctx;

  const { data: pays } = await supabase
    .from("bill_payments")
    .select("expense_id")
    .eq("bill_id", billId);
  const expenseIds = (pays ?? [])
    .map((p) => p.expense_id as string | null)
    .filter(Boolean) as string[];
  if (expenseIds.length) await supabase.from("expenses").delete().in("id", expenseIds);
  // bill_items + bill_payments cascade with the bill.
  await supabase.from("bills").delete().eq("id", billId);

  refreshAP();
  revalidatePath("/financials/expenses");
  redirect("/bills");
}
