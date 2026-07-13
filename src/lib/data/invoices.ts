import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/paginate";
import { invoiceTotals } from "@/lib/invoice-calc";
import type { Invoice, InvoiceItem, Payment } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function attach(
  supabase: SupabaseServerClient,
  invoices: Invoice[],
): Promise<Invoice[]> {
  if (!invoices.length) return invoices;
  const ids = invoices.map((i) => i.id);

  const items = await fetchAll<InvoiceItem>((from, to) =>
    supabase
      .from("invoice_items")
      .select("*")
      .in("invoice_id", ids)
      .order("position", { ascending: true })
      .range(from, to),
  );
  const pays = await fetchAll<Payment>((from, to) =>
    supabase
      .from("payments")
      .select("*")
      .in("invoice_id", ids)
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  const itemsBy = new Map<string, InvoiceItem[]>();
  for (const it of items) {
    const a = itemsBy.get(it.invoice_id) ?? [];
    a.push(it);
    itemsBy.set(it.invoice_id, a);
  }
  const paysBy = new Map<string, Payment[]>();
  for (const p of pays) {
    const a = paysBy.get(p.invoice_id) ?? [];
    a.push(p);
    paysBy.set(p.invoice_id, a);
  }
  for (const inv of invoices) {
    inv.items = itemsBy.get(inv.id) ?? [];
    inv.payments = paysBy.get(inv.id) ?? [];
  }
  return invoices;
}

export function amountPaid(inv: Invoice): number {
  return (inv.payments ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

export interface JobCollectible {
  hasInvoice: boolean;
  invoiceId: string | null; // the oldest open invoice with a balance
  balance: number;
}

/**
 * The job's oldest open invoice and its balance, read ELEVATED — crews can't
 * read invoices/payments under RLS, so the installer collect prompt reads this
 * with the admin client. Returns balance 0 (and invoiceId null) when nothing is
 * owed, and hasInvoice=false when the office hasn't invoiced yet.
 */
export async function getJobOpenBalance(jobId: string): Promise<JobCollectible> {
  const admin = createAdminClient();
  const { data: invData } = await admin
    .from("invoices")
    .select("*")
    .eq("job_id", jobId)
    .order("issue_date", { ascending: true });
  const invoices = (invData ?? []) as Invoice[];
  if (!invoices.length) return { hasInvoice: false, invoiceId: null, balance: 0 };

  const ids = invoices.map((i) => i.id);
  const { data: items } = await admin
    .from("invoice_items")
    .select("*")
    .in("invoice_id", ids);
  const { data: pays } = await admin
    .from("payments")
    .select("*")
    .in("invoice_id", ids);
  const itemsBy = new Map<string, InvoiceItem[]>();
  for (const it of (items ?? []) as InvoiceItem[]) {
    const a = itemsBy.get(it.invoice_id) ?? [];
    a.push(it);
    itemsBy.set(it.invoice_id, a);
  }
  const paysBy = new Map<string, Payment[]>();
  for (const p of (pays ?? []) as Payment[]) {
    const a = paysBy.get(p.invoice_id) ?? [];
    a.push(p);
    paysBy.set(p.invoice_id, a);
  }
  for (const inv of invoices) {
    inv.items = itemsBy.get(inv.id) ?? [];
    inv.payments = paysBy.get(inv.id) ?? [];
  }

  for (const inv of invoices) {
    if (inv.status === "void") continue;
    const bal = invoiceTotals(inv.items ?? [], inv.tax_rate, amountPaid(inv)).balance;
    if (bal > 0.005)
      return {
        hasInvoice: true,
        invoiceId: inv.id,
        balance: Math.round(bal * 100) / 100,
      };
  }
  return { hasInvoice: true, invoiceId: null, balance: 0 };
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [inv] = await attach(supabase, [data as Invoice]);
  return inv;
}

export interface InvoiceListRow extends Invoice {
  customer_name: string | null;
}

export async function listInvoices(): Promise<InvoiceListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*, customer:customers(full_name)")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as (Invoice & {
    customer?: { full_name: string | null } | null;
  })[];
  const list: InvoiceListRow[] = rows.map((r) => ({
    ...r,
    customer_name: r.customer?.full_name ?? null,
  }));
  await attach(supabase, list);
  return list;
}

export async function listInvoicesForCustomer(
  customerId: string,
): Promise<Invoice[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return attach(supabase, (data ?? []) as Invoice[]);
}

/** Invoices tied to a specific job (for the job's Documents tab). */
export async function listInvoicesForJob(jobId: string): Promise<Invoice[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  return attach(supabase, (data ?? []) as Invoice[]);
}

export async function getOutstandingInvoiceCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .in("status", ["sent", "partial"]);
  return count ?? 0;
}
