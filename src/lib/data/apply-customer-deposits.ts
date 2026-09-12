import { createAdminClient } from "@/lib/supabase/admin";
import {
  planDepositApplications,
  type DepositApplyCandidate,
} from "@/lib/deposit-apply";
import { invoiceOpenArBalance } from "@/lib/accounting/open-ar";

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  from: (table: string) => any;
};

export type ApplyDepositsResult = {
  applied: number;
  duplicate: boolean;
  error: string | null;
};

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function loadUnappliedDeposits(
  customerId: string,
): Promise<DepositApplyCandidate[]> {
  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    return [];
  }
  const { data } = await db
    .from("customer_deposits")
    .select("id, customer_id, job_id, estimate_id, amount, received_on, status")
    .eq("customer_id", customerId)
    .eq("status", "unapplied");
  const rows = (data ?? []) as {
    id: string;
    customer_id: string;
    job_id: string | null;
    estimate_id: string | null;
    amount: number;
    received_on: string;
    status: string;
  }[];
  const ids = rows.map((r) => r.id);
  const appliedBy = new Map<string, number>();
  if (ids.length) {
    const { data: apps } = await db
      .from("customer_deposit_applications")
      .select("deposit_id, amount, status")
      .in("deposit_id", ids);
    for (const a of apps ?? []) {
      if (((a.status as string) ?? "active") === "void") continue;
      const id = a.deposit_id as string;
      appliedBy.set(id, round2((appliedBy.get(id) ?? 0) + Number(a.amount)));
    }
  }
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    jobId: r.job_id,
    estimateId: r.estimate_id,
    amount: Number(r.amount) || 0,
    unapplied: round2((Number(r.amount) || 0) - (appliedBy.get(r.id) ?? 0)),
    receivedOn: r.received_on,
    status: r.status,
  }));
}

/**
 * Apply eligible unapplied customer deposits to this invoice via
 * apply_customer_deposit_safe (row locks + stable idempotency keys).
 * Does not throw — invoice create/pay still proceeds if apply is unavailable.
 */
export async function applyEligibleDepositsToInvoice(
  supabase: LooseClient,
  args: {
    invoiceId: string;
    createdBy: string | null;
    appliedOn: string;
  },
): Promise<ApplyDepositsResult> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("id, customer_id, job_id, estimate_id, tax_rate, status")
    .eq("id", args.invoiceId)
    .maybeSingle();
  if (!inv || (inv.status as string) === "void") {
    return { applied: 0, duplicate: false, error: null };
  }
  const customerId = inv.customer_id as string;
  const deposits = await loadUnappliedDeposits(customerId);
  if (!deposits.length) return { applied: 0, duplicate: false, error: null };

  const [{ data: items }, { data: pays }, { data: apps }] = await Promise.all([
    supabase.from("invoice_items").select("quantity, rate").eq("invoice_id", args.invoiceId),
    supabase.from("payments").select("amount, status").eq("invoice_id", args.invoiceId),
    supabase
      .from("credit_applications")
      .select("amount, status")
      .eq("invoice_id", args.invoiceId),
  ]);

  let rpc: LooseClient = supabase;
  try {
    rpc = createAdminClient();
  } catch {
    rpc = supabase;
  }

  let openAr: number | null = null;
  const { data: rpcBal, error: arErr } = await rpc.rpc("invoice_open_ar_balance", {
    p_invoice_id: args.invoiceId,
  });
  if (!arErr && rpcBal != null && Number.isFinite(Number(rpcBal))) {
    openAr = round2(Number(rpcBal));
  } else {
    let deposited = 0;
    let writtenOff = 0;
    try {
      const admin = createAdminClient();
      const [{ data: deps }, { data: wos }] = await Promise.all([
        admin
          .from("customer_deposit_applications")
          .select("amount, status")
          .eq("invoice_id", args.invoiceId),
        admin
          .from("invoice_write_offs")
          .select("amount, status")
          .eq("invoice_id", args.invoiceId),
      ]);
      deposited = (deps ?? [])
        .filter((a) => ((a.status as string) ?? "active") !== "void")
        .reduce((s, a) => s + (Number(a.amount) || 0), 0);
      writtenOff = (wos ?? [])
        .filter((a) => ((a.status as string) ?? "active") !== "void")
        .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    } catch {
      /* service role missing */
    }

    const paid = ((pays ?? []) as { amount: number; status?: string }[])
      .filter((p) => ((p.status as string) ?? "active") !== "void")
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const credited = ((apps ?? []) as { amount: number; status?: string }[])
      .filter((a) => ((a.status as string) ?? "active") !== "void")
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    openAr = invoiceOpenArBalance({
      items: (items ?? []) as { quantity: number | null; rate: number | null }[],
      taxRate: inv.tax_rate as number,
      activePayments: paid,
      activeCredits: credited,
      activeDeposits: deposited,
      activeWriteOffs: writtenOff,
    });
  }
  if (openAr <= 0.005) return { applied: 0, duplicate: false, error: null };

  const plan = planDepositApplications({
    invoiceId: args.invoiceId,
    openAr,
    deposits,
    invoiceJobId: (inv.job_id as string | null) ?? null,
    invoiceEstimateId: (inv.estimate_id as string | null) ?? null,
  });

  let applied = 0;
  let duplicate = false;
  for (const step of plan.steps) {
    const { data, error } = await rpc.rpc("apply_customer_deposit_safe", {
      p_deposit_id: step.depositId,
      p_invoice_id: args.invoiceId,
      p_amount: step.amount,
      p_applied_on: args.appliedOn,
      p_created_by: args.createdBy,
      p_idempotency_key: step.idempotencyKey,
    });
    if (error) {
      if (String(error.message).includes("apply_customer_deposit_safe")) {
        return { applied, duplicate, error: null };
      }
      return { applied, duplicate, error: error.message };
    }
    const res = data as { ok?: boolean; error?: string; duplicate?: boolean };
    if (res?.duplicate) {
      duplicate = true;
      continue;
    }
    if (!res?.ok) {
      return {
        applied,
        duplicate,
        error: res?.error ?? "Could not apply deposit.",
      };
    }
    applied = round2(applied + step.amount);
  }
  return { applied, duplicate, error: null };
}
