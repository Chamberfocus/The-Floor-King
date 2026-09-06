import { createClient } from "@/lib/supabase/server";
import {
  apOriginalTotal,
  apRemaining,
  apSettlementStatus,
  type ApLifecycle,
  type ApSettlementStatus,
  type ApSourceType,
} from "@/lib/accounting/ap-source";

export interface BillItem {
  id: string;
  position: number;
  description: string;
  quantity: number | null;
  unit: string;
  unit_cost: number | null;
}
export interface BillPayment {
  id: string;
  date: string;
  amount: number;
  method: string | null;
  note: string | null;
  status?: string | null;
}
export interface Bill {
  id: string;
  po_id: string | null;
  supplier_id: string | null;
  supplier: string | null;
  job_id: string | null;
  customer_id: string | null;
  bill_number: string | null;
  bill_date: string;
  due_date: string | null;
  terms: string | null;
  memo: string | null;
  created_at: string;
  ap_lifecycle?: ApLifecycle | string | null;
  source_type?: ApSourceType | string | null;
  source_id?: string | null;
  installer_labor_bill_id?: string | null;
  accounting_category?: string | null;
  legacy_review_required?: boolean | null;
  items?: BillItem[];
  payments?: BillPayment[];
}

export type BillStatus = ApSettlementStatus;

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export function billSubtotal(items: Partial<BillItem>[] | undefined): number {
  return apOriginalTotal(
    (items ?? []).map((i) => ({ quantity: i.quantity, unit_cost: i.unit_cost })),
  );
}
export function billPaid(payments: Partial<BillPayment>[] | undefined): number {
  return (payments ?? [])
    .filter((p) => ((p.status as string | null | undefined) ?? "active") !== "void")
    .reduce((s, p) => s + num(p.amount), 0);
}
export function billStatus(
  total: number,
  paid: number,
  lifecycle?: string | null,
): BillStatus {
  return apSettlementStatus({
    lifecycle: lifecycle ?? "open",
    original: total,
    paidActive: paid,
  });
}
export function isOverdue(bill: { due_date: string | null }, balance: number): boolean {
  if (balance <= 0.005 || !bill.due_date) return false;
  return bill.due_date < new Date().toISOString().slice(0, 10);
}

export function sourceBadge(bill: Bill): string {
  if (bill.installer_labor_bill_id || bill.source_type === "installer_labor") {
    return "Installer Labor";
  }
  if (bill.po_id || bill.source_type === "purchase_order") return "Purchase Order";
  if (bill.source_type === "legacy") return "Legacy";
  return "Manual";
}

export interface BillRow extends Bill {
  total: number;
  paid: number;
  balance: number;
  status: BillStatus;
  overdue: boolean;
}

function toRow(
  b: Bill,
  items: Partial<BillItem>[] | undefined,
  payments: Partial<BillPayment>[] | undefined,
): BillRow {
  const total = billSubtotal(items);
  const paid = billPaid(payments);
  const lifecycle = (b.ap_lifecycle as string | null) ?? "open";
  const balance = apRemaining({ original: total, paidActive: paid, lifecycle });
  return {
    ...b,
    total,
    paid,
    balance,
    status: billStatus(total, paid, lifecycle),
    overdue: isOverdue(b, balance),
  };
}

/** All bills with totals + status, newest first (the Accounts Payable ledger). */
export async function listBills(): Promise<BillRow[]> {
  const supabase = await createClient();
  const { data: bills } = await supabase
    .from("bills")
    .select("*")
    .order("created_at", { ascending: false });
  const rows = (bills ?? []) as Bill[];
  if (!rows.length) return [];
  const ids = rows.map((b) => b.id);
  const [{ data: items }, { data: pays }] = await Promise.all([
    supabase.from("bill_items").select("bill_id, quantity, unit_cost").in("bill_id", ids),
    supabase.from("bill_payments").select("bill_id, amount, status").in("bill_id", ids),
  ]);
  const itemsByBill = new Map<string, { quantity: number | null; unit_cost: number | null }[]>();
  for (const it of items ?? []) {
    const arr = itemsByBill.get(it.bill_id as string) ?? [];
    arr.push({ quantity: it.quantity as number | null, unit_cost: it.unit_cost as number | null });
    itemsByBill.set(it.bill_id as string, arr);
  }
  const paysByBill = new Map<string, BillPayment[]>();
  for (const p of pays ?? []) {
    const arr = paysByBill.get(p.bill_id as string) ?? [];
    arr.push({
      id: "",
      date: "",
      amount: num(p.amount),
      method: null,
      note: null,
      status: (p.status as string | null) ?? "active",
    });
    paysByBill.set(p.bill_id as string, arr);
  }
  return rows.map((b) => toRow(b, itemsByBill.get(b.id), paysByBill.get(b.id)));
}

/** One bill with its items and payments. */
export async function getBill(id: string): Promise<BillRow | null> {
  const supabase = await createClient();
  const { data: bill } = await supabase.from("bills").select("*").eq("id", id).maybeSingle();
  if (!bill) return null;
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("bill_items").select("*").eq("bill_id", id).order("position", { ascending: true }),
    supabase
      .from("bill_payments")
      .select("id, date, amount, method, note, status")
      .eq("bill_id", id)
      .order("date", { ascending: true }),
  ]);
  const its = (items ?? []) as BillItem[];
  const pays = (payments ?? []) as BillPayment[];
  return {
    ...toRow(bill as Bill, its, pays),
    items: its,
    payments: pays,
  };
}

/** Whether a PO already has an active (non-void) bill. */
export async function getBillForPO(poId: string): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bills")
    .select("id, ap_lifecycle")
    .eq("po_id", poId)
    .neq("ap_lifecycle", "void")
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string } : null;
}

export interface APSummary {
  outstanding: number;
  overdue: number;
  dueSoon: number;
  openCount: number;
}

/** Accounts-payable rollup for the money dashboard. */
export async function getAPSummary(): Promise<APSummary> {
  const bills = await listBills();
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  let outstanding = 0,
    overdue = 0,
    dueSoon = 0,
    openCount = 0;
  for (const b of bills) {
    if (b.status === "void" || b.status === "draft") continue;
    if (b.balance <= 0.005) continue;
    outstanding += b.balance;
    openCount += 1;
    if (b.due_date && b.due_date < today) overdue += b.balance;
    else if (b.due_date && b.due_date <= soon) dueSoon += b.balance;
  }
  return { outstanding, overdue, dueSoon, openCount };
}
