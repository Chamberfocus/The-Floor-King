import { invoiceTotals } from "@/lib/invoice-calc";
import { signoffPriceAlert, type SignoffPriceAlert } from "@/lib/signoff-sheet";
import { createAdminClient } from "@/lib/supabase/admin";

const EMPTY: SignoffPriceAlert = signoffPriceAlert({ invoices: [], extras: [] });

type InvoiceRow = {
  id: string;
  job_id: string | null;
  status: string | null;
  commercial_kind: string | null;
  tax_rate: number | string | null;
  created_at: string | null;
};

type ItemRow = {
  invoice_id: string;
  quantity: number | string | null;
  rate: number | string | null;
};

type ExtraRow = {
  job_id: string;
  amount: number | string | null;
  invoice_id: string | null;
};

/**
 * Change-order price alert for each job. Crew cannot read invoices, so this
 * uses the service role after the caller has already limited the job ids to
 * work that person is allowed to see. A missing extras table leaves the alert
 * off rather than breaking My Work.
 */
export async function loadSignoffPriceAlerts(
  jobIds: string[],
): Promise<Map<string, SignoffPriceAlert>> {
  const out = new Map<string, SignoffPriceAlert>();
  for (const id of jobIds) out.set(id, EMPTY);
  if (!jobIds.length) return out;

  try {
    const admin = createAdminClient();
    const { data: invoiceData, error: invoiceError } = await admin
      .from("invoices")
      .select("id, job_id, status, commercial_kind, tax_rate, created_at")
      .in("job_id", jobIds)
      .order("created_at", { ascending: true });
    if (invoiceError) return out;

    const invoices = (invoiceData ?? []) as InvoiceRow[];
    const invoiceIds = invoices.map((inv) => inv.id);
    const itemsByInvoice = new Map<string, ItemRow[]>();
    if (invoiceIds.length) {
      const { data: itemData } = await admin
        .from("invoice_items")
        .select("invoice_id, quantity, rate")
        .in("invoice_id", invoiceIds);
      for (const item of (itemData ?? []) as ItemRow[]) {
        const list = itemsByInvoice.get(item.invoice_id) ?? [];
        list.push(item);
        itemsByInvoice.set(item.invoice_id, list);
      }
    }

    const extrasByJob = new Map<string, ExtraRow[]>();
    const { data: extraData, error: extraError } = await admin
      .from("job_extras")
      .select("job_id, amount, invoice_id")
      .in("job_id", jobIds);
    if (!extraError) {
      for (const extra of (extraData ?? []) as ExtraRow[]) {
        const list = extrasByJob.get(extra.job_id) ?? [];
        list.push(extra);
        extrasByJob.set(extra.job_id, list);
      }
    }

    const invoicesByJob = new Map<string, InvoiceRow[]>();
    for (const inv of invoices) {
      if (!inv.job_id) continue;
      const list = invoicesByJob.get(inv.job_id) ?? [];
      list.push(inv);
      invoicesByJob.set(inv.job_id, list);
    }

    for (const jobId of jobIds) {
      const rows = invoicesByJob.get(jobId) ?? [];
      out.set(
        jobId,
        signoffPriceAlert({
          invoices: rows.map((inv) => ({
            id: inv.id,
            status: inv.status ?? "",
            commercialKind: inv.commercial_kind,
            taxRatePct: Number(inv.tax_rate) || 0,
            total: invoiceTotals(itemsByInvoice.get(inv.id) ?? [], inv.tax_rate ?? 0, 0).total,
          })),
          extras: (extrasByJob.get(jobId) ?? []).map((extra) => ({
            amount: Number(extra.amount) || 0,
            invoiceId: extra.invoice_id,
          })),
        }),
      );
    }
  } catch {
    return out;
  }
  return out;
}

export async function loadSignoffPriceAlert(jobId: string): Promise<SignoffPriceAlert> {
  if (!jobId) return EMPTY;
  const map = await loadSignoffPriceAlerts([jobId]);
  return map.get(jobId) ?? EMPTY;
}
