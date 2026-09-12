import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/paginate";
import { computeJobOpenBalance, invoiceTotals } from "@/lib/invoice-calc";
import { buildCustomerScope, type CustomerScope } from "@/lib/customer-scope";
import { getEstimate } from "@/lib/data/estimates";
import { getJob } from "@/lib/data/jobs";
import type { Invoice, InvoiceItem, Payment, CreditApplication } from "@/lib/types";
import {
  listCreditApplicationsForInvoices,
  loadCreditApplicationsAdmin,
  appliedCreditsForInvoice,
} from "@/lib/data/credits";
import { effectiveInvoiceBalance } from "@/lib/credit-ar";

export interface InvoiceScope {
  scope: CustomerScope;
  narrative: string | null;
}

/**
 * The full customer-facing scope for an invoice, pulled from the estimate or job
 * it was created from — the SAME source those documents describe, so the invoice
 * never contradicts the estimate. Invoice line items only store description/qty/
 * rate, so the rich room-by-room scope must come from the linked record.
 * Returns null when the invoice isn't linked to either.
 */
export async function getInvoiceScope(inv: Invoice): Promise<InvoiceScope | null> {
  if (inv.estimate_id) {
    const est = await getEstimate(inv.estimate_id);
    const opts = est?.options ?? [];
    const chosen =
      opts.find((o) => o.id === est?.accepted_option_id) ?? opts[0] ?? null;
    if (est && chosen) {
      return {
        scope: buildCustomerScope(chosen.line_items ?? [], est.job_description),
        narrative: est.job_description,
      };
    }
  }
  if (inv.job_id) {
    const job = await getJob(inv.job_id);
    if (job) {
      return {
        scope: buildCustomerScope(job.line_items ?? [], job.notes ?? null),
        narrative: null,
      };
    }
  }
  return null;
}

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
  let apps: CreditApplication[] = [];
  try {
    apps = await listCreditApplicationsForInvoices(ids, supabase);
  } catch {
    apps = [];
  }

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
  const appsBy = new Map<string, CreditApplication[]>();
  for (const a of apps) {
    const list = appsBy.get(a.invoice_id) ?? [];
    list.push(a);
    appsBy.set(a.invoice_id, list);
  }
  const reductions = await loadInvoiceArReductions(ids);
  for (const inv of invoices) {
    inv.items = itemsBy.get(inv.id) ?? [];
    inv.payments = paysBy.get(inv.id) ?? [];
    inv.creditApplications = appsBy.get(inv.id) ?? [];
    const red = reductions.get(inv.id);
    inv.appliedDeposits = red?.deposited ?? 0;
    inv.appliedWriteOffs = red?.writtenOff ?? 0;
  }
  return invoices;
}

/** Active deposit applications + write-offs per invoice (DEFINER-safe via admin). */
export async function loadInvoiceArReductions(
  invoiceIds: string[],
): Promise<Map<string, { deposited: number; writtenOff: number }>> {
  const out = new Map<string, { deposited: number; writtenOff: number }>();
  for (const id of invoiceIds) out.set(id, { deposited: 0, writtenOff: 0 });
  if (!invoiceIds.length) return out;
  try {
    const admin = createAdminClient();
    const [{ data: deps }, { data: wos }] = await Promise.all([
      admin
        .from("customer_deposit_applications")
        .select("invoice_id, amount, status")
        .in("invoice_id", invoiceIds),
      admin
        .from("invoice_write_offs")
        .select("invoice_id, amount, status")
        .in("invoice_id", invoiceIds),
    ]);
    for (const a of deps ?? []) {
      if (((a.status as string) ?? "active") === "void") continue;
      const id = a.invoice_id as string;
      const cur = out.get(id) ?? { deposited: 0, writtenOff: 0 };
      cur.deposited += Number(a.amount) || 0;
      out.set(id, cur);
    }
    for (const w of wos ?? []) {
      if (((w.status as string) ?? "active") === "void") continue;
      const id = w.invoice_id as string;
      const cur = out.get(id) ?? { deposited: 0, writtenOff: 0 };
      cur.writtenOff += Number(w.amount) || 0;
      out.set(id, cur);
    }
  } catch {
    /* admin missing — leave zeros */
  }
  return out;
}

export function amountPaid(inv: Invoice): number {
  // Void payments are audit history only — they do not reduce balance.
  return (inv.payments ?? [])
    .filter((p) => (p.status ?? "active") !== "void")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

/** Active credit applications on an invoice. */
export function amountCredited(inv: Invoice): number {
  return appliedCreditsForInvoice(inv.creditApplications ?? [], inv.id);
}

export function amountDeposited(inv: Invoice): number {
  return Math.round((Number(inv.appliedDeposits) || 0) * 100) / 100;
}

export function amountWrittenOff(inv: Invoice): number {
  return Math.round((Number(inv.appliedWriteOffs) || 0) * 100) / 100;
}

/** Canonical amount still due. Void invoices are $0. */
export function invoiceAmountDue(inv: Invoice): number {
  if (inv.status === "void") return 0;
  return effectiveInvoiceBalance({
    items: inv.items ?? [],
    taxRate: inv.tax_rate,
    amountPaid: amountPaid(inv),
    appliedCredits: amountCredited(inv),
    appliedDeposits: amountDeposited(inv),
    appliedWriteOffs: amountWrittenOff(inv),
  }).amountDue;
}

/**
 * Display totals for lists/portal/print. Line engine stays invoiceTotals;
 * remaining balance is always invoiceAmountDue (payments + credits +
 * applied deposits + write-offs).
 */
export function invoiceDisplayTotals(inv: Invoice): {
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  credited: number;
  deposited: number;
  writtenOff: number;
  balance: number;
} {
  const line = invoiceTotals(inv.items ?? [], inv.tax_rate, 0);
  return {
    subtotal: line.subtotal,
    tax: line.tax,
    total: line.total,
    paid: amountPaid(inv),
    credited: amountCredited(inv),
    deposited: amountDeposited(inv),
    writtenOff: amountWrittenOff(inv),
    balance: invoiceAmountDue(inv),
  };
}

export interface JobCollectible {
  hasInvoice: boolean;
  /** Oldest active invoice with a remaining balance (for links / primary target). */
  invoiceId: string | null;
  /** Sum of remaining balances across ALL active (non-void) job invoices. */
  balance: number;
  /** Each active invoice that still has a remaining balance (oldest first). */
  openInvoices: { invoiceId: string; balance: number }[];
}

/**
 * Pure job open-balance from already-loaded invoices (items + payments attached).
 * Delegates to computeJobOpenBalance (canonical effectiveInvoiceBalance.amountDue).
 */
export function computeJobCollectible(invoices: Invoice[]): JobCollectible {
  return computeJobOpenBalance(invoices);
}

/**
 * The job's open AR across all linked invoices, read ELEVATED — crews can't
 * read invoices/payments under RLS, so the installer collect prompt reads this
 * with the admin client. Returns balance 0 (and invoiceId null) when nothing is
 * owed, and hasInvoice=false when the office hasn't invoiced yet.
 *
 * With original + supplemental invoices, `balance` is the sum of each remaining
 * balance (void excluded). `invoiceId` stays the oldest open invoice for links.
 */
export async function getJobOpenBalance(jobId: string): Promise<JobCollectible> {
  const admin = createAdminClient();
  const { data: invData } = await admin
    .from("invoices")
    .select("*")
    .eq("job_id", jobId)
    .order("issue_date", { ascending: true })
    .order("created_at", { ascending: true });
  const invoices = (invData ?? []) as Invoice[];
  if (!invoices.length) {
    return { hasInvoice: false, invoiceId: null, balance: 0, openInvoices: [] };
  }

  const ids = invoices.map((i) => i.id);
  const { data: items } = await admin
    .from("invoice_items")
    .select("*")
    .in("invoice_id", ids);
  const { data: pays } = await admin
    .from("payments")
    .select("*")
    .in("invoice_id", ids);
  let apps: CreditApplication[] = [];
  try {
    apps = await loadCreditApplicationsAdmin(ids);
  } catch {
    apps = [];
  }
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
  const appsBy = new Map<string, CreditApplication[]>();
  for (const a of apps) {
    const list = appsBy.get(a.invoice_id) ?? [];
    list.push(a);
    appsBy.set(a.invoice_id, list);
  }
  for (const inv of invoices) {
    inv.items = itemsBy.get(inv.id) ?? [];
    inv.payments = paysBy.get(inv.id) ?? [];
    inv.creditApplications = appsBy.get(inv.id) ?? [];
  }
  const reductions = await loadInvoiceArReductions(ids);
  for (const inv of invoices) {
    const red = reductions.get(inv.id);
    inv.appliedDeposits = red?.deposited ?? 0;
    inv.appliedWriteOffs = red?.writtenOff ?? 0;
  }

  return computeJobCollectible(invoices);
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

/**
 * Open invoices on the dashboard.
 *
 * Cancelled customers are excluded, the same as everywhere money is counted
 * (see finance.ts). Without this, closing a customer removed them from every
 * revenue figure but left their unpaid invoice on the dashboard — chasing money
 * from someone you'd already written off.
 */
export async function getOutstandingInvoiceCount(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, customer:customers(cancelled_at)")
    .in("status", ["sent", "partial"]);
  return (data ?? []).filter((row) => {
    // PostgREST returns a to-one embed as an array in some shapes.
    const c = row.customer as
      | { cancelled_at: string | null }
      | { cancelled_at: string | null }[]
      | null;
    const cancelled = Array.isArray(c) ? c[0]?.cancelled_at : c?.cancelled_at;
    return !cancelled;
  }).length;
}
