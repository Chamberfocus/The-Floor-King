/**
 * F1 credit / refund data access.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  activeApplicationsTotal,
  customerAvailableCredit,
  creditMemoAvailable,
} from "@/lib/credit-ar";
import type {
  CreditApplication,
  CreditMemo,
  CustomerRefund,
} from "@/lib/types";

type DB = Awaited<ReturnType<typeof createClient>>;

export async function listCreditMemosForCustomer(
  customerId: string,
): Promise<CreditMemo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("credit_memos")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  const memos = (data ?? []) as CreditMemo[];
  if (!memos.length) return [];
  const ids = memos.map((m) => m.id);
  const [{ data: apps }, { data: refunds }] = await Promise.all([
    supabase.from("credit_applications").select("*").in("credit_memo_id", ids),
    supabase.from("refunds").select("*").in("credit_memo_id", ids),
  ]);
  const appsBy = new Map<string, CreditApplication[]>();
  for (const a of (apps ?? []) as CreditApplication[]) {
    const list = appsBy.get(a.credit_memo_id) ?? [];
    list.push(a);
    appsBy.set(a.credit_memo_id, list);
  }
  const refBy = new Map<string, CustomerRefund[]>();
  for (const r of (refunds ?? []) as CustomerRefund[]) {
    const list = refBy.get(r.credit_memo_id) ?? [];
    list.push(r);
    refBy.set(r.credit_memo_id, list);
  }
  for (const m of memos) {
    m.applications = appsBy.get(m.id) ?? [];
    m.refunds = refBy.get(m.id) ?? [];
  }
  return memos;
}

export async function listCreditApplicationsForInvoices(
  invoiceIds: string[],
  db?: DB,
): Promise<CreditApplication[]> {
  if (!invoiceIds.length) return [];
  const supabase = db ?? (await createClient());
  const { data } = await supabase
    .from("credit_applications")
    .select("*")
    .in("invoice_id", invoiceIds);
  return (data ?? []) as CreditApplication[];
}

export function appliedCreditsForInvoice(
  apps: CreditApplication[],
  invoiceId: string,
): number {
  return activeApplicationsTotal(
    apps.filter((a) => a.invoice_id === invoiceId),
  );
}

export async function getCustomerCreditSummary(customerId: string): Promise<{
  available: number;
  memos: CreditMemo[];
}> {
  const memos = await listCreditMemosForCustomer(customerId);
  const applications = memos.flatMap((m) => m.applications ?? []);
  const refunds = memos.flatMap((m) => m.refunds ?? []);
  return {
    available: customerAvailableCredit({
      memos: memos.map((m) => ({
        id: m.id,
        amount: m.amount,
        status: m.status,
      })),
      applications,
      refunds,
    }),
    memos,
  };
}

/** Issued commercial credits for an estimate (coverage math). */
export async function commercialCreditsTotalForEstimate(
  estimateId: string,
  db?: DB,
): Promise<number> {
  const supabase = db ?? (await createClient());
  const { data } = await supabase
    .from("credit_memos")
    .select("amount, status, kind")
    .eq("estimate_id", estimateId)
    .eq("kind", "commercial");
  return (data ?? [])
    .filter((r) => ((r.status as string) ?? "issued") !== "void")
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

export function memoAvailable(memo: CreditMemo): number {
  return creditMemoAvailable({
    memoAmount: memo.amount,
    memoStatus: memo.status,
    applications: memo.applications,
    refunds: memo.refunds,
  });
}

/** Elevated load for installer collect / job AR when credits matter. */
export async function loadCreditApplicationsAdmin(
  invoiceIds: string[],
): Promise<CreditApplication[]> {
  if (!invoiceIds.length) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("credit_applications")
    .select("*")
    .in("invoice_id", invoiceIds);
  return (data ?? []) as CreditApplication[];
}
