/**
 * Canonical invoice paid/partial/sent recompute from open AR.
 * Never force `status: paid` after a payment RPC — open AR may still be > 0.
 */
import { invoiceTotals } from "@/lib/invoice-calc";
import { invoiceRemainingBalance } from "@/lib/payment-safety";
import { loadInvoiceArReductions } from "@/lib/data/invoices";
import { ensureInvoiceIssued } from "@/lib/invoice-issue";
import type { InvoiceStatus } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseSupabase = {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  from: (table: string) => any;
  auth?: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
};

export async function recomputeInvoiceStatus(
  supabase: LooseSupabase,
  invoiceId: string,
  actorId?: string | null,
): Promise<void> {
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
  const { total } = invoiceTotals(
    (items ?? []) as { quantity: number | null; rate: number | null }[],
    inv.tax_rate as number,
    0,
  );

  let due = total;
  const { data: openAr, error: arErr } = await supabase.rpc(
    "invoice_open_ar_balance",
    { p_invoice_id: invoiceId },
  );
  if (!arErr && openAr != null && Number.isFinite(Number(openAr))) {
    due = Number(openAr);
  } else {
    const { data: pays } = await supabase
      .from("payments")
      .select("amount, status")
      .eq("invoice_id", invoiceId);
    let credited = 0;
    try {
      const { data: apps } = await supabase
        .from("credit_applications")
        .select("amount, status")
        .eq("invoice_id", invoiceId);
      credited = (apps ?? [])
        .filter((a: { status?: string | null; amount?: number | null }) =>
          ((a.status as string) ?? "active") !== "void",
        )
        .reduce(
          (s: number, a: { amount?: number | null }) =>
            s + (Number(a.amount) || 0),
          0,
        );
    } catch {
      credited = 0;
    }
    const red = (await loadInvoiceArReductions([invoiceId], supabase)).get(
      invoiceId,
    );
    due = invoiceRemainingBalance(
      (items ?? []) as { quantity: number | null; rate: number | null }[],
      inv.tax_rate as number,
      pays ?? [],
      credited,
      red?.deposited ?? 0,
      red?.writtenOff ?? 0,
    );
  }

  const covered = Math.max(0, total - due);
  let status = inv.status as InvoiceStatus;
  if (total > 0 && due <= 0.005) status = "paid";
  else if (covered > 0.005) status = "partial";
  else if (status === "paid" || status === "partial") status = "sent";

  if (status === inv.status) return;

  let actor = actorId ?? null;
  if (actor == null && supabase.auth?.getUser) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    actor = user?.id ?? null;
  }

  const ensured = await ensureInvoiceIssued(supabase, {
    invoiceId,
    currentStatus: inv.status as string,
    targetStatus: status,
    actorId: actor,
  });
  if (!ensured.ok) return;

  const { data: after } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", invoiceId)
    .maybeSingle();
  if ((after?.status as string) === status) return;
  await supabase.from("invoices").update({ status }).eq("id", invoiceId);
}
