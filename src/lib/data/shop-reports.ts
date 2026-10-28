import { createClient } from "@/lib/supabase/server";
import { invoiceTotals } from "@/lib/invoice-calc";
import { splitSales, type SalesSlice } from "@/lib/shop-floor";

export type TaxRow = {
  id: string;
  number: string;
  customer: string;
  issued: string | null;
  subtotal: number;
  tax: number;
  claim: boolean;
};

export type TaxPacket = {
  rows: TaxRow[];
  sales: number;
  salesTax: number;
  claimSales: number;
  claimTax: number;
  claimsReady: boolean;
};

export type StatementLine = {
  id: string;
  number: string;
  issued: string | null;
  due: string | null;
  total: number;
  balance: number;
  claim: boolean;
};

export type CustomerStatement = {
  customerId: string;
  name: string;
  lines: StatementLine[];
  balance: number;
};

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

type Item = { quantity: number | null; rate: number | null };

function totals(items: Item[] | null, taxRate: number, paid: number) {
  return invoiceTotals(
    (items ?? []).map((item) => ({
      quantity: Number(item.quantity) || 0,
      rate: Number(item.rate) || 0,
    })),
    taxRate,
    paid,
  );
}

async function claimJobIds(jobIds: string[]): Promise<{ ids: Set<string>; ready: boolean }> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (!ids.length) return { ids: new Set(), ready: true };
  const db = await createClient();
  const { data, error } = await db.from("jobs").select("id").in("id", ids).eq("is_claim", true);
  if (error) return { ids: new Set(), ready: false };
  return { ids: new Set((data ?? []).map((row) => row.id as string)), ready: true };
}

export async function loadTaxPacket(start: string, end: string): Promise<TaxPacket> {
  const db = await createClient();
  const { data } = await db
    .from("invoices")
    .select(
      "id, number, issue_date, tax_rate, status, job_id, customer:customers(full_name), items:invoice_items(quantity, rate)",
    )
    .gte("issue_date", start)
    .lte("issue_date", end)
    .not("status", "in", "(draft,void)")
    .order("issue_date", { ascending: true })
    .limit(500);
  const raw = data ?? [];
  const claims = await claimJobIds(raw.map((row) => (row.job_id as string | null) || ""));
  const rows: TaxRow[] = raw.map((row) => {
    const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
    const sum = totals(row.items as Item[] | null, Number(row.tax_rate) || 0, 0);
    return {
      id: row.id as string,
      number: (row.number as string | null) || "Invoice",
      customer: (customer as { full_name?: string } | null)?.full_name?.trim() || "Customer",
      issued: (row.issue_date as string | null) ?? null,
      subtotal: money(sum.subtotal),
      tax: money(sum.tax),
      claim: claims.ids.has((row.job_id as string | null) || ""),
    };
  });
  const split = splitSales(
    rows.map((row): SalesSlice => ({ subtotal: row.subtotal, tax: row.tax, claim: row.claim })),
  );
  return { rows, ...split, claimsReady: claims.ready };
}

export async function loadStatements(): Promise<{
  customers: CustomerStatement[];
  claimsReady: boolean;
}> {
  const db = await createClient();
  const { data } = await db
    .from("invoices")
    .select(
      "id, number, issue_date, due_date, tax_rate, status, job_id, customer_id, customer:customers(full_name), items:invoice_items(quantity, rate), payments(amount, status)",
    )
    .in("status", ["sent", "partial"])
    .order("issue_date", { ascending: true })
    .limit(500);
  const raw = data ?? [];
  const claims = await claimJobIds(raw.map((row) => (row.job_id as string | null) || ""));
  const grouped = new Map<string, CustomerStatement>();
  for (const row of raw) {
    const payments = (row.payments as { amount: number | null; status: string | null }[] | null) ?? [];
    const paid = payments
      .filter((payment) => (payment.status ?? "active") !== "void")
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    const sum = totals(row.items as Item[] | null, Number(row.tax_rate) || 0, paid);
    if (sum.balance <= 0.005) continue;
    const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
    const customerId = row.customer_id as string;
    const statement = grouped.get(customerId) ?? {
      customerId,
      name: (customer as { full_name?: string } | null)?.full_name?.trim() || "Customer",
      lines: [],
      balance: 0,
    };
    const balance = money(sum.balance);
    statement.lines.push({
      id: row.id as string,
      number: (row.number as string | null) || "Invoice",
      issued: (row.issue_date as string | null) ?? null,
      due: (row.due_date as string | null) ?? null,
      total: money(sum.total),
      balance,
      claim: claims.ids.has((row.job_id as string | null) || ""),
    });
    statement.balance = money(statement.balance + balance);
    grouped.set(customerId, statement);
  }
  return {
    customers: [...grouped.values()].sort((a, b) => b.balance - a.balance),
    claimsReady: claims.ready,
  };
}
