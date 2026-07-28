import { createClient } from "@/lib/supabase/server";
import { isCommittedPoStatus, COMMITTED_PO_STATUSES } from "@/lib/po-calc";
import type { PoItem, PurchaseOrder } from "@/lib/types";
import type { CutSource } from "@/lib/job-scope";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The carpet cut lines behind a PO's source estimate — the SAME lines the
 * staging sheet and work order read, so the PO's cut list can't disagree with
 * them. Uses the accepted option (else the first), matching PO generation.
 * Returns [] for POs not tied to an estimate (manual / inventory orders).
 */
export async function getEstimateCutSources(
  estimateId: string | null | undefined,
): Promise<CutSource[]> {
  if (!estimateId) return [];
  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("accepted_option_id")
    .eq("id", estimateId)
    .maybeSingle();
  let optionId = (est?.accepted_option_id as string | null) ?? null;
  if (!optionId) {
    const { data: opt } = await supabase
      .from("estimate_options")
      .select("id")
      .eq("estimate_id", estimateId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    optionId = (opt?.id as string) ?? null;
  }
  if (!optionId) return [];
  return fetchCutSources(supabase, optionId);
}

const CUT_COLS =
  "room, description, category, length_in, width_in, sqft, measurements, is_fill, roll_width_ft, manufacturer, color";
// Before the measurements column (0128) is run, the select above errors — fall
// back to the legacy columns so the cut list still renders (from the single cut).
const CUT_COLS_LEGACY =
  "room, description, category, length_in, width_in, sqft, is_fill, roll_width_ft, manufacturer, color";

async function fetchCutSources(
  supabase: SupabaseServerClient,
  optionId: string,
): Promise<CutSource[]> {
  const q = (cols: string) =>
    supabase
      .from("estimate_line_items")
      .select(cols)
      .eq("option_id", optionId)
      .order("position", { ascending: true });
  let { data, error } = await q(CUT_COLS);
  if (error) ({ data } = await q(CUT_COLS_LEGACY));
  return (data ?? []) as unknown as CutSource[];
}

/**
 * The ONE way any document reads a job's carpet cuts — always live from the
 * estimate line items the job points at (`option_id`), never a copy. New
 * document types should call this (or getEstimateCutSources) so they inherit
 * cuts automatically and can't drift.
 */
export async function getJobCutSources(jobId: string): Promise<CutSource[]> {
  if (!jobId) return [];
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("option_id, estimate_id")
    .eq("id", jobId)
    .maybeSingle();
  if (job?.option_id) {
    return fetchCutSources(supabase, job.option_id as string);
  }
  return getEstimateCutSources((job?.estimate_id as string) ?? null);
}

async function attachItems(
  supabase: SupabaseServerClient,
  pos: PurchaseOrder[],
): Promise<PurchaseOrder[]> {
  if (!pos.length) return pos;
  const ids = pos.map((p) => p.id);
  const { data } = await supabase
    .from("po_items")
    .select("*")
    .in("po_id", ids)
    .order("position", { ascending: true });
  const items = (data ?? []) as PoItem[];
  const byPo = new Map<string, PoItem[]>();
  for (const it of items) {
    const arr = byPo.get(it.po_id) ?? [];
    arr.push(it);
    byPo.set(it.po_id, arr);
  }
  for (const p of pos) p.items = byPo.get(p.id) ?? [];
  return pos;
}

export interface JobAttribution {
  job_id: string;
  customer_id: string | null;
  label: string;
}

/**
 * Active jobs (with client names) to attribute a shared-order PO line to, so
 * material for another client on the same order stays trackable.
 */
export async function listJobsForAttribution(): Promise<JobAttribution[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, title, customer_id, status, customer:customers(full_name)")
    .neq("status", "completed")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as {
    id: string;
    title: string | null;
    customer_id: string | null;
    customer?: { full_name: string | null } | { full_name: string | null }[] | null;
  }[];
  return rows.map((r) => {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    return {
      job_id: r.id,
      customer_id: r.customer_id,
      label: [c?.full_name, r.title].filter(Boolean).join(" — ") || "Job",
    };
  });
}

export interface AttributedPoLine {
  id: string;
  po_id: string;
  description: string;
  quantity: number | null;
  unit: string;
  manufacturer: string | null;
  color: string | null;
  note: string | null;
  po_supplier: string | null;
  primary_customer_name: string | null;
}

/**
 * PO lines from OTHER customers' purchase orders that were attributed to this
 * customer (a shared order) — so this client's material is always trackable
 * even when it rode along on someone else's PO.
 */
export async function listAttributedPoItemsForCustomer(
  customerId: string,
): Promise<AttributedPoLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("po_items")
    .select(
      "id, po_id, description, quantity, unit, manufacturer, color, note, po:purchase_orders(supplier, customer_id, customer:customers(full_name))",
    )
    .eq("for_customer_id", customerId);
  const rows = (data ?? []) as {
    id: string;
    po_id: string;
    description: string;
    quantity: number | null;
    unit: string;
    manufacturer: string | null;
    color: string | null;
    note: string | null;
    po?:
      | {
          supplier: string | null;
          customer_id: string | null;
          customer?: { full_name: string | null } | { full_name: string | null }[] | null;
        }
      | Array<{
          supplier: string | null;
          customer_id: string | null;
          customer?: { full_name: string | null } | { full_name: string | null }[] | null;
        }>
      | null;
  }[];
  return rows
    .map((r) => {
      const po = Array.isArray(r.po) ? r.po[0] : r.po;
      const cust = Array.isArray(po?.customer) ? po?.customer[0] : po?.customer;
      return {
        id: r.id,
        po_id: r.po_id,
        description: r.description,
        quantity: r.quantity,
        unit: r.unit,
        manufacturer: r.manufacturer,
        color: r.color,
        note: r.note,
        po_supplier: po?.supplier ?? null,
        po_customer_id: po?.customer_id ?? null,
        primary_customer_name: cust?.full_name ?? null,
      };
    })
    // Only the truly shared ones — a line pointing back at its own PO's customer
    // already shows under that PO.
    .filter((r) => r.po_customer_id !== customerId)
    .map(({ po_customer_id: _drop, ...rest }) => rest);
}

export async function getPurchaseOrder(
  id: string,
): Promise<PurchaseOrder | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [po] = await attachItems(supabase, [data as PurchaseOrder]);
  return po;
}

export interface PoListRow extends PurchaseOrder {
  customer_name: string | null;
}

export async function listPurchaseOrders(): Promise<PoListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*, customer:customers(full_name)")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as (PurchaseOrder & {
    customer?: { full_name: string | null } | null;
  })[];
  const list: PoListRow[] = rows.map((r) => ({
    ...r,
    customer_name: r.customer?.full_name ?? null,
  }));
  await attachItems(supabase, list);
  return list;
}

export async function listPurchaseOrdersForCustomer(
  customerId: string,
): Promise<PurchaseOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return attachItems(supabase, (data ?? []) as PurchaseOrder[]);
}

/** Purchase orders tied to a specific job (for the job's Documents tab). */
export async function listPurchaseOrdersForJob(
  jobId: string,
): Promise<PurchaseOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  return attachItems(supabase, (data ?? []) as PurchaseOrder[]);
}

/**
 * The PO numbering counter (next number to be issued) plus the highest number
 * already issued — so Settings can only move the start FORWARD, never onto a
 * number that's already been used.
 */
export async function getPoCounter(): Promise<{ nextNumber: number; maxIssued: number }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("po_counter")
    .select("next_number")
    .eq("id", "default")
    .maybeSingle();
  const { data: mx } = await supabase
    .from("purchase_orders")
    .select("po_number")
    .order("po_number", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return {
    nextNumber: Number(data?.next_number) || 1001,
    maxIssued: Number(mx?.po_number) || 0,
  };
}

export interface VendorSummary {
  pos: PoListRow[];
  /** Sum of line totals for issued (non-void) POs — real committed spend. */
  totalSpend: number;
  /** POs still outstanding (Open or Received, not Closed/Void). */
  openCount: number;
  openTotal: number;
}

const poLineTotal = (p: PurchaseOrder) =>
  (p.items ?? []).reduce((s, it) => s + (it.quantity ?? 0) * (it.unit_cost ?? 0), 0);

/**
 * A vendor's PO history with real financials: every PO linked to this vendor
 * record (by id), their total committed spend (issued, non-void), and what's
 * still outstanding. Totals are always the sum of the POs' lines.
 */
export async function getVendorSummary(supplierId: string): Promise<VendorSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*, customer:customers(full_name)")
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as (PurchaseOrder & { customer?: { full_name: string | null } | null })[];
  const list: PoListRow[] = rows.map((r) => ({ ...r, customer_name: r.customer?.full_name ?? null }));
  await attachItems(supabase, list);

  let totalSpend = 0;
  let openCount = 0;
  let openTotal = 0;
  for (const p of list) {
    const t = poLineTotal(p);
    if (isCommittedPoStatus(p.status)) totalSpend += t;
    if (p.status === "ordered" || p.status === "received") {
      openCount += 1;
      openTotal += t;
    }
  }
  return { pos: list, totalSpend, openCount, openTotal };
}

export interface SpendRow {
  key: string;
  label: string;
  kind?: string | null;
  pos: number;
  spend: number;
}

/**
 * Purchasing spend for a period, answered TWO ways: by VENDOR (who we paid) and
 * by MANUFACTURER (whose product we moved) — different, both useful. Counts only
 * issued, non-void POs; totals are the sum of the POs' lines.
 */
export async function getPurchasingSpend(
  startISO: string,
  endISO: string,
): Promise<{ byVendor: SpendRow[]; byManufacturer: SpendRow[]; total: number }> {
  const empty = { byVendor: [], byManufacturer: [], total: 0 };
  try {
    const supabase = await createClient();
    const { data: posData } = await supabase
      .from("purchase_orders")
      .select("id, supplier, supplier_id, status, supplier_rec:suppliers(name, kind)")
      .in("status", [...COMMITTED_PO_STATUSES])
      .gte("created_at", startISO)
      .lte("created_at", endISO);
    const pos = posData ?? [];
    if (!pos.length) return empty;
    const poIds = pos.map((p) => p.id as string);

    // Line items for those POs.
    const items: { po_id: string; product_id: string | null; quantity: number | null; unit_cost: number | null }[] = [];
    const productIds = new Set<string>();
    for (let i = 0; i < poIds.length; i += 300) {
      const { data } = await supabase
        .from("po_items")
        .select("po_id, product_id, quantity, unit_cost")
        .in("po_id", poIds.slice(i, i + 300));
      for (const it of data ?? []) {
        items.push({
          po_id: it.po_id as string,
          product_id: (it.product_id as string) ?? null,
          quantity: it.quantity == null ? null : Number(it.quantity),
          unit_cost: it.unit_cost == null ? null : Number(it.unit_cost),
        });
        if (it.product_id) productIds.add(it.product_id as string);
      }
    }

    // Each product's manufacturer.
    const mfrByProduct = new Map<string, string>();
    const pidArr = [...productIds];
    for (let i = 0; i < pidArr.length; i += 300) {
      const { data } = await supabase
        .from("products")
        .select("id, manufacturer")
        .in("id", pidArr.slice(i, i + 300));
      for (const p of data ?? [])
        mfrByProduct.set(p.id as string, ((p.manufacturer as string) || "").trim() || "Unknown");
    }

    // PO → vendor label/kind.
    const vendorOf = new Map<string, { key: string; label: string; kind: string | null }>();
    for (const p of pos) {
      const rawRec = (p as {
        supplier_rec?: { name: string; kind: string } | { name: string; kind: string }[] | null;
      }).supplier_rec;
      const rec = Array.isArray(rawRec) ? rawRec[0] : rawRec;
      vendorOf.set(p.id as string, {
        key: (p.supplier_id as string) ?? `name:${(p.supplier as string) ?? "—"}`,
        label: rec?.name ?? (p.supplier as string) ?? "Unrecorded vendor",
        kind: rec?.kind ?? null,
      });
    }

    const vend = new Map<string, SpendRow & { poSet: Set<string> }>();
    const manu = new Map<string, SpendRow & { poSet: Set<string> }>();
    let total = 0;
    for (const it of items) {
      const amt = (it.quantity ?? 0) * (it.unit_cost ?? 0);
      if (!amt) continue;
      total += amt;
      const v = vendorOf.get(it.po_id);
      if (v) {
        const row = vend.get(v.key) ?? { key: v.key, label: v.label, kind: v.kind, pos: 0, spend: 0, poSet: new Set() };
        row.spend += amt;
        row.poSet.add(it.po_id);
        vend.set(v.key, row);
      }
      const mfr = it.product_id ? (mfrByProduct.get(it.product_id) ?? "Unknown") : "Unknown";
      const mrow = manu.get(mfr) ?? { key: mfr, label: mfr, pos: 0, spend: 0, poSet: new Set() };
      mrow.spend += amt;
      mrow.poSet.add(it.po_id);
      manu.set(mfr, mrow);
    }
    const finalize = (m: Map<string, SpendRow & { poSet: Set<string> }>): SpendRow[] =>
      [...m.values()]
        .map(({ poSet, ...r }) => ({ ...r, pos: poSet.size }))
        .sort((a, b) => b.spend - a.spend);

    return { byVendor: finalize(vend), byManufacturer: finalize(manu), total };
  } catch {
    return empty;
  }
}

export interface StockPull {
  product_id: string;
  name: string;
  qty: number;
  unit: string;
}

/**
 * What this customer's jobs have pulled from our own inventory (the third
 * material source, alongside manufacturer/distributor POs). Aggregated per
 * product so the customer file shows a clear "from stock" picture.
 */
export async function getCustomerStockPulls(
  customerId: string,
): Promise<StockPull[]> {
  const supabase = await createClient();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("customer_id", customerId);
  const jobIds = (jobs ?? []).map((j) => j.id as string);
  if (!jobIds.length) return [];

  const { data: moves } = await supabase
    .from("stock_movements")
    .select("product_id, qty, kind")
    .in("job_id", jobIds)
    .eq("kind", "pull");
  const byProduct = new Map<string, number>();
  for (const m of moves ?? []) {
    const pid = m.product_id as string | null;
    if (!pid) continue;
    byProduct.set(pid, (byProduct.get(pid) ?? 0) + Math.abs(Number(m.qty) || 0));
  }
  if (!byProduct.size) return [];

  const ids = [...byProduct.keys()];
  const { data: prods } = await supabase
    .from("products")
    .select("id, name, unit")
    .in("id", ids);
  const meta = new Map(
    (prods ?? []).map((p) => [
      p.id as string,
      { name: (p.name as string) ?? "Item", unit: (p.unit as string) ?? "" },
    ]),
  );
  return ids.map((id) => ({
    product_id: id,
    name: meta.get(id)?.name ?? "Item",
    qty: Math.round((byProduct.get(id) ?? 0) * 100) / 100,
    unit: meta.get(id)?.unit ?? "",
  }));
}
