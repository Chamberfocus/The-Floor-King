/**
 * Load canonical job records and assemble a true-up.
 * Reads only. Does not write invoices, stock, POs, or accounting.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InstallerBillLike } from "@/lib/accounting/installer-labor-source";
import type { JobBalanceInvoiceInput } from "@/lib/invoice-calc";
import {
  buildTrueUp,
  commissionableRevenue,
  estimatedFreightCents,
  estimatedRevenueFromSnapshots,
  moneyToCents,
  openBalanceFromInvoices,
  resolveFreight,
  resolveLabor,
  resolveMaterial,
  resolveOther,
  type ApprovalMoney,
  type ManualCostEntry,
  type TrueUpFacts,
  type TrueUpResult,
} from "@/lib/job-true-up";

type Row = Record<string, unknown>;

function num(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export interface LoadedTrueUp {
  job: {
    id: string;
    title: string;
    status: string;
    completedAt: string | null;
    customerName: string;
    customerId: string | null;
  };
  facts: TrueUpFacts;
  result: TrueUpResult;
  entries: {
    category: string;
    kind: string;
    amountCents: bigint;
    reason: string;
    note: string | null;
    enteredAt: string;
  }[];
  snapshot: { version: number; approvedAt: string; payload: Row; salespersonId: string | null } | null;
  overrides: {
    collection: { on: boolean; reason: string | null; at: string | null } | null;
    gp: { cents: bigint; reason: string | null; at: string | null } | null;
    rate: { bps: bigint; reason: string | null; at: string | null } | null;
    amount: { cents: bigint; reason: string | null; at: string | null } | null;
  };
  salespeople: { id: string; name: string }[];
}

export async function loadJobTrueUp(
  supabase: SupabaseClient,
  jobId: string,
): Promise<LoadedTrueUp | null> {
  const { data: jobRow } = await supabase
    .from("jobs")
    .select(
      "id, title, status, completed_at, customer_id, estimate_id, estimated_material_cost, estimated_labor_cost, assigned_to, assigned_crew_id, customer:customers(full_name, assigned_to)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!jobRow) return null;

  const job = jobRow as Row;
  const customer = (Array.isArray(job.customer) ? job.customer[0] : job.customer) as Row | null;
  const estimateId = str(job.estimate_id);

  const [snapshotsRes, orgRes, invoicesRes, pullsRes, billsRes, laborCount, expensesRes, issuesRes, trueUpRes, peopleRes] =
    await Promise.all([
      estimateId
        ? supabase
            .from("estimate_approval_snapshots")
            .select("version, payload")
            .eq("estimate_id", estimateId)
            .order("version", { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase.from("org_settings").select("freight_markup_pct").limit(1).maybeSingle(),
      supabase
        .from("invoices")
        .select("id, status, tax_rate, commercial_kind, created_at, invoice_items(quantity, rate)")
        .eq("job_id", jobId),
      supabase
        .from("stock_movements")
        .select("product_id, qty, unit_cost, extended_cost, kind")
        .eq("job_id", jobId)
        .eq("kind", "pull"),
      supabase
        .from("installer_bills")
        .select("id, job_id, status, total, legacy_display_only")
        .eq("job_id", jobId),
      supabase.from("job_labor").select("id", { count: "exact", head: true }).eq("job_id", jobId),
      supabase.from("expenses").select("category, amount").eq("job_id", jobId),
      supabase.from("job_issues").select("cost_impact").eq("job_id", jobId),
      supabase.from("job_true_ups").select("*").eq("job_id", jobId).maybeSingle(),
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("role", ["salesman", "sales_manager", "admin", "office"])
        .order("full_name"),
    ]);

  const invoices = (invoicesRes.data ?? []) as Row[];
  const invoiceIds = invoices.map((i) => String(i.id));
  const [creditsRes, writeOffRes, payRes, depRes, refundRes, poByJob, poByItem] = await Promise.all([
    invoiceIds.length
      ? supabase
          .from("credit_applications")
          .select("invoice_id, amount, status")
          .in("invoice_id", invoiceIds)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    invoiceIds.length
      ? supabase
          .from("invoice_write_offs")
          .select("invoice_id, amount, status")
          .in("invoice_id", invoiceIds)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    invoiceIds.length
      ? supabase.from("payments").select("invoice_id, amount, status").in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [] }),
    invoiceIds.length
      ? supabase
          .from("customer_deposit_applications")
          .select("invoice_id, amount, status")
          .in("invoice_id", invoiceIds)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    supabase.from("credit_memos").select("id, amount, status").eq("job_id", jobId).eq("status", "issued"),
    supabase
      .from("purchase_orders")
      .select("id, status, po_items(id, product_id, description, quantity, received_qty, unit_cost, for_job_id)")
      .eq("job_id", jobId),
    supabase
      .from("po_items")
      .select("id, product_id, description, quantity, received_qty, unit_cost, for_job_id, po:purchase_orders(status, job_id)")
      .eq("for_job_id", jobId),
  ]);

  const creditByInv = sumBy(creditsRes.data ?? [], "invoice_id");
  const writeByInv = sumBy(writeOffRes.data ?? [], "invoice_id");
  const payByInv = sumBy(
    (payRes.data ?? []).filter((p) => (p as Row).status !== "void"),
    "invoice_id",
  );
  const depByInv = sumBy(depRes.data ?? [], "invoice_id");

  const revenueInvoices = invoices.map((inv, index) => ({
    id: String(inv.id),
    status: String(inv.status ?? ""),
    commercialKind: str(inv.commercial_kind),
    sequence: index,
    taxRatePct: num(inv.tax_rate) ?? 0,
    lines: ((inv.invoice_items as Row[] | null) ?? []).map((line) => ({
      quantity: num(line.quantity),
      rate: num(line.rate),
    })),
    appliedCreditCents: creditByInv.get(String(inv.id)) ?? BigInt(0),
    appliedWriteOffCents: writeByInv.get(String(inv.id)) ?? BigInt(0),
  }));

  const paymentsIgnored = [...payByInv.values()].reduce((s, n) => s + n, BigInt(0));
  const depositsIgnored = [...depByInv.values()].reduce((s, n) => s + n, BigInt(0));
  const memoIds = ((refundRes.data ?? []) as Row[]).map((m) => String(m.id));
  let refundsIgnored = BigInt(0);
  if (memoIds.length) {
    const { data: refunds } = await supabase
      .from("refunds")
      .select("amount, status")
      .in("credit_memo_id", memoIds)
      .eq("status", "active");
    for (const r of refunds ?? []) refundsIgnored += moneyToCents(num((r as Row).amount)) ?? BigInt(0);
  }

  const revenue = commissionableRevenue({
    invoices: revenueInvoices,
    refundsCents: refundsIgnored,
    depositsCents: depositsIgnored,
    paymentsCents: paymentsIgnored,
  });

  const balanceInput: JobBalanceInvoiceInput[] = invoices.map((inv) => ({
    id: String(inv.id),
    status: String(inv.status ?? ""),
    tax_rate: (num(inv.tax_rate) ?? 0) as number | string,
    items: ((inv.invoice_items as Row[] | null) ?? []).map((line) => ({
      quantity: num(line.quantity),
      rate: num(line.rate),
    })),
    amountPaid: centsNumber(payByInv.get(String(inv.id)) ?? BigInt(0)),
    appliedCredits: centsNumber(creditByInv.get(String(inv.id)) ?? BigInt(0)),
    appliedDeposits: centsNumber(depByInv.get(String(inv.id)) ?? BigInt(0)),
    appliedWriteOffs: centsNumber(writeByInv.get(String(inv.id)) ?? BigInt(0)),
  }));
  const open = openBalanceFromInvoices(balanceInput);

  const snapshots: ApprovalMoney[] = ((snapshotsRes.data ?? []) as Row[]).map((s) => {
    const payload = (s.payload ?? {}) as Row;
    return {
      version: Number(s.version) || 0,
      subtotalCents: moneyToCents(num(payload.subtotal)) ?? BigInt(0),
      discountCents: moneyToCents(num(payload.discount_amount)) ?? BigInt(0),
      taxCents: moneyToCents(num(payload.tax_amount)) ?? BigInt(0),
      totalCents: moneyToCents(num(payload.total)) ?? BigInt(0),
    };
  });
  const estimatedRevenue = estimatedRevenueFromSnapshots(snapshots);
  const bareMaterial = moneyToCents(num(job.estimated_material_cost));
  const freightPct = num((orgRes.data as Row | null)?.freight_markup_pct) ?? 0;

  const poLines = collectPoLines(jobId, (poByJob.data ?? []) as Row[], (poByItem.data ?? []) as Row[]);
  const trueUp = (trueUpRes.data ?? null) as Row | null;
  let entries: LoadedTrueUp["entries"] = [];
  if (trueUp?.id) {
    const { data } = await supabase
      .from("job_true_up_entries")
      .select("category, kind, amount_cents, reason, note, entered_at")
      .eq("true_up_id", trueUp.id)
      .order("entered_at", { ascending: true });
    entries = ((data ?? []) as Row[]).map((e) => ({
      category: String(e.category),
      kind: String(e.kind),
      amountCents: BigInt(e.amount_cents as string | number),
      reason: String(e.reason ?? ""),
      note: str(e.note),
      enteredAt: String(e.entered_at ?? ""),
    }));
  }
  const manual: ManualCostEntry[] = entries.map((e) => ({
    category: e.category as ManualCostEntry["category"],
    kind: e.kind as ManualCostEntry["kind"],
    amountCents: e.amountCents,
    reason: e.reason,
  }));

  const pulls = ((pullsRes.data ?? []) as Row[]).map((p) => ({
    productId: str(p.product_id),
    qty: num(p.qty),
    unitCost: num(p.unit_cost),
    extendedCost: num(p.extended_cost),
  }));

  const bills = ((billsRes.data ?? []) as Row[]).map(
    (b): InstallerBillLike => ({
      id: String(b.id),
      job_id: String(b.job_id),
      status: str(b.status),
      total: num(b.total),
      legacy_display_only: b.legacy_display_only === true,
    }),
  );

  const expenses = ((expensesRes.data ?? []) as Row[]).map((e) => ({
    category: String(e.category ?? ""),
    amountCents: moneyToCents(num(e.amount)) ?? BigInt(0),
  }));
  const issueCost = ((issuesRes.data ?? []) as Row[]).reduce(
    (s, i) => s + (moneyToCents(num(i.cost_impact)) ?? BigInt(0)),
    BigInt(0),
  );
  const subcontractor = expenses
    .filter((e) => e.category === "subcontractor")
    .reduce((s, e) => s + e.amountCents, BigInt(0));

  let snapshot: LoadedTrueUp["snapshot"] = null;
  if (trueUp?.id) {
    const { data } = await supabase
      .from("job_true_up_snapshots")
      .select("version, approved_at, payload, salesperson_id")
      .eq("true_up_id", trueUp.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const s = data as Row;
      snapshot = {
        version: Number(s.version) || 1,
        approvedAt: String(s.approved_at ?? ""),
        payload: (s.payload ?? {}) as Row,
        salespersonId: str(s.salesperson_id),
      };
    }
  }

  const salespersonId = str(trueUp?.salesperson_id) ?? str(customer?.assigned_to);
  const facts: TrueUpFacts = {
    jobCompleted: String(job.status) === "completed",
    trueUpExists: !!trueUp,
    salespersonId,
    snapshotSalespersonId: snapshot?.salespersonId ?? null,
    approved: !!snapshot,
    paidInFull: String(trueUp?.status ?? "") === "commission_paid",
    openBalanceCents: open.openBalanceCents,
    hasCollectibleInvoice: open.hasCollectibleInvoice,
    collectionOverride: trueUp?.collection_override === true,
    revenue,
    zeroRevenueAcknowledged: !!trueUp?.zero_revenue_ack_at,
    estimated: {
      originalRevenueCents: estimatedRevenue.originalCents,
      changeOrderRevenueCents: estimatedRevenue.changeOrderCents,
      materialCents: bareMaterial,
      laborCents: moneyToCents(num(job.estimated_labor_cost)),
      freightCents: estimatedFreightCents(bareMaterial, freightPct),
      otherCents: bareMaterial == null ? null : BigInt(0),
    },
    material: resolveMaterial({ pulls, poLines, entries: manual }),
    labor: resolveLabor({
      bills,
      jobId,
      installerAssigned: !!(job.assigned_to || job.assigned_crew_id),
      legacyLaborRows: laborCount.count ?? 0,
      entries: manual,
    }),
    freight: resolveFreight({ poLines, entries: manual }),
    other: resolveOther({
      expenses,
      issueCostCents: issueCost > BigInt(0) ? issueCost : BigInt(0),
      hasInstallerBills: bills.some((b) => !b.legacy_display_only),
      subcontractorExpenseCents: subcontractor,
      entries: manual,
    }),
    gpOverrideCents: trueUp?.gp_override_cents == null ? null : BigInt(trueUp.gp_override_cents as string | number),
    rateOverrideBps: trueUp?.rate_override_bps == null ? null : BigInt(trueUp.rate_override_bps as string | number),
    amountOverrideCents:
      trueUp?.amount_override_cents == null ? null : BigInt(trueUp.amount_override_cents as string | number),
  };

  return {
    job: {
      id: jobId,
      title: String(job.title ?? "Job"),
      status: String(job.status ?? ""),
      completedAt: str(job.completed_at),
      customerName: String(customer?.full_name ?? "Customer"),
      customerId: str(job.customer_id),
    },
    facts,
    result: buildTrueUp(facts),
    entries,
    snapshot,
    overrides: {
      collection: trueUp?.collection_override
        ? { on: true, reason: str(trueUp.collection_override_reason), at: str(trueUp.collection_override_at) }
        : null,
      gp:
        trueUp?.gp_override_cents == null
          ? null
          : {
              cents: BigInt(trueUp.gp_override_cents as string | number),
              reason: str(trueUp.gp_override_reason),
              at: str(trueUp.gp_override_at),
            },
      rate:
        trueUp?.rate_override_bps == null
          ? null
          : {
              bps: BigInt(trueUp.rate_override_bps as string | number),
              reason: str(trueUp.rate_override_reason),
              at: str(trueUp.rate_override_at),
            },
      amount:
        trueUp?.amount_override_cents == null
          ? null
          : {
              cents: BigInt(trueUp.amount_override_cents as string | number),
              reason: str(trueUp.amount_override_reason),
              at: str(trueUp.amount_override_at),
            },
    },
    salespeople: ((peopleRes.data ?? []) as Row[]).map((p) => ({
      id: String(p.id),
      name: String(p.full_name ?? "Unnamed"),
    })),
  };
}

function centsNumber(cents: bigint): number {
  return Number(cents) / 100;
}

function sumBy(rows: unknown[], key: string): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const row of rows as Row[]) {
    const id = String(row[key] ?? "");
    const add = moneyToCents(num(row.amount)) ?? BigInt(0);
    map.set(id, (map.get(id) ?? BigInt(0)) + add);
  }
  return map;
}

function collectPoLines(jobId: string, byJob: Row[], byItem: Row[]) {
  const seen = new Set<string>();
  const lines: {
    poStatus: string;
    productId: string | null;
    description: string | null;
    quantity: number | string | null;
    receivedQty: number | string | null;
    unitCost: number | string | null;
  }[] = [];
  const push = (status: string, item: Row) => {
    const id = String(item.id ?? `${item.description}-${item.product_id}`);
    if (seen.has(id)) return;
    seen.add(id);
    lines.push({
      poStatus: status,
      productId: str(item.product_id),
      description: str(item.description),
      quantity: num(item.quantity),
      receivedQty: num(item.received_qty),
      unitCost: num(item.unit_cost),
    });
  };
  for (const po of byJob) {
    const status = String(po.status ?? "");
    for (const item of (po.po_items as Row[] | null) ?? []) push(status, item);
  }
  for (const item of byItem) {
    const po = (Array.isArray(item.po) ? item.po[0] : item.po) as Row | null;
    if (po?.job_id && String(po.job_id) === jobId) continue;
    push(String(po?.status ?? ""), item);
  }
  return lines;
}
