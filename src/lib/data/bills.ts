import { createClient } from "@/lib/supabase/server";

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
  items?: BillItem[];
  payments?: BillPayment[];
}

export type BillStatus = "open" | "partial" | "paid";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export function billSubtotal(items: Partial<BillItem>[] | undefined): number {
  return (items ?? []).reduce(
    (s, i) => s + num(i.quantity) * num(i.unit_cost),
    0,
  );
}
export function billPaid(payments: Partial<BillPayment>[] | undefined): number {
  return (payments ?? []).reduce((s, p) => s + num(p.amount), 0);
}
export function billStatus(total: number, paid: number): BillStatus {
  if (total > 0 && paid >= total - 0.005) return "paid";
  if (paid > 0.005) return "partial";
  return "open";
}
export function isOverdue(bill: { due_date: string | null }, balance: number): boolean {
  if (balance <= 0.005 || !bill.due_date) return false;
  return bill.due_date < new Date().toISOString().slice(0, 10);
}

export interface BillRow extends Bill {
  total: number;
  paid: number;
  balance: number;
  status: BillStatus;
  overdue: boolean;
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
    supabase.from("bill_payments").select("bill_id, amount").in("bill_id", ids),
  ]);
  const itemsByBill = new Map<string, { quantity: number | null; unit_cost: number | null }[]>();
  for (const it of items ?? []) {
    const arr = itemsByBill.get(it.bill_id as string) ?? [];
    arr.push({ quantity: it.quantity as number | null, unit_cost: it.unit_cost as number | null });
    itemsByBill.set(it.bill_id as string, arr);
  }
  const paidByBill = new Map<string, number>();
  for (const p of pays ?? [])
    paidByBill.set(p.bill_id as string, (paidByBill.get(p.bill_id as string) ?? 0) + num(p.amount));
  return rows.map((b) => {
    const total = billSubtotal(itemsByBill.get(b.id));
    const paid = paidByBill.get(b.id) ?? 0;
    const balance = total - paid;
    return {
      ...b,
      total,
      paid,
      balance,
      status: billStatus(total, paid),
      overdue: isOverdue(b, balance),
    };
  });
}

/** One bill with its items and payments. */
export async function getBill(id: string): Promise<BillRow | null> {
  const supabase = await createClient();
  const { data: bill } = await supabase.from("bills").select("*").eq("id", id).maybeSingle();
  if (!bill) return null;
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("bill_items").select("*").eq("bill_id", id).order("position", { ascending: true }),
    supabase.from("bill_payments").select("id, date, amount, method, note").eq("bill_id", id).order("date", { ascending: true }),
  ]);
  const its = (items ?? []) as BillItem[];
  const pays = (payments ?? []) as BillPayment[];
  const total = billSubtotal(its);
  const paid = billPaid(pays);
  const balance = total - paid;
  return {
    ...(bill as Bill),
    items: its,
    payments: pays,
    total,
    paid,
    balance,
    status: billStatus(total, paid),
    overdue: isOverdue(bill as Bill, balance),
  };
}

/** Whether a PO already has a bill (so the PO shows a link instead of a button). */
export async function getBillForPO(poId: string): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("bills").select("id").eq("po_id", poId).limit(1).maybeSingle();
  return data ? { id: data.id as string } : null;
}

export interface APSummary {
  outstanding: number; // total you owe (unpaid balances)
  overdue: number; // balance on overdue bills
  dueSoon: number; // balance due within 7 days (not yet overdue)
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
    if (b.balance <= 0.005) continue;
    outstanding += b.balance;
    openCount += 1;
    if (b.due_date && b.due_date < today) overdue += b.balance;
    else if (b.due_date && b.due_date <= soon) dueSoon += b.balance;
  }
  return { outstanding, overdue, dueSoon, openCount };
}
